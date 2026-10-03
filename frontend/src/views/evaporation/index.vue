<template>
  <section class="page" data-module="evaporation">
    <header class="page-head">
      <div>
        <h2>蒸发观测管理</h2>
        <p class="page-desc">登记蒸发观测原始读数（蒸发量、水温、气温、风速），异常判定由读数统一推导；读数登记后只读，缺测按空值保留。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showForm = !showForm">
          {{ showForm ? '收起登记表单' : '登记蒸发观测记录' }}
        </button>
        <button class="btn" type="button" @click="exportRows">导出蒸发观测清单</button>
      </div>
    </header>

    <form v-if="showForm" class="register-form" @submit.prevent="submitRegister">
      <label class="filter-item">
        <span>记录编号</span>
        <input v-model="form.记录编号" placeholder="如 EVAP-0007" />
      </label>
      <label class="filter-item">
        <span>站点编号</span>
        <input v-model="form.站点编号" placeholder="如 STAT-0001" />
      </label>
      <label class="filter-item">
        <span>观测日期</span>
        <input v-model="form.观测日期" type="date" />
      </label>
      <label class="filter-item">
        <span>蒸发量 (mm)</span>
        <input v-model="form.蒸发量" inputmode="decimal" placeholder="缺测留空" />
      </label>
      <label class="filter-item">
        <span>水温 (℃)</span>
        <input v-model="form.水温" inputmode="decimal" placeholder="缺测留空" />
      </label>
      <label class="filter-item">
        <span>气温 (℃)</span>
        <input v-model="form.气温" inputmode="decimal" placeholder="缺测留空" />
      </label>
      <label class="filter-item">
        <span>风速 (m/s)</span>
        <input v-model="form.风速" inputmode="decimal" placeholder="缺测留空" />
      </label>
      <div class="form-actions">
        <button class="btn primary" type="submit" :disabled="registering">
          {{ registering ? '保存中…' : '保存登记' }}
        </button>
        <button class="btn ghost" type="button" @click="resetForm">清空</button>
      </div>
    </form>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">今日观测站次</span>
        <strong class="stat-value">{{ summary.today }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待审核记录</span>
        <strong class="stat-value">{{ summary.pendingReview }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">异常记录数</span>
        <strong class="stat-value">{{ summary.abnormal }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>记录编号</span>
        <input v-model="keyword" placeholder="按记录编号或站点检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="keyword = ''">重置条件</button>
    </form>

    <div class="panel-grid">
      <section class="panel">
        <h3 class="panel-title">观测记录列表</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>记录编号</th>
              <th>站点编号</th>
              <th>观测日期</th>
              <th>蒸发量</th>
              <th>水温</th>
              <th>气温</th>
              <th>风速</th>
              <th>异常判定</th>
              <th>当前状态</th>
              <th>处理</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filteredRows" :key="row.id">
              <td>{{ row.记录编号 }}</td>
              <td>{{ row.站点编号 }}</td>
              <td>{{ row.观测日期 }}</td>
              <td>{{ formatReading(row.readings.蒸发量) }}</td>
              <td>{{ formatReading(row.readings.水温) }}</td>
              <td>{{ formatReading(row.readings.气温) }}</td>
              <td>{{ formatReading(row.readings.风速) }}</td>
              <td>
                <span v-if="row.reasons.length" class="reason-text">{{ row.reasons.join('、') }}</span>
                <span v-else class="muted-text">正常</span>
              </td>
              <td>{{ row.status }}</td>
              <td class="row-actions">
                <button
                  v-for="action in actionsFor(row)"
                  :key="action"
                  class="link"
                  type="button"
                  :disabled="busyIds.has(row.id)"
                  @click="runAction(action, row)"
                >
                  {{ busyIds.has(row.id) ? '处理中…' : action }}
                </button>
              </td>
            </tr>
            <tr v-if="!filteredRows.length">
              <td colspan="10" class="empty-state">暂无符合条件的蒸发观测记录</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="panel panel-abnormal">
        <h3 class="panel-title">异常面板（{{ abnormalRows.length }}）</h3>
        <p class="panel-hint">命中规则的记录在此复核；复核通过被规则拦截，需先标记异常。</p>
        <ul class="abnormal-list">
          <li v-for="row in abnormalRows" :key="row.id" class="abnormal-item">
            <div class="abnormal-head">
              <strong>{{ row.记录编号 }}</strong>
              <span class="muted-text">{{ row.站点编号 }} · {{ row.观测日期 }} · {{ row.status }}</span>
            </div>
            <div class="abnormal-readings">
              原始读数：蒸发量 {{ formatReading(row.readings.蒸发量) }} /
              水温 {{ formatReading(row.readings.水温) }} /
              气温 {{ formatReading(row.readings.气温) }} /
              风速 {{ formatReading(row.readings.风速) }}
            </div>
            <div class="reason-text">{{ row.reasons.join('、') }}</div>
            <div class="row-actions">
              <button
                v-for="action in actionsFor(row)"
                :key="action"
                class="link"
                type="button"
                :disabled="busyIds.has(row.id)"
                @click="runAction(action, row)"
              >
                {{ busyIds.has(row.id) ? '处理中…' : action }}
              </button>
            </div>
          </li>
          <li v-if="!abnormalRows.length" class="empty-state">当前没有命中异常规则的记录</li>
        </ul>
      </section>
    </div>

    <footer class="page-foot">
      <span>共 {{ filteredRows.length }} 条蒸发观测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  evapSummary,
  exportEvapCsv,
  listEvap,
  registerEvap,
  resolveEvapAction,
  toDraft,
} from '@/api/evaporation-service'
import type { EvapRecord } from '@/data/types'

const STATUSES = ['已采集', '待审核', '已通过', '异常值'] as const

const rows = ref<EvapRecord[]>([])
const keyword = ref('')
const errorMessage = ref('')
const successMessage = ref('')
const showForm = ref(false)
const registering = ref(false)
// 处理中的记录：两个入口共享同一把锁，按钮同步禁用。
const busyIds = ref<Set<number>>(new Set())

const emptyForm = () => ({
  记录编号: '',
  站点编号: '',
  观测日期: '',
  蒸发量: '',
  水温: '',
  气温: '',
  风速: '',
})
const form = reactive(emptyForm())

const summary = ref(evapSummary())

const filteredRows = computed(() => {
  const key = keyword.value.trim()
  if (!key) {
    return rows.value
  }
  return rows.value.filter(
    (row) => row.记录编号.includes(key) || row.站点编号.includes(key),
  )
})

const abnormalRows = computed(() =>
  rows.value.filter((row) => row.reasons.length > 0),
)

const statusSummary = computed(() =>
  STATUSES.map((status) => ({
    status,
    count: rows.value.filter((row) => row.status === status).length,
  })),
)

function formatReading(value: number | null): string {
  return value === null ? '缺测' : String(value)
}

function actionsFor(row: EvapRecord): string[] {
  switch (row.status) {
    case '已采集':
      return ['提交审核', '标记异常']
    case '待审核':
      return ['确认通过', '标记异常']
    default:
      return []
  }
}

function flashSuccess(message: string) {
  successMessage.value = message
  errorMessage.value = ''
}

function flashError(message: string) {
  errorMessage.value = message
  successMessage.value = ''
}

// 列表、异常面板、统计卡共用一次取数，保证三处结论永远一致。
function reload() {
  rows.value = listEvap()
  summary.value = evapSummary()
}

function resetForm() {
  Object.assign(form, emptyForm())
}

async function submitRegister() {
  flashError('')
  const draft = toDraft(form)
  if ('error' in draft) {
    flashError(draft.error)
    return
  }
  registering.value = true
  // 失败（含并发占用）时不更新任何视图；成功后一次刷新，判定与读数同时可见。
  const result = await registerEvap(draft)
  registering.value = false
  if (!result.ok) {
    flashError(result.message)
    return
  }
  resetForm()
  showForm.value = false
  reload()
  flashSuccess(result.message)
}

async function runAction(action: string, row: EvapRecord) {
  flashError('')
  busyIds.value = new Set(busyIds.value).add(row.id)
  // 无论成功失败都在 await 后统一 reload：
  // 成功只落一个结论；失败时服务端未换快照，列表、汇总、待办一起回到原状态。
  const result = await resolveEvapAction(row.id, action)
  busyIds.value = new Set([...busyIds.value].filter((id) => id !== row.id))
  reload()
  if (result.ok) {
    flashSuccess(result.message)
  } else {
    flashError(result.message)
  }
}

function exportRows() {
  const { filename, content } = exportEvapCsv()
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

onMounted(reload)
</script>

<style scoped>
.panel-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 12px;
  align-items: start;
}
.panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}
.panel-title { margin: 0 0 8px; font-size: 14px; }
.panel-hint { margin: 0 0 8px; font-size: 12px; color: var(--muted); }
.register-form {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-end;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.form-actions { display: flex; gap: 8px; }
.abnormal-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.abnormal-item { border: 1px solid var(--border); border-left: 3px solid #d92d20; border-radius: 6px; padding: 8px 10px; }
.abnormal-head { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
.abnormal-readings { font-size: 12px; color: var(--muted); margin: 4px 0; }
.reason-text { color: #b42318; font-size: 12px; }
.muted-text { color: var(--muted); font-size: 12px; }
.success-text { color: #067647; }
button:disabled { color: var(--muted); cursor: not-allowed; }
@media (max-width: 1100px) {
  .panel-grid { grid-template-columns: 1fr; }
}
</style>
