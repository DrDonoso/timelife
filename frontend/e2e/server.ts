// Where scripts/e2e_server.py serves the app (also its PUBLIC_ORIGIN, required by the API's
// same-origin check on mutations).
export const E2E_PORT = 7810
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`
