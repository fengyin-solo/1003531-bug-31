import {
  commitEvapRows,
  listEvapRows,
} from '@/data/local-store'
import {
  evaluateEvapReadings,
  freezeRecord,
  isAbnormal,
  isPendingReview,
} from '@/data/evaporation-domain'
import type {
  ActionResult,
  EvapDraft,
  EvapReadings,
  EvapRecord,
  EvapStatus,
} from '@/data/types'

export type EvapSummary = {
  today: number
  pendingReview: number
  abnormal: number
}

// 模拟提交往返时延，也让两个入口的并发提交能真实撞上同一把锁。
const SUBMIT_DELAY = 120

// 同一条记录同时只能有一个处理在飞：列表与异常面板同时点，只落一个结论。
const inflight = new Set<number>()
let registerBusy = false

const ACTION_TARGETS: Record<string, EvapStatus> = {
  提交审核: '待审核',
  确认通过: '已通过',
  标记异常: '异常值',
}

function todayString(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function listEvap(): EvapRecord[] {
  // 统一取数出口：列表、异常面板、汇总都从这里拿同一份冻结快照。
  return listEvapRows().map(freezeRecord)
}

export function evapSummary(): EvapSummary {
  const rows = listEvap()
  return {
    today: rows.filter((row) => row.观测日期 === todayString()).length,
    pendingReview: rows.filter(isPendingReview).length,
    abnormal: rows.filter(isAbnormal).length,
  }
}

function parseNumber(value: string): number | null {
  const text = value.trim()
  if (text === '' || text === '缺测' || text === 'null') {
    return null
  }
  const num = Number(text)
  return Number.isFinite(num) ? num : Number.NaN
}

export function toDraft(input: {
  记录编号: string
  站点编号: string
  观测日期: string
  蒸发量: string
  水温: string
  气温: string
  风速: string
}): EvapDraft | { error: string } {
  const values = {
    蒸发量: parseNumber(input.蒸发量),
    水温: parseNumber(input.水温),
    气温: parseNumber(input.气温),
    风速: parseNumber(input.风速),
  }
  const badField = (Object.entries(values) as [keyof EvapReadings, number | null][])
    .find(([, num]) => Number.isNaN(num))?.[0]
  if (badField) {
    return { error: `${badField}必须是数字，缺测请留空（按空值保留）` }
  }
  if (!input.记录编号.trim()) {
    return { error: '记录编号不能为空' }
  }
  if (!input.站点编号.trim()) {
    return { error: '站点编号不能为空' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.观测日期.trim())) {
    return { error: '观测日期格式应为 YYYY-MM-DD' }
  }
  return {
    记录编号: input.记录编号.trim(),
    站点编号: input.站点编号.trim(),
    观测日期: input.观测日期.trim(),
    readings: values as EvapReadings,
  }
}

export async function registerEvap(draft: EvapDraft): Promise<ActionResult> {
  if (registerBusy) {
    return { ok: false, message: '上一条记录仍在保存，请勿重复提交' }
  }
  registerBusy = true
  try {
    await new Promise((resolve) => window.setTimeout(resolve, SUBMIT_DELAY))
    const rows = listEvapRows()
    if (rows.some((row) => row.记录编号 === draft.记录编号)) {
      return { ok: false, message: `记录编号 ${draft.记录编号} 已存在` }
    }
    const id = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
    // 登记时判定与原始读数一次算出、一次提交，之后读数不再被任何动作改写。
    const record: EvapRecord = {
      id,
      记录编号: draft.记录编号,
      站点编号: draft.站点编号,
      观测日期: draft.观测日期,
      readings: draft.readings,
      status: '已采集',
      reasons: evaluateEvapReadings(draft.readings),
    }
    commitEvapRows([...rows, record])
    return { ok: true, message: `已登记 ${record.记录编号}` }
  } catch (error) {
    // 提交（含持久化）失败：没有换过快照，列表/汇总/待办保持原状态。
    return {
      ok: false,
      message: error instanceof Error ? `登记失败：${error.message}` : '登记失败，数据保持原状态',
    }
  } finally {
    registerBusy = false
  }
}

export async function resolveEvapAction(
  id: number,
  action: string,
): Promise<ActionResult> {
  const target = ACTION_TARGETS[action]
  if (!target) {
    return { ok: false, message: `蒸发观测记录没有登记「${action}」这个动作` }
  }
  if (inflight.has(id)) {
    return { ok: false, message: '该记录正在处理中，请勿重复提交' }
  }
  inflight.add(id)
  try {
    await new Promise((resolve) => window.setTimeout(resolve, SUBMIT_DELAY))

    // 等待后重新取数：两个入口并发时，以当前真实状态为准，避免覆盖先到的结论。
    const rows = listEvapRows()
    const index = rows.findIndex((row) => row.id === id)
    if (index < 0) {
      return { ok: false, message: `没有找到编号为 ${id} 的蒸发观测记录` }
    }
    const current = rows[index]
    if (current.status === target) {
      return { ok: false, message: `记录已经是「${target}」，不用重复操作` }
    }
    if (action === '提交审核' && current.status !== '已采集') {
      return { ok: false, message: `当前状态「${current.status}」不能提交审核` }
    }
    if (action === '确认通过' && current.status !== '待审核') {
      return { ok: false, message: `当前状态「${current.status}」不能确认通过` }
    }
    if (
      action === '标记异常' &&
      current.status !== '已采集' &&
      current.status !== '待审核'
    ) {
      return { ok: false, message: `当前状态「${current.status}」不能标记异常` }
    }

    // 蒸发量为零 / 风速缺测等判定由读数推导，读数不可变，结论不会被状态覆盖。
    const reasons = evaluateEvapReadings(current.readings)
    if (reasons.length > 0 && action !== '标记异常') {
      return {
        ok: false,
        message: `复核未通过：${reasons.join('、')}，请先按异常处理`,
      }
    }

    // 只改判定字段（status/reasons），原始读数原样带回，随整表一次提交。
    const updated: EvapRecord = {
      ...current,
      readings: current.readings,
      status: target,
      reasons,
    }
    const next = [...rows]
    next[index] = updated
    try {
      commitEvapRows(next)
    } catch (error) {
      // 落盘失败：commitEvapRows 不换内存快照，三个视图重新取数仍是原状态。
      return {
        ok: false,
        message: error instanceof Error
          ? `保存失败：${error.message}，已回到处理前状态`
          : '保存失败，已回到处理前状态',
      }
    }
    return { ok: true, message: `记录已${action}，当前状态「${target}」` }
  } finally {
    inflight.delete(id)
  }
}

function csvCell(value: string | number | null): string {
  if (value === null) {
    return '缺测'
  }
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function exportEvapCsv(): { filename: string; content: string } {
  const header = ['记录编号', '站点编号', '观测日期', '蒸发量', '水温', '气温', '风速', '异常判定', '当前状态']
  const lines = [header.join(',')]
  for (const row of listEvap()) {
    lines.push([
      row.记录编号,
      row.站点编号,
      row.观测日期,
      csvCell(row.readings.蒸发量),
      csvCell(row.readings.水温),
      csvCell(row.readings.气温),
      csvCell(row.readings.风速),
      row.reasons.join('；') || '正常',
      row.status,
    ].join(','))
  }
  return { filename: '蒸发观测-清单.csv', content: `\uFEFF${lines.join('\n')}` }
}
