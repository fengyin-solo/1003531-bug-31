/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

// 业务字段除文本、数字、布尔外，还允许空值（缺测）、判定结论数组与嵌套原始读数。
// 嵌套结构用 unknown 承载，避免递归联合在模板的 String() 调用里触发过深的类型实例化。
export type EntryValue =
  | string
  | number
  | boolean
  | null
  | unknown[]
  | Record<string, unknown>

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: EntryValue
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
