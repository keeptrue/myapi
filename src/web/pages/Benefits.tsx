import * as React from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, CircleDollarSign, Gift, RefreshCw, Ticket, Users } from 'lucide-react'
import { toast } from 'sonner'
import type { AccountDto } from '../lib/api.js'
import { endpoints } from '../lib/api.js'
import { useAccounts, useBenefitEvents, useBenefitSummary } from '../lib/queries.js'
import { compact, dateTime, errorMessage, int } from '../lib/format.js'
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  StatCard,
} from '../components/ui.js'

export function Benefits(): React.ReactElement {
  const accounts = useAccounts()
  const summary = useBenefitSummary()
  const events = useBenefitEvents(120)
  const queryClient = useQueryClient()
  const [busy, setBusy] = React.useState('')
  const [redeemTarget, setRedeemTarget] = React.useState<AccountDto | null>(null)
  const [code, setCode] = React.useState('')

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['accounts'] })
    void queryClient.invalidateQueries({ queryKey: ['benefit-summary'] })
    void queryClient.invalidateQueries({ queryKey: ['benefit-events'] })
  }

  const checkin = async (account: AccountDto): Promise<void> => {
    setBusy(`${account.id}:checkin`)
    try {
      const { result } = await endpoints.checkinAccount(account.id)
      if (result.error !== '') toast.error(`签到失败：${result.error}`)
      else toast.success(`签到完成 · 积分变化 ${result.pointsDelta >= 0 ? '+' : ''}${result.pointsDelta}`)
      invalidate()
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy('')
    }
  }

  const checkinAll = async (): Promise<void> => {
    setBusy('all')
    try {
      const { results } = await endpoints.checkinAll()
      const failed = results.filter(item => item.error !== '').length
      const delta = results.reduce((sum, item) => sum + item.pointsDelta, 0)
      toast.success(`完成 ${results.length} 个账号${failed > 0 ? `，失败 ${failed}` : ''} · 积分变化 ${delta >= 0 ? '+' : ''}${delta}`)
      invalidate()
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy('')
    }
  }

  const keepalive = async (account: AccountDto): Promise<void> => {
    setBusy(`${account.id}:keepalive`)
    try {
      await endpoints.keepalive(account.id)
      toast.success('保活完成')
      invalidate()
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy('')
    }
  }

  const redeem = async (): Promise<void> => {
    if (redeemTarget === null || code.trim() === '') return
    setBusy(`${redeemTarget.id}:redeem`)
    try {
      const { result } = await endpoints.redeem(redeemTarget.id, code.trim())
      toast.success(`兑换成功 · +${result.points} 积分${result.expireTime !== '' ? ` · 到期 ${result.expireTime}` : ''}`)
      setRedeemTarget(null)
      setCode('')
      invalidate()
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy('')
    }
  }

  const list = accounts.data?.accounts ?? []
  const cookieAccounts = list.filter(account => account.credentials.cookie && account.enabled)

  return (
    <>
      <PageHeader
        title="权益"
        desc="积分、会员与每日签到。签到真正发奖的动作是上游的 init-app；弹窗代领只是关闭横幅。所有结果都按余额真实增量报告。"
        actions={(
          <>
            <Button variant="ghost" size="sm" onClick={() => void events.refetch()}><RefreshCw size={13} />刷新</Button>
            <Button variant="primary" size="sm" onClick={() => void checkinAll()} loading={busy === 'all'} disabled={cookieAccounts.length === 0}>
              <CalendarCheck size={13} />全部签到
            </Button>
          </>
        )}
      />

      <div className="grid-stats">
        <StatCard label="通用积分" value={int(summary.data?.generalPoints)} hint="全部账号合计" icon={<CircleDollarSign size={12} />} />
        <StatCard label="Spark 积分" value={int(summary.data?.sparkPoints)} hint="Spark 模型专用" icon={<CircleDollarSign size={12} />} />
        <StatCard label="待领弹窗" value={compact(summary.data?.pendingPopups)} hint="每日奖励 / 下载奖励" icon={<Gift size={12} />} />
        <StatCard label="有效套餐" value={compact(summary.data?.activePlans)} hint={`共 ${summary.data?.accounts ?? 0} 个账号`} icon={<Users size={12} />} />
        <StatCard label="最近签到日" value={summary.data?.lastCheckinDay === '' ? '—' : summary.data?.lastCheckinDay ?? '—'} hint="自动签到按本地时区" icon={<CalendarCheck size={12} />} />
      </div>

      <Card>
        <CardHead title="账号权益" sub="签到、保活、兑换码" actions={<Link to="/settings" className="btn btn-ghost btn-sm">签到设置</Link>} />
        {accounts.isPending && <div style={{ padding: 18 }}><LoadingBlock rows={4} /></div>}
        {!accounts.isPending && list.length === 0 && (
          <EmptyState icon={<Gift size={18} />} title="还没有可管理的账号" desc="先到账号页添加 AStudio 账号。" action={<Link to="/accounts" className="btn btn-primary btn-sm">去添加</Link>} />
        )}
        {list.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>账号</th>
                  <th className="num">通用积分</th>
                  <th className="num">Spark</th>
                  <th>套餐</th>
                  <th className="num">待领</th>
                  <th>会话</th>
                  <th>最近签到</th>
                  <th style={{ width: 240 }} />
                </tr>
              </thead>
              <tbody>
                {list.map(account => (
                  <tr key={account.id}>
                    <td style={{ fontWeight: 550 }}>{account.nickname || account.name}</td>
                    <td className="num">{account.pointsKnown ? int(account.pointsBalance) : '—'}</td>
                    <td className="num">{account.pointsKnown ? int(account.sparkBalance) : '—'}</td>
                    <td>{account.planName === '' ? <span className="faint">—</span> : <Badge tone={account.planActive ? 'cyan' : 'default'}>{account.planName}</Badge>}</td>
                    <td className="num">{account.pendingPopups}</td>
                    <td>{account.credentials.cookie ? <Badge tone={account.sessionOk ? 'success' : 'warning'} dot>{account.sessionOk ? '有效' : '待刷新'}</Badge> : <Badge>仅模型</Badge>}</td>
                    <td className="faint">{account.lastClaimAt === 0 ? '从未' : dateTime(account.lastClaimAt)}</td>
                    <td>
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <Button size="sm" variant="ghost" loading={busy === `${account.id}:checkin`} disabled={!account.credentials.cookie} onClick={() => void checkin(account)}>签到</Button>
                        <Button size="sm" variant="ghost" loading={busy === `${account.id}:keepalive`} disabled={!account.credentials.cookie} onClick={() => void keepalive(account)}>保活</Button>
                        <Button size="sm" variant="ghost" disabled={!account.credentials.cookie} onClick={() => { setRedeemTarget(account); setCode('') }}><Ticket size={13} />兑换</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHead title="权益事件" sub="最近 120 条 · 领取结果如实记录" />
        {events.isPending && <div style={{ padding: 18 }}><LoadingBlock rows={5} /></div>}
        {!events.isPending && (events.data?.events.length ?? 0) === 0 && (
          <EmptyState title="还没有权益事件" desc="完成一次签到或领取后，事件会出现在这里。" />
        )}
        {(events.data?.events.length ?? 0) > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>时间</th><th>账号</th><th>动作</th><th>结果</th><th>详情</th></tr></thead>
              <tbody>
                {events.data?.events.map((event, index) => (
                  <tr key={`${event.time}-${index}`}>
                    <td className="mono faint" style={{ fontSize: 10.5 }}>{dateTime(event.time)}</td>
                    <td>{event.accountName}</td>
                    <td>{event.action}</td>
                    <td>
                      <Badge tone={event.result === 'ok' ? 'success' : event.result === 'skipped' ? 'warning' : 'danger'} dot>
                        {event.result === 'ok' ? '成功' : event.result === 'skipped' ? '跳过' : '失败'}
                      </Badge>
                    </td>
                    <td className="muted" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.detail || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={redeemTarget !== null}
        onOpenChange={open => { if (!open) setRedeemTarget(null) }}
        title="兑换码"
        description={redeemTarget === null ? '' : `在 ${redeemTarget.nickname || redeemTarget.name} 上兑换`}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setRedeemTarget(null)}>取消</Button>
            <Button variant="primary" loading={busy.endsWith(':redeem')} disabled={code.trim() === ''} onClick={() => void redeem()}>兑换</Button>
          </>
        )}
      >
        <Field label="兑换码" hint="兑换成功后会自动刷新余额，并以真实增量报告。">
          <Input value={code} onChange={event => setCode(event.target.value)} placeholder="XXXX-XXXX-XXXX" autoFocus />
        </Field>
      </Modal>

      <Card>
        <CardHead title="自动签到说明" />
        <div style={{ padding: 16, display: 'grid', gap: 8, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
          <div>· 自动签到默认关闭；在设置里开启后，每天过了设定小时会补签一次，启动即补签。</div>
          <div>· 每天真正发奖的是 <code className="code">tenant-app/v2/init-app</code>；<code className="code">client-popups/complete</code> 只负责关闭横幅。</div>
          <div>· 下载奖励 / Beta 领取失败通常表示“今天已经领过”，会以 skipped 记录，不会伪装成成功。</div>
        </div>
      </Card>
    </>
  )
}

