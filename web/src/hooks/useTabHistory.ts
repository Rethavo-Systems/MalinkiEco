import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import { TAB_LABELS } from '../constants'
import { readRequestedTabFromUrl } from '../lib/webPush'
import type { TabKey } from '../types'

function readTab(): TabKey {
  const requestedTab = readRequestedTabFromUrl()
  if (requestedTab) return requestedTab

  const tab: unknown = window.history.state?.malinkiecoTab
  return typeof tab === 'string' && Object.hasOwn(TAB_LABELS, tab) ? tab as TabKey : 'events'
}

function writeTab(tab: TabKey, method: 'pushState' | 'replaceState') {
  const url = new URL(window.location.href)
  if (url.searchParams.has('openTab')) url.searchParams.delete('openTab')
  window.history[method]({ ...window.history.state, malinkiecoTab: tab }, '', url)
}

export function useTabHistory(onTraverse: () => void) {
  const [requestedTab, setRequestedTab] = useState(readTab)
  const handleTraverse = useEffectEvent(onTraverse)

  useEffect(() => {
    writeTab(readTab(), 'replaceState')
    const restoreTab = () => {
      setRequestedTab(readTab())
      handleTraverse()
    }
    window.addEventListener('popstate', restoreTab)
    return () => window.removeEventListener('popstate', restoreTab)
  }, [])

  const selectTab = (tab: TabKey) => {
    if (tab !== readTab()) writeTab(tab, 'pushState')
    setRequestedTab(tab)
  }

  const replaceTab = useCallback((tab: TabKey) => {
    if (tab !== readTab()) writeTab(tab, 'replaceState')
    setRequestedTab(tab)
  }, [])

  return { requestedTab, selectTab, replaceTab }
}
