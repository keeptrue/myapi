import * as React from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  BarChart3,
  Boxes,
  Command,
  Gift,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  ScrollText,
  Settings as SettingsIcon,
  Sun,
  Terminal,
  Users,
  X,
} from 'lucide-react'
import { APP_VERSION } from '../../shared/constants.js'
import { endpoints } from '../lib/api.js'
import { Button, cn } from './ui.js'
import { toast } from 'sonner'

const NAV = [
  { to: '/', label: '概览', icon: LayoutDashboard, end: true },
  { to: '/accounts', label: '账号', icon: Users },
  { to: '/keys', label: '密钥', icon: KeyRound },
  { to: '/models', label: '模型', icon: Boxes },
  { to: '/usage', label: '统计', icon: BarChart3 },
  { to: '/logs', label: '日志', icon: ScrollText },
  { to: '/benefits', label: '权益', icon: Gift },
  { to: '/settings', label: '设置', icon: SettingsIcon },
] as const

const TITLES: Record<string, string> = {
  '/': '概览',
  '/accounts': '账号',
  '/keys': '密钥',
  '/models': '模型',
  '/usage': '统计',
  '/logs': '日志',
  '/benefits': '权益',
  '/settings': '设置',
}

function useTheme(): [string, () => void] {
  const [theme, setTheme] = React.useState<string>(() => localStorage.getItem('myapi-theme') ?? 'dark')
  React.useEffect(() => {
    document.documentElement.dataset['theme'] = theme
    localStorage.setItem('myapi-theme', theme)
  }, [theme])
  return [theme, () => setTheme(current => current === 'dark' ? 'light' : 'dark')]
}

export function Shell({ children }: { children: React.ReactNode }): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [theme, toggleTheme] = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  React.useEffect(() => setOpen(false), [location.pathname])

  const logout = async (): Promise<void> => {
    try {
      await endpoints.logout()
    } catch {
      // Clearing local state is enough even if the request failed.
    }
    queryClient.clear()
    navigate('/')
    toast.success('已退出面板')
  }

  return (
    <div className="app-shell">
      {open && <div className="dialog-overlay" style={{ zIndex: 30 }} onClick={() => setOpen(false)} />}
      <aside className="sidebar" data-open={open ? 'true' : 'false'}>
        <div className="brand">
          <div className="brand-mark"><Command size={18} strokeWidth={2.4} /></div>
          <div>
            <div className="brand-title">myapi</div>
            <div className="brand-sub">gateway console</div>
          </div>
        </div>
        <nav className="nav scroll-thin">
          <div className="nav-label">运行</div>
          {NAV.slice(0, 6).map(item => (
            <NavLink key={item.to} to={item.to} end={'end' in item ? item.end : false} className="nav-item">
              <item.icon size={15} strokeWidth={1.8} />
              <span>{item.label}</span>
            </NavLink>
          ))}
          <div className="nav-label">账户与策略</div>
          {NAV.slice(6).map(item => (
            <NavLink key={item.to} to={item.to} className="nav-item">
              <item.icon size={15} strokeWidth={1.8} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="row-between">
            <div className="row" style={{ gap: 8 }}>
              <span className="dot dot-live" />
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>服务运行中</span>
            </div>
            <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>v{APP_VERSION}</span>
          </div>
          <div className="row" style={{ gap: 4 }}>
            <Button variant="ghost" size="sm" onClick={toggleTheme} title="切换主题">
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              {theme === 'dark' ? '浅色' : '深色'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void logout()} title="退出面板">
              <LogOut size={14} />
              退出
            </Button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <Button variant="ghost" size="icon" className="mobile-menu" onClick={() => setOpen(current => !current)} aria-label="菜单">
            {open ? <X size={17} /> : <Menu size={17} />}
          </Button>
          <div className="row" style={{ gap: 9 }}>
            <Terminal size={15} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{TITLES[location.pathname] ?? '控制台'}</span>
          </div>
          <div style={{ marginLeft: 'auto' }} className="row">
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>
              {window.location.host}
            </span>
            <span className={cn('dot dot-live')} />
          </div>
        </header>
        <main className="page">{children}</main>
      </div>
    </div>
  )
}
