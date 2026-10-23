import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, FlaskConical, Image as ImageIcon, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import type { ProbeResultView, ProbeRun } from '../../shared/types.js'
import type { ModelDto, ProbeRequest } from '../lib/api.js'
import { endpoints } from '../lib/api.js'
import { useAccounts } from '../lib/queries.js'
import { compact, dateTime, errorMessage, int, ms } from '../lib/format.js'
import { Badge, Button, Field, Input, Select, Switch, Textarea } from './ui.js'

interface SavedProbe {
  message: string
  effortMode: string
  customEffort: string
  maxTokens: number
  image: boolean
  scope: string
}

const DEFAULT_PROBE: SavedProbe = {
  message: 'hi',
  effortMode: '__default__',
  customEffort: '',
  maxTokens: 512,
  image: false,
  scope: 'first',
}

function loadSaved(slug: string): SavedProbe {
  try {
    const raw = window.localStorage.getItem(`myapi.probe.${slug}`)
    if (raw === null) return DEFAULT_PROBE
    const parsed = JSON.parse(raw) as Partial<SavedProbe>
    return {
      message: typeof parsed.message === 'string' ? parsed.message : DEFAULT_PROBE.message,
      effortMode: typeof parsed.effortMode === 'string' ? parsed.effortMode : DEFAULT_PROBE.effortMode,
      customEffort: typeof parsed.customEffort === 'string' ? parsed.customEffort : '',
      maxTokens: typeof parsed.maxTokens === 'number' ? parsed.maxTokens : DEFAULT_PROBE.maxTokens,
      image: parsed.image === true,
      scope: typeof parsed.scope === 'string' ? parsed.scope : DEFAULT_PROBE.scope,
    }
  } catch {
    return DEFAULT_PROBE
  }
}

function saveProbe(slug: string, value: SavedProbe): void {
  try {
    window.localStorage.setItem(`myapi.probe.${slug}`, JSON.stringify(value))
  } catch {
    // A full or disabled localStorage must not block a probe.
  }
}

function stateTone(state: ProbeRun['state']): 'success' | 'warning' | 'danger' {
  if (state === 'ok') return 'success'
  if (state === 'rejected') return 'warning'
  return 'danger'
}

function stateLabel(run: ProbeRun): string {
  if (run.state === 'ok') return '已接受'
  if (run.state === 'rejected') return run.modality === 'image' ? '图片未通过' : '档位未通过'
  return '失败'
}


function recentLabel(result: ProbeResultView): string {
  if (result.state === 'ok') return '已接受'
  if (result.state === 'rejected') return result.modality === 'image' ? '图片未通过' : '档位未通过'
  return '失败'
}

function recentTone(result: ProbeResultView): 'success' | 'warning' | 'danger' {
  if (result.state === 'ok') return 'success'
  if (result.state === 'rejected') return 'warning'
  return 'danger'
}

function RecentProbes({ model, accountNames }: { model: ModelDto; accountNames: Map<string, string> }): React.ReactElement | null {
  const results = model.probe.results.slice(0, 6)
  if (results.length === 0) return null
  return (
    <details className="surface-flat" style={{ padding: 12 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 550 }}>
        最近探测记录（7 天，{model.probe.results.length} 条）
      </summary>
      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
        {results.map(result => (
          <div key={`${result.accountId}:${result.effort}:${result.modality}:${result.testedAt}`} style={{ display: 'grid', gap: 3 }}>
            <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
                <Badge tone={recentTone(result)} dot>{recentLabel(result)}</Badge>
                <Badge tone="cyan">{result.effort === '' ? '不传档位' : result.effort}</Badge>
                {result.modality === 'image' && <Badge tone="accent">图片</Badge>}
                <span className="faint" style={{ fontSize: 11 }}>{accountNames.get(result.accountId) ?? result.accountId.slice(0, 10)}</span>
              </div>
              <span className="faint mono" style={{ fontSize: 10 }}>{ms(result.latencyMs)} · {dateTime(result.testedAt)}</span>
            </div>
            {result.contentPreview !== '' && (
              <div className="faint" style={{ fontSize: 11, lineHeight: 1.5, wordBreak: 'break-word' }}>
                {result.contentPreview.length > 160 ? `${result.contentPreview.slice(0, 160)}…` : result.contentPreview}
              </div>
            )}
            {result.reason !== '' && <div style={{ fontSize: 11, color: 'var(--danger)' }}>{result.reason}</div>}
          </div>
        ))}
      </div>
    </details>
  )
}

