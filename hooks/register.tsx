import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, SessionContextUsage } from 'claude-code'

import type { CacheHit, Limit, Usage } from '../types'

// 缓存有效期（分钟）。Claude Code 订阅用户默认 1 小时
const TTL_MIN = 60
// 剩余多少分钟时提醒
const WARN_MIN = 10
// 上下文超过这个量才发系统通知（小上下文过期也不心疼）
const NOTIFY_TOKENS = 100_000


const cache = atom({ plugin: 'cache-reminder', key: 'cache' } as const, null, { shape: 'cache-1' })
const usage = atom({ plugin: 'cache-reminder', key: 'usage' } as const, null, { shape: 'usage-1' })
const nowA = atom({ plugin: 'cache-reminder', key: 'now' } as const, 0)
const warned = atom({ plugin: 'cache-reminder', key: 'warned' } as const, null)
const expired = atom({ plugin: 'cache-reminder', key: 'expired' } as const, null)
const isHidden = atom({ plugin: 'cache-reminder', key: 'isHidden' } as const, false)

function fmtDur(ms: number): string {
  if (ms <= 0) return '0m'
  const m = Math.floor(ms / 60000)
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return mm ? `${h}h${mm}m` : `${h}h`
  return `${mm}m`
}
function fmtTokens(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M'
  if (n >= 1e3) return Math.round(n / 1e3) + 'k'
  return String(n)
}
const level = (p: number) => (p >= 80 ? 'error' : p >= 50 ? 'warning' : 'success')

function toUsage(context: SessionContextUsage, limits: SessionRateLimit[]): Usage {
  return {
    tokens: context.tokens ?? null,
    window: context.window,
    limits: limits.map((l): Limit => {
      const t = l.resetsAt ? Date.parse(l.resetsAt) : NaN
      return { kind: l.kind, percent: l.percentUsed, resetsAt: Number.isNaN(t) ? null : t }
    }),
  }
}

function hitRate(c: CacheHit): number {
  const total = c.read + c.write + c.fresh
  return total ? Math.round((c.read / total) * 100) : 0
}

async function check($: EngineInterface) {
  const now = await $.clock.now()
  await update($, nowA, () => now)
  const c = await read($, cache)
  if (!c) return
  const left = c.at + TTL_MIN * 60000 - now
  const u = await read($, usage)
  const tokens = u?.tokens ?? 0

  if (left <= 0) {
    if ((await read($, expired)) !== c.at) {
      await update($, expired, () => c.at)
      $.ui.toast('缓存已过期：下一条消息会按全价重算整段上下文')
    }
    return
  }
  if (left <= WARN_MIN * 60000 && (await read($, warned)) !== c.at) {
    await update($, warned, () => c.at)
    const msg = `缓存还剩 ${fmtDur(left)}（上下文 ${fmtTokens(tokens)}）。要离开的话，先 /compact`
    $.ui.toast(msg)
    if (tokens >= NOTIFY_TOKENS) {
      $.ui.notify(msg, { title: '缓存快过期了' }).catch(() => {})
    }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cache', description: '显示缓存命中率、过期倒计时和额度；/cache hide|show 切换提示条' })
    try {
      const s = await $.session.usage()
      await update($, usage, () => toUsage(s.context, s.rateLimits))
    } catch {}
    await check($)
    $.clock.every(30_000, () => void check($))
    return next(e)
  })

  // 每次主线程请求返回后记下缓存读写量；缓存命中也会刷新 TTL
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (!e.agentId && r.usage) {
      const u = r.usage
      if (u.cache_read_input_tokens + u.cache_creation_input_tokens > 0) {
        const at = await $.clock.now()
        await update($, cache, () => ({
          read: u.cache_read_input_tokens,
          write: u.cache_creation_input_tokens,
          fresh: u.input_tokens,
          at,
        }))
        await update($, nowA, () => at)
      }
    }
    return r
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => toUsage(e.context, e.rateLimits))
    return next(e)
  })

  on('command.run', { command: 'cache' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'hide' || arg === 'show') {
      await update($, isHidden, () => arg === 'hide')
      return { text: arg === 'hide' ? '缓存提示条已隐藏，提醒照常。' : '缓存提示条已显示。' }
    }
    const c = await read($, cache)
    const u = await read($, usage)
    const now = await $.clock.now()
    const lines: string[] = []
    if (c) {
      const left = c.at + TTL_MIN * 60000 - now
      lines.push(`缓存命中率 ${hitRate(c)}%（读 ${fmtTokens(c.read)}，写 ${fmtTokens(c.write)}，未缓存 ${fmtTokens(c.fresh)}）`)
      lines.push(left > 0 ? `缓存还剩 ${fmtDur(left)}` : '缓存已过期')
    } else lines.push('还没有缓存记录（发一条消息后出现）')
    for (const l of u?.limits ?? []) {
      lines.push(`${l.kind} 额度 ${Math.round(l.percent)}%${l.resetsAt ? `，${fmtDur(l.resetsAt - now)} 后重置` : ''}`)
    }
    if (u?.tokens != null) lines.push(`上下文 ${fmtTokens(u.tokens)}/${fmtTokens(u.window)}`)
    return { text: lines.join('\n') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const c = await read($, cache)
    if (e.props.hasSurvey || !c || (await read($, isHidden))) return next(e)
    const u = await read($, usage)
    const now = (await read($, nowA)) || (await $.clock.now())
    const { Box, Text } = $.ui.resolve(e)

    const hit = hitRate(c)
    const left = c.at + TTL_MIN * 60000 - now
    const ttlColor = left <= WARN_MIN * 60000 ? 'error' : left <= 20 * 60000 ? 'warning' : 'success'
    const label = (k: string) => (k === 'five_hour' ? '5h' : k === 'seven_day' ? '7d' : k)
    const ctxPct = u?.tokens != null && u.window ? (u.tokens / u.window) * 100 : null

    // 最危险的一项决定边框颜色
    const worst = [ttlColor, ...(u?.limits ?? []).map(l => level(l.percent)), ctxPct != null ? level(ctxPct) : 'success']
    const border = worst.includes('error') ? 'error' : worst.includes('warning') ? 'warning' : 'success'
    const B = (color: string, text: string) => <Text color={color} bold weight="bold">{text}</Text>

    return (
      <Box borderStyle="round" borderColor={border} paddingX={1}>
        <Text>
          <Text bold weight="bold">缓存 </Text>
          {B(hit >= 80 ? 'success' : hit >= 50 ? 'warning' : 'error', `${hit}%`)}
          <Text>  </Text>
          {B(ttlColor, left > 0 ? `⏳ ${fmtDur(left)}` : '已过期')}
          {(u?.limits ?? []).map(l => (
            <Text key={l.kind}>
              <Text>   │   </Text>
              <Text bold weight="bold">{label(l.kind)} </Text>
              {B(level(l.percent), `${Math.round(l.percent)}%`)}
              {l.resetsAt ? <Text> ↻{fmtDur(l.resetsAt - now)}</Text> : null}
            </Text>
          ))}
          {u?.tokens != null ? (
            <Text key="ctx">
              <Text>   │   </Text>
              <Text bold weight="bold">上下文 </Text>
              {B(ctxPct != null ? level(ctxPct) : 'text', `${fmtTokens(u.tokens)}/${fmtTokens(u.window)}`)}
            </Text>
          ) : null}
        </Text>
      </Box>
    )
  })
}
