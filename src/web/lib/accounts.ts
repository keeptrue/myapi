import type { CheckinResult } from '../../shared/providers.js'
import type { AccountDto } from './api.js'

/**
 * Display helpers for the console.
 *
 * `AccountDto` carries vendor state inside `profile`, so the pages read through these
 * accessors instead of naming AStudio fields directly. Swapping in a second provider then
 * needs no page changes beyond what the adapter already reports.
 */

export function accountName(account: AccountDto): string {
  const label = account.label.trim()
  if (label !== '') return label
  const nickname = account.profile.nickname.trim()
  return nickname !== '' ? nickname : account.id
}

function balanceOf(account: AccountDto, key: string): { value: number; known: boolean } {
  const found = account.profile.balances.find(item => item.key === key)
  return { value: found?.value ?? 0, known: found?.known ?? false }
}

export function points(account: AccountDto): { value: number; known: boolean } {
  return balanceOf(account, 'points')
}

export function spark(account: AccountDto): { value: number; known: boolean } {
  return balanceOf(account, 'spark')
}

export function credentialBadge(kind: AccountDto['credentialKind']): { tone: 'default' | 'accent' | 'cyan' | 'success' | 'warning' | 'danger'; label: string } {
  switch (kind) {
    case 'sms':
      return { tone: 'accent', label: '短信' }
    case 'client-import':
      return { tone: 'default', label: '文件' }
    case 'bearer-only':
      return { tone: 'warning', label: '仅模型' }
    case 'web-oauth':
      return { tone: 'cyan', label: '网页' }
    case 'paste':
    default:
      return { tone: 'default', label: '粘贴' }
  }
}

/** An account can check in or keep alive only when it holds a full credential, not a bare bearer. */
export function hasFullCredential(account: AccountDto): boolean {
  return account.sessionOk && account.credentialKind !== 'bearer-only'
}

export function planName(account: AccountDto): string {
  const active = account.profile.plans.find(plan => plan.active)
  return active?.name ?? account.profile.plans[0]?.name ?? ''
}

export function planActive(account: AccountDto): boolean {
  return account.profile.plans.some(plan => plan.active)
}

/** Sum every reported delta into one signed number for the toast. */
export function checkinDeltaText(result: CheckinResult): string {
  const sum = result.deltas.reduce((acc, item) => acc + item.value, 0)
  return `${sum >= 0 ? '+' : ''}${sum}`
}

/** Adapter-owned field read straight out of `profile`; never interpreted by the console. */
export function profileField(account: AccountDto, key: string): string {
  const value = account.profile.extra?.[key]
  return typeof value === 'string' ? value : ''
}

export function deltaLabel(result: CheckinResult): string {
  return result.deltas.map(item => `${item.label}${item.value >= 0 ? '+' : ''}${item.value}`).join('、')
}
