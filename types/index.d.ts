export type CacheHit = { read: number; write: number; fresh: number; at: number }
export type Limit = { kind: string; percent: number; resetsAt: number | null }
export type Usage = { tokens: number | null; window: number; limits: Limit[] }

declare module 'claude-code' {
  interface PluginState {
    'cache-reminder': {
      cache: Shaped<CacheHit | null>
      usage: Shaped<Usage | null>
      now: number
      warned: number | null
      expired: number | null
      isHidden: boolean
    }
  }
}
