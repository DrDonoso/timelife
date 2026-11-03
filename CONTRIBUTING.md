# Contributing to Timelife

Thanks for your interest in Timelife! It started as a private app for one family, so it is opinionated in a few
places, but bug reports, fixes, translations and ideas are all welcome.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md) in every interaction, and report security problems privately
as described in [SECURITY.md](SECURITY.md) — never in a public issue.

## Before you start

- **Bugs:** [open an issue](https://github.com/DrDonoso/timelife/issues/new/choose) with the steps to reproduce it,
  the version you run (`/api/version` or the administration footer) and your browser and device. Check first whether
  it also happens in the [demo](https://demo.timelife.lauvid.com).
- **Features:** open an issue to discuss it before writing a large change, so we can agree on the approach first.
- **Privacy first.** Timelife keeps family photos away from public platforms. Changes that weaken that — public
  sharing, tracking, third-party analytics or external calls the administrator did not configure — are unlikely to be
  accepted.

## Development setup

You need [uv](https://docs.astral.sh/uv/) (Python 3.12 or newer; CI uses 3.14), Node.js 24,
[FFmpeg](https://ffmpeg.org/) (`ffmpeg` and `ffprobe` on the `PATH`, for video uploads) and, optionally, Docker.

```sh
git clone https://github.com/<you>/timelife.git && cd timelife
uv sync --locked
cd frontend && npm ci
```

[docs/development.md](docs/development.md) explains how to run the backend and the frontend with hot reload, the
local Docker stack, the demo data and every test suite. For a quick look at the interface without a backend, run
`npm run dev:demo` in `frontend/`: the [static demo](docs/demo.md) answers the API in the browser with sample data.

## Checks

CI runs all of these on every pull request, and a single `application` check must pass before merging. Run the ones
that cover your change before you push:

```sh
# Backend (repository root)
uv run pytest -q
uv run ruff check src tests scripts alembic
uv run mypy
uv run python scripts/export_openapi.py --check

# Frontend (frontend/)
npm run gen:api -- --check
npm run lint
npm test
npm run build
npm run e2e          # Playwright against the real backend (after npm run build)
npm run e2e:demo     # Playwright against the static demo
```

## Conventions

- **Tests.** New behaviour comes with tests: pytest for the backend (`tests/`), Vitest next to the code
  (`*.test.ts(x)`) and Playwright for user flows (`frontend/e2e/`), which also run axe accessibility checks. Keep the
  interface usable with a keyboard and a screen reader.
- **Translations.** The interface is Spanish first. Strings live in `frontend/src/i18n/locales/{es,en,pt}`: `es` is
  the source and every key needs its English and European Portuguese (`pt-PT`) version too, with the same
  placeholders — `src/i18n/i18n.test.tsx` fails otherwise. Every backend error code needs a message in each language.
- **Design system and colours.** Reuse the components in `frontend/src/components/` (documented in their
  [README](frontend/src/components/README.md)). Colours are CSS tokens per theme (`styles/tokens.css` for the default
  palette, `styles/themes.css` for the others); colours painted from JavaScript (categories, years, family lanes) go
  through `useThemeColors()`.
- **API contract.** After changing backend schemas or routes, run `uv run python scripts/export_openapi.py` and
  `npm --prefix frontend run gen:api`, and commit both `frontend/src/api/openapi.json` and
  `frontend/src/api/schema.gen.ts`.
- **Static demo.** Every `/api` endpoint the app calls needs a handler in `frontend/src/demo/handlers.ts` that follows
  the backend's rules; see [docs/demo.md](docs/demo.md#keeping-the-demo-in-step-with-the-app).
- **Database.** Schema changes need an Alembic migration in `alembic/versions/` (numbered `0007_…`, `0008_…`) that
  matches the models; `tests/test_migrations.py` checks upgrades and downgrades. Data that should survive a move to
  another server belongs in the backup format too (`src/timelife/backup_*.py`).
- **Privacy in logs.** Never log personal data or secrets (e-mails, names, notes, file names, tokens, exception
  messages that may carry SQL parameters).
- **Dependencies.** Keep them few. `uv.lock` must be locked against PyPI and `frontend/package-lock.json` must only
  resolve from `https://registry.npmjs.org/` — CI fails on any other registry. If your npm uses a mirror, rewrite the
  `resolved` URLs to `https://registry.npmjs.org/` before committing.
- **Screenshots.** When the interface changes visibly, refresh the documentation images with
  `npm --prefix frontend run gen:screenshots` (it captures the static demo into `docs/images/`).
- **Documentation.** Update the [README](README.md) or the guides in [docs/](docs/) when behaviour, configuration or
  commands change.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep each pull request focused on one change, with commits whose subject says what changes in the imperative
   (*Add…*, *Fix…*, *Show…*) and a body that explains why.
3. Fill in the pull request template: what changed, how you tested it and, for visible changes, screenshots.
4. Make sure CI is green. Workflows of first-time contributors start after a maintainer approves them.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE) of this project.
