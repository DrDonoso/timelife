"""Password hashing with scrypt (standard library) and the password rules.

Hashes read ``scrypt$<n>$<r>$<p>$<salt>$<key>`` (salt and key in unpadded URL-safe base64), so
the cost can grow later: signing in rehashes a password stored with other parameters. Passwords
are NFKC-normalised first (the same password typed on another keyboard matches). Each hash needs
``128 * n * r`` bytes (32 MiB), so at most ``CONCURRENT_HASHES`` run at a time, in worker
threads. Accounts without a password are checked against a dummy hash: a sign-in takes the same
time whether the account exists or not."""

import base64
import binascii
import hashlib
import hmac
import secrets
import threading
import unicodedata

from starlette.concurrency import run_in_threadpool

ALGORITHM = "scrypt"
COST, BLOCK_SIZE, PARALLELISM = 2**15, 8, 2
SALT_BYTES = 16
KEY_BYTES = 32
CONCURRENT_HASHES = 2
MIN_LENGTH = 8
MAX_LENGTH = 200
# Parameters accepted from stored hashes (bounds the memory and time one check may take).
MAX_COST, MAX_BLOCK_SIZE, MAX_PARALLELISM = 2**20, 32, 16

_slots = threading.BoundedSemaphore(CONCURRENT_HASHES)
_DUMMY_SALT = secrets.token_bytes(SALT_BYTES)


def normalized(password: str) -> bytes:
    return unicodedata.normalize("NFKC", password).encode()


def same_password(first: str, second: str) -> bool:
    return hmac.compare_digest(normalized(first), normalized(second))


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _derive(
    password: str, salt: bytes, cost: int, block_size: int, parallelism: int, size: int
) -> bytes:
    with _slots:
        return hashlib.scrypt(
            normalized(password),
            salt=salt,
            n=cost,
            r=block_size,
            p=parallelism,
            maxmem=256 * cost * block_size + 1024 * 1024,
            dklen=size,
        )


def _parse(stored: str) -> tuple[int, int, int, bytes, bytes] | None:
    """``(n, r, p, salt, key)`` of a well-formed hash within the accepted bounds, else None."""
    parts = stored.split("$")
    if len(parts) != 6 or parts[0] != ALGORITHM:
        return None
    try:
        cost, block_size, parallelism = (int(part) for part in parts[1:4])
        salt, key = _decode(parts[4]), _decode(parts[5])
    except (ValueError, binascii.Error):
        return None
    if not (
        2 <= cost <= MAX_COST
        and cost & (cost - 1) == 0
        and 1 <= block_size <= MAX_BLOCK_SIZE
        and 1 <= parallelism <= MAX_PARALLELISM
        and 8 <= len(salt) <= 64
        and 16 <= len(key) <= 64
    ):
        return None
    return cost, block_size, parallelism, salt, key


def hash_password_now(password: str) -> str:
    salt = secrets.token_bytes(SALT_BYTES)
    key = _derive(password, salt, COST, BLOCK_SIZE, PARALLELISM, KEY_BYTES)
    return f"{ALGORITHM}${COST}${BLOCK_SIZE}${PARALLELISM}${_encode(salt)}${_encode(key)}"


def verify_password_now(password: str, stored: str | None) -> bool:
    """Whether ``password`` matches ``stored``; without a (valid) hash, the same work is done
    against a dummy one and the answer is False."""
    parsed = _parse(stored) if stored else None
    if parsed is None:
        _derive(password, _DUMMY_SALT, COST, BLOCK_SIZE, PARALLELISM, KEY_BYTES)
        return False
    cost, block_size, parallelism, salt, key = parsed
    candidate = _derive(password, salt, cost, block_size, parallelism, len(key))
    return hmac.compare_digest(candidate, key)


def needs_rehash(stored: str) -> bool:
    """Whether ``stored`` uses other parameters than the current ones."""
    parsed = _parse(stored)
    return parsed is None or parsed[:3] != (COST, BLOCK_SIZE, PARALLELISM)


async def hash_password(password: str) -> str:
    return await run_in_threadpool(hash_password_now, password)


async def verify_password(password: str, stored: str | None) -> bool:
    return await run_in_threadpool(verify_password_now, password, stored)
