import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { UsageSummary } from '../../shared/types.js'
import { bucketLabel, compact } from '../lib/format.js'

const AXIS = { stroke: 'var(--faint)', fontSize: 10 }
const GRID = 'color-mix(in oklab, var(--line) 65%, transparent)'

function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string }>
  label?: string
}): React.ReactElement | null {
  if (active !== true || payload === undefined || payload.length === 0) return null
  return (
    <div className="chart-tip">
      <div className="chart-tip-label">{label}</div>
      {payload.map(item => (
        <div key={item.name} className="chart-tip-value" style={{ color: item.color }}>
          {item.name}: {compact(item.value)}
        </div>
      ))}
    </div>
  )
}

export function TrafficChart({ summary }: { summary: UsageSummary }): React.ReactElement {
  const data = summary.timeseries.map(point => ({
    ...point,
    label: bucketLabel(point.bucket),
  }))
  if (data.length === 0) {
    return <div className="empty" style={{ padding: 28 }}><div className="empty-desc">这段时间还没有请求。</div></div>
  }
  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="reqFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f2b544" stopOpacity={0.32} />
              <stop offset="100%" stopColor="#f2b544" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey="label" tick={{ ...AXIS, fontFamily: 'var(--font-mono)' }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
          <YAxis allowDecimals={false} tick={{ ...AXIS, fontFamily: 'var(--font-mono)' }} tickLine={false} axisLine={false} width={44} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--line-strong)', strokeDasharray: '3 3' }} />
          <Area type="monotone" dataKey="requests" name="请求" stroke="#f2b544" strokeWidth={1.7} fill="url(#reqFill)" dot={false} activeDot={{ r: 3 }} />
          <Line type="monotone" dataKey="failures" name="失败" stroke="#f07178" strokeWidth={1.4} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ModelBars({ summary }: { summary: UsageSummary }): React.ReactElement {
  const data = summary.byModel.slice(0, 8).map(item => ({ name: item.key, requests: item.value.requests }))
  if (data.length === 0) {
    return <div className="empty" style={{ padding: 24 }}><div className="empty-desc">还没有模型调用记录。</div></div>
  }
  return (
    <div style={{ width: '100%', height: Math.max(160, data.length * 34) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 4" horizontal={false} />
          <XAxis type="number" tick={{ ...AXIS, fontFamily: 'var(--font-mono)' }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" width={112} tick={{ ...AXIS, fontSize: 10 }} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'color-mix(in oklab, var(--panel-2) 70%, transparent)' }} />
          <Bar dataKey="requests" name="请求" radius={[0, 4, 4, 0]} barSize={12}>
            {data.map((_, index) => <Cell key={index} fill={index === 0 ? '#f2b544' : '#4fd1c5'} opacity={1 - index * 0.07} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function Sparkline({ data, color = '#f2b544' }: { data: number[]; color?: string }): React.ReactElement {
  const points = data.length === 0 ? [] : data
  return (
    <div style={{ width: '100%', height: 44 }}>
      <ResponsiveContainer>
        <AreaChart data={points.map((value, index) => ({ index, value }))} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.4} fill={color} fillOpacity={0.12} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
