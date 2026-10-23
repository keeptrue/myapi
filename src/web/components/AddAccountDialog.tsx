import * as React from 'react'
import { FileUp, Loader2, MessageSquare, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { endpoints } from '../lib/api.js'
import { accountName, hasFullCredential, points, spark, planName, planActive, credentialBadge, checkinDeltaText } from '../lib/accounts.js'
import { errorMessage } from '../lib/format.js'
import { solveGeetest } from '../lib/geetest.js'
import { Button, Field, Input, Modal, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from './ui.js'

export function AddAccountDialog({ open, onOpenChange, onAdded }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: () => void
}): React.ReactElement {
  const [tab, setTab] = React.useState('sms')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  const [mobile, setMobile] = React.useState('')
  const [code, setCode] = React.useState('')
  const [countdown, setCountdown] = React.useState(0)
  const [smsSent, setSmsSent] = React.useState(false)

  const [paste, setPaste] = React.useState({ token: '', ssoSessionId: '', accountId: '', uid: '', mobile: '', modelBearerToken: '', name: '' })
  const [configToml, setConfigToml] = React.useState('')
  const [sessionJson, setSessionJson] = React.useState('')
  const [configName, setConfigName] = React.useState('')
  const [sessionName, setSessionName] = React.useState('')

  React.useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setInterval(() => setCountdown(value => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [countdown])

  React.useEffect(() => {
    if (!open) {
      setError('')
      setBusy(false)
    }
  }, [open])

  const sendCode = async (): Promise<void> => {
    if (!/^1[3-9]\d{9}$/u.test(mobile.trim())) {
      setError('请输入 11 位中国大陆手机号')
      return
    }
    setError('')
    setBusy(true)
    try {
      const config = await endpoints.geetest()
      const solved = await solveGeetest(config.geetest)
      await endpoints.sendSms({
        mobile: mobile.trim(),
        challenge: solved.geetest_challenge,
        validate: solved.geetest_validate,
        seccode: solved.geetest_seccode,
      })
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
      const result = await endpoints.verifySms(mobile.trim(), code.trim())
      toast.success(`账号已添加：${accountName(result.account)}`)
      onAdded()
      onOpenChange(false)
      setCode('')
      setSmsSent(false)
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
      const result = await endpoints.importAccount({
        token: paste.token.trim(),
        ssoSessionId: paste.ssoSessionId.trim(),
        accountId: paste.accountId.trim(),
        uid: paste.uid.trim(),
        mobile: paste.mobile.trim(),
        modelBearerToken: paste.modelBearerToken.trim(),
        ...(paste.name.trim() === '' ? {} : { name: paste.name.trim() }),
      })
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
      const result = await endpoints.importFile({ configToml, sessionJson })
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

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="添加 AStudio 账号"
      description="推荐短信登录；已有桌面端会话时可直接粘贴或导入文件。凭据落盘前会用 AES-256-GCM 加密。"
      wide
    >
      {error !== '' && <div className="banner banner-danger">{error}</div>}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="sms">短信登录</TabsTrigger>
          <TabsTrigger value="paste">粘贴凭据</TabsTrigger>
          <TabsTrigger value="file">导入文件</TabsTrigger>
        </TabsList>

        <TabsContent value="sms">
          <div className="stack" style={{ paddingTop: 16 }}>
            <div className="banner">
              <ShieldCheck size={15} style={{ flex: 'none', marginTop: 1 }} />
              <span>短信发送前会弹出 GeeTest 滑块，必须在本页浏览器里由人完成。网关不做自动解题。</span>
            </div>
            <Field label="手机号" hint="中国大陆 11 位手机号，与 AStudio 客户端登录一致。">
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

        <TabsContent value="paste">
          <div className="stack" style={{ paddingTop: 16 }}>
            <div className="banner">
              三项凭据来自 AStudio 数据目录：<code className="code">runtime/acode-home/config.toml</code> 与 <code className="code">userdata/astron-session.json</code>。
              有 Cookie 时网关会自动换取 modelBearerToken；只填 Bearer 也能作为“模型专用”账号使用，但无法签到。
            </div>
            <div className="form-grid">
              <Field label="chat token" hint="config.toml 的 experimental_bearer_token">
                <Input value={paste.token} onChange={event => setPaste({ ...paste, token: event.target.value })} placeholder="eyJ…" />
              </Field>
              <Field label="ssoSessionId">
                <Input value={paste.ssoSessionId} onChange={event => setPaste({ ...paste, ssoSessionId: event.target.value })} placeholder="astron-session.json 的 ssoSessionId" />
              </Field>
              <Field label="accountId">
                <Input value={paste.accountId} onChange={event => setPaste({ ...paste, accountId: event.target.value })} placeholder="astron-session.json 的 accountId" />
              </Field>
              <Field label="uid" hint="可留空，导入时会尝试从 userInfo 补齐">
                <Input value={paste.uid} onChange={event => setPaste({ ...paste, uid: event.target.value })} placeholder="uid" />
              </Field>
              <Field label="手机号（可选）">
                <Input value={paste.mobile} onChange={event => setPaste({ ...paste, mobile: event.target.value })} placeholder="13800138000" />
              </Field>
              <Field label="modelBearerToken（可选）">
                <Input value={paste.modelBearerToken} onChange={event => setPaste({ ...paste, modelBearerToken: event.target.value })} placeholder="32位hex:base64" />
              </Field>
              <div className="span-2">
                <Field label="账号备注名（可选）">
                  <Input value={paste.name} onChange={event => setPaste({ ...paste, name: event.target.value })} placeholder="例如：主账号" />
                </Field>
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
              <Button variant="primary" onClick={() => void importPaste()} loading={busy}>导入账号</Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="file">
          <div className="stack" style={{ paddingTop: 16 }}>
            <div className="banner">
              选择 AStudio 数据目录下的两个文件。浏览器只在本机读取文本，然后提交给网关解析；不会上传到第三方。
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
      </Tabs>
      {busy && <div className="row" style={{ color: 'var(--muted)', fontSize: 11 }}><Loader2 size={12} className="spin" />正在与上游交互，请稍候…</div>}
    </Modal>
  )
}
