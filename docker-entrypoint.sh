#!/bin/sh
set -eu
umask 077
alembic upgrade head
python -m timelife.seed
exec python -m uvicorn timelife.app:app --host 0.0.0.0 --port 7779 --no-access-log \
    --proxy-headers --forwarded-allow-ips "${TRUSTED_PROXY_IPS:-127.0.0.1}"
