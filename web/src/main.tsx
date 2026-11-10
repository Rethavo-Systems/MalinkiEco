import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applySavedTheme } from './lib/theme'
import './index.css'
import './AppTheme.css'
import './ThemePolish.css'
import './SectionsPolish.css'

applySavedTheme()
if (['/site-preview', '/chat-preview'].includes(window.location.pathname)) {
  window.history.replaceState(null, '', '/')
}
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => undefined) })
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
