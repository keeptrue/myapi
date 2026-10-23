import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, RefreshCw, RotateCcw, Save, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import type { Settings as SettingsType } from '../../shared/types.js'
import { endpoints } from '../lib/api.js'
import { useModelsDev, useSettings, useSystem } from '../lib/queries.js'
import { dateTime, errorMessage } from '../lib/format.js'
import {
  Badge,
  Button,
  Card,
  CardHead,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  Switch,
  Textarea,
} from '../components/ui.js'

export function Settings(): React.ReactElement {
  const settings = useSettings()
  const system = useSystem()
  const modelsDev = useModelsDev()
  const queryClient = useQueryClient()
  const [form, setForm] = React.useState<SettingsType | null>(null)
  const [busy, setBusy] = React.useState('')
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [corsText, setCorsText] = React.useState('')

  React.useEffect(() => {
    if (settings.data === undefined) return
    setForm(settings.data.settings)
    setCorsText(settings.data.settings.corsOrigins.join('\n'))
  }, [settings.data])

  const original = settings.data?.settings
  const dirty = form !== null && original !== undefined && JSON.stringify(form) !== JSON.stringify(original)
  const restartChanged = form !== null && original !== undefined
    && (settings.data?.restartFields ?? []).some(field =>
      JSON.stringify((form as unknown as Record<string, unknown>)[field]) !== JSON.stringify((original as unknown as Record<string, unknown>)[field]))

  const update = <K extends keyof SettingsType>(key: K, value: SettingsType[K]): void => {
    setForm(currentForm => currentForm === null ? currentForm : { ...currentForm, [key]: value })
  }

  const save = async (): Promise<void> => {
    if (form === null) return
    setBusy('save')
    try {
      const result = await endpoints.saveSettings({
        ...form,
        corsOrigins: corsText.split('\n').map(item => item.trim()).filter(item => item !== ''),
      })
      setForm(result.settings)
      setCorsText(result.settings.corsOrigins.join('\n'))
      toast.success(result.needsRestart === true ? '设置已保存；部分上游/并发项需要重启生效' : '设置已保存')
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
      void queryClient.invalidateQueries({ queryKey: ['system'] })
      void queryClient.invalidateQueries({ queryKey: ['models-dev'] })
      void queryClient.invalidateQueries({ queryKey: ['models'] })
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
      void queryClient.invalidateQueries({ queryKey: ['models-dev'] })
      void queryClient.invalidateQueries({ queryKey: ['models'] })
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy('')
    }
  }

  const changePassword = async (): Promise<void> => {
    if (next.length < 8) {
      toast.error('新密码至少 8 位')
      return
    }
    if (next !== confirm) {
      toast.error('两次输入的新密码不一致')
      return
    }
    setBusy('password')
    try {
      await endpoints.changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      toast.success('面板密码已更新，旧会话已失效')
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy('')
    }
  }

  if (settings.isPending || form === null) {
    return (
      <>
        <PageHeader title="设置" desc="运行参数、调度与安全。" />
        <Card><div style={{ padding: 20 }}><LoadingBlock rows={8} /></div></Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="设置"
        desc="大部分改动即时生效；标注「需重启」的字段只写入状态文件，重启进程后才会应用到上游客户端。"
        actions={(
          <>
            <Button variant="ghost" size="sm" onClick={() => { setForm(settings.data?.settings ?? form); setCorsText(settings.data?.settings.corsOrigins.join('\n') ?? '') }} disabled={!dirty}>
              <RotateCcw size={13} />撤销
            </Button>
            <Button variant="primary" size="sm" onClick={() => void save()} loading={busy === 'save'} disabled={!dirty}><Save size={13} />保存设置</Button>
          </>
        )}
      />

      {restartChanged && <div className="banner banner-warn">检测到需重启字段发生变化：保存后请重启进程，上游地址 / 并发 / 日志保留等参数才会完全生效。</div>}
      {settings.isError && <div className="banner banner-danger">{errorMessage(settings.error)}</div>}

      <div className="split-even">
        <Card>
          <CardHead title="调度与轮换" sub="即时生效" />
          <div className="stack" style={{ padding: 16 }}>
            <ToggleRow
              title="余额感知轮换"
              desc="通用与 Spark 都为 0 的账号先跳过，两轮后回退，避免陈旧余额硬阻塞。"
              checked={form.balanceAwareRotation}
              onChange={value => update('balanceAwareRotation', value)}
            />
            <ToggleRow
              title="每日自动签到"
              desc="默认关闭。开启后过设定小时会补签，启动即补签。"
              checked={form.autoCheckin}
              onChange={value => update('autoCheckin', value)}
            />
            <div className="form-grid">
              <Field label="签到小时" hint="0–23，按进程时区">
                <Select value={String(form.checkinHour)} onChange={event => update('checkinHour', Number(event.target.value))}>
                  {Array.from({ length: 24 }).map((_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
                </Select>
              </Field>
              <Field label="保活间隔（分钟）" hint="0 = 关闭；定期刷新凭据与权益。">
                <Input type="number" min={0} max={1440} value={form.keepaliveMinutes} onChange={event => update('keepaliveMinutes', Number(event.target.value))} />
              </Field>
            </div>
            <ToggleRow title="代领每日奖励弹窗" desc="关闭横幅；真正发奖仍是 init-app。" checked={form.checkinCompletePopups} onChange={value => update('checkinCompletePopups', value)} />
            <ToggleRow title="领取客户端下载奖励" desc="已领取会记为 skipped。" checked={form.checkinClaimDownload} onChange={value => update('checkinClaimDownload', value)} />
            <ToggleRow title="领取 Beta 资格" desc="需要账号配置域账号，否则自动跳过。" checked={form.checkinClaimBeta} onChange={value => update('checkinClaimBeta', value)} />
          </div>
        </Card>

        <Card>
          <CardHead title="目录与日志" sub="目录刷新即时生效" />
          <div className="stack" style={{ padding: 16 }}>
            <Field label="目录刷新间隔（分钟）" hint="1–1440。刷新失败会保留上次快照。">
              <Input type="number" min={1} max={1440} value={form.catalogRefreshMinutes} onChange={event => update('catalogRefreshMinutes', Number(event.target.value))} />
            </Field>
            <div className="form-grid">
              <Field label="日志保留天数" hint="需重启">
                <Input type="number" min={1} max={365} value={form.logRetentionDays} onChange={event => update('logRetentionDays', Number(event.target.value))} />
              </Field>
              <Field label="内存日志条数" hint="需重启；影响面板回看。">
                <Input type="number" min={100} max={100000} value={form.logMaxEntries} onChange={event => update('logMaxEntries', Number(event.target.value))} />
              </Field>
            </div>
            <Field label="CORS 允许来源" hint="每行一个；留空表示不额外放行浏览器跨域。API 客户端不受影响。">
              <Textarea value={corsText} onChange={event => setCorsText(event.target.value)} rows={3} placeholder="https://example.com" />
            </Field>
            <div className="banner">日志只保存请求元数据，不保存 messages / tools 内容。</div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead
          title="官方元数据（models.dev）"
          sub="只读外部参考数据，不影响网关调用"
          actions={(
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void refreshModelsDev()}
              loading={busy === 'models-dev'}
              disabled={!form.modelsDevEnabled}
            >
              <RefreshCw size={13} />立即刷新
            </Button>
          )}
        />
        <div className="stack" style={{ padding: 16 }}>
          <ToggleRow
            title="启用官方元数据"
            desc="拉取 models.dev 的官方价、上下文、模态、推理选项与工具能力，用于模型页对照。"
            checked={form.modelsDevEnabled}
            onChange={value => update('modelsDevEnabled', value)}
          />
          <div className="form-grid">
            <div className="span-2">
              <Field label="数据地址" hint="默认 https://models.dev/api.json；可换成自建镜像。">
                <Input value={form.modelsDevUrl} onChange={event => update('modelsDevUrl', event.target.value)} />
              </Field>
            </div>
            <Field label="刷新间隔（小时）" hint="1–720；后台按此间隔检查，失败后 15 分钟退避。">
              <Input
                type="number"
                min={1}
                max={720}
                value={form.modelsDevRefreshHours}
                onChange={event => update('modelsDevRefreshHours', Number(event.target.value))}
              />
            </Field>
            <Field label="当前状态" hint="缓存文件：data/modelsdev.json">
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', minHeight: 34, alignItems: 'center' }}>
                {modelsDev.data === undefined
                  ? <span className="faint">读取中…</span>
                  : (
                    <>
                      <Badge tone={!modelsDev.data.status.enabled ? 'default' : modelsDev.data.status.error !== '' ? 'danger' : modelsDev.data.status.source === 'live' ? 'success' : modelsDev.data.status.source === 'saved' ? 'warning' : 'default'} dot>
                        {!modelsDev.data.status.enabled ? '未启用' : modelsDev.data.status.source === 'live' ? '实时' : modelsDev.data.status.source === 'saved' ? '缓存' : '未就绪'}
                      </Badge>
                      <span className="faint" style={{ fontSize: 11 }}>
                        {modelsDev.data.status.models} 个条目 · {modelsDev.data.status.providers} 个 provider
                      </span>
                      <span className="faint" style={{ fontSize: 11 }}>· 检查于 {dateTime(modelsDev.data.status.checkedAt)}</span>
                    </>
                  )}
              </div>
            </Field>
          </div>
          {modelsDev.data?.status.error !== undefined && modelsDev.data.status.error !== '' && (
            <div className="banner banner-warn" role="alert">{modelsDev.data.status.error}</div>
          )}
          {modelsDev.isError && <div className="banner banner-danger" role="alert">{errorMessage(modelsDev.error)}</div>}
          <div className="banner" style={{ fontSize: 12 }}>
            models.dev 只提供官方参考价与规格；AStudio 的 point_multiplier 与积分为平台口径。这里不会把两者换算成未经验证的货币倍率。
          </div>
        </div>
      </Card>

      <Card>
        <CardHead title="上游与运行时" sub="标注需重启的字段不会热更新" />
        <div className="form-grid" style={{ padding: 16 }}>
          <div className="span-2">
            <Field label="推理上游 Base URL" hint="默认 https://maas-api.cn-huabei-1.xf-yun.com/v1 · 需重启">
              <Input value={form.upstreamBase} onChange={event => update('upstreamBase', event.target.value)} />
            </Field>
          </div>
          <div className="span-2">
            <Field label="模型目录 Base URL" hint="默认 astronstudio-api-volces-prod.xf-yun.com/api/v1/model-manager · 需重启">
              <Input value={form.modelsBase} onChange={event => update('modelsBase', event.target.value)} />
            </Field>
          </div>
          <div className="span-2">
            <Field label="工作区 API Base URL" hint="登录、权益与 bot/models/configs 所在 · 需重启">
              <Input value={form.workspaceBase} onChange={event => update('workspaceBase', event.target.value)} />
            </Field>
          </div>
          <Field label="studioVersion" hint="上游客户端版本头 · 需重启">
            <Input value={form.studioVersion} onChange={event => update('studioVersion', event.target.value)} />
          </Field>
          <Field label="clientType" hint="Windows 21 / 其他 22 · 需重启">
            <Input value={form.clientType} onChange={event => update('clientType', event.target.value)} />
          </Field>
          <Field label="请求超时（秒）">
            <Input type="number" min={10} max={3600} value={form.requestTimeoutSeconds} onChange={event => update('requestTimeoutSeconds', Number(event.target.value))} />
          </Field>
          <Field label="流空闲超时（秒）">
            <Input type="number" min={10} max={3600} value={form.idleTimeoutSeconds} onChange={event => update('idleTimeoutSeconds', Number(event.target.value))} />
          </Field>
          <Field label="最大并发" hint="需重启">
            <Input type="number" min={1} max={64} value={form.maxConcurrency} onChange={event => update('maxConcurrency', Number(event.target.value))} />
          </Field>
          <Field label="请求体上限（MB）" hint="需重启">
            <Input type="number" min={1} max={256} value={form.maxBodyMb} onChange={event => update('maxBodyMb', Number(event.target.value))} />
          </Field>
        </div>
      </Card>

      <div className="split-even">
        <Card>
          <CardHead title="面板安全" sub="密码只存 scrypt 摘要" />
          <div className="stack" style={{ padding: 16 }}>
            <Field label="当前密码">
              <Input type="password" value={current} onChange={event => setCurrent(event.target.value)} autoComplete="current-password" />
            </Field>
            <div className="form-grid">
              <Field label="新密码" hint="至少 8 位">
                <Input type="password" value={next} onChange={event => setNext(event.target.value)} autoComplete="new-password" />
              </Field>
              <Field label="确认新密码">
                <Input type="password" value={confirm} onChange={event => setConfirm(event.target.value)} autoComplete="new-password" />
              </Field>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Button variant="primary" loading={busy === 'password'} onClick={() => void changePassword()} disabled={current === '' || next === ''}>
                <KeyRound size={13} />更新密码
              </Button>
            </div>
            <div className="banner"><ShieldCheck size={15} style={{ flex: 'none', marginTop: 1 }} />修改密码会让所有旧会话立即失效；当前浏览器会拿到新的 Cookie。</div>
          </div>
        </Card>

        <Card>
          <CardHead title="关于" sub={system.data === undefined ? '读取中…' : `v${system.data.version}`} />
          <div className="stack" style={{ padding: 16, gap: 10, fontSize: 12, color: 'var(--muted)' }}>
            <Row label="运行时长" value={system.data === undefined ? '—' : `${Math.floor(system.data.uptimeSeconds / 3600)}h ${Math.floor((system.data.uptimeSeconds % 3600) / 60)}m`} />
            <Row label="Node" value={system.data?.node ?? '—'} />
            <Row label="平台" value={system.data?.platform ?? '—'} />
            <Row label="账号 / 模型" value={system.data === undefined ? '—' : `${system.data.accounts} / ${system.data.models}`} />
            <Row label="目录错误" value={system.data?.catalogError === '' ? '无' : system.data?.catalogError ?? '—'} />
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              <Badge tone="accent">Chat</Badge>
              <Badge tone="cyan">Responses</Badge>
              <Badge>Messages</Badge>
            </div>
            <div className="banner" style={{ marginTop: 4 }}>
              只做本地个人使用；请遵守 AStudio 的服务条款。本项目不做验证码自动破解，也不承诺长期兼容上游私有接口。
            </div>
          </div>
        </Card>
      </div>
    </>
  )
}

function ToggleRow({ title, desc, checked, onChange }: { title: string; desc: string; checked: boolean; onChange: (value: boolean) => void }): React.ReactElement {
  return (
    <div className="row-between" style={{ gap: 14, alignItems: 'flex-start' }}>
      <div style={{ display: 'grid', gap: 2 }}>
        <span style={{ fontSize: 12.5, fontWeight: 550 }}>{title}</span>
        <span style={{ fontSize: 11, color: 'var(--faint)', lineHeight: 1.5 }}>{desc}</span>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} label={title} />
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="row-between" style={{ gap: 12 }}>
      <span style={{ color: 'var(--faint)' }}>{label}</span>
      <span className="mono" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )
}
