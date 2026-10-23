import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, ExternalLink, Link2, Search } from 'lucide-react'
import { toast } from 'sonner'
import type { OfficialCost, OfficialModelInfo } from '../../shared/types.js'
import type { ModelDto } from '../lib/api.js'
import { endpoints } from '../lib/api.js'
import { compact, confidenceLabel, errorMessage, modalityLabel, pricePair, usd } from '../lib/format.js'
import { Badge, Button, Input, Modal, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from './ui.js'
import { ProbePanel } from './ProbePanel.js'

export type DetailTab = 'capabilities' | 'official' | 'probe'

function Metric({ label, platform, official, mismatch }: {
  label: string
  platform: string
  official?: string
  mismatch?: boolean
}): React.ReactElement {
  return (
    <div>
      <div className="faint" style={{ fontSize: 11 }}>{label}</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
        <span style={{ fontWeight: 550 }}>{platform}</span>
        {mismatch === true && (
          <span title={`平台 ${platform} / 官方 ${official ?? '—'}`}>
            <AlertTriangle size={12} style={{ color: 'var(--warning)' }} aria-label="与官方值不同" />
          </span>
        )}
        {official !== undefined && <span className="faint" style={{ fontSize: 11 }}>官方 {official}</span>}
      </div>
    </div>
  )
}

function ModalityBadges({ values, tone = 'default' }: {
  values: string[]
  tone?: 'default' | 'cyan' | 'accent'
}): React.ReactElement {
  if (values.length === 0) return <span className="faint">—</span>
  return (
    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      {values.map(value => <Badge key={value} tone={tone}>{modalityLabel(value)}</Badge>)}
    </div>
  )
}

function Feature({ label, value }: { label: string; value: boolean }): React.ReactElement {
  return (
    <div className="row-between" style={{ gap: 8 }}>
      <span className="faint" style={{ fontSize: 12 }}>{label}</span>
      <Badge tone={value ? 'success' : 'default'}>{value ? '官方声明' : '未声明'}</Badge>
    </div>
  )
}

function CapabilityTab({ model }: { model: ModelDto }): React.ReactElement {
  const { capabilities: caps, official } = model
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="banner" style={{ fontSize: 12 }}>
        平台列来自 AStudio 目录，是网关实际使用的值；官方列来自 models.dev，只作对照。两边冲突时以平台列为准。
      </div>

      <div className="surface-flat" style={{ padding: 14, display: 'grid', gap: 12 }}>
        <div className="row-between">
          <span className="surface-title">上下文与输出</span>
          {official !== null && <Badge tone="cyan">{confidenceLabel(official.confidence)}</Badge>}
        </div>
        <div className="form-grid">
          <Metric label="上下文窗口" platform={model.contextWindow > 0 ? compact(model.contextWindow) : '平台未声明'} official={official?.contextWindow !== undefined && official.contextWindow > 0 ? compact(official.contextWindow) : '—'} mismatch={caps.context.mismatch} />
          <Metric label="最大输入" platform="平台未声明" official={official !== null && official.maxInputTokens > 0 ? compact(official.maxInputTokens) : '—'} />
          <Metric label="最大输出" platform={model.maxOutputTokens > 0 ? compact(model.maxOutputTokens) : '平台未声明'} official={official?.maxOutputTokens !== undefined && official.maxOutputTokens > 0 ? compact(official.maxOutputTokens) : '—'} mismatch={caps.output.mismatch} />
        </div>
      </div>

      <div className="surface-flat" style={{ padding: 14, display: 'grid', gap: 12 }}>
        <div className="surface-title">多模态</div>
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="faint" style={{ fontSize: 11 }}>平台输入</div>
          <ModalityBadges values={caps.inputModalities.platform} />
          <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>官方输入</div>
          <ModalityBadges values={caps.inputModalities.official} tone="cyan" />
          {caps.inputModalities.extraOfficial.length > 0 && (
            <div className="banner banner-warn" style={{ fontSize: 12 }}>
              官方声明了平台未声明的模态：{caps.inputModalities.extraOfficial.map(modalityLabel).join('、')}。网关是否可用以实际请求为准。
            </div>
          )}
          <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>官方输出</div>
          <ModalityBadges values={caps.outputModalities.official} tone="cyan" />
        </div>
      </div>

      <div className="surface-flat" style={{ padding: 14, display: 'grid', gap: 10 }}>
        <div className="surface-title">推理</div>
        <div className="form-grid">
          <div>
            <div className="faint" style={{ fontSize: 11 }}>平台档位</div>
            <ModalityBadges values={caps.reasoning.platformEfforts} />
          </div>
          <div>
            <div className="faint" style={{ fontSize: 11 }}>官方档位</div>
            <ModalityBadges values={caps.reasoning.officialEfforts} tone="cyan" />
          </div>
          <div>
            <div className="faint" style={{ fontSize: 11 }}>默认档位</div>
            <div style={{ marginTop: 3 }}>{caps.reasoning.defaultEffort || '—'}</div>
          </div>
          <div>
            <div className="faint" style={{ fontSize: 11 }}>可关闭思考</div>
            <div style={{ marginTop: 3 }}>{caps.reasoning.canDisableThinking ? '平台声明' : '平台未声明'}</div>
          </div>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Badge tone={caps.reasoning.official ? 'success' : 'default'}>官方推理 {caps.reasoning.official ? '声明' : '未声明'}</Badge>
          <Badge tone={caps.reasoning.officialToggle ? 'success' : 'default'}>toggle</Badge>
          <Badge tone={caps.reasoning.officialBudgetTokens ? 'success' : 'default'}>budget_tokens</Badge>
        </div>
      </div>

      <div className="surface-flat" style={{ padding: 14, display: 'grid', gap: 8 }}>
        <div className="surface-title">官方能力标记</div>
        <Feature label="工具调用" value={caps.features.toolCall} />
        <Feature label="结构化输出" value={caps.features.structuredOutput} />
        <Feature label="附件" value={caps.features.attachment} />
        <Feature label="温度参数" value={caps.features.temperature} />
        <Feature label="开源权重" value={caps.features.openWeights} />
      </div>

      <div className="surface-flat" style={{ padding: 14, display: 'grid', gap: 6 }}>
        <div className="surface-title">模型身份与可用性</div>
        <div className="faint" style={{ fontSize: 12 }}>slug <span className="mono">{model.slug}</span></div>
        {model.directoryId !== '' && <div className="faint" style={{ fontSize: 12 }}>目录 ID <span className="mono">{model.directoryId}</span></div>}
        <div className="faint" style={{ fontSize: 12 }}>来源 {model.source} · {model.available ? '可调用' : '受限'}</div>
        {model.description !== '' && <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>{model.description}</div>}
        {model.availableAccounts.length > 0 && <div className="faint" style={{ fontSize: 12 }}>可用账号：{model.availableAccounts.join('、')}</div>}
        {model.aliases.length > 0 && <div className="faint" style={{ fontSize: 12 }}>别名：{model.aliases.join('、')}</div>}
        {official !== null && (
          <div className="faint" style={{ fontSize: 12 }}>
            官方条目：<span className="mono">{official.key}</span> · {official.providerName}
            {official.contextMismatch && <span style={{ color: 'var(--warning)' }}> · 上下文与平台值不同</span>}
          </div>
        )}
      </div>
    </div>
  )
}

