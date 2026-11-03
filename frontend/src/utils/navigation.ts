/** Full-page navigations (e.g. to Google's OAuth page); an object so tests can spy on it. */
export const browserNavigation = {
  assign(url: string): void {
    window.location.assign(url)
  },
}
