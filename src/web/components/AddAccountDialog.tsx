import * as React from 'react'
import { FileUp, Loader2, MessageSquare, ShieldCheck, Globe } from 'lucide-react'
import { toast } from 'sonner'
import { endpoints } from '../lib/api.js'
import { accountName, hasFullCredential, points, spark, planName, planActive, credentialBadge, checkinDeltaText } from '../lib/accounts.js'
import { errorMessage } from '../lib/format.js'
import { solveGeetest } from '../lib/geetest.js'
import { useProviders } from '../lib/queries.js'
import { Badge, Button, EmptyState, Field, Input, LoadingBlock, Modal, Select, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from './ui.js'

/** Round-trip budget for the browser authorization poll, in milliseconds. */
const OAUTH_POLL_MS = 2_000
const OAUTH_TIMEOUT_MS = 5 * 60_000

type OauthStatus = 'idle' | 'pending' | 'done' | 'expired' | 'error'

interface TabDef {
  key: string
  label: string
  /** Capability bit that gates this tab; a false bit never produces a tab. */
  cap: 'smsLogin' | 'pasteCredential' | 'importFromClient' | 'webLogin'
}

/** Render order of the onboarding tabs; the first available one is the default. */
const TAB_DEFS: TabDef[] = [
  { key: 'sms', label: '短信登录', cap: 'smsLogin' },
  { key: 'paste', label: '粘贴凭据', cap: 'pasteCredential' },
  { key: 'file', label: '导入文件', cap: 'importFromClient' },
  { key: 'web', label: '网页授权登录', cap: 'webLogin' },
]

export function AddAccountDialog({ open, onOpenChange, onAdded }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: () => void
}): React.ReactElement {
  const providersQuery = useProviders()
  const providers = providersQuery.data?.providers ?? []
  const providersLoading = providersQuery.isLoading
  const providersFailed = providersQuery.isError

  const [providerId, setProviderId] = React.useState('')
  const [tab, setTab] = React.useState('sms')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  const [mobile, setMobile] = React.useState('')
  const [code, setCode] = React.useState('')
  const [countdown, setCountdown] = React.useState(0)
  const [smsSent, setSmsSent] = React.useState(false)
  /** Opaque send-session token from the provider; echoed back on verify. */
  const [ticket, setTicket] = React.useState('')

  const [pasteFields, setPasteFields] = React.useState<Record<string, string>>({})
  const [pasteName, setPasteName] = React.useState('')
  const [configToml, setConfigToml] = React.useState('')
  const [sessionJson, setSessionJson] = React.useState('')
  const [configName, setConfigName] = React.useState('')
  const [sessionName, setSessionName] = React.useState('')

  // ---- Browser authorization state ----
  const [redirectUri, setRedirectUri] = React.useState('')
  const [stateId, setStateId] = React.useState('')
  const [hint, setHint] = React.useState('')
  const [oauthStatus, setOauthStatus] = React.useState<OauthStatus>('idle')
  const [oauthMessage, setOauthMessage] = React.useState('')
  const [oauthLabel, setOauthLabel] = React.useState('')
  const [oauthElapsed, setOauthElapsed] = React.useState(0)
  const [webBusy, setWebBusy] = React.useState(false)
  const [exchangeUrl, setExchangeUrl] = React.useState('')

  // Timers and the popup this component opened are kept in refs so cleanup is idempotent.
  const pollTimer = React.useRef<number | null>(null)
  const elapsedTimer = React.useRef<number | null>(null)
  const startedAtRef = React.useRef(0)
  const openedWindowRef = React.useRef<Window | null>(null)

  const stopRoundTrip = React.useCallback((): void => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current)
      pollTimer.current = null
    }
    if (elapsedTimer.current !== null) {
      window.clearInterval(elapsedTimer.current)
      elapsedTimer.current = null
    }
    const win = openedWindowRef.current
    if (win !== null) {
      try { win.close() } catch { /* the popup may already be gone */ }
      openedWindowRef.current = null
    }
  }, [])

  // Default the selector to the first registered provider once the roster lands.
  React.useEffect(() => {
    if (providerId !== '' || providers.length === 0) return
    setProviderId(providers[0]?.id ?? '')
  }, [providers, providerId])

  // Re-fetch the callback address whenever the authorization tab is opened.
  React.useEffect(() => {
    if (!open || tab !== 'web') return
    let cancelled = false
    void (async (): Promise<void> => {
      try {
        const info = await endpoints.oauthRedirect()
        if (!cancelled) setRedirectUri(info.redirectUri)
      } catch (caught: unknown) {
        if (!cancelled) setError(errorMessage(caught))
      }
    })()
    return () => { cancelled = true }
  }, [open, tab])

  // Close the popup and clear the timers on close, provider change and tab switch.
  React.useEffect(() => stopRoundTrip, [stopRoundTrip, open, providerId, tab])

  // Reset provider-scoped state when the dialog closes or the provider changes.
  React.useEffect(() => {
    if (open) return
    setBusy(false)
    setError('')
    setMobile('')
    setCode('')
    setCountdown(0)
    setSmsSent(false)
    setTicket('')
    setPasteFields({})
    setPasteName('')
    setConfigToml('')
    setSessionJson('')
    setConfigName('')
    setSessionName('')
    setStateId('')
    setHint('')
    setOauthStatus('idle')
    setOauthMessage('')
    setOauthLabel('')
    setOauthElapsed(0)
    setExchangeUrl('')
  }, [open])

  React.useEffect(() => {
    if (providerId === '') return
    setTicket('')
    setSmsSent(false)
    setPasteFields({})
    setPasteName('')
    setConfigToml('')
    setSessionJson('')
    setConfigName('')
    setSessionName('')
    setStateId('')
    setHint('')
    setOauthStatus('idle')
    setOauthMessage('')
    setOauthLabel('')
    setOauthElapsed(0)
    setExchangeUrl('')
  }, [providerId])

  React.useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setInterval(() => setCountdown(value => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [countdown])

  const sendCode = async (): Promise<void> => {
    if (!/^1[3-9]\d{9}$/u.test(mobile.trim())) {
      setError('请输入 11 位中国大陆手机号')
      return
    }
    setError('')
    setBusy(true)
    try {
      // AStudio sits its SMS behind GeeTest; providers without a challenge are sent
      // straight through. TODO(M7): drive this from a provider-declared signal instead
      // of an id comparison.
      if (providerId === 'astudio') {
        const config = await endpoints.geetest()
        const solved = await solveGeetest(config.geetest)
        await endpoints.providerSmsSend(providerId, {
          mobile: mobile.trim(),
          challenge: solved.geetest_challenge,
          validate: solved.geetest_validate,
          seccode: solved.geetest_seccode,
        })
      } else {
        const result = await endpoints.providerSmsSend(providerId, { mobile: mobile.trim() })
        setTicket(result.ticket ?? '')
      }
      setSmsSent(true)
      setCountdown(60)
      toast.success('验证码已发送')
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const verify = async (): Promise<void> => {
    if (code.trim() === '') {
      setError('请填写短信验证码')
      return
    }
    setError('')
    setBusy(true)
    try {
      const result = await endpoints.providerSmsVerify(providerId, {
        mobile: mobile.trim(),
        code: code.trim(),
        ...(ticket === '' ? {} : { ticket }),
      })
      toast.success(`账号已添加：${accountName(result.account)}`)
      onAdded()
      onOpenChange(false)
      setCode('')
      setSmsSent(false)
      setTicket('')
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const importPaste = async (): Promise<void> => {
    setError('')
    setBusy(true)
    try {
      const fields: Record<string, string> = {}
      for (const [field, value] of Object.entries(pasteFields)) {
        if (value.trim() !== '') fields[field] = value.trim()
      }
      const result = await endpoints.providerPaste(providerId, fields, pasteName.trim() === '' ? undefined : pasteName.trim())
      toast.success(`账号已导入：${accountName(result.account)}`)
      onAdded()
      onOpenChange(false)
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const importFile = async (): Promise<void> => {
    if (configToml === '' && sessionJson === '') {
      setError('至少选择一个 AStudio 会话文件')
      return
    }
    setError('')
    setBusy(true)
    try {
      const result = await endpoints.importFile({ providerId, configToml, sessionJson })
      toast.success(`账号已导入：${accountName(result.account)}`)
      onAdded()
      onOpenChange(false)
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const readFile = async (file: File | undefined, setter: (value: string) => void, setName: (value: string) => void): Promise<void> => {
    if (file === undefined) return
    setName(file.name)
    setter(await file.text())
  }

  // ---- Browser authorization flow ----

  const finishWithAccount = (label: string): void => {
    setOauthStatus('done')
    setOauthLabel(label)
    stopRoundTrip()
    toast.success(`授权完成，账号已添加${label === '' ? '' : `：${label}`}`)
    // Keep the success banner visible briefly, then hand back to the parent.
    window.setTimeout(() => {
      onAdded()
      onOpenChange(false)
    }, 600)
  }

  const startRoundTrip = async (): Promise<void> => {
    setWebBusy(true)
    setError('')
    try {
      const session = await endpoints.oauthStart(providerId)
      setStateId(session.stateId)
      setHint(session.hint)
      setRedirectUri(session.redirectUri)
      setOauthStatus('pending')
      setOauthMessage('')
      setOauthLabel('')
      setOauthElapsed(0)
      startedAtRef.current = Date.now()

      // Providers send X-Frame-Options: DENY, so the consent window must be a real popup.
      const win = window.open(session.authorizeUrl, '_blank', 'noopener')
      openedWindowRef.current = win

      pollTimer.current = window.setInterval(async () => {
        try {
          const pending = await endpoints.oauthPending(session.stateId)
          if (pending.status === 'done') {
            finishWithAccount(pending.label ?? '')
          } else if (pending.status === 'expired') {
            setOauthStatus('expired')
            setOauthMessage(pending.message === '' ? '授权已过期，请重新发起' : pending.message)
            stopRoundTrip()
          } else if (pending.status === 'error') {
            setOauthStatus('error')
            setOauthMessage(pending.message)
            stopRoundTrip()
          }
        } catch (caught: unknown) {
          setOauthStatus('error')
          setOauthMessage(errorMessage(caught))
          stopRoundTrip()
        }
      }, OAUTH_POLL_MS)

      elapsedTimer.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000)
        setOauthElapsed(elapsed)
        if (elapsed * 1000 >= OAUTH_TIMEOUT_MS) {
          setOauthStatus('expired')
          setOauthMessage('授权超时，请重新发起')
          stopRoundTrip()
        }
      }, 1_000)
    } catch (caught: unknown) {
      setOauthStatus('error')
      setOauthMessage(errorMessage(caught))
    } finally {
      setWebBusy(false)
    }
  }

  const submitExchange = async (): Promise<void> => {
    setError('')
    setWebBusy(true)
    try {
      const result = await endpoints.oauthExchange({ providerId, stateId, callbackUrl: exchangeUrl.trim() })
      if (result.ok) {
        finishWithAccount(result.account === undefined ? '' : accountName(result.account))
      } else {
        setOauthStatus('error')
        setOauthMessage(result.message)
      }
    } catch (caught: unknown) {
      setOauthStatus('error')
      setOauthMessage(errorMessage(caught))
    } finally {
      setWebBusy(false)
    }
  }

  // ---- Derived view ----
  const provider = providers.find(item => item.id === providerId)
  const caps = provider?.capabilities
  const capFor = (cap: TabDef['cap']): boolean => caps?.[cap] === true

  const tabDefs = TAB_DEFS.map(def => ({ ...def, on: capFor(def.cap) }))
  const availableTabs = tabDefs.filter(def => def.on)
  /** A provider with no capabilities at all still gets the paste tab as the escape hatch. */
  const noAutoMethod = availableTabs.length === 0
  const shownTabs = noAutoMethod ? [{ key: 'paste', label: '粘贴凭据' }] : availableTabs
  const activeTab = shownTabs.some(item => item.key === tab) ? tab : shownTabs[0]?.key ?? 'paste'

  const oauthStatusLabel = oauthStatus === 'pending'
    ? `授权中（已等待 ${oauthElapsed}s）`
    : oauthStatus === 'done' ? '已完成' : oauthStatus === 'expired' ? '已过期' : oauthStatus === 'error' ? '失败' : '尚未开始'

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="添加账号"
      description="按提供商选择登录方式。短信登录与网页授权都需要在浏览器窗口里由人完成验证，网关不做自动解题。"
      wide
    >
      {error !== '' && <div className="banner banner-danger">{error}</div>}

      {providersLoading && providers.length === 0 ? (
        <LoadingBlock />
      ) : providersFailed ? (
        <div className="banner banner-danger">提供商列表加载失败，请重试。</div>
      ) : providers.length === 0 ? (
        <EmptyState
          title="尚未注册任何提供商"
          desc="网关没有可用的提供商，无法添加账号。"
          action={<Button variant="ghost" onClick={() => onOpenChange(false)}>关闭</Button>}
        />
      ) : (
        <>
          <Field label="提供商">
            <Select value={providerId} onChange={event => setProviderId(event.target.value)}>
              {providers.map(item => (
                <option key={item.id} value={item.id}>{item.displayName}</option>
              ))}
            </Select>
          </Field>

          {noAutoMethod && <div className="banner banner-warn">该提供商不支持任何自动登录方式，请改用粘贴凭据</div>}

          <Tabs value={activeTab} onValueChange={setTab}>
            <TabsList>
              {shownTabs.map(item => (
                <TabsTrigger key={item.key} value={item.key}>{item.label}</TabsTrigger>
              ))}
            </TabsList>

            {activeTab === 'sms' && (
              <TabsContent value="sms">
                <div className="stack" style={{ paddingTop: 16 }}>
                  <div className="banner">
                    <ShieldCheck size={15} style={{ flex: 'none', marginTop: 1 }} />
                    <span>短信发送前会弹出 GeeTest 滑块，必须在本页浏览器里由人完成。网关不做自动解题。</span>
                  </div>
                  <Field label="手机号" hint="中国大陆 11 位手机号，与客户端登录一致。">
                    <Input value={mobile} onChange={event => setMobile(event.target.value)} placeholder="13800138000" inputMode="tel" autoComplete="tel" />
                  </Field>
                  <div className="row" style={{ alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <Field label="短信验证码">
                        <Input value={code} onChange={event => setCode(event.target.value)} placeholder="6 位验证码" inputMode="numeric" autoComplete="one-time-code" />
                      </Field>
                    </div>
                    <Button onClick={() => void sendCode()} loading={busy} disabled={countdown > 0}>
                      <MessageSquare size={13} />
                      {countdown > 0 ? `${countdown}s 后重发` : smsSent ? '重新发送' : '发送验证码'}
                    </Button>
                  </div>
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
                    <Button variant="primary" onClick={() => void verify()} loading={busy} disabled={code.trim() === ''}>登录并添加</Button>
                  </div>
                </div>
              </TabsContent>
            )}

            {activeTab === 'paste' && (
              <TabsContent value="paste">
                <div className="stack" style={{ paddingTop: 16 }}>
                  <div className="banner">
                    粘贴该提供商的登录凭据。字段由提供商适配器声明，网关会把凭据整体加密保存。
                  </div>
                  <div className="form-grid">
                    {(providersQuery.data?.providers.find(provider => provider.id === providerId)?.credentialDescriptors ?? []).map(descriptor => (
                      <Field key={descriptor.field} label={descriptor.label + (descriptor.required ? '' : '（可选）')} hint={descriptor.hint}>
                        <Input
                          type={descriptor.secret ? 'password' : 'text'}
                          value={pasteFields[descriptor.field] ?? ''}
                          onChange={event => setPasteFields(current => ({ ...current, [descriptor.field]: event.target.value }))}
                          placeholder={descriptor.hint}
                        />
                      </Field>
                    ))}
                    <div className="span-2">
                      <Field label="账号备注名（可选）">
                        <Input value={pasteName} onChange={event => setPasteName(event.target.value)} placeholder="例如：主账号" />
                      </Field>
                    </div>
                  </div>
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
                    <Button variant="primary" onClick={() => void importPaste()} loading={busy}>导入账号</Button>
                  </div>
                </div>
              </TabsContent>
            )}

            {activeTab === 'file' && (
              <TabsContent value="file">
                <div className="stack" style={{ paddingTop: 16 }}>
                  <div className="banner">
                    选择本机客户端数据目录下的两个文件。浏览器只在本机读取文本，然后提交给网关解析；不会上传到第三方。
                  </div>
                  <div className="form-grid">
                    <Field label="config.toml" hint={configName === '' ? '可选，提供模型 Bearer' : configName}>
                      <label className="btn" style={{ width: '100%' }}>
                        <FileUp size={14} />
                        选择 config.toml
                        <input
                          type="file"
                          accept=".toml,text/plain"
                          style={{ display: 'none' }}
                          onChange={event => void readFile(event.target.files?.[0], setConfigToml, setConfigName)}
                        />
                      </label>
                    </Field>
                    <Field label="astron-session.json" hint={sessionName === '' ? '可选，提供完整会话' : sessionName}>
                      <label className="btn" style={{ width: '100%' }}>
                        <FileUp size={14} />
                        选择 astron-session.json
                        <input
                          type="file"
                          accept=".json,application/json"
                          style={{ display: 'none' }}
                          onChange={event => void readFile(event.target.files?.[0], setSessionJson, setSessionName)}
                        />
                      </label>
                    </Field>
                  </div>
                  {(configToml !== '' || sessionJson !== '') && (
                    <div className="row" style={{ gap: 8 }}>
                      <span className="badge badge-success"><span className="badge-dot" />{configToml !== '' ? 'config.toml 已读取' : '未选 config.toml'}</span>
                      <span className="badge badge-success"><span className="badge-dot" />{sessionJson !== '' ? 'astron-session.json 已读取' : '未选 session'}</span>
                    </div>
                  )}
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
                    <Button variant="primary" onClick={() => void importFile()} loading={busy}>解析并导入</Button>
                  </div>
                </div>
              </TabsContent>
            )}

            {activeTab === 'web' && (
              <TabsContent value="web">
                <div className="stack" style={{ paddingTop: 16 }}>
                  <div className="banner">
                    <ShieldCheck size={15} style={{ flex: 'none', marginTop: 1 }} />
                    <span>授权在新窗口里由人完成，网关只轮询状态，不自动通过任何验证码。</span>
                  </div>

                  {redirectUri !== '' && (
                    <Field label="回调地址" hint="提供商会把浏览器重定向回这个地址，请勿泄露。">
                      <code className="code" style={{ display: 'block', overflowWrap: 'anywhere' }}>{redirectUri}</code>
                    </Field>
                  )}
                  {hint !== '' && <div className="banner">{hint}</div>}

                  <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <Button variant="primary" onClick={() => void startRoundTrip()} loading={webBusy}>
                        <Globe size={13} />
                        在浏览器中打开授权
                      </Button>
                    </div>
                    <Button variant="ghost" onClick={stopRoundTrip} disabled={oauthStatus !== 'pending'}>取消</Button>
                  </div>

                  {stateId !== '' && (
                    <div className="stack">
                      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                        <Badge tone={oauthStatus === 'done' ? 'success' : oauthStatus === 'pending' ? 'accent' : oauthStatus === 'error' ? 'danger' : 'default'} dot>
                          {oauthStatusLabel}
                        </Badge>
                        {oauthStatus === 'pending' && <span className="badge">剩余 {Math.max(0, Math.ceil((OAUTH_TIMEOUT_MS - oauthElapsed * 1000) / 1000))}s</span>}
                      </div>
                      <Field label="state" hint="如浏览器窗口未完成跳转，可复制后联系管理员，或改用下方手动粘贴。">
                        <code className="code" style={{ display: 'block', overflowWrap: 'anywhere' }}>{stateId}</code>
                      </Field>
                    </div>
                  )}

                  {oauthStatus === 'done' && (
                    <div className="banner">
                      <span className="badge badge-success" style={{ flex: 'none' }}>完成</span>
                      <span>授权完成，账号已添加{oauthLabel === '' ? '' : `：${oauthLabel}`}。</span>
                    </div>
                  )}
                  {oauthStatus === 'expired' && <div className="banner banner-warn">授权已过期，请重新发起</div>}
                  {oauthStatus === 'error' && <div className="banner banner-danger">{oauthMessage}</div>}

                  <Field
                    label="手动粘贴回调地址（兜底）"
                    hint="当浏览器窗口无法完成跳转时，把地址栏里完整的回调 URL 粘贴到这里。"
                    error={stateId === '' ? '请先点击「在浏览器中打开授权」发起一轮授权，再粘贴回调地址。' : undefined}
                  >
                    <Textarea
                      rows={3}
                      value={exchangeUrl}
                      onChange={event => setExchangeUrl(event.target.value)}
                      placeholder="https://…/callback?code=…&state=…"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                  </Field>
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                    <Button
                      variant="primary"
                      onClick={() => void submitExchange()}
                      loading={webBusy}
                      disabled={stateId === '' || exchangeUrl.trim() === ''}
                    >
                      用粘贴的地址完成授权
                    </Button>
                  </div>
                </div>
              </TabsContent>
            )}
          </Tabs>
        </>
      )}
      {busy && <div className="row" style={{ color: 'var(--muted)', fontSize: 11 }}><Loader2 size={12} className="spin" />正在与上游交互，请稍候…</div>}
    </Modal>
  )
}
