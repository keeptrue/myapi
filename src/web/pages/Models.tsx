import * as React from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Boxes, FlaskConical, RefreshCw, Search, Tags } from 'lucide-react'
import { toast } from 'sonner'
import type { ModelDto } from '../lib/api.js'
import { endpoints } from '../lib/api.js'
import { useModels } from '../lib/queries.js'
import { compact, confidenceLabel, dateTime, errorMessage, modalityShort, ms, pricePair } from '../lib/format.js'
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
  Select,
  Switch,
  Textarea,
} from '../components/ui.js'
import { ModelDetail, type DetailTab } from '../components/ModelDetail.js'

type Filter = 'all' | 'matched' | 'unmatched' | 'image' | 'reasoning' | 'restricted'

function modelsDevTone(status: { enabled: boolean; source: string; error: string } | undefined): 'default' | 'success' | 'warning' | 'danger' {
  if (status === undefined || !status.enabled) return 'default'
  if (status.error !== '') return 'danger'
  if (status.source === 'live') return 'success'
  if (status.source === 'saved') return 'warning'
  return 'default'
}

function modelsDevLabel(status: { enabled: boolean; source: string } | undefined): string {
  if (status === undefined || !status.enabled) return '未启用'
  if (status.source === 'live') return '实时'
  if (status.source === 'saved') return '缓存'
  return '未就绪'
}

function probeTone(state: string | undefined): 'success' | 'warning' | 'danger' | 'default' {
  if (state === 'ok') return 'success'
  if (state === 'rejected') return 'warning'
  if (state === 'failed') return 'danger'
  return 'default'
}

function probeLabel(state: string | undefined, modality: string | undefined): string {
  if (state === 'ok') return '已验证'
  if (state === 'rejected') return modality === 'image' ? '图片未通过' : '档位未通过'
  if (state === 'failed') return '失败'
  return '未探测'
}

