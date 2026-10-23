import * as React from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Activity, ArrowUpRight, Boxes, CircleDollarSign, Cpu, Gauge, RefreshCw, Users, Zap } from 'lucide-react'
import { PageHeader, Card, CardHead, StatCard, Badge, Button, LoadingBlock, EmptyState } from '../components/ui.js'
import { ModelBars, TrafficChart } from '../components/charts.js'
import { useAccounts, useBenefitSummary, useModels, useSummary, useSystem } from '../lib/queries.js'
import { compact, dateTime, int, ms, percent, timeAgo } from '../lib/format.js'
import { endpoints } from '../lib/api.js'
import { useQuery } from '@tanstack/react-query'

export function Overview(): React.ReactElement {
  const summary = useSummary('24h')
  const accounts = useAccounts()
  const models = useModels()
  const system = useSystem()
  const benefits = useBenefitSummary()
  const recent = useQuery({ queryKey: ['recent'], queryFn: () => endpoints.recent(12), refetchInterval: 10_000 })
  const queryClient = useQueryClient()

  const refresh = (): void => {
    void queryClient.invalidateQueries()
  }

  const total = summary.data?.total
  const successRate = total !== undefined && total.requests > 0 ? total.successes / total.requests : 0
  const firstToken = total !== undefined && total.firstTokenCount > 0 ? total.firstTokenMsSum / total.firstTokenCount : 0
  const ready = accounts.data?.accounts.filter(account => account.enabled && account.cooldownUntil <= Date.now()).length ?? 0
  const accountCount = accounts.data?.accounts.length ?? 0

  return (
    <>
      <PageHeader
        title="概览"
        desc="AStudio 上游的账号、模型、流量与权益一屏概览。所有数字来自本机网关的真实请求记录。"
        actions={(
          <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw size={13} />刷新</Button>
        )}
      />
      <div className="grid-stats">
        <StatCard label="24h 请求" value={compact(total?.requests)} hint={`失败 ${compact(total?.failures)}`} icon={<Activity size={12} />} />
        <StatCard label="成功率" value={percent(successRate)} hint={total?.requests === 0 ? '暂无请求' : `成功 ${compact(total?.successes)}`} icon={<Gauge size={12} />} />
        <StatCard label="Tokens" value={compact((total?.promptTokens ?? 0) + (total?.completionTokens ?? 0))} hint={`输入 ${compact(total?.promptTokens)} / 输出 ${compact(total?.completionTokens)}`} icon={<Cpu size={12} />} />
        <StatCard label="首 token" value={ms(firstToken)} hint={`${compact(total?.firstTokenCount)} 次流式样本`} icon={<Zap size={12} />} />
        <StatCard label="可用账号" value={`${ready}/${accountCount}`} hint={accountCount === 0 ? '尚未添加账号' : '未冷却且启用'} icon={<Users size={12} />} />
        <StatCard label="积分" value={int((benefits.data?.generalPoints ?? 0) + (benefits.data?.sparkPoints ?? 0))} hint={`通用 ${int(benefits.data?.generalPoints)} / Spark ${int(benefits.data?.sparkPoints)}`} icon={<CircleDollarSign size={12} />} />
      </div>

      <div className="split-main">
        <div className="stack">
          <Card>
            <CardHead
              title="请求与输出"
              sub="最近 24 小时 · 琥珀=请求数，红色=失败数"
              actions={<Link to="/usage" className="btn btn-ghost btn-sm">查看统计 <ArrowUpRight size={13} /></Link>}
            />
            <div style={{ padding: '10px 12px 6px' }}>
              {summary.isPending ? <LoadingBlock rows={5} /> : <TrafficChart summary={summary.data ?? emptySummary()} />}
            </div>
          </Card>

          <div className="split-even">
            <Card>
              <CardHead title="模型用量" sub="按请求数排序" />
              <div style={{ padding: '6px 12px 10px' }}>
                {summary.isPending ? <LoadingBlock rows={4} /> : <ModelBars summary={summary.data ?? emptySummary()} />}
              </div>
            </Card>
            <Card>
              <CardHead title="账号健康" sub="凭据 / 冷却 / 积分" actions={<Link to="/accounts" className="btn btn-ghost btn-sm">管理</Link>} />
              <div style={{ padding: '8px 14px 12px', display: 'grid', gap: 9 }}>
                {accounts.isPending && <LoadingBlock rows={3} />}
                {accounts.data?.accounts.length === 0 && (
                  <div className="empty" style={{ padding: '18px 0' }}>
                    <div className="empty-desc">还没有 AStudio 账号</div>
                    <Link to="/accounts" className="btn btn-primary btn-sm">添加账号</Link>
                  </div>
                )}
                {accounts.data?.accounts.slice(0, 5).map(account => (
                  <div key={account.id} className="row-between" style={{ gap: 8 }}>
                    <div className="row" style={{ gap: 8, minWidth: 0 }}>
                      <span className={account.sessionOk ? 'dot dot-live' : 'dot dot-warn'} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.nickname || account.name}</span>
                    </div>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {int(account.pointsBalance + account.sparkBalance)} 分
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card>
            <CardHead
              title="最近请求"
              sub="只记录元数据，不保存对话内容"
              actions={<Link to="/logs" className="btn btn-ghost btn-sm">全部日志 <ArrowUpRight size={13} /></Link>}
            />
            {recent.isPending
              ? <div style={{ padding: 18 }}><LoadingBlock rows={4} /></div>
              : (recent.data?.entries.length ?? 0) === 0
                ? <EmptyState title="还没有请求" desc="用任意 OpenAI / Claude 客户端向 /v1 发一条消息后，这里会出现记录。" />
                : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>时间</th><th>模型</th><th>状态</th><th className="num">Tokens</th><th className="num">耗时</th></tr></thead>
                      <tbody>
                        {recent.data?.entries.map(entry => (
                          <tr key={`${entry.requestId}-${entry.time}`}>
                            <td className="mono faint">{dateTime(entry.time)}</td>
                            <td><span className="mono">{entry.model}</span></td>
                            <td><Badge tone={entry.status >= 200 && entry.status < 400 ? 'success' : 'danger'} dot>{entry.status}</Badge></td>
                            <td className="num">{compact(entry.promptTokens + entry.completionTokens)}</td>
                            <td className="num">{ms(entry.durationMs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
          </Card>
        </div>

        <div className="stack">
          <Card>
            <CardHead title="服务状态" sub={system.data === undefined ? '读取中…' : `v${system.data.version}`} />
            <div className="stack" style={{ padding: 16, gap: 11 }}>
              <Row label="运行时长" value={system.data === undefined ? '—' : `${Math.floor(system.data.uptimeSeconds / 3600)}h ${Math.floor((system.data.uptimeSeconds % 3600) / 60)}m`} />
              <Row label="Node" value={system.data?.node ?? '—'} />
              <Row label="模型目录" value={system.data?.models === undefined ? '—' : `${system.data.models} 个`} />
              <Row label="目录更新" value={system.data?.catalogFetchedAt === 0 ? '尚未成功' : timeAgo(system.data?.catalogFetchedAt)} />
              <Row label="上游" value={system.data?.upstream ?? '—'} mono />
              {system.data?.catalogError !== undefined && system.data.catalogError !== '' && (
                <div className="banner banner-warn">{system.data.catalogError}</div>
              )}
            </div>
          </Card>

          <Card>
            <CardHead title="模型目录" sub={models.data?.source === 'live' ? '实时' : models.data?.source === 'saved' ? '上次快照' : '空'} actions={<Link to="/models" className="btn btn-ghost btn-sm">查看</Link>} />
            <div style={{ padding: '8px 14px 14px', display: 'grid', gap: 8 }}>
              {models.isPending && <LoadingBlock rows={4} />}
              {models.data?.models.slice(0, 6).map(model => (
                <div key={model.slug} className="row-between" style={{ gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{model.name}</div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>{model.slug}</div>
                  </div>
                  <Badge tone={model.available ? 'success' : 'warning'}>{model.available ? '可用' : '受限'}</Badge>
                </div>
              ))}
              {(models.data?.models.length ?? 0) === 0 && !models.isPending && (
                <div className="empty" style={{ padding: '16px 0' }}><div className="empty-desc">目录为空，先添加账号并刷新。</div></div>
              )}
            </div>
          </Card>

          <Card>
            <div style={{ padding: 16 }} className="stack">
              <div className="row" style={{ gap: 8 }}><Boxes size={14} style={{ color: 'var(--accent)' }} /><span style={{ fontWeight: 600, fontSize: 13 }}>接入提示</span></div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.65 }}>
                Base URL 填 <code className="code">http://127.0.0.1:8787/v1</code>。
                Claude Code 的 <code className="code">ANTHROPIC_BASE_URL</code> 填 <code className="code">http://127.0.0.1:8787</code>。
                模型名可填显示名、slug 或目录 ID。
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Badge tone="accent">Chat</Badge>
                <Badge tone="cyan">Responses</Badge>
                <Badge>Messages</Badge>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): React.ReactElement {
  return (
    <div className="row-between" style={{ gap: 12 }}>
      <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{label}</span>
      <span className={mono ? 'mono' : ''} style={{ fontSize: 11.5, color: 'var(--muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )
}

function emptySummary(): import('../../shared/types.js').UsageSummary {
  return {
    range: '24h',
    total: { requests: 0, successes: 0, failures: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, firstTokenMsSum: 0, firstTokenCount: 0 },
    byModel: [],
    byAccount: [],
    byKey: [],
    timeseries: [],
  }
}

