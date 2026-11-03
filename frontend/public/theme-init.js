// Applies the saved theme, palette and language before the first paint. It is a separate file
// because the CSP (script-src 'self') forbids inline scripts. Plain ES5 that must never throw: on
// any failure the defaults stay (system mode, sunset palette, the page's language) and the app
// still boots normally.
//   localStorage 'timelife.theme'   = 'light' | 'dark' | 'system'  ->  <html data-theme> + color-scheme
//   localStorage 'timelife.palette' = 'sunset' | 'ocean' | 'forest' | 'lavender' | 'graphite'
//                                                                   ->  <html data-palette>
//   localStorage 'timelife.lang'    = 'es' | 'en' | 'pt'            ->  <html lang> (else index.html's)
// and paints the theme-color metas with the palette's background.
(function () {
  // --color-bg of every palette and mode: keep equal to THEMES[palette].background in
  // src/theme/themes.ts (src/theme/themeInit.test.ts checks it).
  var BACKGROUNDS = {
    sunset: { light: '#fbf7f2', dark: '#1c1816' },
    ocean: { light: '#f2f7fa', dark: '#0d171e' },
    forest: { light: '#f4f6ef', dark: '#101712' },
    lavender: { light: '#f8f6fc', dark: '#15121d' },
    graphite: { light: '#f6f6f5', dark: '#121212' }
  }

  function read(key) {
    try {
      var value = window.localStorage.getItem(key)
      // Accept JSON-encoded strings ("\"dark\"") as well as plain ones.
      return typeof value === 'string' ? value.replace(/^"(.*)"$/, '$1') : null
    } catch (error) {
      return null // Storage blocked (private mode, disabled site data).
    }
  }

  try {
    var root = document.documentElement
    var preference = read('timelife.theme')
    if (preference !== 'light' && preference !== 'dark') preference = 'system'
    var palette = read('timelife.palette')
    if (typeof palette !== 'string' || !Object.prototype.hasOwnProperty.call(BACKGROUNDS, palette)) palette = 'sunset'
    // Without a choice, index.html decides: Spanish, or English in the demo build.
    var lang = read('timelife.lang')
    if (lang !== 'es' && lang !== 'en' && lang !== 'pt') lang = root.getAttribute('lang') === 'en' ? 'en' : 'es'

    var theme = preference
    if (theme === 'system') {
      var prefersDark = false
      try {
        prefersDark = !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      } catch (error) {
        prefersDark = false
      }
      theme = prefersDark ? 'dark' : 'light'
    }

    root.setAttribute('data-theme', theme)
    root.setAttribute('data-palette', palette)
    root.style.colorScheme = theme
    root.setAttribute('lang', lang)

    // Browser UI colour: "system" keeps one meta per colour scheme; an explicit choice paints them
    // all with that theme.
    var colors = BACKGROUNDS[palette]
    var metas = document.querySelectorAll('meta[name="theme-color"]')
    for (var i = 0; i < metas.length; i++) {
      var media = metas[i].getAttribute('media') || ''
      var target = theme
      if (preference === 'system' && media) target = media.indexOf('dark') !== -1 ? 'dark' : 'light'
      metas[i].setAttribute('content', colors[target])
    }
  } catch (error) {
    // Never block the app: index.html already sets the default lang and the system colour scheme.
  }
})()
