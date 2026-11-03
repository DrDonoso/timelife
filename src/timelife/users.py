"""Administration of the people who can sign in (``/api/admin/users``).

Rules: e-mail addresses are unique (stored lower-case); nobody changes their own role, state or
password here, or deletes themselves; at least one enabled administrator always remains. Without
Google sign-in every new user needs a password. Passwords set here are temporary (changed at the
next sign-in). Role, state and password changes sign the user out everywhere."""

from fastapi import APIRouter, Request
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import DB, AdminUser, revoke_user_sessions, settings
from .contracts import IdPath, UserCreateIn, UserOut, UserPasswordIn, UserUpdateIn
from .db import User, utcnow
from .errors import AppError
from .password_auth import set_password
from .passwords import hash_password

admin_router = APIRouter(prefix="/api/admin", tags=["Users"])


def user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        disabled=user.disabled,
        google_linked=user.google_linked,
        has_password=user.has_password,
        must_change_password=user.must_change_password,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


def is_enabled_admin(user: User) -> bool:
    return user.role == "admin" and not user.disabled


async def email_taken(db: AsyncSession, email: str) -> bool:
    return await db.scalar(select(User.id).where(User.email == email)) is not None


async def lock_users(db: AsyncSession, user_id: int, *, admins: bool) -> tuple[User, int]:
    """Row-lock user ``user_id`` and, with ``admins``, every enabled administrator; return the user
    (else 404 ``user_not_found``) and how many other enabled administrators exist.

    Requests that may take administrator access away lock the same rows in id order (so they
    cannot deadlock): on PostgreSQL they run one at a time and each one counts the administrators
    the previous one left. SQLite ignores row locks (local development and tests only)."""
    condition = User.id == user_id
    if admins:
        condition = or_(condition, and_(User.role == "admin", User.disabled.is_(False)))
    rows = await db.scalars(
        select(User)
        .where(condition)
        .order_by(User.id)
        # FOR NO KEY UPDATE: unlike FOR UPDATE it never blocks the foreign-key checks of rows
        # referencing these users (new sessions, events, images).
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )
    user: User | None = None
    others = 0
    for row in rows:
        if row.id == user_id:
            user = row
        elif is_enabled_admin(row):
            others += 1
    if user is None:
        raise AppError("user_not_found", 404)
    return user, others


def check_admin_loss(user: User, others: int) -> None:
    """409 ``last_admin`` when ``user`` may not stop being an enabled administrator (demotion,
    disabling or deletion) because no other enabled administrator would remain."""
    if is_enabled_admin(user) and others == 0:
        raise AppError("last_admin", 409)


@admin_router.get("/users", response_model=list[UserOut])
async def list_users(admin: AdminUser, db: DB) -> list[UserOut]:
    users = await db.scalars(select(User))
    # Administrators first, then by e-mail, sorted here so every database (and collation) yields
    # the same code-point order.
    ordered = sorted(users, key=lambda user: (user.role != "admin", user.email))
    return [user_out(user) for user in ordered]


@admin_router.post("/users", response_model=UserOut, status_code=201)
async def create_user(body: UserCreateIn, request: Request, admin: AdminUser, db: DB) -> UserOut:
    if body.password is None and not settings(request).google_enabled:
        # Without Google sign-in, an account without a password could never be used.
        raise AppError("invalid_request", 422, fields={"password": "missing"})
    if await email_taken(db, body.email):
        raise AppError("user_exists", 409)
    user = User(
        email=body.email,
        name=body.name,
        role=body.role,
        disabled=False,
        auth_version=1,
        password_hash=None if body.password is None else await hash_password(body.password),
        must_change_password=body.password is not None,
        invited_by_id=admin.id,
        created_at=utcnow(),
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        if not await email_taken(db, body.email):
            raise
        raise AppError("user_exists", 409) from None  # invited concurrently
    return user_out(user)


@admin_router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(user_id: IdPath, body: UserUpdateIn, admin: AdminUser, db: DB) -> UserOut:
    # Only the fields sent change: a null role/disabled changes nothing, '' or null clears the name.
    user, others = await lock_users(
        db, user_id, admins=body.role is not None or body.disabled is not None
    )
    role = user.role if body.role is None else body.role
    disabled = user.disabled if body.disabled is None else body.disabled
    if (role, disabled) != (user.role, user.disabled):
        if user.id == admin.id:
            raise AppError("cannot_modify_self", 409)
        if role != "admin" or disabled:
            check_admin_loss(user, others)
        user.role, user.disabled = role, disabled
        await revoke_user_sessions(db, user)
    if "name" in body.model_fields_set:
        user.name = body.name
    await db.commit()
    return user_out(user)


@admin_router.put("/users/{user_id}/password", response_model=UserOut)
async def reset_user_password(
    user_id: IdPath, body: UserPasswordIn, admin: AdminUser, db: DB
) -> UserOut:
    """Give the user a new temporary password (to be changed at the next sign-in), sign them out
    everywhere and cancel their "forgot password" links. Your own: change it from your menu."""
    user, _ = await lock_users(db, user_id, admins=False)
    if user.id == admin.id:
        raise AppError("cannot_modify_self", 409)
    await set_password(db, user, body.password, temporary=True)
    await db.commit()
    return user_out(user)


@admin_router.delete("/users/{user_id}", status_code=204)
async def delete_user(user_id: IdPath, admin: AdminUser, db: DB) -> None:
    user, others = await lock_users(db, user_id, admins=True)
    if user.id == admin.id:
        raise AppError("cannot_modify_self", 409)
    check_admin_loss(user, others)
    # Foreign keys delete the user's sessions and reset links and clear references to them
    # (users they invited, events, images).
    await db.delete(user)
    await db.commit()
