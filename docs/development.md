# Development

How to run, test and release Timelife from source. Read [CONTRIBUTING.md](../CONTRIBUTING.md) for the conventions
pull requests follow.

## Local stack (Docker)

Requirements: Docker with Compose v2. The local stack builds the image from your working copy, so no Python or
Node.js installation is needed.

```powershell
Copy-Item .env.example .env        # Linux/macOS: cp .env.example .env
# Fill in POSTGRES_PASSWORD and AUTH_SECRET in .env with two different random values, e.g. from:
docker run --rm python:3.14-slim python -c "import secrets; print(secrets.token_urlsafe(48))"
docker compose -f docker-compose.local.yml up -d --build
```

Open <http://localhost:7779> and use the development login: user **`admin`** (administrator) or **`viewer`**
(read-only family member), password `LOCAL_LOGIN_PASSWORD` (default **`admin`**). They are the local accounts
`dev-admin@example.com` and `dev-viewer@example.com`. Until an administrator exists the login page also shows the
form that creates the first one (as on a real server), next to the development login.

Load demo data to explore the timeline (development databases only):

```powershell
docker compose -f docker-compose.local.yml exec app python -m timelife.demo
```

It creates two children (Lucía and Mateo, with a few shared milestones), 82 milestones from March 2024 to October 2026
and generated photos. It is deterministic and does nothing if the demo children already exist. Options:
`--events N` loads a smaller sample, and `--reset` first deletes **all** events and children with their photos. The
command refuses to run unless `ALLOW_INSECURE_LOCAL_LOGIN=true`.

Everyday commands:

```powershell
docker compose -f docker-compose.local.yml logs -f app         # follow the logs
docker compose -f docker-compose.local.yml up -d --build       # rebuild after code changes
docker compose -f docker-compose.local.yml down                # stop, keep the data
docker compose -f docker-compose.local.yml down -v             # stop and delete the local database and photos
```

The local stack (Compose project `timelife-local`, with its own volumes):

- publishes the app only on `127.0.0.1:${APP_PORT}` (default 7779) — never expose it through a proxy or tunnel;
- serves plain HTTP with non-Secure cookies and enables the development login (`ALLOW_INSECURE_LOCAL_LOGIN=true`);
- uses `LOCAL_PUBLIC_ORIGIN` instead of `PUBLIC_ORIGIN`; if you change `APP_PORT`, set
  `LOCAL_PUBLIC_ORIGIN=http://localhost:<port>` as well;
- makes Google and e-mail optional, as everywhere: set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and register
  `http://localhost:7779/api/auth/google/callback` to try the real Google sign-in, and the `SMTP_*` values to try
  "forgot password" e-mails.

## Development without Docker

