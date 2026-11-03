# Troubleshooting

Common problems and their fixes. Start with `docker compose logs app`: invalid settings stop the container with an
explicit message.

| Symptom | Cause and fix |
| --- | --- |
| `required variable … is missing a value` when running `docker compose` | Set the variable in `.env` next to the compose file (see [Configuration](configuration.md)). |
| `app` restarts or stays `unhealthy` | Read `docker compose logs app`. Typical messages: `AUTH_SECRET must contain at least 32 characters`, `PUBLIC_ORIGIN must be a comma-separated list…`, `AUTH_COOKIE_SECURE=true requires HTTPS…`, `GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required together`, `SMTP_HOST is required when SMTP_FROM…`, `SMTP_FROM is required when SMTP_HOST is set`, `TZ must be an available IANA time zone`. |
| `password authentication failed for user "timelife"` | `POSTGRES_PASSWORD` changed after the database volume was created. Restore the old value, or run `docker compose exec db psql -U timelife -d timelife -c "ALTER ROLE timelife PASSWORD '<new>'"` and recreate `app`. |
| `.env` changes have no effect | Recreate the container: `docker compose up -d --force-recreate app`. |
| `400 invalid_host` | The proxy does not preserve the `Host` header, or that host name is missing from `PUBLIC_ORIGIN`. |
| `403 invalid_origin` when saving | The page was opened through a URL that is not in `PUBLIC_ORIGIN` (another host name, an IP address or a different port). Add it or use the canonical URL. |
| Signed in, but back at the login page right away | The session cookie was not stored. With `AUTH_COOKIE_SECURE=true` it needs HTTPS (some browsers also refuse Secure cookies on `http://localhost`): open the HTTPS URL, or use the local stack for plain-HTTP testing. |
| Google: `redirect_uri_mismatch` | The redirect URI must match `<origin>/api/auth/google/callback` exactly for the URL you opened (scheme, host, port). |
| Google: "access blocked" / app not available | The OAuth app is in *Testing* and the account is not a test user — add it or publish the app. |
| Login error *not invited* (`google_not_invited`) | Give that Google account's e-mail access in **Administración → Usuarios**. |
| Login error *El correo (o el usuario) o la contraseña no son correctos* | Wrong e-mail or password, or the account has no password yet (Google only): an administrator gives it one with the key button in **Usuarios**. After 10 failed attempts the e-mail is blocked for 5 minutes (`login_throttled`). |
| The login page shows **Crea la cuenta de administración** on a server with data | No enabled administrator is left (e.g. disabled in the database by hand). Create one there, or use the recovery link below to give an existing account administrator rights. |
| Nobody can sign in as administrator (lost password) | `docker compose exec app python -m timelife.setup` and open the printed link within the hour (see [lost administrator access](administration.md#lost-administrator-access)). |
| No **¿Has olvidado tu contraseña?** link | No SMTP server is configured (`/api/auth/config` shows `"password_reset_enabled":false`): set `SMTP_HOST` and `SMTP_FROM` and recreate. |
| "Forgot password" e-mails do not arrive | Run `docker compose exec app python -m timelife.mail you@example.com` and read its error; the logs show `E-mail not sent (password reset: …)`. Check the spam folder, the credentials (Gmail needs an app password) and that `SMTP_FROM` is the mailbox's address. |
| A "forgot password" link says it expired or was used | Links work once and for an hour, and asking again replaces the previous one: use the latest e-mail, or ask again. |
| Login error *account disabled* | Re-enable the user in **Administración → Usuarios**. |
| No **Continuar con Google** button | Google is not configured (`/api/auth/config` shows `"google_enabled":false`): set both Google variables and recreate. |
| `request_throttled` for several people | Every request appears to come from the proxy: configure `TRUSTED_PROXY_IPS`. |
| Uploads fail with `413` | Raise `MAX_UPLOAD_MB` / `MAX_VIDEO_UPLOAD_MB` and the proxy's body-size limit. |
| Importing a backup says the server or its proxy refuses the 32 MB parts (`import_chunk_too_large`) | The proxy's body-size limit is below 32 MB: raise it (nginx `client_max_body_size`). |
| Importing a backup says there is not enough free space (`import_no_space`) | The server needs room for the file plus about as much again while it imports: free space on the media volume, then choose the file again. |
| `backup_busy` when exporting or starting an import | One export or import runs at a time: wait for the other one (another administrator may be downloading a copy, or the last import is still deleting the photos it replaced). |
| An import says *El servidor se reinició mientras importaba* | Nothing was changed: start it again from **Importar y exportar** (the uploaded file is still there). |
| An exported ZIP larger than 4 GB does not open on a Mac | macOS's Archive Utility struggles with large ZIP64 archives: open it with The Unarchiver or 7-Zip. Timelife imports it either way. |
| A video stays *Procesando…* | Conversions run one at a time in the background: long or 4K videos take a while. `docker compose logs app` reports failures (`Video conversion failed …`); a video that cannot be converted shows an error in the editor — remove it and try another file. |
| `video_unavailable` when uploading a video | FFmpeg is missing (only when running the backend outside Docker): install it (`ffmpeg` and `ffprobe` on the `PATH`). |
| A Live Photo uploads without motion | Its video was not selected with it: both files must be chosen together and share the name (`IMG_1234.HEIC` + `IMG_1234.MOV`), or upload the `.livp` from iCloud.com. Safari on the iPhone only sends the still. |
| `Permission denied` under `/app/data/media` | The container runs as uid 1000. With a bind mount instead of the named volume, `chown -R 1000:1000` the host folder. |
| `503 frontend_not_built` | Development backend without a frontend build: use the Vite dev server or run `npm run build` in `frontend/`. |
| The home-screen icon is a letter, a screenshot or an old icon | iOS and Android copy the icon when the app is added: remove it from the home screen and add it again. Both read `/apple-touch-icon.png` and `/manifest.webmanifest`, which load without a session. |
| `Bind for 0.0.0.0:7779 failed: port is already allocated` | Choose another `APP_PORT` (and update `LOCAL_PUBLIC_ORIGIN` for the local stack). |
| The development login is missing | It exists only in `docker-compose.local.yml` / `ALLOW_INSECURE_LOCAL_LOGIN=true` with loopback origins, never in production. |
