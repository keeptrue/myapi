import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, MoreHorizontal, Plus, RefreshCw, ScrollText, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { KeyDto } from '../lib/api.js'
import { accountName, hasFullCredential, points, spark, planName, planActive, credentialBadge, checkinDeltaText } from '../lib/accounts.js'
import { endpoints } from '../lib/api.js'
import { useAccounts, useKeys, useModels } from '../lib/queries.js'
import { errorMessage, timeAgo } from '../lib/format.js'
import {
  Badge,
  Button,
  Card,
  CardHead,
  ConfirmDialog,
  CopyButton,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Menu,
  MenuItem,
  MenuSeparator,
  Modal,
  PageHeader,
  Select,
  Switch,
  Textarea,
} from '../components/ui.js'

export function Keys(): React.ReactElement {
  const keys = useKeys()
  const accounts = useAccounts()
  const models = useModels()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [busy, setBusy] = React.useState('')
  const [created, setCreated] = React.useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<KeyDto | null>(null)

  const [name, setName] = React.useState('')
  const [boundAccountId, setBoundAccountId] = React.useState('')
  const [rpm, setRpm] = React.useState('0')
  const [modelsText, setModelsText] = React.useState('')

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['keys'] })
  }

  const resetForm = (): void => {
    setName('')
    setBoundAccountId('')
    setRpm('0')
    setModelsText('')
  }

  const create = async (): Promise<void> => {
    setBusy('create')
    try {
      const allowedModels = modelsText.split(/[,，\s]+/u).map(item => item.trim()).filter(item => item !== '')
      const result = await endpoints.createKey({
        name: name.trim() === '' ? '默认密钥' : name.trim(),
        allowedModels,
        boundAccountId: boundAccountId === '' ? null : boundAccountId,
        rpm: Number(rpm) || 0,
      })
      setCreated(result.key)
      setCreateOpen(false)
      resetForm()
      invalidate()
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy('')
    }
  }

  const rotate = async (key: KeyDto): Promise<void> => {
    setBusy(`${key.id}:rotate`)
    try {
      const result = await endpoints.rotateKey(key.id)
      setCreated(result.key)
      invalidate()
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy('')
    }
  }

  const toggle = async (key: KeyDto, enabled: boolean): Promise<void> => {
    setBusy(`${key.id}:toggle`)
    try {
      await endpoints.updateKey(key.id, { enabled })
      invalidate()
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy('')
    }
  }

  const remove = async (): Promise<void> => {
    if (deleteTarget === null) return
    setBusy(`${deleteTarget.id}:delete`)
    try {
      await endpoints.deleteKey(deleteTarget.id)
      toast.success('密钥已删除')
      setDeleteTarget(null)
      invalidate()
    } catch (error: unknown) {
      toast.error(errorMessage(error))
    } finally {
      setBusy('')
    }
  }

  const list = keys.data?.keys ?? []
  const keyLabel = (id: string | null): string => {
    if (id === null) return '任意账号'
    const account = accounts.data?.accounts.find(item => item.id === id)
    return account === undefined ? '已删除账号' : accountName(account)
  }

  return (
    <>
      <PageHeader
        title="密钥"
        desc="客户端用这些 Key 调用 /v1。Key 只保存 HMAC 摘要，创建或轮换时显示一次；绑定账号与模型白名单可把不同团队隔离开。"
        actions={(
          <>
            <Button variant="ghost" size="sm" onClick={() => void keys.refetch()}><RefreshCw size={13} />刷新</Button>
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}><Plus size={14} />创建密钥</Button>
          </>
        )}
      />

      <div className="split-main">
        <Card>
          <CardHead title="API Keys" sub={keys.isPending ? '读取中…' : `${list.length} 把密钥`} />
          {keys.isPending && <div style={{ padding: 18 }}><LoadingBlock rows={4} /></div>}
          {keys.isError && <div className="banner banner-danger" style={{ margin: 16 }}>{errorMessage(keys.error)}</div>}
          {!keys.isPending && list.length === 0 && (
            <EmptyState
              icon={<KeyRound size={18} />}
              title="还没有 API Key"
              desc="创建后把 sk-myapi-… 填进 OpenAI / Claude Code 客户端即可。"
              action={<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}><Plus size={14} />创建第一把</Button>}
            />
          )}
          {list.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>Key</th>
                    <th>绑定账号</th>
                    <th>模型限制</th>
                    <th className="num">RPM</th>
                    <th>最近使用</th>
                    <th>启用</th>
                    <th style={{ width: 52 }} />
                  </tr>
                </thead>
                <tbody>
                  {list.map(key => (
                    <tr key={key.id}>
                      <td style={{ fontWeight: 550 }}>{key.name}</td>
                      <td><code className="code">{key.prefix}…{key.last4}</code></td>
                      <td className="muted">{keyLabel(key.boundAccountId)}</td>
                      <td className="muted">{key.allowedModels.length === 0 ? '全部模型' : `${key.allowedModels.length} 个`}</td>
                      <td className="num">{key.rpm === 0 ? '不限' : key.rpm}</td>
                      <td className="faint">{timeAgo(key.lastUsedAt)}</td>
                      <td>
                        <Switch checked={key.enabled} onCheckedChange={value => void toggle(key, value)} disabled={busy === `${key.id}:toggle`} />
                      </td>
                      <td>
                        <Menu trigger={<button className="btn btn-ghost btn-icon" aria-label="密钥操作"><MoreHorizontal size={16} /></button>}>
                          <MenuItem icon={<ScrollText size={13} />} onSelect={() => void rotate(key)} disabled={busy === `${key.id}:rotate`}>轮换并显示新 Key</MenuItem>
                          <MenuSeparator />
                          <MenuItem icon={<Trash2 size={13} />} danger onSelect={() => setDeleteTarget(key)}>删除密钥</MenuItem>
                        </Menu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="stack">
          <Card>
            <CardHead title="创建密钥" sub="一次性展示 · 只存 HMAC" />
            <div className="stack" style={{ padding: 16 }}>
              <Field label="名称">
                <Input value={name} onChange={event => setName(event.target.value)} placeholder="例如：Claude Code" />
              </Field>
              <Field label="绑定账号（可选）" hint="绑定后所有请求只用这个账号，适合按账号拆分 provider。">
                <Select value={boundAccountId} onChange={event => setBoundAccountId(event.target.value)}>
                  <option value="">任意可用账号</option>
                  {accounts.data?.accounts.map(account => (
                    <option key={account.id} value={account.id}>{accountName(account)}</option>
                  ))}
                </Select>
              </Field>
              <Field label="每分钟请求上限" hint="0 表示不限制；超过后返回 429。">
                <Input type="number" min={0} max={6000} value={rpm} onChange={event => setRpm(event.target.value)} />
              </Field>
              <Field label="模型白名单" hint="逗号或换行分隔；留空表示允许目录中的全部模型。">
                <Textarea value={modelsText} onChange={event => setModelsText(event.target.value)} placeholder={models.data?.models.slice(0, 3).map(model => model.slug).join(', ') ?? 'xopglm52, spark-x2.5'} />
              </Field>
              <Button variant="primary" loading={busy === 'create'} onClick={() => void create()}><Plus size={14} />创建并显示 Key</Button>
            </div>
          </Card>

          <Card>
            <CardHead title="客户端配置" />
            <div className="stack" style={{ padding: 16, gap: 9, fontSize: 12, color: 'var(--muted)', lineHeight: 1.65 }}>
              <div><span className="badge badge-accent">OpenAI</span> Base URL <code className="code">http://127.0.0.1:8787/v1</code></div>
              <div><span className="badge badge-cyan">Anthropic</span> <code className="code">ANTHROPIC_BASE_URL=http://127.0.0.1:8787</code></div>
              <div>鉴权支持 <code className="code">Authorization: Bearer</code> 与 <code className="code">x-api-key</code>。</div>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={createOpen}
        onOpenChange={open => { setCreateOpen(open); if (!open) resetForm() }}
        title="创建 API Key"
        description="创建后完整 Key 只会显示这一次。请立即保存到客户端配置里。"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button variant="primary" loading={busy === 'create'} onClick={() => void create()}>创建</Button>
          </>
        )}
      >
        <Field label="名称">
          <Input value={name} onChange={event => setName(event.target.value)} placeholder="例如：Codex" autoFocus />
        </Field>
        <Field label="绑定账号（可选）">
          <Select value={boundAccountId} onChange={event => setBoundAccountId(event.target.value)}>
            <option value="">任意可用账号</option>
            {accounts.data?.accounts.map(account => (
              <option key={account.id} value={account.id}>{accountName(account)}</option>
            ))}
          </Select>
        </Field>
        <div className="form-grid">
          <Field label="每分钟上限">
            <Input type="number" min={0} value={rpm} onChange={event => setRpm(event.target.value)} />
          </Field>
          <Field label="模型白名单" hint="留空 = 全部">
            <Input value={modelsText} onChange={event => setModelsText(event.target.value)} placeholder="xopglm52" />
          </Field>
        </div>
      </Modal>

      <Modal
        open={created !== null}
        onOpenChange={open => { if (!open) setCreated(null) }}
        title="这是你的新 API Key"
        description="关闭后无法再次查看。若遗失，只能在列表里轮换生成新的。"
        footer={<Button variant="primary" onClick={() => setCreated(null)}>我已保存</Button>}
      >
        <div className="banner banner-warn">请把下面这串 Key 存进密码管理器或客户端配置，不要提交到仓库。</div>
        <div className="row" style={{ gap: 8 }}>
          <code className="code-block" style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{created ?? ''}</code>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <CopyButton value={created ?? ''} label="复制 Key" />
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={open => { if (!open) setDeleteTarget(null) }}
        title="删除密钥"
        description={deleteTarget === null ? '' : `删除「${deleteTarget.name}」后，使用它的客户端会立即收到 401。`}
        confirmLabel="删除"
        danger
        loading={busy.endsWith(':delete')}
        onConfirm={() => void remove()}
      />
    </>
  )
}
