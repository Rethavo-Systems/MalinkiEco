import type { RemoteUser } from '../types'
import { DEFAULT_NOTIFICATION_SETTINGS } from '../constants'

export const PLOT_COUNT = 35
export const PLOT_OPTIONS = Array.from({ length: PLOT_COUNT }, (_, index) => `Участок ${index + 1}`)
export const PLOTS_COLLECTION = 'plots'

export function normalizePlotName(raw: string): string {
  const normalized = raw.trim().replace(/^участок\s*/i, '').trim()
  return normalized ? `Участок ${normalized}` : ''
}

export function normalizePlots(plots: string[]): string[] {
  return Array.from(
    new Set(
      plots
        .map((plot) => normalizePlotName(String(plot ?? '')))
        .filter(Boolean),
    ),
  )
}

export function extractPlotsFromUser(user: Pick<RemoteUser, 'plotName' | 'plots'>): string[] {
  const normalizedPlots = normalizePlots(user.plots)
  if (normalizedPlots.length > 0) return normalizedPlots
  const singlePlot = normalizePlotName(user.plotName)
  return singlePlot ? [singlePlot] : []
}

export function extractPlotsFromUserData(data: Record<string, unknown>): string[] {
  const plots = Array.isArray(data.plots) ? data.plots.map(String) : []
  const normalizedPlots = normalizePlots(plots)
  if (normalizedPlots.length > 0) return normalizedPlots
  const singlePlot = normalizePlotName(String(data.plotName ?? ''))
  return singlePlot ? [singlePlot] : []
}

export function plotSortValue(raw: string): number {
  const normalized = normalizePlotName(raw)
  const suffix = normalized.replace(/^Участок\s*/i, '').trim()
  const asNumber = Number(suffix)
  return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : Number.MAX_SAFE_INTEGER
}

export function plotDocumentId(raw: string): string {
  const sortValue = plotSortValue(raw)
  if (sortValue !== Number.MAX_SAFE_INTEGER) {
    return `plot-${String(sortValue).padStart(2, '0')}`
  }

  const slug = normalizePlotName(raw)
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/giu, '-')
    .replace(/^-+|-+$/g, '')
  return `plot-${slug || 'unknown'}`
}

export function splitAmountAcrossPlots(plots: string[], amount: number): Map<string, number> {
  const normalizedPlots = normalizePlots(plots)
  const normalizedAmount = Math.round(amount)
  if (normalizedPlots.length === 0 || normalizedAmount === 0) return new Map()

  const sign = normalizedAmount >= 0 ? 1 : -1
  const absoluteAmount = Math.abs(normalizedAmount)
  const baseShare = Math.floor(absoluteAmount / normalizedPlots.length)
  let remainder = absoluteAmount % normalizedPlots.length
  const shares = new Map<string, number>()

  normalizedPlots.forEach((plot) => {
    const extra = remainder > 0 ? 1 : 0
    if (remainder > 0) remainder -= 1
    shares.set(plot, sign * (baseShare + extra))
  })

  return shares
}

export function deriveInitialPlotBalancesFromUsers(usersData: Record<string, unknown>[]): Map<string, number> {
  const balances = new Map<string, number>(PLOT_OPTIONS.map((plot) => [plot, 0]))
  const seededPlots = new Set<string>()

  usersData.forEach((data) => {
    const currentBalance = Number(data.balance ?? 0)
    if (!Number.isFinite(currentBalance) || currentBalance === 0) return

    const shares = splitAmountAcrossPlots(extractPlotsFromUserData(data), currentBalance)
    shares.forEach((share, plot) => {
      if (seededPlots.has(plot)) return
      balances.set(plot, share)
      seededPlots.add(plot)
    })
  })

  return balances
}

export function sumBalanceForPlots(
  plotBalances: Map<string, number>,
  plots: string[],
  fallbackBalance = 0,
): number {
  const normalizedPlots = normalizePlots(plots)
  if (normalizedPlots.length === 0) return fallbackBalance
  if (plotBalances.size === 0) return fallbackBalance
  return normalizedPlots.reduce((sum, plot) => sum + (plotBalances.get(plot) ?? 0), 0)
}

export function applyPlotBalancesToUser(user: RemoteUser, plotBalances: Map<string, number>): RemoteUser {
  const normalizedPlots = extractPlotsFromUser(user)
  return {
    ...user,
    plots: normalizedPlots,
    plotName: normalizedPlots.join(', '),
    balance: sumBalanceForPlots(plotBalances, normalizedPlots, user.balance),
    isPlaceholder: false,
  }
}

function ownerSortKey(user: Pick<RemoteUser, 'plotName' | 'plots' | 'fullName' | 'isPlaceholder'>): [number, number, string] {
  const plots = extractPlotsFromUser(user)
  const firstPlot = plots[0] ?? ''
  return [
    plotSortValue(firstPlot),
    user.isPlaceholder ? 1 : 0,
    user.fullName.toLocaleLowerCase('ru-RU'),
  ]
}

export function buildOwnersDirectory(users: RemoteUser[], plotBalances: Map<string, number>): RemoteUser[] {
  const actualUsers = users.map((user) => applyPlotBalancesToUser(user, plotBalances))
  const registeredPlots = new Set(actualUsers.flatMap((user) => extractPlotsFromUser(user)))

  const placeholders: RemoteUser[] = PLOT_OPTIONS
    .filter((plot) => !registeredPlots.has(plot))
    .map((plot) => ({
      id: `placeholder:${plotDocumentId(plot)}`,
      email: '',
      fullName: 'Собственник не зарегистрирован',
      plotName: plot,
      plots: [plot],
      role: 'USER',
      balance: sumBalanceForPlots(plotBalances, [plot], 0),
      lastChatReadAt: 0,
      notificationSettings: DEFAULT_NOTIFICATION_SETTINGS,
      phone: '',
      login: '',
      isPlaceholder: true,
    }))

  return [...actualUsers, ...placeholders].sort((left, right) => {
    const [leftPlotOrder, leftPlaceholderOrder, leftName] = ownerSortKey(left)
    const [rightPlotOrder, rightPlaceholderOrder, rightName] = ownerSortKey(right)
    if (leftPlotOrder !== rightPlotOrder) return leftPlotOrder - rightPlotOrder
    if (leftPlaceholderOrder !== rightPlaceholderOrder) return leftPlaceholderOrder - rightPlaceholderOrder
    return leftName.localeCompare(rightName, 'ru-RU')
  })
}
