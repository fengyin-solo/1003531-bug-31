<template>
  <section class="page" data-module="evaporation">
    <header class="page-head">
      <div>
        <h2>蒸发观测管理</h2>
        <p class="page-desc">
          登记蒸发观测记录并围绕原始读数做异常判定与复核：风速无读数按缺测（空值）保留，0 是有效读数；原始读数登记后冻结不改写。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showForm = !showForm">
          {{ showForm ? '收起登记表' : '登记蒸发观测记录' }}
        </button>
        <button class="btn" type="button" @click="exportRows">导出蒸发观测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form v-if="showForm" class="filter-bar register-form" @submit.prevent="submitRegister">
      <label class="filter-item">
        <span>站点编号 *</span>
        <input v-model="form.站点编号" placeholder="如 STAT-1001" />
      </label>
      <label class="filter-item">
        <span>观测日期 *</span>
        <input v-model="form.观测日期" type="date" />
      </label>
      <label class="filter-item">
        <span>蒸发量(mm) *</span>
        <input v-model="form.蒸发量" inputmode="decimal" placeholder="0 为有效读数" />
      </label>
      <label class="filter-item">
        <span>水温(℃) *</span>
        <input v-model="form.水温" inputmode="decimal" placeholder="数字" />
      </label>
      <label class="filter-item">
        <span>气温(℃) *</span>
        <input v-model="form.气温" inputmode="decimal" placeholder="数字" />
      </label>
      <label class="filter-item">
        <span>风速(m/s)</span>
        <input v-model="form.风速" inputmode="decimal" placeholder="无读数留空＝缺测" />
      </label>
      <button class="btn primary" type="submit" :disabled="busy">保存登记（读数与判定一次落库）</button>
      <ul v-if="registerErrors.length" class="error-list">
        <li v-for="item in registerErrors" :key="item.field" class="error-text">
          {{ item.field }}：{{ item.message }}
        </li>
      </ul>
      <p v-if="registerHint" class="error-text">{{ registerHint }}</p>
    </form>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      <label class="filter-item fault-switch">
        <input v-model="forceFail" type="checkbox" />
        <span>模拟下一次处理失败（验证回滚，不落库）</span>
      </label>
    </form>

    <section class="panel">
      <h3 class="panel-title">待办处理（待审核）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>记录编号</th><th>站点编号</th><th>观测日期</th>
            <th>蒸发量</th><th>水温</th><th>气温</th><th>风速</th>
            <th>判定结论</th><th colspan="2">处理</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in pendingRows" :key="`todo-${String(row.id)}`">
            <td>{{ row.记录编号 }}</td>
            <td>{{ row.站点编号 }}</td>
            <td>{{ row.观测日期 }}</td>
            <td>{{ formatReading(row.raw.蒸发量) }}</td>
            <td>{{ formatReading(row.raw.水温) }}</td>
            <td>{{ formatReading(row.raw.气温) }}</td>
            <td>{{ formatReading(row.raw.风速) }}</td>
            <td>{{ row.异常结论.length ? row.异常结论.join('；') : '规则无异常' }}</td>
            <td class="row-actions">
              <button class="link" type="button" :disabled="isBusy(row.id)" @click="process(row, '确认通过')">
                确认通过
              </button>
            </td>
            <td class="row-actions">
              <button class="link danger" type="button" :disabled="isBusy(row.id)" @click="process(row, '标记异常')">
                标记异常
              </button>
            </td>
          </tr>
          <tr v-if="!pendingRows.length">
            <td colspan="10" class="empty-state">暂无待审核记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h3 class="panel-title">异常判定面板（含规则命中与人工判定）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>记录编号</th><th>站点编号</th><th>观测日期</th>
            <th>当前状态</th><th>判定结论（只追加不覆盖）</th><th>处理结论</th><th>处理入口</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in abnormalRows" :key="`abn-${String(row.id)}`">
            <td>{{ row.记录编号 }}</td>
            <td>{{ row.站点编号 }}</td>
            <td>{{ row.观测日期 }}</td>
            <td>{{ row.status }}</td>
            <td>{{ row.异常结论.join('；') }}</td>
            <td>{{ row.处理结论 ?? '—' }}</td>
            <td class="row-actions">
              <button
                v-if="row.status === '已采集'"
                class="link" type="button" :disabled="isBusy(row.id)"
                @click="process(row, '提交审核')"
              >
                提交审核
              </button>
              <button
                v-if="row.status === '待审核'"
                class="link danger" type="button" :disabled="isBusy(row.id)"
                @click="process(row, '标记异常')"
              >
                标记异常
              </button>
              <span v-else-if="row.status !== '已采集'" class="muted-text">已处理</span>
            </td>
          </tr>
          <tr v-if="!abnormalRows.length">
            <td colspan="7" class="empty-state">暂无异常记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h3 class="panel-title">全部记录</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <template v-for="column in columns" :key="column">
              <td v-if="column === '蒸发量'">{{ formatReading(row.raw.蒸发量) }}</td>
              <td v-else-if="column === '水温'">{{ formatReading(row.raw.水温) }}</td>
              <td v-else-if="column === '气温'">{{ formatReading(row.raw.气温) }}</td>
              <td v-else-if="column === '风速'">{{ formatReading(row.raw.风速) }}</td>
              <td v-else>{{ row[column] ?? '—' }}</td>
            </template>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-if="row.status === '已采集'"
                class="link" type="button" :disabled="isBusy(row.id)"
                @click="process(row, '提交审核')"
              >
                提交审核
              </button>
              <button
                v-if="row.status === '待审核'"
                class="link" type="button" :disabled="isBusy(row.id)"
                @click="process(row, '确认通过')"
              >
                确认通过
              </button>
              <button
                v-if="row.status === '待审核' || row.status === '已采集'"
                class="link danger" type="button" :disabled="isBusy(row.id)"
                @click="process(row, '标记异常')"
              >
                标记异常
              </button>
              <span v-if="!isPending(row)" class="muted-text">{{ isBusy(row.id) ? '处理中…' : '已流转' }}</span>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无蒸发观测数据，可先登记蒸发观测记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条蒸发观测记录；原始读数冻结保存，缺测以「缺测」显示</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  buildDraft,
  formatReading,
  isAbnormal,
  isPending,
} from '@/data/evaporation'
import type { EvaporationRow, RegisterError } from '@/data/evaporation'
import type { EvaporationAction } from '@/api/local-service'
import {
  downloadEntries,
  listEvaporationEntries,
  loadEvaporationSummary,
  processEvaporation,
  registerEvaporation,
} from '@/api/local-service'