Hot reload for backend and frontend (Python ≥ 3.12, [uv](https://docs.astral.sh/uv/), Node.js 24, and
[FFmpeg](https://ffmpeg.org/) — `ffmpeg` and `ffprobe` on the `PATH` — for video uploads, e.g. `winget install
Gyan.FFmpeg`, `brew install ffmpeg` or `apt install ffmpeg`). Add these development values to your `.env` (see the end
of [`.env.example`](../.env.example)):

```dotenv
DATABASE_URL=sqlite+aiosqlite:///./data/timelife.db
MEDIA_DIR=./data/media
AUTH_SECRET=<random value, at least 32 characters>
PUBLIC_ORIGIN=http://localhost:5173,http://localhost:7779
AUTH_COOKIE_SECURE=false
ALLOW_INSECURE_LOCAL_LOGIN=true
```

Backend (repository root):

```powershell
uv sync --locked
uv run alembic upgrade head
uv run python -m timelife.seed
uv run python -m timelife.demo            # optional sample data
uv run uvicorn timelife.app:app --reload --port 7779
```

Frontend (second terminal):

```powershell
cd frontend
npm ci
npm run dev                               # http://localhost:5173, proxies /api to http://127.0.0.1:7779
```

Open <http://localhost:5173> and use the development login (`admin` or `viewer`, password `LOCAL_LOGIN_PASSWORD`,
default `admin`). Set `VITE_API_TARGET` (e.g. `$env:VITE_API_TARGET="http://127.0.0.1:7801"`) when the backend
listens elsewhere. `PUBLIC_ORIGIN` must list the Vite origin because the backend checks the browser's `Origin` on
every change. Until you run `npm run build`, the backend's own URL (<http://localhost:7779>) answers
`503 frontend_not_built`; use the Vite URL instead. Generated data lives in the git-ignored `data/` folder.

To try "forgot password" e-mails without a real mailbox, run a local SMTP catcher such as
[Mailpit](https://mailpit.axllent.org/) (`docker run --rm -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025
axllent/mailpit`) with `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_SECURITY=none` and
`SMTP_FROM=timelife@example.com`, and read the messages on <http://localhost:8025>.

## Tests and quality checks

Backend (repository root):

```powershell
uv run pytest -q
uv run ruff check src tests scripts alembic
uv run mypy
uv run python scripts/export_openapi.py --check
```

Tests use temporary SQLite databases by default. To run them against PostgreSQL like CI, set
`TEST_DATABASE_URL=postgresql+asyncpg://postgres:<password>@localhost:5432/timelife_test` — the database must be named
`timelife_test` and **is wiped by the tests**; never point it at real data. The video tests encode small clips with
FFmpeg and are skipped when `ffmpeg`/`ffprobe` are not installed (CI installs them).

Frontend (`frontend/`):

```powershell
npm ci
npm run gen:api -- --check    # API types match src/api/openapi.json
npm run lint
npm test                      # Vitest
npm run build                 # tsc --noEmit + vite build
npx playwright install chromium
npm run e2e                   # Playwright end-to-end suite (serves the build above)
npm run e2e:demo              # Playwright smoke test of the static demo (builds it itself)
```

The end-to-end suite (`frontend/e2e/`) drives the real backend serving the built SPA, so run `npm run build` first
(and again after frontend changes) and keep the Python environment synced (`uv sync`); FFmpeg must be on the `PATH`
(the `media` spec converts real videos). Playwright starts
`uv run --no-sync python scripts/e2e_server.py` from the repository root: a fresh SQLite database and media folder
under `.tmp/e2e-server/`, the default categories, 40 deterministic demo milestones and the development sign-in on
<http://127.0.0.1:7810>; the folder is deleted when the server stops. Specs:

- `auth` — login redirect (the e-mail form, no Google or "forgot password" without their settings), development
  sign-in and sign-out, viewers kept out of `/admin` and the edit button, the home-screen manifest and icons available
  without a session, nothing new to read at a first visit and every note in the user menu's **Novedades**;
- `timeline` (desktop and phone) — newest-first line, the opening sweep, keyboard navigation, zoom with the controls,
  keys and hubs, search, full-screen photos on phones, *Todos juntos* (a line per child, shared milestones between
  them), category and date filters, mode (light/dark), colour theme and language (Spanish, English and Portuguese);
- `event-flow` — child with avatar (its timeline address made from the name), milestone with photos (cover, order,
  names), detail card, edit, trash, restore and permanent deletion;
- `media` — a video and a Live Photo (photo + clip) uploaded together and converted by the server, the video player
  and the LIVE badge on the card, the Live Photo switched off from the editor (Playwright's Chromium has no H.264
  decoder: players are checked by their markup);
- `admin` — categories (names in three languages, colour, icon, order), a year's own colour (added, seen on the
  timeline, removed), a child's own line colour on *Todos juntos*, a user added with a generated temporary password
  who chooses their own at the first sign-in (in another browser) and then gets a new one from an administrator, the
  events' date filter and same-day order, a milestone added from the timeline's **Nuevo hito** button, and the cover
  framing;
- `a11y` — axe-core (WCAG 2.2 A/AA and best practices) on every screen, desktop and phone, in light and dark modes,
  the first-password, recovery and new-password pages included, plus the key screens in every colour theme: no
  serious or critical violations;
- `memories` — the notice of today's memories and the header's list, with a milestone of a year ago made for it
  (the development users' memories of the day count as seen everywhere else, so their notice never covers a page);
- `push` — notifications turned on from the account panel (the real service worker and server registration, with
  stand-ins for the permission and the browser's subscription: Chromium has no push service in tests), the choice of
  which ones arrive (kept after a reload), registered again at the next opening, and turned off. The e2e server
  answers in place of the push services (`webpush.TRANSPORT`), so nothing leaves the machine when the other specs add
  milestones.

Specs that sign in or change data run one at a time, the rest in parallel. Handy commands:
`npx playwright test e2e/timeline.spec.ts --project=mobile`, `npx playwright test --ui` and `npx playwright show-report`.
Locally, a server already listening on port 7810 is reused; in CI a failing run uploads the HTML report and traces as
the `playwright-report` artifact.

## API contract

The frontend's API types are generated from the backend's OpenAPI contract. After changing backend schemas or routes,
run `uv run python scripts/export_openapi.py` and `npm --prefix frontend run gen:api`, and commit both
`frontend/src/api/openapi.json` and `frontend/src/api/schema.gen.ts`. Every endpoint the app calls also needs a
handler in the [static demo](demo.md#keeping-the-demo-in-step-with-the-app).

## What's new notes

A change people will notice comes with a note in the same pull request: the next time each person opens Timelife,
a window (**Novedades**) tells them what is new since they last looked, once, and the user menu keeps every note.
People opening it for the first time start with nothing to catch up on. A note is a JSON file in
`frontend/src/whatsNew/notes/` named `YYYY-MM-DD-short-name.json` (the day it is written; lower-case letters, digits
and hyphens):

```json
{
  "kind": "new",
  "audience": "everyone",
  "icon": "search",
  "link": "/all",
  "es": {
    "title": "Busca un recuerdo escribiendo lo que pasó",
    "body": "Escribe en el buscador, por ejemplo «primeros pasos», y verás solo los hitos que lo cuentan."
  },
  "en": {
    "title": "Find a memory by typing what happened",
    "body": "Type in the search box, for example \"first steps\", to see only the milestones about it."
  },
  "pt": {
    "title": "Encontra uma memória escrevendo o que aconteceu",
    "body": "Escreve na pesquisa, por exemplo «primeiros passos», para veres só os marcos sobre isso."
  }
}
```

- `kind`: `new` (something people can do now), `improved` (something works better) or `fixed` (a problem people
  noticed is gone). The window shows new things first, then improvements, then fixes.
- `audience`: `everyone`, or `admins` for the administration pages (viewers never see those notes).
- `icon` (optional): a key of `NOTE_ICONS` in `frontend/src/whatsNew/icons.ts`; without it, the icon of its kind.
- `link` (optional): a page of the app where it can be tried, the same for every family (`/all`, `/admin/backup`;
  administration pages only in `admins` notes). The note then gets a **Llévame allí** button.
- `es`, `en`, `pt`: a `title` (70 characters at most) saying what people can do now, and a `body` (300 at most) with
  one or two short sentences on what it means for them and where to find it.

Write for a grandparent, not a developer: everyday words, no technical ones (server, version, cache, browser, API,
upload limits…), "tú" in Spanish and "tu" in European Portuguese like the rest of the interface, one change per note.
Fixes only deserve a note when people noticed the problem. Dependency updates, refactoring, CI, documentation and
invisible fixes need none. The file name is the note's id: once released, never rename or delete a note (people
would see it again, or lose it from the list); correct its texts instead. `src/whatsNew/notes.test.ts` checks every
note (name, date, fields, icon, link and the three languages), and the release on GitHub lists, in English, the notes
added since the previous release (below).

## Home-screen icons

The home-screen icons in `frontend/public/` are rendered from `favicon.svg` on an opaque cream tile (iOS turns
transparency black): `apple-touch-icon.png` (180 px, linked from `index.html`) for iOS, and `icon-192.png`,
`icon-512.png` and `icon-maskable-512.png` (listed in `manifest.webmanifest`) for Android, whose launchers crop the
maskable one to their own shape; `badge-96.png` is the mark in white on transparency, the silhouette Android's status
bar shows for the notifications. After changing the favicon, run `npm --prefix frontend run gen:icons` (it uses
Playwright's Chromium) and commit the PNGs. `src/homeScreen.test.ts` checks the links, sizes and colours, and the
end-to-end suites (`auth`, `demo`) that Chromium parses the manifest and loads every icon.

## Notifications

The server sends them itself (`src/timelife/webpush.py` for the protocol, `src/timelife/push.py` for the devices, the
preferences and the round of every minute); `frontend/src/push/` turns them on and off and chooses which ones arrive,
`frontend/public/sw.js` shows them where the browser does not. The backend tests never contact a push service:
`tests/conftest.py` stops the round that runs every minute and replaces the network (`webpush.TRANSPORT`), and the
tests call `app.state.notifier.tick(now)` with the moment they want.

To try them by hand, Chrome on `http://localhost` (the Vite dev server or the local stack) turns them on and receives
them: sign in as `viewer` there and add a milestone as `admin` in another browser (or a private window), and it
arrives within a minute. An iPhone needs an HTTPS address in `PUBLIC_ORIGIN` (a test deployment, or a tunnel to your
machine) and the app added to its Home Screen. The memories' notification goes out at the first minute between 9:00
and 21:00 of the device's day while the person has memories that day not yet told nor looked at; a birthday's, in the
same window, once a day on each device, when a child turns a year older (or a month, during their first year); a new
milestone's, at the next minute, to every device of everybody but whoever added it. To try the birthdays, give a child
the birth date of a year ago today before nine: a device already dealt with that day waits for the next one, unless
its `push_subscriptions.birthdays_notified_on` is cleared.

## Documentation screenshots

The pictures in the README and in `docs/images/` come from the static demo, so they only show its made-up sample data.
After visible interface changes, run `npm --prefix frontend run gen:screenshots` (it builds the demo, serves it and
captures every view with Playwright's Chromium) and commit the PNGs. Never use photos of a real family.

## Production image

To build the production image locally: `docker build -t timelife:local .`

## Continuous integration and releases

Every job runs on GitHub-hosted runners (`ubuntu-latest`); the actions are pinned to commit SHAs, and Dependabot
proposes grouped updates of the actions, the Python and npm packages and the base images once a month.

- **`.github/workflows/ci.yml`** runs on pull requests to `main` (and is reused by the release workflow). Jobs:
  - `backend` — `uv.lock` resolves from PyPI only, FFmpeg, `uv sync --locked`, pytest against a PostgreSQL 18
    service, Ruff, mypy and the OpenAPI contract check;
  - `frontend` — `package-lock.json` resolves from `registry.npmjs.org` only, `npm ci`, API-type check, oxlint,
    Vitest, production build, FFmpeg, Playwright (Chromium) and the static demo's smoke test;
  - `docker` — builds the real image, boots `docker-compose.yml` with throwaway secrets and a fake but well-formed
    Google client ID, and smoke-tests it: `/health` 200, `/api/version`, `/api/children` 401 without a session,
    `/api/auth/config` (Google enabled, development login and e-mail off, setup required), `/api/auth/dev-login` 404,
    creating the first administrator (and a second attempt refused), signing in with its password (and a wrong one
    refused), the administrator recovery command, the SPA shell and the notifications' service worker, the non-root
    user and FFmpeg (H.264, AAC and the HDR tone-mapping filters);
  - `application` — a single gate that fails unless every job succeeded. Make it a required status check for `main`.
- **`.github/workflows/docker-deploy.yml`** runs on every push to `main` (except documentation-only changes) or
  manually. It reruns the whole CI, computes a serialized CalVer version (`YYYYMMDD`, then `YYYYMMDD.02`, `.03`, …
  for further releases the same day, skipping any version that already has a git tag or a published image, so images
  are never overwritten), builds and pushes `drdonoso/timelife:latest` and `drdonoso/timelife:<version>` (with
  `IMAGE_TAG`/`BUILD_DATE` baked in and the GitHub Actions build cache), and creates a GitHub release with generated
  notes, headed by a *What's new* section in English with the [notes](#whats-new-notes) added since the previous
  release (`scripts/release_notes.py`; none when there are none). Releases are serialized (`timelife-release`
  concurrency group). Only `DrDonoso/timelife` publishes: in forks
  the workflow stops after CI. It never connects to your server: update it with
  `docker compose pull && docker compose up -d`.

**Repository secrets for publishing** (*Settings → Secrets and variables → Actions*):

| Secret | Value |
| --- | --- |
| `DOCKER_USERNAME` | Docker Hub user that can push the image. |
| `DOCKER_PASSWORD` | A Docker Hub **personal access token** with *Read & Write* permission (Docker Hub → Account settings → Personal access tokens), not the account password. |

```sh
gh secret set DOCKER_USERNAME --body <docker-hub-user>
gh secret set DOCKER_PASSWORD        # paste the token when prompted
```

The release uses the built-in `GITHUB_TOKEN`; no other secrets are needed. To publish your own image from a fork,
change `IMAGE` and the repository check of the `publish` job in `docker-deploy.yml`, and `image:` in
`docker-compose.yml`.
