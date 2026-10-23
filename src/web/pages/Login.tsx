import * as React from 'react'
import { Command, KeyRound, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { endpoints } from '../lib/api.js'
import { errorMessage } from '../lib/format.js'
import { Button, Input } from '../components/ui.js'

export function Login({ onSuccess }: { onSuccess: () => void }): React.ReactElement {
  const [password, setPassword] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (password === '') return
    setBusy(true)
    setError('')
    try {
      await endpoints.login(password)
      toast.success('已登录')
      onSuccess()
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark"><Command size={18} strokeWidth={2.4} /></div>
          <div>
            <div className="brand-title">myapi</div>
            <div className="brand-sub">gateway console</div>
          </div>
        </div>
        <h1 className="login-title">进入控制台</h1>
        <p className="login-sub">输入首次启动时打印在终端里的面板密码。密码只保存在本机的状态文件中，不会上传。</p>
        <form onSubmit={event => void submit(event)} className="stack">
          <div>
            <label className="label" htmlFor="password">面板密码</label>
            <div style={{ position: 'relative' }}>
              <KeyRound size={14} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--faint)' }} />
              <Input
                id="password"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="••••••••••••"
                style={{ paddingLeft: 32 }}
              />
            </div>
          </div>
          {error !== '' && <div className="banner banner-danger">{error}</div>}
          <Button type="submit" variant="primary" disabled={busy || password === ''}>
            {busy ? <Loader2 size={14} className="spin" /> : null}
            登录
          </Button>
        </form>
        <div className="banner" style={{ marginTop: 18 }}>
          忘记密码？停止服务后删除 <code className="code">data/state.json</code> 里的 auth 字段会重新生成随机密码；更稳妥的做法是启动时用 <code className="code">MYAPI_ADMIN_PASSWORD</code> 指定。
        </div>
      </div>
    </div>
  )
}
