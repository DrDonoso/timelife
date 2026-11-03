# Public demo

Try it at **<https://demo.timelife.lauvid.com>**.

`npm run build:demo` builds a version of the app that needs no server at all, meant for a public demo like that one:

- **No backend, no database, no sign-in.** A [Mock Service Worker](https://mswjs.io) answers every `/api` request in
  the browser (`frontend/src/demo/`) following the backend's rules: search, filters, trash, versions, protections and
  error messages. Visitors land straight on the timeline as the administrator *Alex Carter*, so everything can be
  tried: the editor, photo uploads, categories, children, appearance, users and the trash.
- **Sample data in English.** The Carter family: Emma (born March 2024) and Leo (born September 2025) with 82
  milestones up to 21 October 2026 and more as time passes, illustrated photos in which the two of them, at their age
  that day, live each milestone (with Mum, Dad or their grandparents when a photo's name says so), portraits, and six
  accounts (the two parents and four relatives). The dates move forward by whole years so the timeline always
  reaches the visitor's today, while birthdays, Halloween and Christmas keep their dates. The interface opens in English; Spanish and Portuguese are one click away.
- **Nothing is stored or sent anywhere.** Changes, including uploaded photos and videos (processed in the browser:
  videos and Live Photo clips play as uploaded, so only formats the browser can decode work), live in the tab's
  memory: a reload, or **Reset the demo** in the user menu (where *Sign out* would be), brings the sample data back. A
  welcome message says so once per tab.
- **HTTPS only.** Browsers run service workers only over HTTPS (or on `localhost`), and some not in private windows
  (Firefox); without one the page explains that the demo cannot start.

## Run it locally

No Python needed:

```powershell
cd frontend
npm ci
npm run dev:demo        # http://localhost:5173 with hot reload
npm run build:demo      # → frontend/dist-demo/ (the files to publish)
npm run preview:demo    # serves dist-demo/ on http://localhost:4173
```

Normal builds never contain the demo: the flag comes only from `frontend/.env.demo` (`VITE_DEMO=1`, read in
`--mode demo`), the demo code is a separate chunk loaded behind that flag, and `mockServiceWorker.js` is removed from
`dist/`.

## Deploy it to Cloudflare

Cloudflare Workers static assets are enough (the free plan too). `frontend/wrangler.jsonc` describes a
Worker without code that serves `frontend/dist-demo/`, returning `index.html` for deep links such as
`/c/emma/e/12`; the build also writes `dist-demo/_headers` with the app's security headers and cache rules.

1. Cloudflare dashboard → **Workers & Pages → Create → Import a repository** and choose your copy of Timelife:
   - **Root directory:** `frontend`
   - **Build command:** `npm run build:demo`
   - **Deploy command:** `npx wrangler@4 deploy`
   - **Build variables:** none needed (the build image uses Node 24). If you add `NODE_VERSION`, set it to `24`:
     an empty or unknown value installs an old Node whose npm cannot run `npm clean-install`.

   Every push to `main` then redeploys the demo. From a terminal instead (after `npx wrangler@4 login`):
   `cd frontend; npm run build:demo; npx wrangler@4 deploy`.
2. The Worker → **Settings → Domains & Routes → Add → Custom domain** → for example `demo.example.com`. With the
   domain's zone on the same Cloudflare account, Cloudflare creates the DNS record and the certificate.

## Keeping the demo in step with the app

- Every `/api` endpoint the app calls needs a handler in `frontend/src/demo/handlers.ts`, built on the in-memory store
  (`store.ts`) with the backend's rules and error codes. Requests the demo does not serve answer `501` and log
  `[demo] Unhandled API request:` to the console; `src/demo/demo.test.tsx` and `e2e/demo.spec.ts` fail on them.
- `scenario.ts` holds the content (written for 21 October 2026 plus one more year) and `artwork.ts` draws the pictures
  as SVG: the portraits (ported from `src/timelife/demo.py`) and the photos, composed in `art/` from the children at
  any age, the grown-ups, props and backdrops. `art/stories.ts` matches each milestone title to what its photos show;
  a new milestone needs a rule there (its test lists the ones without), or it only gets a portrait in its scene.
- Checks: `npm test` (Vitest, including `src/demo/`) and `npm run e2e:demo` (Playwright on the built demo, desktop and
  phone, with axe-core); both run in CI.
- After upgrading `msw`, refresh the committed worker script with `npx msw init public`.
