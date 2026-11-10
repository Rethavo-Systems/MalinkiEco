const key = 'malinkieco.theme'
export function applySavedTheme() {
  let theme = 'dark'
  try { if (localStorage.getItem(key) === 'light') theme = 'light' } catch { /* Private storage can be unavailable. */ }
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}