function ResultCard({ run }: { run: ProbeRun }): React.ReactElement {
  const [copied, setCopied] = React.useState(false)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(run.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('复制失败，请手动选择文本')
    }
  }
  return (
    <div className="surface-flat" style={{ padding: 12, display: 'grid', gap: 8 }}>
      <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 550 }}>{run.accountName}</span>
          <Badge tone={stateTone(run.state)} dot>{stateLabel(run)}</Badge>
          <Badge tone="cyan">{run.effort === '' ? '不传档位' : run.effort}</Badge>
          {run.modality === 'image' && <Badge tone="accent"><ImageIcon size={11} />图片</Badge>}
          {!run.effortDeclared && <Badge tone="warning">档位未声明</Badge>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="mono faint" style={{ fontSize: 11 }}>HTTP {run.httpStatus || '—'}</span>
          <span className="mono faint" style={{ fontSize: 11 }}>{ms(run.latencyMs)}</span>
          {run.content !== '' && (
            <Button size="sm" variant="ghost" onClick={() => void copy()} aria-label="复制回复">
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </Button>
          )}
        </div>
      </div>

      <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
        <Badge>输入 {compact(run.usage.promptTokens)}</Badge>
        <Badge>输出 {compact(run.usage.completionTokens)}</Badge>
        {run.usage.cachedTokens > 0 && <Badge tone="cyan">缓存 {compact(run.usage.cachedTokens)}</Badge>}
        {run.usage.reasoningTokens > 0 && <Badge tone="cyan">推理 {compact(run.usage.reasoningTokens)}</Badge>}
        {run.finishReason !== '' && <Badge>finish {run.finishReason}</Badge>}
      </div>

      {run.reason !== '' && (
        <div className="banner banner-danger" role="alert" style={{ fontSize: 12 }}>{run.reason}</div>
      )}

      {run.state === 'ok' && run.content === '' && (
        <div className="banner banner-warn" style={{ fontSize: 12 }}>
          上游接受了请求，但回复为空。可以调大最大输出后重试。
        </div>
      )}
      {run.finishReason === 'length' && (
        <div className="banner banner-warn" style={{ fontSize: 12 }}>回复被 max_tokens 截断，调大最大输出后重试。</div>
      )}

      {run.content !== '' && (
        <pre className="code" style={{ margin: 0, padding: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240, overflow: 'auto' }}>
          {run.content}
        </pre>
      )}

      {run.reasoning !== '' && (
        <details>
          <summary className="faint" style={{ cursor: 'pointer', fontSize: 12 }}>推理内容（{int(run.reasoning.length)} 字符）</summary>
          <pre className="code" style={{ margin: '8px 0 0', padding: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto' }}>
            {run.reasoning}
          </pre>
        </details>
      )}
    </div>
  )
}

export function ProbePanel({ model }: { model: ModelDto }): React.ReactElement {
  const queryClient = useQueryClient()
  const accounts = useAccounts()
  const saved = React.useMemo(() => loadSaved(model.slug), [model.slug])
  const [message, setMessage] = React.useState(saved.message)
  const [effortMode, setEffortMode] = React.useState(saved.effortMode)
  const [customEffort, setCustomEffort] = React.useState(saved.customEffort)
  const [maxTokens, setMaxTokens] = React.useState(saved.maxTokens)
  const [image, setImage] = React.useState(saved.image)
  const [scope, setScope] = React.useState(saved.scope)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [results, setResults] = React.useState<ProbeRun[]>([])

  const declaredEfforts = [...new Set([
    ...model.reasoningEfforts,
    ...(model.canDisableThinking ? ['none'] : []),
  ])]
  const imageDeclared = model.inputModalities.includes('image')
    || model.official?.inputModalities.includes('image') === true
  const enabledAccounts = accounts.data?.accounts.filter(account => account.enabled) ?? []
  const accountNames = new Map((accounts.data?.accounts ?? []).map(account => [
    account.id,
    account.nickname || account.name || account.mobileMasked || account.id,
  ]))

  React.useEffect(() => {
    saveProbe(model.slug, { message, effortMode, customEffort, maxTokens, image, scope })
  }, [model.slug, message, effortMode, customEffort, maxTokens, image, scope])

  React.useEffect(() => {
    if (!imageDeclared && image) setImage(false)
  }, [imageDeclared, image])

  React.useEffect(() => {
    if (effortMode === '__default__' || effortMode === '__none__' || effortMode === '__custom__') return
    if (!declaredEfforts.includes(effortMode)) setEffortMode('__default__')
  }, [effortMode, declaredEfforts])

  React.useEffect(() => {
    if (scope === 'first' || scope === 'all') return
    if (!enabledAccounts.some(account => account.id === scope)) setScope('first')
  }, [scope, enabledAccounts])

  const reset = (): void => {
    setMessage(DEFAULT_PROBE.message)
    setEffortMode(DEFAULT_PROBE.effortMode)
    setCustomEffort('')
    setMaxTokens(DEFAULT_PROBE.maxTokens)
    setImage(false)
    setScope('first')
    setError('')
    setResults([])
  }

  const send = async (): Promise<void> => {
    let effort: string | undefined
    if (effortMode === '__default__') effort = undefined
    else if (effortMode === '__custom__') effort = customEffort.trim()
    else if (effortMode === '__none__') effort = 'none'
    else effort = effortMode
    if (effortMode === '__custom__' && (effort === undefined || effort === '')) {
      toast.error('请填写自定义思考档位')
      return
    }
    if (effort !== undefined && !/^[a-z][a-z0-9_-]{0,31}$/u.test(effort)) {
      toast.error('思考档位只能包含小写字母、数字、下划线和连字符')
      return
    }
    setBusy(true)
    setError('')
    setResults([])
    try {
      const payload: ProbeRequest = {
        message: message.trim() === '' ? 'hi' : message.trim(),
        maxTokens,
        image,
        ...(effort === undefined ? {} : { effort }),
        ...(scope === 'all' ? { allAccounts: true } : scope === 'first' ? {} : { accountId: scope }),
      }
      const response = await endpoints.probe(model.slug, payload)
      setResults(response.results)
      const ok = response.results.filter(item => item.state === 'ok').length
      const rejected = response.results.filter(item => item.state === 'rejected').length
      if (ok > 0) toast.success(`探测完成 · ${ok}/${response.results.length} 个账号接受`)
      else if (rejected > 0) toast.warning('探测完成 · 上游未接受该档位')
      else toast.error('探测失败，查看结果里的上游错误')
      void queryClient.invalidateQueries({ queryKey: ['models'] })
    } catch (cause: unknown) {
      const text = errorMessage(cause)
      setError(text)
      toast.error(text)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="banner" style={{ fontSize: 12 }}>
        探测会直接向上游发一次真实请求，消耗少量 token；它不经过网关轮换，所以每个账号的结果是独立的。
      </div>

      <Field label="消息" hint={`默认 hi；最多 4000 字。当前 ${int(message.length)} 字。`}>
        <Textarea
          value={message}
          onChange={event => setMessage(event.target.value.slice(0, 4000))}
          rows={4}
          placeholder="hi"
        />
      </Field>

      <div className="form-grid">
        <Field label="思考档位" hint="默认跟随目录声明的 default_reasoning_level。">
          <Select value={effortMode} onChange={event => setEffortMode(event.target.value)}>
            <option value="__default__">默认（目录声明）</option>
            <option value="__none__">不传（上游默认）</option>
            {declaredEfforts.map(effort => (
              <option key={effort} value={effort}>{effort === 'none' ? '关闭思考（none）' : effort}</option>
            ))}
            <option value="__custom__">自定义…</option>
          </Select>
        </Field>
        <Field label="最大输出" hint="1–4096；默认 512。">
          <Input
            type="number"
            min={1}
            max={4096}
            value={maxTokens}
            onChange={event => setMaxTokens(Math.min(Math.max(Number(event.target.value) || 1, 1), 4096))}
          />
        </Field>
        <Field label="账号范围" hint="默认只打首个可调用账号，控制消耗。">
          <Select value={scope} onChange={event => setScope(event.target.value)}>
            <option value="first">首个可调用账号</option>
            <option value="all">全部可用账号（最多 3 个）</option>
            {enabledAccounts.map(account => (
              <option key={account.id} value={account.id}>{account.nickname || account.name || account.mobileMasked || account.id}</option>
            ))}
          </Select>
        </Field>
      </div>

      {effortMode === '__custom__' && (
        <Field label="自定义档位" hint="例如 minimal / xhigh；上游是否接受由探测结果说明。">
          <Input value={customEffort} onChange={event => setCustomEffort(event.target.value)} placeholder="例如 xhigh" />
        </Field>
      )}

      <div className="row-between" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 8 }}>
          <Switch checked={image} onCheckedChange={setImage} disabled={!imageDeclared || busy} label="附带测试图" />
          <div>
            <div style={{ fontSize: 12 }}>附带测试图（验证图片输入）</div>
            <div className="faint" style={{ fontSize: 11 }}>
              {imageDeclared ? '发一张内置红色方块图，问模型它是什么颜色。' : '平台目录与 models.dev 都未声明图片输入。'}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button variant="ghost" size="sm" onClick={reset} disabled={busy}><RotateCcw size={13} />恢复默认</Button>
          <Button variant="primary" size="sm" onClick={() => void send()} loading={busy} disabled={enabledAccounts.length === 0}>
            <FlaskConical size={13} />发送探测
          </Button>
        </div>
      </div>

      {enabledAccounts.length === 0 && (
        <div className="banner banner-warn" role="alert">还没有启用账号；先到「账号」页添加并启用后再探测。</div>
      )}
      {error !== '' && <div className="banner banner-danger" role="alert">{error}</div>}

      <RecentProbes model={model} accountNames={accountNames} />

      <div aria-live="polite" style={{ display: 'grid', gap: 8 }}>
        {busy && <div className="faint" style={{ fontSize: 12 }}>正在请求上游…</div>}
        {!busy && results.length === 0 && error === '' && (
          <div className="faint" style={{ fontSize: 12 }}>还没有探测结果。点「发送探测」后，这里会显示每个账号的回复、用量和错误。</div>
        )}
        {results.map(run => <ResultCard key={`${run.accountId}:${run.effort}:${run.modality}`} run={run} />)}
      </div>
    </div>
  )
}
