import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, RefreshCw, ScrollText, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { LogEntry } from '../../shared/types.js'
import { endpoints, exportUrl } from '../lib/api.js'
import { useAccounts, useModels } from '../lib/queries.js'
import { compact, dateTime, errorMessage, fullDateTime, ms } from '../lib/format.js'
import {
  Badge,
  Button,
  Card,
  CardHead,
  ConfirmDialog,
  EmptyState,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
} from '../components/ui.js'

export function Logs(): React.ReactElement {
  const accounts = useAccounts()
  const models = useModels()
  const queryClient = useQueryClient()
  const [model, setModel] = React.useState('')
  const [accountId, setAccountId] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [detail, setDetail] = React.useState<LogEntry | null>(null)
  const [clearOpen, setClearOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const logs = useQuery({
    queryKey: ['logs', model, accountId, status],
    queryFn: () => endpoints.logs({ limit: 200, model, accountId, status }),
    refetchInterval: 15_000,
  })

  const clear = async (): Promise<void> => {
    setBusy(true)
    try {
      await endpoints.clearLogs()
      toast.success('日志与统计已清空')
      setClearOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['logs'] })
      void queryClient.invalidateQueries({ queryKey: ['summary'] })
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="日志"
        desc="只记录请求元数据：时间、模型、账号、Key 前缀、状态、tokens、延迟与错误摘要。对话内容不会写入磁盘。"
        actions={(
          <>
            <a className="btn btn-ghost btn-sm" href={exportUrl('csv')}><Download size={13} />CSV</a>
            <a className="btn btn-ghost btn-sm" href={exportUrl('jsonl')}><Download size={13} />JSONL</a>
            <Button variant="ghost" size="sm" onClick={() => void logs.refetch()}><RefreshCw size={13} />刷新</Button>
            <Button variant="danger" size="sm" onClick={() => setClearOpen(true)}><Trash2 size={13} />清空</Button>
          </>
        )}
      />

      <Card>
        <CardHead
          title="请求记录"
          sub={logs.isPending ? '读取中…' : `最近 ${logs.data?.entries.length ?? 0} 条`}
          actions={(
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <Select value={model} onChange={event => setModel(event.target.value)} style={{ width: 180, height: 30 }}>
                <option value="">全部模型</option>
                {models.data?.models.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}
              </Select>
              <Select value={accountId} onChange={event => setAccountId(event.target.value)} style={{ width: 160, height: 30 }}>
                <option value="">全部账号</option>
                {accounts.data?.accounts.map(item => <option key={item.id} value={item.id}>{item.nickname || item.name}</option>)}
              </Select>
              <Select value={status} onChange={event => setStatus(event.target.value)} style={{ width: 120, height: 30 }}>
                <option value="">全部状态</option>
                <option value="200">200</option>
                <option value="400">400</option>
                <option value="401">401</option>
                <option value="403">403</option>
                <option value="429">429</option>
                <option value="500">500</option>
                <option value="502">502</option>
                <option value="503">503</option>
              </Select>
            </div>
          )}
        />
        {logs.isPending && <div style={{ padding: 18 }}><LoadingBlock rows={6} /></div>}
        {logs.isError && <div className="banner banner-danger" style={{ margin: 16 }}>{errorMessage(logs.error)}</div>}
        {!logs.isPending && (logs.data?.entries.length ?? 0) === 0 && (
          <EmptyState icon={<ScrollText size={18} />} title="没有匹配的记录" desc="调整筛选条件，或先发一条真实请求。" />
        )}
        {(logs.data?.entries.length ?? 0) > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>模型</th>
                  <th>账号</th>
                  <th>Key</th>
                  <th>状态</th>
                  <th className="num">输入</th>
                  <th className="num">输出</th>
                  <th className="num">首 token</th>
                  <th className="num">耗时</th>
                </tr>
              </thead>
              <tbody>
                {logs.data?.entries.map(entry => (
                  <tr key={`${entry.requestId}-${entry.time}`} onClick={() => setDetail(entry)} style={{ cursor: 'pointer' }}>
                    <td className="mono faint" style={{ fontSize: 10.5 }}>{dateTime(entry.time)}</td>
                    <td><span className="mono" style={{ fontSize: 11 }}>{entry.model}</span></td>
                    <td className="muted" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.accountName || '—'}</td>
                    <td className="mono faint" style={{ fontSize: 10 }}>{entry.keyPrefix || '—'}</td>
                    <td>
                      <Badge tone={entry.status >= 200 && entry.status < 400 ? 'success' : entry.status === 429 ? 'warning' : 'danger'} dot>
                        {entry.status}
                      </Badge>
                      {entry.stream && <span className="badge" style={{ marginLeft: 4 }}>流</span>}
                    </td>
                    <td className="num">{compact(entry.promptTokens)}</td>
                    <td className="num">{compact(entry.completionTokens)}</td>
                    <td className="num">{entry.firstTokenMs === 0 ? '—' : ms(entry.firstTokenMs)}</td>
                    <td className="num">{ms(entry.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={detail !== null}
        onOpenChange={open => { if (!open) setDetail(null) }}
        title="请求详情"
        description={detail === null ? '' : fullDateTime(detail.time)}
        wide
      >
        {detail !== null && (
          <>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <Badge tone={detail.status >= 200 && detail.status < 400 ? 'success' : 'danger'}>HTTP {detail.status}</Badge>
              <Badge>{detail.stream ? '流式' : '非流式'}</Badge>
              <Badge>{detail.model}</Badge>
              {detail.upstreamModel !== detail.model && <Badge tone="cyan">上游 {detail.upstreamModel}</Badge>}
            </div>
            <pre className="code-block">{JSON.stringify(detail, null, 2)}</pre>
            {detail.error !== '' && <div className="banner banner-danger">{detail.error}</div>}
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="清空日志与统计"
        description="会删除全部 JSONL 日志文件并重置聚合统计。账号、密钥和设置不受影响。"
        confirmLabel="清空"
        danger
        loading={busy}
        onConfirm={() => void clear()}
      />
    </>
  )
}
