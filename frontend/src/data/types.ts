/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 蒸发观测：原始读数与复核判定分开存放，读数登记后只读（null 表示缺测，不当作 0）。
export type EvapReadings = {
  蒸发量: number | null
  水温: number | null
  气温: number | null
  风速: number | null
}

export type EvapStatus = '已采集' | '待审核' | '已通过' | '异常值'

export type EvapRecord = {
  id: number
  记录编号: string
  站点编号: string
  观测日期: string
  readings: EvapReadings
  status: EvapStatus
  // 异常判定与原始读数分开持久化，任何流转都不改写字段本身。
  reasons: string[]
}

export type EvapDraft = {
  记录编号: string
  站点编号: string
  观测日期: string
  readings: EvapReadings
}