function ratesPair(cost: { input?: number; output?: number }): string {
  if (cost.input === undefined && cost.output === undefined) return '—'
  return `${usd(cost.input)} / ${usd(cost.output)}`
}

function PriceTable({ cost }: { cost: OfficialCost | undefined }): React.ReactElement {
  if (cost === undefined) return <div className="faint" style={{ fontSize: 12 }}>models.dev 未给这个条目标价。</div>
  const tiers = cost.tiers ?? []
  const rows: Array<[string, number | undefined]> = [
    ['输入', cost.input],
    ['输出', cost.output],
    ['缓存读', cost.cacheRead],
    ['缓存写', cost.cacheWrite],
    ['推理', cost.reasoning],
    ['音频输入', cost.inputAudio],
    ['音频输出', cost.outputAudio],
  ]
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>项目</th><th className="num">USD / 1M tokens</th></tr></thead>
          <tbody>
            {rows.filter(([, value]) => value !== undefined).map(([label, value]) => (
              <tr key={label}><td>{label}</td><td className="num mono">{usd(value)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {tiers.length > 0 && (
        <div className="faint" style={{ fontSize: 11 }}>
          长上下文阶梯：{tiers.map(tier => `≥ ${compact(tier.threshold)} ${ratesPair(tier)}`).join(' · ')}
        </div>
      )}
      {cost.contextOver200k !== undefined && (
        <div className="faint" style={{ fontSize: 11 }}>
          超长上下文：{ratesPair(cost.contextOver200k)}
        </div>
      )}
      <div className="faint" style={{ fontSize: 11 }}>单位：USD / 1M tokens；来自 models.dev，仅作参考价。</div>
    </div>
  )
}

function BindingSearch({ model, onChanged }: { model: ModelDto; onChanged: () => void }): React.ReactElement {
  const [query, setQuery] = React.useState('')
  const deferred = React.useDeferredValue(query)
  const [busy, setBusy] = React.useState('')
  const search = useQuery({
    queryKey: ['models-dev-search', deferred],
    queryFn: () => endpoints.searchModelsDev(deferred),
    enabled: deferred.trim().length > 0,
  })
  const bind = async (key: string | null): Promise<void> => {
    setBusy(key ?? 'clear')
    try {
      await endpoints.setModelReference(model.slug, key)
      toast.success(key === null ? '已清除手动绑定' : '已绑定官方条目')
      onChanged()
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="surface-flat" style={{ padding: 14, display: 'grid', gap: 10 }}>
      <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div className="surface-title row" style={{ gap: 6 }}><Link2 size={13} />官方条目绑定</div>
          <div className="faint" style={{ fontSize: 11 }}>自动匹配不理想时，搜索 models.dev 条目手动指定。</div>
        </div>
        {model.official?.confidence === 'manual' && (
          <Button size="sm" variant="ghost" loading={busy === 'clear'} onClick={() => void bind(null)}>清除手动绑定</Button>
        )}
      </div>
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--faint)' }} />
        <Input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="搜索模型名 / provider / 模型 ID，例如 glm-5.2"
          style={{ paddingLeft: 32 }}
        />
      </div>
      {search.isPending && query.trim() !== '' && <div className="faint" style={{ fontSize: 12 }}>搜索中…</div>}
      {search.isError && <div className="banner banner-danger" role="alert">{errorMessage(search.error)}</div>}
      {search.data?.models.length === 0 && query.trim() !== '' && !search.isPending && (
        <div className="faint" style={{ fontSize: 12 }}>没有匹配的 models.dev 条目。</div>
      )}
      {search.data !== undefined && search.data.models.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          {search.data.models.map(result => (
            <div key={result.key} className="row-between" style={{ gap: 8, padding: '7px 8px', border: '1px solid var(--line)', borderRadius: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 550 }}>{result.name}</span>
                  <Badge>{result.providerName}</Badge>
                  <span className="mono faint" style={{ fontSize: 10 }}>{result.key}</span>
                </div>
                <div className="faint" style={{ fontSize: 11 }}>
                  {compact(result.contextWindow)} 上下文 · {pricePair(result.cost)}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                loading={busy === result.key}
                onClick={() => void bind(result.key)}
              >
                {model.official?.key === result.key ? <><Check size={12} />当前</> : '绑定'}
              </Button>
            </div>
          ))}
        </div>
      )}
      {model.official !== null && (
        <div className="faint" style={{ fontSize: 11 }}>
          当前：<span className="mono">{model.official.key}</span> · {model.official.providerName} · 匹配置信度 {confidenceLabel(model.official.confidence)}
        </div>
      )}
    </div>
  )
}

function MultiplierCard({ model, official }: { model: ModelDto; official: OfficialModelInfo | null }): React.ReactElement {
  const [estimate, setEstimate] = React.useState(false)
  const primary = model.pointMultipliers[0]?.value ?? model.pointMultiplier
  const primaryAccount = model.pointMultipliers[0]?.accountName ?? '平台'
  const multiplier = Number(primary)
  const canEstimate = official?.cost !== undefined
    && (official.cost.input !== undefined || official.cost.output !== undefined)
    && primary !== '' && Number.isFinite(multiplier) && multiplier > 0
  const estimated = canEstimate && official?.cost !== undefined
    ? {
        input: official.cost.input === undefined ? undefined : official.cost.input * multiplier,
        output: official.cost.output === undefined ? undefined : official.cost.output * multiplier,
      }
    : undefined
  React.useEffect(() => {
    if (!canEstimate) setEstimate(false)
  }, [canEstimate])
  return (
    <div className="surface-flat" style={{ padding: 14, display: 'grid', gap: 10 }}>
      <div className="surface-title">平台倍率与官方价对照</div>
      {model.pointMultipliers.length === 0 && model.pointMultiplier === '' && (
        <div className="faint" style={{ fontSize: 12 }}>上游没有给这个模型配置 point_multiplier。</div>
      )}
      {model.pointMultipliers.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {model.pointMultipliers.map(item => (
            <Badge key={`${item.accountId}:${item.value}`} tone="accent">
              {item.accountName} ×{item.value}
            </Badge>
          ))}
        </div>
      )}
      {model.pointMultipliers.length === 0 && model.pointMultiplier !== '' && (
        <Badge tone="accent">平台 ×{model.pointMultiplier}</Badge>
      )}
      <div className="faint" style={{ fontSize: 12 }}>
        {official === null
          ? 'models.dev 无官方条目，暂时没有官方价可对照；绑定条目后可估算。'
          : `官方价：${pricePair(official.cost)}（USD / 1M tokens）。AStudio 只公开 point_multiplier，没有公开积分→货币的换算基准。`}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Switch checked={estimate} onCheckedChange={setEstimate} disabled={!canEstimate} label="按倍率估算平台价" />
        <div>
          <div style={{ fontSize: 12 }}>按倍率估算平台价</div>
          <div className="faint" style={{ fontSize: 11 }}>公式：官方价 × point_multiplier。仅作对照，金额不是 AStudio 账单。</div>
        </div>
      </div>
      {estimate && estimated !== undefined && (
        <div className="banner" style={{ fontSize: 12 }}>
          参考平台价：{ratesPair(estimated)} USD / 1M tokens（{primaryAccount} 倍率 ×{multiplier}）
        </div>
      )}
    </div>
  )
}

function OfficialTab({ model, onChanged }: { model: ModelDto; onChanged: () => void }): React.ReactElement {
  const official = model.official

  return (
    <div className="stack" style={{ gap: 12 }}>
      {official === null && (
        <div className="banner banner-warn" role="alert">
          models.dev 没有匹配到这个模型。可以手动搜索并绑定一个官方条目；绑定只影响对照，不影响网关调用。
        </div>
      )}

      {official !== null && (
        <>
          <div className="surface-flat" style={{ padding: 14, display: 'grid', gap: 8 }}>
            <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <span className="surface-title">{official.name}</span>
                  <Badge tone="cyan">{confidenceLabel(official.confidence)}</Badge>
                  {official.status !== '' && <Badge tone="warning">{official.status}</Badge>}
                </div>
                <div className="faint" style={{ fontSize: 11, marginTop: 3 }}>
                  {official.providerName} · <span className="mono">{official.key}</span>
                  {official.canonicalId !== official.key && <> · canonical <span className="mono">{official.canonicalId}</span></>}
                </div>
              </div>
              <a
                className="btn btn-ghost btn-sm"
                href={`https://models.dev/models/${official.canonicalId.split('/').map(encodeURIComponent).join('/')}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={13} />models.dev
              </a>
            </div>
            <div className="form-grid">
              <Metric label="官方上下文" platform={compact(official.contextWindow)} />
              <Metric label="官方最大输入" platform={official.maxInputTokens > 0 ? compact(official.maxInputTokens) : '—'} />
              <Metric label="官方最大输出" platform={compact(official.maxOutputTokens)} />
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <ModalityBadges values={official.inputModalities} />
              {official.outputModalities.length > 0 && <Badge tone="cyan">输出 {official.outputModalities.map(modalityLabel).join('、')}</Badge>}
            </div>
            <div className="faint" style={{ fontSize: 11 }}>
              知识截止 {official.knowledge || '—'} · 发布 {official.releaseDate || '—'} · 更新 {official.lastUpdated || '—'}
            </div>
            <div className="faint" style={{ fontSize: 11 }}>
              匹配：{official.matchedBy}
              {official.contextMismatch && <span style={{ color: 'var(--warning)' }}> · 上下文与平台值不同</span>}
            </div>
          </div>

          <div className="surface-flat" style={{ padding: 14, display: 'grid', gap: 8 }}>
            <div className="surface-title">官方价</div>
            <PriceTable cost={official.cost} />
          </div>

          {official.alternatives.length > 0 && (
            <div className="surface-flat" style={{ padding: 14, display: 'grid', gap: 8 }}>
              <div className="surface-title">其他官方报价</div>
              {official.alternatives.map(alternative => (
                <div key={alternative.key} className="row-between" style={{ gap: 8 }}>
                  <div>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12 }}>{alternative.providerName}</span>
                      <span className="mono faint" style={{ fontSize: 10 }}>{alternative.key}</span>
                    </div>
                    <div className="faint" style={{ fontSize: 11 }}>{compact(alternative.contextWindow)} 上下文 · {pricePair(alternative.cost)}</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => void endpoints.setModelReference(model.slug, alternative.key).then(() => { toast.success('已切换官方对照'); onChanged() }).catch((error: unknown) => toast.error(errorMessage(error)))}>
                    用作对照
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <MultiplierCard key={model.slug} model={model} official={official} />

      <BindingSearch model={model} onChanged={onChanged} />
    </div>
  )
}

export function ModelDetail({ model, open, onOpenChange, initialTab = 'capabilities', onChanged }: {
  model: ModelDto | null
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: DetailTab
  onChanged: () => void
}): React.ReactElement | null {
  const [tab, setTab] = React.useState<DetailTab>(initialTab)
  React.useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab, model?.slug])
  if (model === null) return null
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={model.name}
      description={<span className="mono" style={{ fontSize: 11 }}>{model.slug}{model.directoryId !== '' ? ` · ${model.directoryId}` : ''}</span>}
      wide
    >
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <Badge tone={model.available ? 'success' : 'warning'} dot>{model.available ? '可调用' : '受限'}</Badge>
        <Badge>{model.source === 'model-manager' ? '目录' : model.source === 'bot-configs' ? '账号配置' : '合并'}</Badge>
        {model.pointMultiplier !== '' && <Badge tone="accent">×{model.pointMultiplier}</Badge>}
        {model.official !== null && <Badge tone="cyan">官方 {model.official.providerName}</Badge>}
        {model.aliases.map(alias => <Badge key={alias}>{alias}</Badge>)}
      </div>
      <Tabs value={tab} onValueChange={value => setTab(value as DetailTab)}>
        <TabsList>
          <TabsTrigger value="capabilities">能力</TabsTrigger>
          <TabsTrigger value="official">官方 / 倍率</TabsTrigger>
          <TabsTrigger value="probe">探测</TabsTrigger>
        </TabsList>
        <TabsContent value="capabilities"><CapabilityTab model={model} /></TabsContent>
        <TabsContent value="official"><OfficialTab key={model.slug} model={model} onChanged={onChanged} /></TabsContent>
        <TabsContent value="probe"><ProbePanel key={model.slug} model={model} /></TabsContent>
      </Tabs>
    </Modal>
  )
}
