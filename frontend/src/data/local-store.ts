import { SEED_ROWS } from './seed'
import { SEED_EVAP_ROWS } from './evaporation-seed'
import type { EntryRow, EvapRecord } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries:v2'
const EVAP_STORAGE_KEY = 'hydrology-monitor-station:evaporation:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isLegacyEvapRows(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => item && 'readings' in item === false)
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    // 旧版本里蒸发挂在通用集合下且结构已不兼容，丢弃并回到新种子。
    if (isLegacyEvapRows(parsed.evaporation)) {
      delete parsed.evaporation
    }
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

function readEvapStorage(): EvapRecord[] {
  const fallback = clone(SEED_EVAP_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(EVAP_STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(EVAP_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.some((item) => !item || !('readings' in item))) {
      window.localStorage.setItem(EVAP_STORAGE_KEY, JSON.stringify(fallback))
      return fallback
    }
    return parsed as EvapRecord[]
  } catch {
    window.localStorage.setItem(EVAP_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null
let evapCache: EvapRecord[] | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  if (typeof window !== 'undefined' && window.localStorage) {
    // 先写持久层，成功后才换内存快照；写入抛错时缓存保持原状（失败回滚）。
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  cache = next
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function listEvapRows(): EvapRecord[] {
  if (evapCache === null) {
    evapCache = readEvapStorage()
  }
  return evapCache
}

// 蒸发唯一写入口：判定（status/reasons）与原始读数在同一次提交里落盘，
// 持久化失败时内存快照原样保留，列表、汇总、待办自然一起回到原状态。
export function commitEvapRows(rows: EvapRecord[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(EVAP_STORAGE_KEY, JSON.stringify(rows))
  }
  evapCache = rows
}

export function resetEvapRows(): EvapRecord[] {
  const rows = clone(SEED_EVAP_ROWS)
  commitEvapRows(rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