export function Models(): React.ReactElement {
  const models = useModels()
  const queryClient = useQueryClient()
  const [search, setSearch] = React.useState('')
  const [filter, setFilter] = React.useState<Filter>('all')
  const [busy, setBusy] = React.useState('')
  const [aliasOpen, setAliasOpen] = React.useState(false)
  const [aliasText, setAliasText] = React.useState('')
  const [selectedSlug, setSelectedSlug] = React.useState('')
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [detailTab, setDetailTab] = React.useState<DetailTab>('capabilities')
  const aliases = useQuery({ queryKey: ['aliases'], queryFn: endpoints.aliases })

  React.useEffect(() => {
    if (aliases.data === undefined) return
    setAliasText(Object.entries(aliases.data.aliases).map(([alias, target]) => `${alias}=${target}`).join('\n'))
  }, [aliases.data])

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['models'] })
    void queryClient.invalidateQueries({ queryKey: ['aliases'] })
    void queryClient.invalidateQueries({ queryKey: ['models-dev'] })
  }

  const refresh = async (): Promise<void> => {
    setBusy('refresh')
    try {
      const result = await endpoints.refreshModels()
      if (result.error !== '') toast.warning(`目录已刷新，但有部分错误：${result.error}`)
      else toast.success(`目录已刷新 · ${result.models.length} 个模型`)
      invalidate()
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy('')
    }
  }

  const refreshModelsDev = async (): Promise<void> => {
    setBusy('models-dev')
    try {
      const { status } = await endpoints.refreshModelsDev()
      if (status.error !== '') toast.warning(`官方元数据刷新失败：${status.error}`)
      else toast.success(`官方元数据已刷新 · ${status.models} 个条目`)
      invalidate()
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy('')
    }
  }

  const setVisible = async (model: ModelDto, visible: boolean): Promise<void> => {
    setBusy(`${model.slug}:visible`)
    try {
      await endpoints.setVisible(model.slug, visible)
      invalidate()
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy('')
    }
  }

  const saveAliases = async (): Promise<void> => {
    setBusy('aliases')
    try {
      const aliasesMap: Record<string, string> = {}
      for (const line of aliasText.split('\n')) {
        const [left, right] = line.split('=')
        if (left === undefined || right === undefined) continue
        const alias = left.trim()
        const target = right.trim()
        if (alias !== '' && target !== '') aliasesMap[alias] = target
      }
      await endpoints.saveAliases(aliasesMap)
      toast.success('别名已保存')
      setAliasOpen(false)
      invalidate()
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy('')
    }
  }

  const openDetail = (model: ModelDto, tab: DetailTab): void => {
    setSelectedSlug(model.slug)
    setDetailTab(tab)
    setDetailOpen(true)
  }

  const list = (models.data?.models ?? []).filter(model => {
    const query = search.trim().toLowerCase()
    const matchesQuery = query === ''
      || model.name.toLowerCase().includes(query)
      || model.slug.toLowerCase().includes(query)
      || model.directoryId.toLowerCase().includes(query)
      || model.aliases.some(alias => alias.toLowerCase().includes(query))
      || model.official?.name.toLowerCase().includes(query) === true
      || model.official?.key.toLowerCase().includes(query) === true
      || model.official?.providerName.toLowerCase().includes(query) === true
    if (!matchesQuery) return false
    if (filter === 'matched') return model.official !== null
    if (filter === 'unmatched') return model.official === null
    if (filter === 'image') {
      return model.capabilities.inputModalities.effective.includes('image')
        || model.capabilities.inputModalities.extraOfficial.includes('image')
    }
    if (filter === 'reasoning') return model.reasoningEfforts.length > 0 || model.capabilities.reasoning.official
    if (filter === 'restricted') return !model.available
    return true
  })

  const source = models.data?.source
  const sourceTone = source === 'live' ? 'success' : source === 'saved' ? 'warning' : 'default'
  const status = models.data?.modelsDev
  const selected = models.data?.models.find(model => model.slug === selectedSlug) ?? null
  const matchedCount = models.data?.models.filter(model => model.official !== null).length ?? 0

  return (
    <>
      <PageHeader
        title="模型"
        desc="AStudio 目录是网关实际能力；models.dev 是官方参考层。这里并列展示上下文、模态、推理、倍率和官方价，不用内置清单顶替上游。"
        actions={(
          <>
            <Button variant="ghost" size="sm" onClick={() => setAliasOpen(true)}><Tags size={13} />别名</Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refreshModelsDev()}
              loading={busy === 'models-dev'}
              disabled={status === undefined || !status.enabled || status.refreshing}
            >
              <RefreshCw size={13} />刷新官方元数据
            </Button>
            <Button variant="primary" size="sm" onClick={() => void refresh()} loading={busy === 'refresh'}><RefreshCw size={13} />刷新目录</Button>
          </>
        )}
      />

      <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Badge tone={sourceTone as 'success' | 'warning' | 'default'} dot>
            {source === 'live' ? '实时目录' : source === 'saved' ? '上次快照' : '空目录'}
          </Badge>
          <span className="faint" style={{ fontSize: 11 }}>更新于 {dateTime(models.data?.fetchedAt)}</span>
          <span className="faint" style={{ fontSize: 11 }}>· {models.data?.models.length ?? 0} 个模型</span>
          <Badge tone={modelsDevTone(status)} dot>官方元数据：{modelsDevLabel(status)}</Badge>
          <span className="faint" style={{ fontSize: 11 }}>· {matchedCount} 个有官方对照</span>
          {status?.refreshing === true && <span className="faint" style={{ fontSize: 11 }}>· 正在拉取…</span>}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Select value={filter} onChange={event => setFilter(event.target.value as Filter)} aria-label="筛选模型">
            <option value="all">全部</option>
            <option value="matched">有官方对照</option>
            <option value="unmatched">无官方对照</option>
            <option value="image">支持图片</option>
            <option value="reasoning">支持推理</option>
            <option value="restricted">受限</option>
          </Select>
          <div style={{ position: 'relative', width: 'min(320px, 100%)' }}>
            <Search size={14} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--faint)' }} />
            <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索显示名 / slug / 目录 ID / 别名 / 官方条目" style={{ paddingLeft: 32 }} />
          </div>
        </div>
      </div>

      {models.data?.error !== undefined && models.data.error !== '' && (
        <div className="banner banner-warn">{models.data.error}</div>
      )}
      {status !== undefined && status.error !== '' && (
        <div className="banner banner-warn" role="alert">官方元数据：{status.error}</div>
      )}
      {status !== undefined && !status.enabled && (
        <div className="banner" style={{ fontSize: 12 }}>
          官方元数据未启用。到 <Link to="/settings" style={{ color: 'var(--accent)' }}>设置 → 官方元数据</Link> 开启后，这里会显示 models.dev 官方价、上下文与模态对照。
        </div>
      )}
      {status !== undefined && status.enabled && status.source === 'empty' && (
        <div className="banner" style={{ fontSize: 12 }}>官方元数据还没有快照；点右上角「刷新官方元数据」或等待后台拉取。</div>
      )}

      <Card>
        <CardHead title="模型目录" sub="显隐只影响选择器；已选中的会话仍可继续调用" />
        {models.isPending && <div style={{ padding: 18 }}><LoadingBlock rows={6} /></div>}
        {models.isError && <div className="banner banner-danger" style={{ margin: 16 }}>{errorMessage(models.error)}</div>}
        {!models.isPending && list.length === 0 && (
          <EmptyState
            icon={<Boxes size={18} />}
            title={search === '' && filter === 'all' ? '目录为空' : '没有匹配的模型'}
            desc={search === '' && filter === 'all' ? '请先添加账号，并确认账号能读到 model-manager 目录。' : '换一个关键词或筛选条件。'}
            action={search === '' && filter === 'all' ? <Button variant="primary" size="sm" onClick={() => void refresh()} loading={busy === 'refresh'}>立即刷新</Button> : undefined}
          />
        )}
        {list.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>模型</th>
                  <th className="num">上下文 / 输出</th>
                  <th>多模态</th>
                  <th>推理</th>
                  <th>可用性</th>
                  <th>倍率 / 官方价</th>
                  <th>探测</th>
                  <th>显示</th>
                  <th style={{ width: 118 }} />
                </tr>
              </thead>
              <tbody>
                {list.map(model => {
                  const latest = model.probe.latest
                  const official = model.official
                  const extraModalities = model.capabilities.inputModalities.extraOfficial
                  return (
                    <tr key={model.slug}>
                      <td>
                        <div style={{ display: 'grid', gap: 2 }}>
                          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                            <span
                              role="button"
                              tabIndex={0}
                              style={{ fontWeight: 550, cursor: 'pointer' }}
                              onClick={() => openDetail(model, 'capabilities')}
                              onKeyDown={event => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault()
                                  openDetail(model, 'capabilities')
                                }
                              }}
                            >
                              {model.name}
                            </span>
                            <Badge tone={official === null ? 'default' : 'cyan'}>
                              {official === null ? '无对照' : confidenceLabel(official.confidence)}
                            </Badge>
                            {model.aliases.map(alias => <Badge key={alias}>{alias}</Badge>)}
                          </div>
                          <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>
                            {model.slug}{model.directoryId !== '' ? ` · ${model.directoryId}` : ''}
                          </span>
                        </div>
                      </td>
                      <td className="num">
                        <div className="row" style={{ gap: 3, justifyContent: 'flex-end' }}>
                          <span>{model.contextWindow > 0 ? compact(model.contextWindow) : '—'}</span>
                          {model.capabilities.context.mismatch && (
                            <span title={`平台 ${compact(model.contextWindow)} / 官方 ${compact(model.capabilities.context.official)}`}>
                              <AlertTriangle size={11} style={{ color: 'var(--warning)' }} aria-label="上下文与官方值不同" />
                            </span>
                          )}
                        </div>
                        <div className="faint row" style={{ fontSize: 10, gap: 3, justifyContent: 'flex-end' }}>
                          <span>输出 {model.maxOutputTokens > 0 ? compact(model.maxOutputTokens) : '—'}</span>
                          {model.capabilities.output.mismatch && (
                            <span title={`平台 ${compact(model.maxOutputTokens)} / 官方 ${compact(model.capabilities.output.official)}`}>
                              <AlertTriangle size={10} style={{ color: 'var(--warning)' }} aria-label="输出上限与官方值不同" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 3, flexWrap: 'wrap' }}>
                          {model.capabilities.inputModalities.effective.map(value => (
                            <Badge key={value} tone={value === 'text' ? 'default' : 'cyan'}>{modalityShort(value)}</Badge>
                          ))}
                          {extraModalities.map(value => (
                            <Badge key={`official-${value}`} tone="warning">官{modalityShort(value)}</Badge>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                          {model.reasoningEfforts.length === 0
                            ? <span className="faint">{model.capabilities.reasoning.official ? '官方可推理' : '—'}</span>
                            : model.reasoningEfforts.map(effort => <Badge key={effort} tone="cyan">{effort}</Badge>)}
                          {model.canDisableThinking && <Badge>可关思考</Badge>}
                        </div>
                      </td>
                      <td>
                        <Badge tone={model.available ? 'success' : 'warning'} dot>{model.available ? '可调用' : '受限'}</Badge>
                        {model.availableAccounts.length > 0 && (
                          <div className="faint" style={{ fontSize: 10, marginTop: 3 }}>
                            {model.availableAccounts.slice(0, 2).join('、')}{model.availableAccounts.length > 2 ? ` +${model.availableAccounts.length - 2}` : ''}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                          {model.pointMultipliers.length > 0
                            ? model.pointMultipliers.slice(0, 2).map(item => (
                                <Badge key={`${item.accountId}:${item.value}`} tone="accent">×{item.value}</Badge>
                              ))
                            : model.pointMultiplier !== ''
                              ? <Badge tone="accent">×{model.pointMultiplier}</Badge>
                              : <span className="faint">—</span>}
                          {model.pointMultipliers.length > 2 && <Badge>+{model.pointMultipliers.length - 2}</Badge>}
                        </div>
                        <div
                          className="faint mono"
                          style={{ fontSize: 10, marginTop: 3 }}
                          title={official !== null ? `${official.providerName} · ${official.key}` : undefined}
                        >
                          {official !== null ? pricePair(official.cost) : '无官方价'}
                        </div>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          <Badge tone={probeTone(latest?.state)} dot>{probeLabel(latest?.state, latest?.modality)}</Badge>
                          {latest !== undefined && latest.latencyMs > 0 && <span className="faint" style={{ fontSize: 10 }}>{ms(latest.latencyMs)}</span>}
                        </div>
                        {latest !== undefined && (
                          <div className="faint" style={{ fontSize: 10, marginTop: 3 }}>
                            {latest.effort === '' ? '不传档位' : latest.effort}{latest.modality === 'image' ? ' · 图片' : ''}
                          </div>
                        )}
                        {model.probe.acceptedEfforts.length > 1 && (
                          <div className="faint" style={{ fontSize: 10 }}>接受 {model.probe.acceptedEfforts.join('、')}</div>
                        )}
                      </td>
                      <td>
                        <Switch checked={!model.hidden} onCheckedChange={value => void setVisible(model, value)} disabled={busy === `${model.slug}:visible`} label={`显示 ${model.name}`} />
                      </td>
                      <td>
                        <div className="row" style={{ gap: 2 }}>
                          <Button size="sm" variant="ghost" onClick={() => openDetail(model, 'capabilities')}>详情</Button>
                          <Button size="sm" variant="ghost" onClick={() => openDetail(model, 'probe')} aria-label={`探测 ${model.name}`}>
                            <FlaskConical size={13} />
                          </Button>
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

      <div className="split-even">
        <Card>
          <CardHead title="目录与官方元数据" />
          <div style={{ padding: 16, display: 'grid', gap: 8, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
            <div>· 目录只保留 <code className="code">visibility = list</code>、<code className="code">supported_in_api = true</code> 且带上下文/输出预算的行。</div>
            <div>· 账号的 <code className="code">bot/models/configs</code> 回答“这个账号能不能调用”；没有列出的模型显示为受限。</div>
            <div>· 倍率来自账号配置的 <code className="code">point_multiplier</code>，按账号分别展示；账号间不同会全部列出。</div>
            <div>· models.dev 只作官方参考：缓存 24 小时、ETag 复用；刷新失败保留上次快照，不影响网关调用。</div>
            <div>· 官方价单位是 USD / 1M tokens；“按倍率估算平台价”在详情里手动开启，公式写在界面上。</div>
          </div>
        </Card>
        <Card>
          <CardHead title="探测说明" />
          <div style={{ padding: 16, display: 'grid', gap: 8, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
            <div>· 默认消息 <code className="code">hi</code>，可改成任意文本；默认最大输出 512，可设 1–4096。</div>
            <div>· 思考档位可选目录声明值、关闭思考（none）、自定义；默认跟随 <code className="code">default_reasoning_level</code>。</div>
            <div>· 账号范围默认首个可调用账号；需要对比多账号时选“全部可用账号（最多 3 个）”。</div>
            <div>· 图片探测发一张内置红色方块图，只验证图片输入是否被接受；音频/视频/PDF 只做官方元数据对照。</div>
            <div>· 上游 200 记为已接受；400 且提到档位/参数记为档位未通过；其余记为失败。结果存 7 天。</div>
          </div>
        </Card>
      </div>

      <Modal
        open={aliasOpen}
        onOpenChange={setAliasOpen}
        title="模型别名"
        description="每行一个 alias=target，target 必须是目录里已有的显示名、slug 或目录 ID。"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setAliasOpen(false)}>取消</Button>
            <Button variant="primary" loading={busy === 'aliases'} onClick={() => void saveAliases()}>保存</Button>
          </>
        )}
      >
        <Field label="别名映射" hint="例如：glm=GLM-5.2 或 fast=xopglm52">
          <Textarea value={aliasText} onChange={event => setAliasText(event.target.value)} rows={8} placeholder={'glm=xopglm52\nfast=spark-x2.5'} />
        </Field>
      </Modal>

      <ModelDetail
        model={selected}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        initialTab={detailTab}
        onChanged={invalidate}
      />
    </>
  )
}
