"""Password hashing (scrypt) and the password rules of the API contracts."""

import re
from typing import Any

import pytest
from pydantic import TypeAdapter, ValidationError

from timelife import passwords
from timelife.contracts import NewPassword
from timelife.passwords import (
    hash_password,
    hash_password_now,
    needs_rehash,
    same_password,
    verify_password,
    verify_password_now,
)

from .conftest import PASSWORD_PARAMETERS

HASH = re.compile(r"scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})")


def test_hashes_are_salted_and_verified() -> None:
    first, second = hash_password_now("una contraseña"), hash_password_now("una contraseña")
    assert first != second  # a new salt every time
    match = HASH.fullmatch(first)
    assert match is not None
    assert tuple(int(value) for value in match.groups()[:3]) == (
        passwords.COST,
        passwords.BLOCK_SIZE,
        passwords.PARALLELISM,
    )
    assert verify_password_now("una contraseña", first)
    assert verify_password_now("una contraseña", second)
    for wrong in ("una contrasena", "Una contraseña", "una contraseña ", ""):
        assert not verify_password_now(wrong, first)


async def test_hashing_runs_in_worker_threads() -> None:
    stored = await hash_password("en un hilo aparte")
    assert await verify_password("en un hilo aparte", stored)
    assert not await verify_password("otra", stored)


def test_passwords_are_compared_in_nfkc() -> None:
    composed, decomposed = "contrase\u00f1a", "contrasen\u0303a"
    stored = hash_password_now(composed)
    assert verify_password_now(decomposed, stored)
    assert same_password(composed, decomposed)
    assert same_password("ｆｕｌｌｗｉｄｔｈ", "fullwidth")  # compatibility forms too
    assert not same_password("abc", "abd")


@pytest.mark.parametrize(
    "stored",
    [
        None,
        "",
        "garbage",
        "bcrypt$2b$12$abc",
        "scrypt$16$8$1$c2FsdA$" + "A" * 43,  # salt too short
        "scrypt$15$8$1$" + "A" * 22 + "$" + "A" * 43,  # cost not a power of two
        "scrypt$2097152$8$1$" + "A" * 22 + "$" + "A" * 43,  # cost beyond the accepted bound
        "scrypt$16$64$1$" + "A" * 22 + "$" + "A" * 43,
        "scrypt$16$8$32$" + "A" * 22 + "$" + "A" * 43,
        "scrypt$16$8$1$" + "A" * 22 + "$" + "A" * 4,  # key too short
        "scrypt$16$8$1$" + "!" * 22 + "$" + "A" * 43,
        "scrypt$x$8$1$" + "A" * 22 + "$" + "A" * 43,
    ],
)
def test_unusable_hashes_never_match(stored: str | None) -> None:
    assert not verify_password_now("contraseña", stored)


def test_hashes_with_other_parameters_still_match_and_need_a_rehash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(passwords, "COST", 2**3)
    old = hash_password_now("contraseña antigua")
    monkeypatch.setattr(passwords, "COST", 2**5)
    assert verify_password_now("contraseña antigua", old)
    assert needs_rehash(old)
    assert not needs_rehash(hash_password_now("contraseña antigua"))
    assert needs_rehash("garbage")


def test_the_real_parameters(monkeypatch: pytest.MonkeyPatch) -> None:
    cost, block_size, parallelism = PASSWORD_PARAMETERS
    # 32 MiB of memory per hash (scrypt needs 128 * n * r bytes).
    assert (cost, block_size) == (2**15, 8) and parallelism >= 1
    names = ("COST", "BLOCK_SIZE", "PARALLELISM")
    for name, value in zip(names, PASSWORD_PARAMETERS, strict=True):
        monkeypatch.setattr(passwords, name, value)
    stored = hash_password_now("con los parámetros reales")
    assert stored.startswith(f"scrypt${cost}${block_size}${parallelism}$")
    assert verify_password_now("con los parámetros reales", stored)


@pytest.mark.parametrize(
    "value", ["12345678", "ocho car", "  espacios  ", "ñ" * 8, "x" * 200, "mi clave larga"]
)
def test_new_passwords_accept_8_to_200_characters(value: str) -> None:
    assert TypeAdapter(NewPassword).validate_python(value) == value


@pytest.mark.parametrize(
    "value",
    ["", "1234567", " " * 20, "x" * 201, "con\x00nulo", "salto\nde línea", "a\tb\tc\td", 12345678],
)
def test_new_passwords_are_validated(value: Any) -> None:
    with pytest.raises(ValidationError):
        TypeAdapter(NewPassword).validate_python(value)
