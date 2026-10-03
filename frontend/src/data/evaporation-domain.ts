import type { EvapReadings, EvapRecord } from './types'

// 缺测按空值（null）保留，不补零、不当有效值；判定只依赖原始读数。
export function evaluateEvapReadings(readings: EvapReadings): string[] {
  const reasons: string[] = []
  if (readings.蒸发量 === null) {
    reasons.push('蒸发量缺测')
  } else if (readings.蒸发量 === 0) {
    reasons.push('蒸发量为零')
  }
  if (readings.风速 === null) {
    reasons.push('风速缺测')
  }
  if (readings.水温 === null) {
    reasons.push('水温缺测')
  }
  if (readings.气温 === null) {
    reasons.push('气温缺测')
  }
  // 气温低于水温：只要两项读数都在就判定，结论与其他原因并存，不会被覆盖。
  if (
    readings.气温 !== null &&
    readings.水温 !== null &&
    readings.气温 < readings.水温
  ) {
    reasons.push('气温低于水温')
  }
  return reasons
}

export function freezeReadings(readings: EvapReadings): EvapReadings {
  return Object.freeze({ ...readings }) as EvapReadings
}

// 对外读取记录时冻结读数，任何处理入口都无法改写原始读数。
export function freezeRecord(record: EvapRecord): EvapRecord {
  return Object.freeze({
    ...record,
    readings: freezeReadings(record.readings),
    reasons: Object.freeze([...record.reasons]),
  }) as EvapRecord
}

export function isAbnormal(record: Pick<EvapRecord, 'status' | 'reasons'>): boolean {
  return record.status === '异常值' || record.reasons.length > 0
}

export function isPendingReview(record: Pick<EvapRecord, 'status'>): boolean {
  return record.status === '待审核'
}

export function isPending(record: Pick<EvapRecord, 'status'>): boolean {
  return record.status === '已采集' || record.status === '待审核'
}
