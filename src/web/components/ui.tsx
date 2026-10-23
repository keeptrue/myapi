import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu'
import { Check, Copy, Loader2, X } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { toast } from 'sonner'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'icon'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export function Button({ className, variant = 'default', size = 'md', loading = false, disabled, children, ...props }: ButtonProps): React.ReactElement {
  return (
    <button
      className={cn(
        'btn',
        variant === 'primary' && 'btn-primary',
        variant === 'danger' && 'btn-danger',
        variant === 'ghost' && 'btn-ghost',
        size === 'sm' && 'btn-sm',
        size === 'icon' && 'btn-icon',
        className,
      )}
      disabled={disabled === true || loading}
      {...props}
    >
      {loading && <Loader2 size={14} className="spin" />}
      {children}
    </button>
  )
}

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn('surface', className)} {...props}>{children}</div>
}

export function CardHead({ title, sub, actions }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }): React.ReactElement {
  return (
    <div className="surface-head">
      <div>
        <div className="surface-title">{title}</div>
        {sub !== undefined && <div className="surface-sub">{sub}</div>}
      </div>
      {actions !== undefined && <div className="row">{actions}</div>}
    </div>
  )
}

export function PageHeader({ title, desc, actions }: { title: React.ReactNode; desc?: React.ReactNode; actions?: React.ReactNode }): React.ReactElement {
  return (
    <header className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {desc !== undefined && <p className="page-desc">{desc}</p>}
      </div>
      {actions !== undefined && <div className="row">{actions}</div>}
    </header>
  )
}

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'accent' | 'cyan'

export function Badge({ tone = 'default', children, dot = false, className }: { tone?: Tone; children: React.ReactNode; dot?: boolean; className?: string }): React.ReactElement {
  return (
    <span className={cn('badge', tone !== 'default' && `badge-${tone}`, className)}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>): React.ReactElement {
  return <input {...props} className={cn('input', props.className)} />
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>): React.ReactElement {
  return <textarea {...props} className={cn('textarea', props.className)} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>): React.ReactElement {
  return <select {...props} className={cn('select', props.className)} />
}

export function Field({ label, hint, error, children }: { label: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; children: React.ReactNode }): React.ReactElement {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {error !== undefined && <div className="field-hint" style={{ color: 'var(--danger)' }}>{error}</div>}
      {error === undefined && hint !== undefined && <div className="field-hint">{hint}</div>}
    </div>
  )
}

export function Switch({ checked, onCheckedChange, disabled, label }: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
}): React.ReactElement {
  return (
    <SwitchPrimitive.Root className="switch" checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label={label}>
      <SwitchPrimitive.Thumb className="switch-thumb" />
    </SwitchPrimitive.Root>
  )
}

export function Tabs({ value, defaultValue, onValueChange, children, className }: {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  return (
    <TabsPrimitive.Root value={value} defaultValue={defaultValue} onValueChange={onValueChange} className={className}>
      {children}
    </TabsPrimitive.Root>
  )
}

export function TabsList({ children }: { children: React.ReactNode }): React.ReactElement {
  return <TabsPrimitive.List className="tabs">{children}</TabsPrimitive.List>
}

export function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }): React.ReactElement {
  return <TabsPrimitive.Trigger value={value} className="tab">{children}</TabsPrimitive.Trigger>
}

export function TabsContent({ value, children, className }: { value: string; children: React.ReactNode; className?: string }): React.ReactElement {
  return <TabsPrimitive.Content value={value} className={className}>{children}</TabsPrimitive.Content>
}

export function Modal({ open, onOpenChange, title, description, children, footer, wide = false }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
}): React.ReactElement {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content
          className="dialog-content"
          data-wide={wide ? 'true' : 'false'}
          onPointerDownOutside={event => event.preventDefault()}
          onInteractOutside={event => event.preventDefault()}
        >
          <div className="dialog-head">
            <div>
              <DialogPrimitive.Title className="dialog-title">{title}</DialogPrimitive.Title>
              {description !== undefined && <DialogPrimitive.Description className="dialog-desc">{description}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close asChild>
              <button className="btn btn-ghost btn-icon" aria-label="关闭"><X size={16} /></button>
            </DialogPrimitive.Close>
          </div>
          <div className="dialog-body scroll-thin">{children}</div>
          {footer !== undefined && <div className="dialog-foot">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function Menu({ trigger, children, align = 'end' }: { trigger: React.ReactNode; children: React.ReactNode; align?: 'start' | 'end' | 'center' }): React.ReactElement {
  return (
    <DropdownPrimitive.Root>
      <DropdownPrimitive.Trigger asChild>{trigger}</DropdownPrimitive.Trigger>
      <DropdownPrimitive.Portal>
        <DropdownPrimitive.Content className="dropdown" align={align} sideOffset={6}>
          {children}
        </DropdownPrimitive.Content>
      </DropdownPrimitive.Portal>
    </DropdownPrimitive.Root>
  )
}

export function MenuItem({ children, icon, danger = false, onSelect, disabled }: {
  children: React.ReactNode
  icon?: React.ReactNode
  danger?: boolean
  onSelect?: () => void
  disabled?: boolean
}): React.ReactElement {
  return (
    <DropdownPrimitive.Item className="dropdown-item" data-danger={danger ? 'true' : 'false'} disabled={disabled} onSelect={onSelect}>
      {icon}
      {children}
    </DropdownPrimitive.Item>
  )
}

export function MenuSeparator(): React.ReactElement {
  return <DropdownPrimitive.Separator style={{ height: 1, background: 'var(--line)', margin: '4px 2px' }} />
}

export function Hint({ label, children }: { label: React.ReactNode; children: React.ReactElement }): React.ReactElement {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content className="tooltip" sideOffset={6}>{label}</TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

export function StatCard({ label, value, hint, icon }: { label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode }): React.ReactElement {
  return (
    <div className="stat-card">
      <div className="stat-label">{icon}{label}</div>
      <div className="stat-value">{value}</div>
      {hint !== undefined && <div className="stat-hint">{hint}</div>}
    </div>
  )
}

export function EmptyState({ title, desc, icon, action }: { title: React.ReactNode; desc?: React.ReactNode; icon?: React.ReactNode; action?: React.ReactNode }): React.ReactElement {
  return (
    <div className="empty">
      <div className="empty-icon">{icon ?? <Check size={18} />}</div>
      <div className="empty-title">{title}</div>
      {desc !== undefined && <div className="empty-desc">{desc}</div>}
      {action !== undefined && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  )
}

export function Spinner({ size = 16 }: { size?: number }): React.ReactElement {
  return <Loader2 size={size} className="spin" />
}

export function LoadingBlock({ rows = 3 }: { rows?: number }): React.ReactElement {
  return (
    <div className="stack" aria-busy="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton" style={{ height: 16, width: `${100 - index * 12}%` }} />
      ))}
    </div>
  )
}

export function CopyButton({ value, label = '复制' }: { value: string; label?: string }): React.ReactElement {
  const [copied, setCopied] = React.useState(false)
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          toast.success('已复制')
          setTimeout(() => setCopied(false), 1500)
        }).catch(() => toast.error('复制失败，请手动选择'))
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {label}
    </Button>
  )
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = '确认', danger = false, onConfirm, loading = false }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  loading?: boolean
}): React.ReactElement {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      {...(description === undefined ? {} : { description })}
      footer={(
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      )}
    >
      <div className="banner">此操作会立即生效，请确认你了解影响范围。</div>
    </Modal>
  )
}

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{children}</div>
      {hint !== undefined && <div className="surface-sub">{hint}</div>}
    </div>
  )
}
