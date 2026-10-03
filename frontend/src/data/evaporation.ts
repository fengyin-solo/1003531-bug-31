import type { EntryRow } from './types'

// 蒸发观测域逻辑：登记、异常判定与汇总取数共用同一份规则，页面与存储层都不再各算一遍。
//
// 约定（对应修复要求）：
// 1. 缺测按空值保留：风速等没有读数的项存 null，列表显示「缺测」，绝不用 0 顶替；0 本身是有效读数。
// 2. 原始读数登记后冻结：任何流转只写状态、版本与判定结论，不回写 raw 里的任何一个读数。
// 3. 判定与原始值一次保存：登记和处理都在单次提交里同时落库，不存在「读数落了、结论没落」的中间态。
// 4. 规则结论只追加不覆盖：气温低于水温等已命中的结论在后续提交时保留，复核结论在规则结论之上补充。

export const EVAPORATION_KEY = 'evaporation'

export const EVAPORATION_READING_FIELDS = ['蒸发量', '水温', '气温', '风速'] as const
export type ReadingField = (typeof EVAPORATION_READING_FIELDS)[number]

export const EVAPORATION_STATUS = {
  collected: '已采集',
  pendingReview: '待审核',
  approved: '已通过',
  abnormal: '异常值',
} as const
export type EvaporationStatus = (typeof EVAPORATION_STATUS)[keyof typeof EVAPORATION_STATUS]

// 自动判定命中的规则编号（结论原文固定，列表、面板、汇总都按它取数）
export const EVAPORATION_RULES = {
  zeroEvaporation: '蒸发量为零，需核对原始记录',
  missingWindSpeed: '风速缺测，观测要素不完整',
  airBelowWater: '气温低于水温，请复核温度读数',
} as const
export const MANUAL_ABNORMAL_TAG = '人工判定异常'

/** 冻结的原始读数：登记后不允许被任何动作改写。 */
export type EvaporationRaw = {
  蒸发量: number
  水温: number
  气温: number
  // 风速没有读数时为 null（缺测保留空值），0.0 是有效读数
  风速: number | null
}

/** 登记入参：全部来自登记表单，风速留空即缺测。 */
export type EvaporationDraft = {
  站点编号: string
  观测日期: string
  raw: EvaporationRaw
}

/** 蒸发观测记录：raw 为冻结原始值，结论与状态随流程追加。 */
export type EvaporationRow = EntryRow & {
  id: number
  status: EvaporationStatus
  记录编号: string
  站点编号: string
  观测日期: string
  raw: EvaporationRaw
  // 自动规则结论（只追加不覆盖）
  异常结论: string[]
  // 人工处理结论：确认通过时写入，标记异常时写入人工标记
  处理结论: string | null
  // 乐观锁版本：处理一次 +1，两个入口同时提交时只有一个能对上版本
  version: number
}

export function isEvaporationRow(row: EntryRow): row is EvaporationRow {
  const raw = row.raw
  return (
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as EvaporationRaw).蒸发量 === 'number' &&
    typeof (raw as EvaporationRaw).水温 === 'number' &&
    typeof (raw as EvaporationRaw).气温 === 'number' &&
    Array.isArray(row.异常结论)
  )
}

/** 从原始读数重算全部自动规则结论。气温低于水温一旦命中永远在结论集合里，不会被后续结论覆盖。 */
export function evaluateAbnormal(raw: EvaporationRaw): string[] {
  const reasons: string[] = []
  if (raw.蒸发量 === 0) {
    reasons.push(EVAPORATION_RULES.zeroEvaporation)
  }
  if (raw.风速 === null) {
    reasons.push(EVAPORATION_RULES.missingWindSpeed)
  }
  if (raw.气温 < raw.水温) {
    reasons.push(EVAPORATION_RULES.airBelowWater)
  }
  return reasons
}

export type RegisterError = { field: string; message: string }

function parseNumber(value: string): { ok: true; value: number } | { ok: false } {
  const text = value.trim()
  if (text === '') {
    return { ok: false }
  }
  const parsed = Number(text)
  return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false }
}

/** 校验登记表单：空字符串不是 0，缺测必须由调用方显式保留为 null，不允许悄悄变成有效值。 */
export function buildDraft(input: {
  站点编号: string
  观测日期: string
  蒸发量: string
  水温: string
  气温: string
  风速: string
}): { ok: true; draft: EvaporationDraft } | { ok: false; errors: RegisterError[] } {
  const errors: RegisterError[] = []
  if (input.站点编号.trim() === '') {
    errors.push({ field: '站点编号', message: '请填写站点编号' })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.观测日期)) {
    errors.push({ field: '观测日期', message: '请选择观测日期' })
  }
  const evaporation = parseNumber(input.蒸发量)
  if (!evaporation.ok) {
    errors.push({ field: '蒸发量', message: '蒸发量必须是数字（0 为有效读数）' })
  } else if (evaporation.value < 0) {
    errors.push({ field: '蒸发量', message: '蒸发量不能为负数' })
  }
  const water = parseNumber(input.水温)
  if (!water.ok) {
    errors.push({ field: '水温', message: '水温必须是数字' })
  }
  const air = parseNumber(input.气温)
  if (!air.ok) {
    errors.push({ field: '气温', message: '气温必须是数字' })
  }
  // 风速留空 → 缺测（null），不是 0；填了就必须是合法数字
  let windSpeed: number | null = null
  const windText = input.风速.trim()
  if (windText !== '') {
    const wind = parseNumber(windText)
    if (!wind.ok) {
      errors.push({ field: '风速', message: '风速必须是数字，无读数时请留空按缺测登记' })
    } else if (wind.value < 0) {
      errors.push({ field: '风速', message: '风速不能为负数' })
    } else {
      windSpeed = wind.value
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    draft: {
      站点编号: input.站点编号.trim(),
      观测日期: input.观测日期,
      raw: {
        蒸发量: (evaporation as { value: number }).value,
        水温: (water as { value: number }).value,
        气温: (air as { value: number }).value,
        风速: windSpeed,
      },
    },
  }
}

export function isPending(row: EvaporationRow): boolean {
  return row.status === EVAPORATION_STATUS.collected || row.status === EVAPORATION_STATUS.pendingReview
}

export function isAbnormal(row: EvaporationRow): boolean {
  return row.status === EVAPORATION_STATUS.abnormal || row.异常结论.length > 0
}

/** 列表、异常面板、汇总共用的派生字段：全部从同一条记录的原始值与结论取数。 */
export function toDisplayRow(row: EvaporationRow): EvaporationRow {
  return {
    ...row,
    pending: isPending(row),
    abnormal: isAbnormal(row),
  }
}

export function formatReading(value: number | null): string {
  return value === null ? '缺测' : String(value)
}
