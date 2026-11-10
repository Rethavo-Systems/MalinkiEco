import { useSyncExternalStore } from 'react'

const key = 'malinkieco.theme'
const subscribe = (callback: () => void) => {
  window.addEventListener('malinkieco-theme', callback)
  return () => window.removeEventListener('malinkieco-theme', callback)
}
export function ThemeSettings() {
  const theme = useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme ?? 'dark')
  return <section className="settings-panel__section theme-settings"><h4>Оформление</h4>
    <div className="theme-options" role="group" aria-label="Тема сайта">
      {(['light', 'dark'] as const).map(value => <button type="button" key={value} aria-pressed={theme === value} onClick={() => {
        try { localStorage.setItem(key, value) } catch { /* Apply for this session even without storage. */ }
        document.documentElement.dataset.theme = value
        document.documentElement.style.colorScheme = value
        window.dispatchEvent(new Event('malinkieco-theme'))
      }}><span className={`theme-swatch theme-swatch--${value}`} aria-hidden="true" />{value === 'light' ? 'Светлая' : 'Тёмная'}<span className="theme-option-check" aria-hidden="true">{theme === value ? '✓' : ''}</span></button>)}
    </div>
  </section>
}
