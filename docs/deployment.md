# Deployment

Run Timelife on your own server with Docker Compose: the published image
[`drdonoso/timelife`](https://hub.docker.com/r/drdonoso/timelife) next to PostgreSQL. The
[README](../README.md#deploy-with-docker) has the short version.

## Requirements

- A Linux host (VM, LXC container or VPS) with Docker Engine and the Compose plugin. The image is built for
  `linux/amd64`.
- A domain name with an HTTPS reverse proxy in front (Caddy, Traefik, nginx, Nginx Proxy Manager, Cloudflare Tunnel, …).
- Optional: a [Google OAuth client](configuration.md#google-sign-in-setup-optional) and an
  [SMTP server](configuration.md#e-mail-smtp-setup-optional).

## Install

```sh
mkdir -p /opt/timelife && cd /opt/timelife
curl -fsSLO https://raw.githubusercontent.com/DrDonoso/timelife/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/DrDonoso/timelife/main/.env.example
chmod 600 .env
# Two different random values for POSTGRES_PASSWORD and AUTH_SECRET (run it twice):
docker run --rm python:3.14-slim python -c "import secrets; print(secrets.token_urlsafe(48))"
# Edit .env: POSTGRES_PASSWORD, AUTH_SECRET and PUBLIC_ORIGIN (https://…); optionally GOOGLE_* and SMTP_*.
# Optionally pin IMAGE_TAG to a release.
docker compose pull
docker compose up -d
docker compose ps                            # app and db should become "healthy"
docker compose logs --tail=100 app
curl -fsS http://127.0.0.1:7779/health       # {"status":"ok"}
```

Then open the site right away and create the administrator account (see
[First run](administration.md#first-run)). Every setting is described in [Configuration](configuration.md).

`docker-compose.yml` pulls `drdonoso/timelife:${IMAGE_TAG:-latest}` from Docker Hub, publishes port
`${APP_PORT:-7779}` on all interfaces (use `APP_PORT=127.0.0.1:7779` when the proxy runs on the same host, or
firewall the port so the proxy is the only way in) and keeps PostgreSQL private. Data lives in the named volumes
`timelife_pgdata` and `timelife_media`.

## Reverse proxy

- Terminate TLS and proxy to `http://<docker-host>:7779`, **preserving the original `Host` header** — unknown hosts
  are rejected with `400 invalid_host`.
- Every URL people use must be listed in `PUBLIC_ORIGIN` exactly (scheme, host and non-default port) — with Google,
  each with a matching redirect URI. "Forgot password" links use the URL the request came from.
- Send `X-Forwarded-For`/`X-Forwarded-Proto` and set `TRUSTED_PROXY_IPS` to the proxy address *as seen from the
  container*. For a proxy on the Docker host that is usually the gateway of the `timelife_default` network
  (`docker network inspect timelife_default --format '{{(index .IPAM.Config 0).Gateway}}'`); for a proxy container
  attached to that network, its IP or subnet.
- Allow request bodies of at least `MAX_UPLOAD_MB` + `MAX_VIDEO_UPLOAD_MB` — a Live Photo and its clip travel in one
  request (nginx: `client_max_body_size 540m;`). Uploads answer before their video is converted, so default read
  timeouts are fine. Cloudflare Tunnel / proxied Cloudflare hostnames cap request bodies at 100 MB on the free plan:
  lower `MAX_VIDEO_UPLOAD_MB` or upload big videos through another hostname.
- **Import and export** need nothing more: an import travels in 32 MB requests (below Cloudflare's cap, and below the
  limit above) and its processing runs in the background, so no request waits long. The export is one long download
  that streams from the first byte (Caddy and Cloudflare pass it straight through; nginx spools up to
  `proxy_max_temp_file_size`, 1 GB, to a temporary file first unless `proxy_buffering off;` is set for
  `/api/admin/backup/export`).

A minimal Caddyfile (Caddy preserves `Host` and adds the forwarded headers):

```caddyfile
timelife.example.com {
    reverse_proxy 127.0.0.1:7779
}
```

## Updates

Back up first (see [below](#backups-and-restore)), then:

```sh
docker compose pull
docker compose up -d
docker image prune -f
```

Database migrations run automatically when the new container starts. For controlled updates pin `IMAGE_TAG` to a
release (`20261102`, `20261102.02`, …) and change it deliberately. Migrations are not reversed automatically: to roll
back, set the previous `IMAGE_TAG` **and** restore the backup taken before the update.

## Backups and restore

Back up **both** volumes — `timelife_pgdata` (the database: users, children, events, categories, settings) and
`timelife_media` (every photo and video, with their originals) — and keep a secure copy of `.env` and the image tag you
run. Store backups encrypted and off-site, and test a restore now and then.

### Backup

From the folder with `docker-compose.yml`:

```sh
umask 077
mkdir -p backup
docker compose stop app
docker compose exec -T db pg_dump -U timelife -d timelife -Fc > backup/timelife.dump
docker compose cp app:/app/data/media backup/media
docker compose start app
```

Stopping only `app` keeps the dump and the photos consistent with each other; the database keeps running. If any
command fails, start the app again and treat the backup as incomplete.

### Restore

This replaces all current data. On a new server, run `docker compose up -d` once first so the volumes, the
database and the containers exist:

```sh
docker compose stop app
docker compose exec -T db pg_restore -U timelife -d timelife --clean --if-exists < backup/timelife.dump
docker compose cp backup/media/. app:/app/data/media
docker compose run --rm --no-deps --user root --entrypoint sh app -c 'chown -R 1000:1000 /app/data/media'
docker compose up -d app
```

Use the same (or a newer) image version as the backup. Then check `/health`, sign in and open a few events with
photos. Sessions stored in the backup become valid again; rotate `AUTH_SECRET` and recreate `app` to sign everybody
out.

### From the app

**Administración → Importar y exportar** downloads the same content as one ZIP — users,
categories, children, every milestone (the trash too) with the original photos and videos, year colours and appearance
settings — and imports it back on this or another server (*Reemplazar todo* restores it exactly; *Fusionar* only adds
what is missing). Copies made by older versions of Timelife still import (their categories take the Spanish name as
the Portuguese one until it is edited); an older Timelife refuses a copy made by a newer one. It is handy for moving
to a new server, keeping an extra copy you can browse, or bringing back something deleted. It leaves out what only makes sense on one server: sessions (everyone signs in again), the link
between an account and its Google identity (made again, by e-mail, at the next sign-in) and the passwords — after
*Reemplazar todo* on another server, only the importing administrator keeps theirs: give the others new temporary
passwords from **Usuarios** (or they use *¿Has olvidado tu contraseña?* or Google). The thumbnails and the
browser-ready videos are made again after an import (videos show *Procesando…* for a while). An import needs free
space for the uploaded file and about as much again while it runs. The volume backup above remains the complete,
consistent copy to rely on for disaster recovery (it holds the password hashes too).