const columns = ['记录编号', '站点编号', '观测日期', '蒸发量', '水温', '气温', '风速']
const statuses = ['已采集', '待审核', '已通过', '异常值']
const filterFields = columns.slice(0, 3)

const rows = ref<EvaporationRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const forceFail = ref(false)
const busyIds = ref<Set<number>>(new Set())
const busy = ref(false)

const showForm = ref(false)
const form = reactive({
  站点编号: '',
  观测日期: '',
  蒸发量: '',
  水温: '',
  气温: '',
  风速: '',
})
const registerErrors = ref<RegisterError[]>([])
const registerHint = ref('')

const stats = ref([
  { label: '今日观测站次', value: 0 },
  { label: '待审核记录', value: 0 },
  { label: '异常记录数', value: 0 },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => row.status === status).length,
  })),
)

// 列表、待办、异常面板三个区块都派生自同一次 reload 读到的 rows，取数口径完全一致
const pendingRows = computed(() => rows.value.filter((row) => row.status === '待审核'))
const abnormalRows = computed(() => rows.value.filter(isAbnormal))

function isBusy(id: number): boolean {
  return busyIds.value.has(id)
}

function refreshStats() {
  const summary = loadEvaporationSummary()
  stats.value = [
    { label: '今日观测站次', value: summary.todayCount },
    { label: '待审核记录', value: summary.pendingCount },
    { label: '异常记录数', value: summary.abnormalCount },
  ]
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries('evaporation')
}

function submitRegister() {
  errorMessage.value = ''
  registerHint.value = ''
  registerErrors.value = []
  const result = buildDraft(form)
  if (!result.ok) {
    registerErrors.value = result.errors
    return
  }
  // 登记即一次保存：冻结原始读数 + 初步判定结论同条记录落库
  const saved = registerEvaporation(result.draft)
  if (!saved.ok) {
    registerHint.value = saved.message
    return
  }
  registerHint.value = saved.message
  Object.assign(form, {
    站点编号: '',
    观测日期: '',
    蒸发量: '',
    水温: '',
    气温: '',
    风速: '',
  })
  reload()
}

async function process(row: EvaporationRow, action: EvaporationAction) {
  errorMessage.value = ''
  const id = Number(row.id)
  // 提交前锁定页面上的全部入口（列表行、待办行、异常面板行同一记录只允许一个在途）
  busyIds.value = new Set(busyIds.value).add(id)
  busy.value = true
  try {
    // expectedVersion 是乐观锁：另一个入口先落了结论，这里的版本对不上会被服务拒绝
    const result = await processEvaporation(id, action, {
      expectedVersion: row.version,
      forceFail: forceFail.value,
    })
    if (!result.ok) {
      errorMessage.value = result.message
    }
    // 无论成功失败都重新取数：失败时列表、汇总、待办一起展示回滚后的原状态
    reload()
  } finally {
    const next = new Set(busyIds.value)
    next.delete(id)
    busyIds.value = next
    busy.value = false
    forceFail.value = false
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEvaporationEntries(filters.value)
    rows.value = payload.items as EvaporationRow[]
    total.value = payload.total
    refreshStats()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '蒸发观测列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 14px;
}
.panel-title {
  margin: 0 0 8px;
  font-size: 14px;
}
.register-form {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}
.error-list {
  flex-basis: 100%;
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
}
.fault-switch {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.link.danger {
  color: #b42318;
}
.link:disabled {
  color: #9aa6b2;
  cursor: not-allowed;
}
.muted-text {
  color: var(--muted);
  font-size: 12px;
}
</style>
