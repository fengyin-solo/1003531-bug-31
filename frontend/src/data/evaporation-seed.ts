import type { EvapRecord } from './types'

function shiftDate(days: number): string {
  const date = new Date('2026-10-03T00:00:00')
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

// 蒸发示例数据：读数（含 null 缺测）与异常判定分离，判定由领域规则统一推导。
export const SEED_EVAP_ROWS: EvapRecord[] = [
  {
    id: 1,
    记录编号: 'EVAP-0001',
    站点编号: 'STAT-0001',
    观测日期: shiftDate(0),
    readings: { 蒸发量: 2.4, 水温: 18.2, 气温: 21.5, 风速: 3.1 },
    status: '已采集',
    reasons: [],
  },
  {
    id: 2,
    记录编号: 'EVAP-0002',
    站点编号: 'STAT-0001',
    观测日期: shiftDate(-1),
    readings: { 蒸发量: 0, 水温: 17.6, 气温: 19.0, 风速: 2.2 },
    status: '待审核',
    reasons: ['蒸发量为零'],
  },
  {
    id: 3,
    记录编号: 'EVAP-0003',
    站点编号: 'STAT-0002',
    观测日期: shiftDate(-1),
    readings: { 蒸发量: 1.8, 水温: 19.4, 气温: 16.2, 风速: 1.5 },
    status: '待审核',
    reasons: ['气温低于水温'],
  },
  {
    id: 4,
    记录编号: 'EVAP-0004',
    站点编号: 'STAT-0002',
    观测日期: shiftDate(-2),
    readings: { 蒸发量: 2.0, 水温: 18.0, 气温: 20.1, 风速: null },
    status: '待审核',
    reasons: ['风速缺测'],
  },
  {
    id: 5,
    记录编号: 'EVAP-0005',
    站点编号: 'STAT-0003',
    观测日期: shiftDate(-2),
    readings: { 蒸发量: 0, 水温: null, 气温: 15.8, 风速: null },
    status: '已采集',
    reasons: ['蒸发量为零', '水温缺测', '风速缺测'],
  },
  {
    id: 6,
    记录编号: 'EVAP-0006',
    站点编号: 'STAT-0003',
    观测日期: shiftDate(-3),
    readings: { 蒸发量: 3.2, 水温: 16.5, 气温: 22.0, 风速: 4.0 },
    status: '已通过',
    reasons: [],
  },
]
