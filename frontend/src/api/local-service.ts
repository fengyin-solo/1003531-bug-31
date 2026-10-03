import { MODULE_BY_KEY } from '@/data/modules'
import {
  EVAPORATION_KEY,
  EVAPORATION_STATUS,
  MANUAL_ABNORMAL_TAG,
  evaluateAbnormal,
  isAbnormal,
  isEvaporationRow,
  isPending,
  toDisplayRow,
} from '@/data/evaporation'
import type {
  EvaporationDraft,
  EvaporationRow,
  EvaporationStatus,
} from '@/data/evaporation'
import { allRows, clone, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  if (key === EVAPORATION_KEY) {
    return { ok: false, message: '蒸发观测记录请使用登记、提交审核、复核入口，不走通用状态流转' }
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '缺测'
  }
  if (Array.isArray(value)) {
    return value.join('；')
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// ---- 蒸发观测：登记 / 异常判定 / 处理 / 汇总取数 -------------------------------

function evaporationRows(): EvaporationRow[] {
  return listRows(EVAPORATION_KEY)
    .filter(isEvaporationRow)
    .map((row) => toDisplayRow(row))
}

export function listEvaporationEntries(filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(evaporationRows(), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export type EvaporationSummary = {
  todayCount: number
  pendingCount: number
  abnormalCount: number
}

function todayString(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

// 汇总取数与列表、异常面板同一份来源：全部从原始读数与判定结论实时派生。
export function loadEvaporationSummary(): EvaporationSummary {
  const rows = evaporationRows()
  const today = todayString()
  return {
    todayCount: rows.filter((row) => row.观测日期 === today).length,
    pendingCount: rows.filter(isPending).length,
    abnormalCount: rows.filter(isAbnormal).length,
  }
}

/**
 * 登记：判定结论与冻结的原始读数在同一条记录里一次保存。
 * 缺测（风速无读数）按空值 null 保留，不用 0 顶替；0.0 是合法有效读数。
 */
export function registerEvaporation(draft: EvaporationDraft): ActionResult {
  const rows = listRows(EVAPORATION_KEY).filter(isEvaporationRow)
  if (rows.some((row) => row.站点编号 === draft.站点编号 && row.观测日期 === draft.观测日期)) {
    return { ok: false, message: '该站点当天已有蒸发观测记录，不能重复登记' }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const record: EvaporationRow = {
    id,
    status: EVAPORATION_STATUS.collected,
    pending: true,
    abnormal: false,
    记录编号: `EVAP-${String(id).padStart(4, '0')}`,
    站点编号: draft.站点编号,
    观测日期: draft.观测日期,
    // 冻结原始读数：此后任何动作都只能读取，不能回写
    raw: clone(draft.raw),
    异常结论: evaluateAbnormal(draft.raw),
    处理结论: null,
    version: 0,
  }
  saveRows(EVAPORATION_KEY, [...listRows(EVAPORATION_KEY), toDisplayRow(record)])
  return { ok: true, message: `蒸发观测记录 ${record.记录编号} 已登记，原始读数与初步判定已一次保存` }
}

export type EvaporationAction = '提交审核' | '确认通过' | '标记异常'

export type ProcessEvaporationOptions = {
  // 乐观锁：入口拿的是哪一版，提交时就必须还是那一版，否则说明已被另一个入口落过结论
  expectedVersion?: number
  // 人工标记异常的备注（可选）
  note?: string
  // 故障注入：置 true 时提交在落库前失败，用于验证回滚（原始读数与旧结论保持原样）
  forceFail?: boolean
}

// 每条记录一把处理锁：列表入口和异常面板入口同时点，只放行一个，另一个直接拒绝。
const processingLocks = new Set<number>()

const PROCESS_DELAY_MS = 200

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

/**
 * 处理蒸发观测记录（列表「提交审核」与异常面板/待办「确认通过、标记异常」共用这一个入口）：
 * - 判定永远从冻结的原始读数重算，气温低于水温等历史结论只追加、不被覆盖；
 * - 蒸发量为 0 或风速缺测时拒绝「确认通过」，异常记录不能通过复核；
 * - 状态、结论、版本在单次保存里一起落库，失败则一次都不写，列表/汇总/待办共同回到原状态；
 * - 锁 + 版本双重保证两个入口同时提交只落一个结论。
 */
export async function processEvaporation(
  id: number,
  action: EvaporationAction,
  options: ProcessEvaporationOptions = {},
): Promise<ActionResult> {
  if (processingLocks.has(id)) {
    return {
      ok: false,
      message: '该记录正在处理中，请勿重复提交；两个处理入口同一时刻只会落一个结论',
    }
  }
  processingLocks.add(id)
  try {
    // 模拟一次有耗时的提交：两个入口并发时必然撞锁，而不是后写覆盖先写
    await delay(PROCESS_DELAY_MS)

    const rows = listRows(EVAPORATION_KEY).filter(isEvaporationRow)
    const index = rows.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      return { ok: false, message: `没有找到编号为 ${id} 的蒸发观测记录，状态保持原样` }
    }
    const row = rows[index]
    if (options.expectedVersion !== undefined && options.expectedVersion !== row.version) {
      return {
        ok: false,
        message: `记录 ${row.记录编号} 已被另一个处理入口更新过结论，请刷新后再操作`,
      }
    }

    // 每次处理都从冻结原始读数重算规则结论：结论集合只增不覆盖，raw 永远不参与写入
    const reasons = evaluateAbnormal(row.raw)

    let status: EvaporationStatus
    let conclusions: string[] = reasons
    let conclusion: string | null = row.处理结论

    if (action === '提交审核') {
      if (row.status !== EVAPORATION_STATUS.collected) {
        return { ok: false, message: `只有「已采集」记录能提交审核，当前为「${row.status}」，状态未改动` }
      }
      status = EVAPORATION_STATUS.pendingReview
    } else if (action === '确认通过') {
      if (row.status !== EVAPORATION_STATUS.pendingReview) {
        return { ok: false, message: `只有「待审核」记录能确认通过，当前为「${row.status}」，状态未改动` }
      }
      if (reasons.length > 0) {
        // 蒸发量为零、风速缺测等异常记录不能通过复核，且不抹掉已有结论
        return {
          ok: false,
          message: `复核未通过：${reasons.join('；')}。记录维持「待审核」，请先标记异常或补测`,
        }
      }
      status = EVAPORATION_STATUS.approved
      conclusion = '复核通过：读数齐全，判定规则无异常'
    } else {
      if (
        row.status !== EVAPORATION_STATUS.pendingReview &&
        row.status !== EVAPORATION_STATUS.collected
      ) {
        return { ok: false, message: `当前为「${row.status}」，不能再标记异常，状态未改动` }
      }
      status = EVAPORATION_STATUS.abnormal
      // 人工标记追加到规则结论之后，规则结论（含气温低于水温）原样保留
      conclusions = Array.from(new Set([...reasons, MANUAL_ABNORMAL_TAG]))
      conclusion = options.note?.trim() || '人工判定异常，转补测/复测处理'
    }

    if (options.forceFail) {
      // 故障注入：落库前失败。整段逻辑只动过局部变量，缓存与 localStorage 都没写，
      // 列表、汇总、待办读到的仍是处理前状态；重试时旧结论与原始读数都还在。
      throw new Error('提交失败：模拟的网络/存储故障，未落库任何内容，记录保持原状态')
    }

    // 关键：基于行的克隆生成新记录，原始读数引用冻结值，不修改、不规范化任何读数
    const updated: EvaporationRow = clone({
      ...row,
      status,
      异常结论: conclusions,
      处理结论: conclusion,
      version: row.version + 1,
    })
    const nextRows = [...rows]
    nextRows[index] = toDisplayRow(updated)
    // 单次提交：状态、判定结论、版本与（登记时的）原始读数整体一次保存
    saveRows(EVAPORATION_KEY, nextRows)

    return { ok: true, message: `记录 ${row.记录编号} 已${action}，当前状态「${status}」` }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '处理失败，记录已回到原状态，原始读数未改动',
    }
  } finally {
    processingLocks.delete(id)
  }
}

export function resetEvaporation(): PageResult {
  resetRows(EVAPORATION_KEY)
  return listEvaporationEntries()
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const lines = [['编号', ...meta.fields, '当前状态'].join(',')]
  if (key === EVAPORATION_KEY) {
    for (const row of evaporationRows()) {
      lines.push(
        [
          row.id,
          row.记录编号,
          row.站点编号,
          row.观测日期,
          row.raw.蒸发量,
          row.raw.水温,
          row.raw.气温,
          row.raw.风速,
          row.status,
        ]
          .map(csvCell)
          .join(','),
      )
    }
    lines.push('', `判定明细编号,记录编号,异常结论,处理结论`)
    for (const row of evaporationRows()) {
      lines.push(
        [row.id, row.记录编号, row.异常结论, row.处理结论 ?? '']
          .map(csvCell)
          .join(','),
      )
    }
  } else {
    for (const row of listRows(key)) {
      lines.push(
        [row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status]
          .map(csvCell)
          .join(','),
      )
    }
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    if (meta.key === EVAPORATION_KEY) {
      const valid = entries.filter(isEvaporationRow).map((row) => toDisplayRow(row))
      return {
        name: meta.name,
        created: valid.length,
        pending: valid.filter(isPending).length,
        abnormal: valid.filter(isAbnormal).length,
      }
    }
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
