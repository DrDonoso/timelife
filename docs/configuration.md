# Configuration

Every setting of Timelife. The [README](../README.md#configuration) lists the essential ones.

All settings are environment variables. Compose reads them from `.env` (copy [`.env.example`](../.env.example), which
documents every value); the backend also reads `.env` directly when it runs outside Docker. `.env` is git-ignored and
excluded from the Docker build context — never commit it.

| Variable | Default | `docker-compose.yml` | Description |
| --- | --- | --- | --- |
| `POSTGRES_PASSWORD` | – | **required** | Password of the bundled PostgreSQL role/database `timelife`. Must be URL-safe (it is embedded in `DATABASE_URL`). Applied only when the `pgdata` volume is first initialised. |
| `AUTH_SECRET` | – | **required** | HMAC key (≥ 32 characters) for session tokens and sign-in state. Rotating it signs everybody out. |
| `PUBLIC_ORIGIN` | `http://localhost:7779` | **required** | Browser origin(s), comma-separated, e.g. `https://timelife.example.com,https://timelife.home.example.com`. Drives the host allow-list, the CSRF `Origin` check and the Google redirect URIs. No paths, credentials or wildcards. |
| `AUTH_COOKIE_SECURE` | `true` | optional | Secure cookies and HSTS. While `true`, every origin that is not localhost/127.0.0.1/[::1] must use HTTPS. |
| `GOOGLE_CLIENT_ID` | empty | optional | OAuth client ID (`….apps.googleusercontent.com`, type *Web application*). Both Google values or neither; with them, people can also sign in with Google (see [Google sign-in setup](#google-sign-in-setup-optional)). |
| `GOOGLE_CLIENT_SECRET` | empty | optional | OAuth client secret. |
| `SMTP_HOST` | empty | optional | SMTP server for "forgot password" e-mails (host name or IP, no port); empty turns them off. See [E-mail (SMTP) setup](#e-mail-smtp-setup-optional). |
| `SMTP_SECURITY` | `starttls` | optional | `starttls`, `ssl` (implicit TLS) or `none` (a relay on your own network; no credentials allowed). |
| `SMTP_PORT` | by `SMTP_SECURITY` | optional | 587 with `starttls`, 465 with `ssl`, 25 with `none` unless set. |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | empty | optional | Mailbox credentials (both or neither). |
| `SMTP_FROM` | empty | with `SMTP_HOST` | Sender: `timelife@example.com` or `"Timelife <timelife@example.com>"`. |
| `SESSION_DAYS` | `30` | optional | Session lifetime in days (1–365). |
| `MAX_UPLOAD_MB` | `30` | optional | Maximum size of one uploaded photo in MB (1–200). |
| `MAX_VIDEO_UPLOAD_MB` | `500` | optional | Maximum size of one uploaded video in MB (1–4096). |
| `MAX_VIDEO_MINUTES` | `10` | optional | Maximum length of one uploaded video in minutes (1–240). |
| `TZ` | `Europe/Madrid` | optional | IANA time zone of the server. |
| `TRUSTED_PROXY_IPS` | `127.0.0.1` | optional | IPs/networks allowed to set `X-Forwarded-*` headers (Uvicorn `--forwarded-allow-ips`). Never `*`. |
| `APP_PORT` | `7779` | optional | Published host port; `127.0.0.1:7779` publishes on loopback only (production file). |
| `IMAGE_TAG` | `latest` | optional | Image tag pulled by `docker-compose.yml`; pin a release such as `20261102`. |
| `LOCAL_PUBLIC_ORIGIN` | `http://localhost:7779` | local stack | Loopback origin(s) of `docker-compose.local.yml` (see [Development](development.md#local-stack-docker)). |
| `LOCAL_LOGIN_PASSWORD` | `admin` | local stack | Password of the development users `admin` and `viewer` (1–200 characters). |
| `ALLOW_INSECURE_LOCAL_LOGIN` | `false` | local stack sets `true` | Enables `POST /api/auth/dev-login`. Startup fails unless every public origin is loopback. |
| `DATABASE_URL` | – | set by Compose | `postgresql+asyncpg://user:password@host:5432/db` or `sqlite+aiosqlite:///./data/timelife.db`. |
| `MEDIA_DIR` | `data/media` | set by Compose | Photo storage folder (`/app/data/media` in the container). |

The image also carries `IMAGE_TAG` and `BUILD_DATE` (Docker build arguments, set by the release workflow), returned
by `/api/version` and shown in the administration footer.

Invalid settings stop the container with an explicit message in `docker compose logs app`. After editing `.env`,
**recreate** the container — a restart does not reload Compose variables:

```sh
docker compose up -d --force-recreate app
```

## Google sign-in setup (optional)

E-mail and password sign-in always works. With a Google OAuth client, people can also click **Continuar con Google**
and use the Google account of the e-mail an administrator gave access to (their first Google sign-in links it).

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create (or select) a project, e.g.
   `Timelife`.
2. Go to **Google Auth Platform** (*APIs & Services → OAuth consent screen*) and click **Get started**:
   - **Branding:** app name `Timelife`, user support e-mail and developer contact e-mail. A logo is optional
     (uploading one requires Google's brand verification).
   - **Audience:** *External* (or *Internal* if every family member belongs to your Google Workspace). While the
     publishing status is **Testing**, only the accounts listed under **Test users** can sign in — add each family
     member, or click **Publish app**. Timelife only requests the non-sensitive `openid`, `email` and `profile`
     scopes, so no scope verification is needed, and access is still limited to the people you invite in Timelife.
   - **Data access:** nothing to add.
3. Go to **Clients → Create client**, choose **Web application** and name it `Timelife`.
   - **Authorized JavaScript origins:** not needed (the flow runs on the server).
   - **Authorized redirect URIs:** add one entry per origin in `PUBLIC_ORIGIN`, with this exact path:

     ```text
     https://timelife.example.com/api/auth/google/callback
     http://localhost:7779/api/auth/google/callback      (local stack only; plain HTTP works only for localhost)
     ```

4. Copy the **Client ID** and **Client secret** into `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and recreate
   the app container. Changes in the Google console can take a few minutes to apply.
5. Check that `https://timelife.example.com/api/auth/config` returns `"google_enabled":true` and that the login page
   shows **Continuar con Google**.

Open Timelife in a regular browser: Google rejects embedded in-app browsers (`disallowed_useragent`).

## E-mail (SMTP) setup (optional)

With an SMTP server, the login page offers **¿Has olvidado tu contraseña?**: Timelife e-mails a link (in the language
of the page) to choose a new password. The link works once, for an hour, and asking again replaces it; the answer is
the same whether the e-mail has an account or not, and disabled accounts get nothing. Timelife sends no other e-mails.

1. Put the server's values in `.env` (examples below) and recreate the app container.
2. Check them: `docker compose exec app python -m timelife.mail you@example.com` sends a test e-mail and prints the
   server's answer when it fails (e.g. `SMTPAuthenticationError`).
3. `https://timelife.example.com/api/auth/config` returns `"password_reset_enabled":true` and the login page shows the
   link.

```dotenv
# Gmail / Google Workspace (an app password: Google account → Security → App passwords)
SMTP_HOST=smtp.gmail.com
SMTP_SECURITY=starttls
SMTP_USERNAME=your-account@gmail.com
SMTP_PASSWORD="abcd efgh ijkl mnop"
SMTP_FROM="Timelife <your-account@gmail.com>"

# A relay on your own network (no encryption, no credentials)
SMTP_HOST=192.168.1.20
SMTP_SECURITY=none
SMTP_FROM=timelife@home.example.com
```

Sending happens after the request was answered; a failure is only logged (`E-mail not sent (password reset: …)`,
without the address). Most providers only accept an `SMTP_FROM` with the address of `SMTP_USERNAME`.
