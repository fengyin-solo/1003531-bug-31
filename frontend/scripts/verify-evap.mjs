// 运行时验证：注入 localStorage 垫片后跑断言（node --loader ./scripts/ts-loader.mjs）。
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// ---- localStorage 垫片，可切换成抛错模式 ----
const store = new Map()
let failMode = false
globalThis.window = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      if (failMode) {
        throw new Error('QuotaExceededError: 模拟持久化失败')
      }
      store.set(k, String(v))
    },
  },
}

const api = await import(pathToFileURL(join(here, 'harness-entry.ts')).href)

let passed = 0
function ok(name) {
  passed++
  console.log('  ✓', name)
}

// 种子重置，保证用例独立
api.resetEvapRows()

// 1) 蒸发量为零 / 风速缺测不能通过复核（种子 id=2 蒸发量0，id=4 风速缺测）
{
  const r1 = await api.resolveEvapAction(2, '确认通过')
  assert.equal(r1.ok, false)
  assert.match(r1.message, /蒸发量为零/)
  const r2 = await api.resolveEvapAction(4, '确认通过')
  assert.equal(r2.ok, false)
  assert.match(r2.message, /风速缺测/)
  const after = api.listEvap().find((r) => r.id === 2)
  assert.equal(after.status, '待审核')
  ok('蒸发量为零 / 风速缺测被复核拦截，状态不变')
}

// 2) 气温低于水温的结论不被状态覆盖（id=3）
{
  const before = api.listEvap().find((r) => r.id === 3)
  assert.deepEqual(before.reasons, ['气温低于水温'])
  const blocked = await api.resolveEvapAction(3, '确认通过')
  assert.equal(blocked.ok, false)
  const marked = await api.resolveEvapAction(3, '标记异常')
  assert.equal(marked.ok, true)
  const after = api.listEvap().find((r) => r.id === 3)
  assert.equal(after.status, '异常值')
  assert.deepEqual(after.reasons, ['气温低于水温'])
  ok('气温低于水温结论在标记异常后仍保留，不被覆盖')
}

// 3) 两个处理入口并发提交，同一条记录只落一个结论
{
  api.resetEvapRows()
  const [a, b] = await Promise.all([
    api.resolveEvapAction(2, '标记异常'),
    api.resolveEvapAction(2, '标记异常'),
  ])
  assert.equal([a.ok, b.ok].filter(Boolean).length, 1)
  const rec = api.listEvap().find((r) => r.id === 2)
  assert.equal(rec.status, '异常值')
  ok(`并发双提交只成功一个（成功=${a.ok}, 被拒=${!b.ok}）`)

  api.resetEvapRows()
  const [c, d] = await Promise.all([
    api.resolveEvapAction(2, '标记异常'),
    api.resolveEvapAction(2, '确认通过'),
  ])
  assert.equal([c.ok, d.ok].filter(Boolean).length, 1)
  ok('并发不同动作也只落一个结论')
}

// 4) 持久化失败：列表、汇总、待办全部回到原状态
{
  api.resetEvapRows()
  const beforeRows = JSON.stringify(api.listEvapRows())
  const beforeSummary = api.evapSummary()
  failMode = true
  const r = await api.resolveEvapAction(1, '提交审核')
  failMode = false
  assert.equal(r.ok, false)
  assert.match(r.message, /回到处理前状态/)
  assert.equal(JSON.stringify(api.listEvapRows()), beforeRows)
  assert.deepEqual(api.evapSummary(), beforeSummary)
  const rec = api.listEvap().find((x) => x.id === 1)
  assert.equal(rec.status, '已采集')
  ok('落盘失败后记录、汇总与原状态完全一致')
}

// 5) 原始读数任何流程后都不改写（含缺测为 null、冻结防外部篡改）
{
  api.resetEvapRows()
  const before = api.listEvap().find((r) => r.id === 5)
  const snapshot = JSON.stringify(before.readings)
  const blocked = await api.resolveEvapAction(5, '提交审核')
  assert.equal(blocked.ok, false)
  await api.resolveEvapAction(5, '标记异常')
  const after = api.listEvap().find((r) => r.id === 5)
  assert.equal(JSON.stringify(after.readings), snapshot)
  assert.equal(after.readings.风速, null)
  assert.equal(after.readings.水温, null)
  assert.equal(after.readings.蒸发量, 0)
  // 冻结：外部拿到的对象改读数/塞原因会被拒绝
  assert.throws(() => { after.readings.蒸发量 = 999 }, TypeError)
  assert.throws(() => { after.reasons.push('伪造原因') }, TypeError)
  const again = api.listEvap().find((r) => r.id === 5)
  assert.equal(again.readings.蒸发量, 0)
  assert.equal(again.reasons.includes('伪造原因'), false)
  ok('原始读数与判定结果不可被外部/流程改写，缺测保持 null')
}

// 6) 列表、异常面板、汇总三处同源一致
{
  api.resetEvapRows()
  const rows = api.listEvap()
  const abnormalCount = rows.filter((r) => r.reasons.length > 0).length
  const pendingReview = rows.filter((r) => r.status === '待审核').length
  const s = api.evapSummary()
  assert.equal(s.abnormal, abnormalCount)
  assert.equal(s.pendingReview, pendingReview)
  ok(`三处取数一致：异常 ${s.abnormal}、待审核 ${s.pendingReview}`)
}

// 7) 登记：缺测按空值保留，判定与读数一次落库
{
  api.resetEvapRows()
  const draft = api.toDraft({
    记录编号: 'EVAP-0999',
    站点编号: 'STAT-0009',
    观测日期: '2026-10-03',
    蒸发量: '0',
    水温: '',
    气温: '12',
    风速: '',
  })
  assert.equal(draft.error, undefined)
  const r = await api.registerEvap(draft)
  assert.equal(r.ok, true)
  const rec = api.listEvap().find((x) => x.记录编号 === 'EVAP-0999')
  assert.equal(rec.readings.风速, null)
  assert.equal(rec.readings.水温, null)
  assert.deepEqual([...rec.reasons].sort(), ['蒸发量为零', '水温缺测', '风速缺测'].sort())
  const bad = api.toDraft({
    记录编号: 'X', 站点编号: 'Y', 观测日期: '2026-10-03',
    蒸发量: 'abc', 水温: '1', 气温: '2', 风速: '3',
  })
  assert.equal('error' in bad, true)
  ok('登记缺测存为 null，判定随读数一次保存；非法输入被拒')
}

// 8) 登记并发也只落一条
{
  api.resetEvapRows()
  const draft = api.toDraft({
    记录编号: 'EVAP-0998',
    站点编号: 'S1',
    观测日期: '2026-10-03',
    蒸发量: '1', 水温: '1', 气温: '2', 风速: '3',
  })
  const [x, y] = await Promise.all([api.registerEvap(draft), api.registerEvap(draft)])
  assert.equal([x.ok, y.ok].filter(Boolean).length, 1)
  assert.equal(api.listEvap().filter((r) => r.记录编号 === 'EVAP-0998').length, 1)
  ok('登记双提交只落一条')
}

console.log(`\n全部 ${passed} 项验证通过`)
