import { useRef } from 'react'
import { TAB_LABELS } from '../constants'
import type { TabKey } from '../types'
import { balanceIndicator } from '../lib/navigationState'

const paths: Record<TabKey, string> = {
  events: 'M4 5h16v14H4z M8 9h8 M8 13h5',
  chat: 'M20 11.5a8 8 0 0 1-8 8H4l1.6-4A8 8 0 1 1 20 11.5Z M8 10h8 M8 14h5',
  owners: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  polls: 'M4 20V10 M12 20V4 M20 20v-7',
  payments: 'M3 6h18v14H3z M3 10h18 M7 15h3',
  logs: 'M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h4',
}

type Props = {
  activeTab: TabKey
  tabs: TabKey[]
  badges: Record<TabKey, number>
  balance: number
  onSelect: (tab: TabKey) => void
}

export function GateIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 21V4h16v17M2 4h20M2 21h5M17 21h5" />
    <path d="M5 7h14M5 10h14M5 13h14" />
    <path d="M12 21v-5m-3 3 3-3 3 3" />
  </svg>
}

export function AppNavigation({ activeTab, tabs, badges, balance, onSelect }: Props) {
  const drawer = useRef<HTMLDialogElement>(null)
  const indicator = balanceIndicator(balance)
  const attentionCount = tabs.reduce((total, tab) => total + badges[tab], 0)
  const content = (mobile: boolean) => <>
    <div className="app-navigation__brand">
      <div><strong>MalinkiEco</strong></div>
      {mobile && <button className="app-navigation__close" onClick={() => drawer.current?.close()} aria-label="Закрыть меню">×</button>}
    </div>
    <nav aria-label="Разделы сайта">
      {tabs.map(tab => <button key={tab} type="button" aria-current={activeTab === tab ? 'page' : undefined}
        className={`app-navigation__item ${activeTab === tab ? 'is-active' : ''}`}
        onClick={() => { onSelect(tab); drawer.current?.close(); window.scrollTo({ top: 0, behavior: 'instant' }) }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[tab]} /></svg>
        <span>{TAB_LABELS[tab]}</span>
        {tab === 'payments' && <span className={`payment-status-coin payment-status-coin--${indicator.tone}`} role="img" aria-label={indicator.label} title={indicator.label}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9 17V7h4a3 3 0 0 1 0 6H7m0 2h7"/></svg></span>}
        {badges[tab] > 0 && <span className="app-navigation__badge" aria-label={`${tab === 'owners' ? 'Заявок на рассмотрении' : 'Новых записей'}: ${badges[tab]}`}>{badges[tab] > 99 ? '99+' : badges[tab]}</span>}
      </button>)}
    </nav>
  </>
  return <>
    <aside className="app-navigation">{content(false)}</aside>
    <button type="button" className="app-menu-toggle" aria-label="Открыть меню разделов" aria-haspopup="dialog"
      aria-describedby={attentionCount > 0 ? 'navigation-attention-count' : undefined}
      onClick={() => drawer.current?.showModal()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16 M4 12h16 M4 18h16" /></svg>
      {attentionCount > 0 && <span id="navigation-attention-count" className="app-menu-toggle__badge" aria-label={`Новых записей и заявок: ${attentionCount}`}>{attentionCount > 99 ? '99+' : attentionCount}</span>}
    </button>
    <dialog className="app-navigation-drawer" ref={drawer} aria-label="Меню разделов" onClick={event => { if (event.target === event.currentTarget) drawer.current?.close() }}>
      <div className="app-navigation__drawer-inner">{content(true)}</div>
    </dialog>
  </>
}
