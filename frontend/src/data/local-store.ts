import { isEvaporationRow, toDisplayRow, EVAPORATION_KEY } from './evaporation'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 旧版本播种的蒸发记录是「蒸发观测样例1」这类占位串，没有冻结原始读数，无法参与判定。
// 升级时只迁移结构合法的蒸发记录；不合法的直接回到新示例数据，绝不给缺测项补 0。
function normalizeStored(raw: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const storedEvaporation = raw[EVAPORATION_KEY]
  if (!Array.isArray(storedEvaporation)) {
    return raw
  }
  const valid = storedEvaporation
    .filter(isEvaporationRow)
    .map((row) => clone(toDisplayRow(row)))
  return {
    ...raw,
    [EVAPORATION_KEY]: valid.length > 0 ? valid : clone(SEED_ROWS[EVAPORATION_KEY]),
  }
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
    return normalizeStored({ ...fallback, ...parsed })
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

// 唯一写入口：先序列化并写入 localStorage，成功后才换内存缓存，
// 任何一步抛错都保留旧快照，列表、汇总、待办看到的状态一起回到原样。
export function saveRows(key: string, rows: EntryRow[]): void {
  const snapshot = allRows()
  const next = { ...snapshot, [key]: rows }
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  cache = next
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
