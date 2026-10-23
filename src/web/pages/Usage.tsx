import * as React from 'react'
import { Download, Gauge, RefreshCw, Timer, Zap } from 'lucide-react'
import { PageHeader, Card, CardHead, StatCard, Badge, Button, LoadingBlock, EmptyState } from '../components/ui.js'
import { TrafficChart, ModelBars } from '../components/charts.js'
import { useSummary } from '../lib/queries.js'
import { compact, ms, percent } from '../lib/format.js'
import { exportUrl } from '../lib/api.js'
import type { Counter } from '../../shared/types.js'

const RANGES = [
  { value: '24h', label: '24 小时' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: 'all', label: '全部' },
] as const

function successRate(counter: Counter | undefined): number {
  return counter === undefined || counter.requests === 0 ? 0 : counter.successes / counter.requests
}

export function Usage(): React.ReactElement {
  const [range, setRange] = React.useState<string>('24h')
  const summary = useSummary(range)
  const total = summary.data?.total

  return (
    <>
      <PageHeader
        title="统计"
        desc="按请求、模型、账号与 Key 聚合。时间范围只影响顶部汇总与曲线；下方分组表为全部时间累计。"
        actions={(
          <>
            <a className="btn btn-ghost btn-sm" href={exportUrl('csv')}><Download size={13} />导出 CSV</a>
            <Button variant="ghost" size="sm" onClick={() => void summary.refetch()}><RefreshCw size={13} />刷新</Button>
          </>
        )}
      />

      <div className="row" style={{ gap: 6 }}>
        {RANGES.map(item => (
          <Button key={item.value} size="sm" variant={range === item.value ? 'primary' : 'ghost'} onClick={() => setRange(item.value)}>
            {item.label}
          </Button>
        ))}
      </div>

      <div className="grid-stats">
        <StatCard label="请求" value={compact(total?.requests)} hint={`失败 ${compact(total?.failures)}`} />
        <StatCard label="成功率" value={percent(successRate(total))} icon={<Gauge size={12} />} />
        <StatCard label="输入 tokens" value={compact(total?.promptTokens)} hint={`缓存 ${compact(total?.cachedTokens)}`} />
        <StatCard label="输出 tokens" value={compact(total?.completionTokens)} hint={`思考 ${compact(total?.reasoningTokens)}`} icon={<Zap size={12} />} />
        <StatCard label="首 token 均值" value={ms((total?.firstTokenCount ?? 0) === 0 ? 0 : (total?.firstTokenMsSum ?? 0) / (total?.firstTokenCount ?? 1))} icon={<Timer size={12} />} />
      </div>

      <Card>
        <CardHead title="请求与失败" sub={range === 'all' ? '全部时间' : `最近 ${RANGES.find(item => item.value === range)?.label}`} />
        <div style={{ padding: '10px 12px 6px' }}>
          {summary.isPending
            ? <LoadingBlock rows={5} />
            : <TrafficChart summary={summary.data ?? emptySummary()} />}
        </div>
      </Card>

      <div className="split-even">
        <Card>
          <CardHead title="模型 Top" sub="按请求数" />
          <div style={{ padding: '6px 12px 10px' }}>
            {summary.isPending ? <LoadingBlock rows={4} /> : <ModelBars summary={summary.data ?? emptySummary()} />}
          </div>
        </Card>
        <Card>
          <CardHead title="按账号" sub="全部时间累计" />
          {summary.isPending && <div style={{ padding: 16 }}><LoadingBlock rows={4} /></div>}
          {!summary.isPending && (summary.data?.byAccount.length ?? 0) === 0 && (
            <EmptyState title="还没有账号调用" desc="发一条真实请求后，账号维度会出现在这里。" />
          )}
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>账号</th><th className="num">请求</th><th className="num">成功率</th><th className="num">输出</th></tr></thead>
              <tbody>
                {summary.data?.byAccount.slice(0, 8).map(item => (
                  <tr key={item.key}>
                    <td className="mono" style={{ fontSize: 11 }}>{item.key === 'none' ? '（未知）' : item.key.slice(0, 12)}</td>
                    <td className="num">{compact(item.value.requests)}</td>
                    <td className="num">{percent(successRate(item.value))}</td>
                    <td className="num">{compact(item.value.completionTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="split-even">
        <Card>
          <CardHead title="按模型" sub="全部时间累计" />
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>模型</th><th className="num">请求</th><th className="num">失败</th><th className="num">输入</th><th className="num">输出</th></tr></thead>
              <tbody>
                {summary.data?.byModel.slice(0, 12).map(item => (
                  <tr key={item.key}>
                    <td><span className="mono" style={{ fontSize: 11 }}>{item.key}</span></td>
                    <td className="num">{compact(item.value.requests)}</td>
                    <td className="num">{compact(item.value.failures)}</td>
                    <td className="num">{compact(item.value.promptTokens)}</td>
                    <td className="num">{compact(item.value.completionTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(summary.data?.byModel.length ?? 0) === 0 && !summary.isPending && <EmptyState title="还没有模型调用" />}
          </div>
        </Card>
        <Card>
          <CardHead title="按密钥" sub="全部时间累计" />
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Key</th><th className="num">请求</th><th className="num">失败</th><th>状态</th></tr></thead>
              <tbody>
                {summary.data?.byKey.slice(0, 12).map(item => (
                  <tr key={item.key}>
                    <td className="mono" style={{ fontSize: 11 }}>{item.key === 'none' ? '（面板）' : item.key.slice(0, 14)}</td>
                    <td className="num">{compact(item.value.requests)}</td>
                    <td className="num">{compact(item.value.failures)}</td>
                    <td><Badge tone={item.value.failures === 0 ? 'success' : 'warning'} dot>{item.value.failures === 0 ? '正常' : '有失败'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(summary.data?.byKey.length ?? 0) === 0 && !summary.isPending && <EmptyState title="还没有密钥调用" />}
          </div>
        </Card>
      </div>
    </>
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
