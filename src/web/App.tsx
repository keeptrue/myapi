import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { endpoints } from './lib/api.js'
import { Login } from './pages/Login.js'
import { Shell } from './components/Shell.js'
import { Overview } from './pages/Overview.js'
import { Accounts } from './pages/Accounts.js'
import { Keys } from './pages/Keys.js'
import { Models } from './pages/Models.js'
import { Usage } from './pages/Usage.js'
import { Logs } from './pages/Logs.js'
import { Benefits } from './pages/Benefits.js'
import { Settings } from './pages/Settings.js'
import { Route, Routes, useNavigate } from 'react-router-dom'

export function App(): React.ReactElement {
  const session = useQuery({ queryKey: ['session'], queryFn: endpoints.session, retry: false })
  const navigate = useNavigate()

  React.useEffect(() => {
    const handler = (): void => {
      void session.refetch()
    }
    window.addEventListener('myapi:unauthorized', handler)
    return () => window.removeEventListener('myapi:unauthorized', handler)
  }, [session])

  if (session.isPending) {
    return (
      <div className="login-wrap">
        <div className="row" style={{ color: 'var(--muted)' }}>
          <Loader2 size={18} className="spin" />
          正在读取面板状态…
        </div>
      </div>
    )
  }

  if (session.data === undefined || !session.data.authenticated) {
    return (
      <Login
        onSuccess={() => {
          void session.refetch()
          navigate('/')
        }}
      />
    )
  }

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/keys" element={<Keys />} />
        <Route path="/models" element={<Models />} />
        <Route path="/usage" element={<Usage />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/benefits" element={<Benefits />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Overview />} />
      </Routes>
    </Shell>
  )
}

