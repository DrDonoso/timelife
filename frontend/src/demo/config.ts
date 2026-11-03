/**
 * Public demo switch, set at BUILD time by `--mode demo` (frontend/.env.demo → `VITE_DEMO=1`).
 *
 * The demo answers the whole API in the browser (MSW service worker, src/demo/handlers.ts) from
 * sample data: there is no backend, no database and no sign-in, and every change lives in the
 * page's memory until it is reloaded. Normal builds never load anything from src/demo/ except
 * this flag (main.tsx imports the rest only behind a literal `import.meta.env.VITE_DEMO` check).
 */
export const IS_DEMO: boolean = import.meta.env.VITE_DEMO === '1'
