import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, CalendarCheck, KeyRound, MoreHorizontal, Plus, RefreshCw, Trash2, Users, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import type { AccountDto } from '../lib/api.js'
import { endpoints } from '../lib/api.js'
import { useAccounts } from '../lib/queries.js'
import { compact, cooldown, errorMessage, int, percent, timeAgo } from '../lib/format.js'
import { AddAccountDialog } from '../components/AddAccountDialog.js'
import {
  Badge,
  Button,
  Card,
  CardHead,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Menu,
  MenuItem,
  MenuSeparator,
  Modal,
  PageHeader,
  StatCard,
} from '../components/ui.js'

export function Accounts(): React.ReactElement {
  const accounts = useAccounts()
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = React.useState(false)
  const [busy, setBusy] = React.useState('')
  const [deleteTarget, setDeleteTarget] = React.useState<AccountDto | null>(null)
  const [domainTarget, setDomainTarget] = React.useState<AccountDto | null>(null)
  const [domainValue, setDomainValue] = React.useState('')

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['accounts'] })
    void queryClient.invalidateQueries({ queryKey: ['benefit-summary'] })
    void queryClient.invalidateQueries({ queryKey: ['models'] })
  }

  const run = async (id: string, action: string, work: () => Promise<void>): Promise<void> => {
    setBusy(`${id}:${action}`)
    try {
      await work()
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy('')
    }
  }

  const refresh = (account: AccountDto): void => {
    void run(account.id, 'refresh', async () => {
      await endpoints.refreshAccount(account.id)
      toast.success('凭据与权益已刷新')
      invalidate()
    })
  }

  const test = (account: AccountDto): void => {
    void run(account.id, 'test', async () => {
      const { result } = await endpoints.testAccount(account.id)
      if (result.ok) toast.success(`连通正常 · ${result.model} · ${result.latencyMs}ms`)
      else toast.error(`测试失败：${result.message}`)
      invalidate()
    })
  }

  const checkin = (account: AccountDto): void => {
    void run(account.id, 'checkin', async () => {
      const { result } = await endpoints.checkinAccount(account.id)
      if (result.error !== '') toast.error(`签到失败：${result.error}`)
      else toast.success(`签到完成 · 积分变化 ${result.pointsDelta >= 0 ? '+' : ''}${result.pointsDelta}${result.actions.length > 0 ? ` · ${result.actions.join('、')}` : ''}`)
      invalidate()
    })
  }

  const keepalive = (account: AccountDto): void => {
    void run(account.id, 'keepalive', async () => {
      await endpoints.keepalive(account.id)
      toast.success('保活完成')
      invalidate()
    })
  }

  const toggle = (account: AccountDto, enabled: boolean): void => {
    void run(account.id, 'toggle', async () => {
      await endpoints.updateAccount(account.id, { enabled })
      invalidate()
    })
  }

  const checkinAll = async (): Promise<void> => {
    setBusy('all:checkin')
    try {
      const { results } = await endpoints.checkinAll()
      const failed = results.filter(item => item.error !== '')
      const gained = results.reduce((sum, item) => sum + item.pointsDelta, 0)
      if (failed.length > 0) toast.warning(`完成 ${results.length} 个账号，${failed.length} 个失败，积分变化 ${gained >= 0 ? '+' : ''}${gained}`)
      else toast.success(`全部签到完成 · 积分变化 ${gained >= 0 ? '+' : ''}${gained}`)
      invalidate()
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy('')
    }
  }

  const saveDomain = async (): Promise<void> => {
    if (domainTarget === null) return
    setBusy(`${domainTarget.id}:domain`)
    try {
      await endpoints.updateAccount(domainTarget.id, { domainAccount: domainValue.trim() })
      toast.success('域账号已保存')
      setDomainTarget(null)
      invalidate()
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy('')
    }
  }

  const remove = async (): Promise<void> => {
    if (deleteTarget === null) return
    setBusy(`${deleteTarget.id}:delete`)
    try {
      await endpoints.deleteAccount(deleteTarget.id)
      toast.success('账号已删除')
      setDeleteTarget(null)
      invalidate()
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy('')
    }
  }

  const list = accounts.data?.accounts ?? []
  const ready = list.filter(account => account.enabled && account.cooldownUntil <= Date.now()).length
  const points = list.reduce((sum, account) => sum + account.pointsBalance, 0)
  const spark = list.reduce((sum, account) => sum + account.sparkBalance, 0)
  const popups = list.reduce((sum, account) => sum + account.pendingPopups, 0)

  return (
    <>
      <PageHeader
        title="账号"
        desc="所有 AStudio 账号都在本机加密保管。失败会进入冷却并自动切换；凭据过期时用「刷新凭据」重新换取。"
        actions={(
          <>
            <Button variant="ghost" size="sm" onClick={() => void checkinAll()} loading={busy === 'all:checkin'} disabled={list.length === 0}>
              <CalendarCheck size={13} />全部签到
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void accounts.refetch()}><RefreshCw size={13} />刷新</Button>
            <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}><Plus size={14} />添加账号</Button>
          </>
        )}
      />

      <div className="grid-stats">
        <StatCard label="账号" value={compact(list.length)} hint={`${ready} 个当前可用`} icon={<Users size={12} />} />
        <StatCard label="通用积分" value={int(points)} hint="所有账号合计" icon={<Wallet size={12} />} />
        <StatCard label="Spark 积分" value={int(spark)} hint="Spark 模型专用" icon={<Wallet size={12} />} />
        <StatCard label="待领弹窗" value={compact(popups)} hint="每日奖励 / 下载奖励" icon={<BadgeCheck size={12} />} />
        <StatCard label="需要处理" value={compact(list.filter(account => !account.enabled || account.cooldownUntil > Date.now() || (account.credentials.cookie && !account.sessionOk)).length)} hint="凭据过期或冷却中" icon={<KeyRound size={12} />} />
      </div>

      <Card>
        <CardHead title="账号列表" sub={accounts.isPending ? '读取中…' : `${list.length} 个账号`} />
        {accounts.isPending && <div style={{ padding: 18 }}><LoadingBlock rows={5} /></div>}
        {accounts.isError && <div className="banner banner-danger" style={{ margin: 16 }}>{errorMessage(accounts.error)}</div>}
        {!accounts.isPending && list.length === 0 && (
          <EmptyState
            icon={<Users size={18} />}
            title="还没有 AStudio 账号"
            desc="可以短信登录，或从已登录的桌面端粘贴/导入会话。"
            action={<Button variant="primary" size="sm" onClick={() => setAddOpen(true)}><Plus size={14} />添加第一个账号</Button>}
          />
        )}
        {list.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>账号</th>
                  <th>状态</th>
                  <th className="num">通用积分</th>
                  <th className="num">Spark</th>
                  <th>套餐</th>
                  <th className="num">成功率</th>
                  <th>最近使用</th>
                  <th style={{ width: 56 }} />
                </tr>
              </thead>
              <tbody>
                {list.map(account => {
                  const total = account.successes + account.failures
                  const cooling = account.cooldownUntil > Date.now()
                  return (
                    <tr key={account.id}>
                      <td>
                        <div style={{ display: 'grid', gap: 2 }}>
                          <div className="row" style={{ gap: 7 }}>
                            <span style={{ fontWeight: 550 }}>{account.nickname || account.name}</span>
                            <Badge tone={account.source === 'sms-login' ? 'accent' : account.source === 'model-only' ? 'warning' : 'default'}>
                              {account.source === 'sms-login' ? '短信' : account.source === 'model-only' ? '仅模型' : account.source === 'file-import' ? '文件' : '粘贴'}
                            </Badge>
                          </div>
                          <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>
                            {account.mobileMasked || account.accountId || account.uid || account.id.slice(0, 12)}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          {account.enabled ? (
                            account.sessionOk
                              ? <Badge tone="success" dot>在线</Badge>
                              : <Badge tone="warning" dot>仅凭据</Badge>
                          ) : <Badge dot>已停用</Badge>}
                          {cooling && <Badge tone="danger">冷却 {cooldown(account.cooldownUntil)}</Badge>}
                          {account.lastError !== '' && (
                            <span title={account.lastError} className="badge badge-danger">上次失败</span>
                          )}
                        </div>
                      </td>
                      <td className="num">{account.pointsKnown ? int(account.pointsBalance) : '—'}</td>
                      <td className="num">{account.pointsKnown ? int(account.sparkBalance) : '—'}</td>
                      <td>{account.planName !== '' ? <Badge tone={account.planActive ? 'cyan' : 'default'}>{account.planName}</Badge> : <span className="faint">—</span>}</td>
                      <td className="num">{total === 0 ? '—' : percent(account.successes / total)}</td>
                      <td className="faint" style={{ fontSize: 11.5 }}>{timeAgo(account.lastUsedAt)}</td>
                      <td>
                        <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                          <Menu trigger={<button className="btn btn-ghost btn-icon" aria-label="账号操作"><MoreHorizontal size={16} /></button>}>
                            <MenuItem icon={<RefreshCw size={13} />} onSelect={() => refresh(account)}>刷新凭据与权益</MenuItem>
                            <MenuItem icon={<BadgeCheck size={13} />} onSelect={() => test(account)}>测试连通</MenuItem>
                            <MenuItem icon={<CalendarCheck size={13} />} onSelect={() => checkin(account)} disabled={!account.credentials.cookie}>签到 / 领权益</MenuItem>
                            <MenuItem icon={<KeyRound size={13} />} onSelect={() => keepalive(account)} disabled={!account.credentials.cookie}>保活</MenuItem>
                            <MenuItem onSelect={() => { setDomainTarget(account); setDomainValue(account.domainAccount) }}>设置域账号</MenuItem>
                            <MenuItem onSelect={() => toggle(account, !account.enabled)}>{account.enabled ? '停用账号' : '启用账号'}</MenuItem>
                            <MenuSeparator />
                            <MenuItem icon={<Trash2 size={13} />} danger onSelect={() => setDeleteTarget(account)}>删除账号</MenuItem>
                          </Menu>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHead title="调度说明" sub="失败切换与余额感知" />
        <div style={{ padding: 16, display: 'grid', gap: 8, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
          <div>· 请求按游标轮询账号；401 会先用 Cookie 重新换取 modelBearerToken 并重放一次；429 / 5xx 会换号重试，最多 3 个账号。</div>
          <div>· 通用与 Spark 积分都为 0 的账号在「余额感知轮换」开启时会被降权，但不会硬阻塞请求。</div>
          <div>· 冷却时间会随连续失败指数增长，成功一次即清零。账号的凭据只在内存中解密，日志和接口都不会回显。</div>
        </div>
      </Card>

      <AddAccountDialog open={addOpen} onOpenChange={setAddOpen} onAdded={invalidate} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={open => { if (!open) setDeleteTarget(null) }}
        title="删除账号"
        description={deleteTarget === null ? '' : `将删除 ${deleteTarget.nickname || deleteTarget.name} 及其绑定的密钥关系。此操作无法撤销。`}
        confirmLabel="删除"
        danger
        loading={busy.endsWith(':delete')}
        onConfirm={() => void remove()}
      />

      <Modal
        open={domainTarget !== null}
        onOpenChange={open => { if (!open) setDomainTarget(null) }}
        title="设置域账号"
        description="Beta 资格领取需要域账号；留空则自动跳过该项。"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDomainTarget(null)}>取消</Button>
            <Button variant="primary" loading={busy.endsWith(':domain')} onClick={() => void saveDomain()}>保存</Button>
          </>
        )}
      >
        <Field label="域账号" hint="仅在账号可领取 Beta 时使用，不会用于其他请求。">
          <Input value={domainValue} onChange={event => setDomainValue(event.target.value)} placeholder="name@example.com" />
        </Field>
      </Modal>
    </>
  )
}
