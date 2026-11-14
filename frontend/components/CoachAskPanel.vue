<template>
  <view
    class="coach-panel"
    :style="{
      borderColor: hexWithAlpha(themeColor, 0.36),
      boxShadow: `0 12px 30px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.08)`
    }"
  >
    <view class="coach-head">
      <view class="coach-title-row">
        <text class="coach-icon">🎓</text>
        <text class="coach-title" :style="{ color: themeColor }">
          {{ personaName }} · AI 复盘教练
        </text>
      </view>
      <view class="head-right">
        <view v-if="messages.length > 0" class="clear-btn" @tap="onClearHistory">
          <text class="clear-btn-text">清空对话</text>
        </view>
        <view class="step-badge">
          <text class="step-badge-text">
            {{ currentEntry ? `第 ${currentEntry.step} 步 · ${currentEntry.notation || currentEntry.uci}` : '开局初始局面' }}
          </text>
        </view>
      </view>
    </view>

    <!-- 端侧主变线推演与战术语义卡片 -->
    <view v-if="previewLines.length > 0 || actualAnalysis" class="pv-card">
      <view v-if="actualAnalysis" class="actual-tactics-row">
        <text class="pv-section-label">实走后果</text>
        <view class="tag-list">
          <view
            v-for="tag in actualAnalysis.tactics_tags"
            :key="'act-' + tag"
            class="tactic-tag"
            :class="{ 'is-danger': isDangerTag(tag) }"
          >
            <text class="tactic-tag-text">{{ tag }}</text>
          </view>
          <view v-if="actualAnalysis.eval_loss_cp > 0" class="loss-badge">
            <text class="loss-badge-text">亏 {{ actualAnalysis.eval_loss_cp }} cp</text>
          </view>
        </view>
        <text v-if="actualAnalysis.pv && actualAnalysis.pv.length" class="pv-seq-text is-actual">
          {{ actualAnalysis.pv.join(' -> ') }}
        </text>
      </view>

      <view v-if="previewLines.length > 0" class="pv-lines-group">
        <text class="pv-section-label">
          {{ currentEntry && hasAlternativeLines ? '引擎正解主变推演 (PV)' : '当前后续最优主变 (PV)' }}
        </text>
        <view
          v-for="(line, idx) in previewLines"
          :key="'pv-' + line.uci + '-' + idx"
          class="pv-line-item"
        >
          <view class="pv-line-top">
            <text class="pv-rank">#{{ idx + 1 }}</text>
            <text class="pv-move">{{ line.notation || line.uci }}</text>
            <text class="pv-score">({{ line.score_cp >= 0 ? '+' : '' }}{{ line.score_cp }})</text>
            <view class="tag-list">
              <view
                v-for="t in (line.tactics_tags || []).slice(0, 2)"
                :key="line.uci + '-' + t"
                class="tactic-tag is-subtle"
              >
                <text class="tactic-tag-text">{{ t }}</text>
              </view>
            </view>
          </view>
          <text v-if="line.pv && line.pv.length" class="pv-seq-text">
            {{ line.pv.join(' -> ') }}
          </text>
        </view>
      </view>
    </view>

    <!-- 快捷分析与多轮假设追问标签 -->
    <view class="quick-row">
      <view
        v-for="preset in QUICK_PROMPTS"
        :key="preset.id"
        class="quick-chip"
        :class="{ 'is-disabled': loading }"
        :style="{
          borderColor: hexWithAlpha(themeColor, 0.4),
          backgroundColor: hexWithAlpha(themeColor, 0.12)
        }"
        @tap="onQuickAsk(preset)"
      >
        <text class="quick-text">{{ preset.label }}</text>
      </view>
    </view>

    <!-- 自由追问输入框 -->
    <view class="input-row">
      <input
        v-model="questionInput"
        class="ask-input"
        maxlength="500"
        confirm-type="send"
        placeholder="输入追问，如：那如果他不跟我换子怎么办？"
        placeholder-class="ask-placeholder"
        @confirm="onSendCustomQuestion"
      />
      <button
        class="send-btn"
        :disabled="loading || !questionInput.trim()"
        :style="{ backgroundColor: themeColor }"
        @tap="onSendCustomQuestion"
      >
        {{ loading ? '推演中' : '追问' }}
      </button>
    </view>

    <!-- 多轮对话历史展示区 -->
    <view v-if="messages.length > 0" class="chat-thread">
      <view
        v-for="msg in messages"
        :key="msg.id"
        class="chat-msg"
        :class="msg.role === 'user' ? 'is-user' : 'is-assistant'"
      >
        <view class="chat-msg-head">
          <text class="chat-role">
            {{ msg.role === 'user' ? `我 · ${msg.stepLabel || '当前局面'}` : personaName }}
          </text>
          <view v-if="msg.role === 'assistant' && msg.isFallback" class="fallback-pill">
            <text class="fallback-pill-text">
              {{ msg.isLocalFallback ? '离线引擎速览' : '引擎兜底解析' }}
            </text>
          </view>
          <view v-else-if="msg.role === 'assistant' && msg.modelName" class="model-pill">
            <text class="model-pill-text">{{ msg.modelName }}</text>
          </view>
        </view>
        <text class="answer-text" selectable>{{ msg.content }}</text>
      </view>
    </view>

    <view v-if="loading" class="answer-box loading-box">
      <text class="loading-text">正在结合主变线 (PV) 与战术标签运行多步推演…</text>
    </view>

    <view v-else-if="messages.length === 0" class="empty-tip">
      <text class="empty-tip-text">
        点击上方快捷标签或连续追问（支持保留多轮上下文），AI 教练将结合主变线与兑子/弃子/漏防归因拆解棋理。
      </text>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { hexWithAlpha } from '../utils/color.js'
import { useGameStore } from '../stores/game.js'

const QUICK_PROMPTS = [
  {
    id: 'diagnose',
    label: '诊断当前步',
    buildQuestion: (entry) =>
      entry
        ? `请诊断第 ${entry.step} 步「${entry.notation || entry.uci}」走得怎么样？结合实走后续变化与引擎正解主变说明具体得失。`
        : '当前处于开局初始局面，请分析双方开局常见的先行战略思路与前3手主变推荐。'
  },
  {
    id: 'best_line',
    label: '最佳变例推演',
    buildQuestion: () =>
      '基于当前停留局面，引擎算出的最佳主变线后续 2~3 步攻防是什么？为什么强于其他变例？'
  },
  {
    id: 'what_if',
    label: '如果他不换子？',
    buildQuestion: () =>
      '那如果对手不按主变线跟我兑子或避战退防，我下一步该如何扩大先手或抓破绽？'
  },
  {
    id: 'summary',
    label: '全局胜负手总结',
    buildQuestion: () =>
      '请总结这盘棋的全局走势、核心胜负手以及关键战犯步（失误步）出在哪里？给出针对性的改进建议。'
  }
]

const DANGER_TAGS = new Set(['白丢大子', '漏防丢子', '漏防失兵', '亏子兑换', '遭反将受压', '缓手失先'])

const props = defineProps({
  persona: {
    type: Object,
    default: () => ({})
  },
  currentEntry: {
    type: Object,
    default: null
  }
})

const gameStore = useGameStore()

const questionInput = ref('')
const loading = ref(false)
const messages = ref([])

const themeColor = computed(() =>
  props.persona && props.persona.theme_color ? props.persona.theme_color : '#2563EB'
)
const personaName = computed(() =>
  props.persona && props.persona.name ? props.persona.name : 'AI 教练'
)

const tacticalPreview = computed(() => {
  // 依赖 displayFen 确保时间轴拖动时实时刷新 PV 预览卡片
  void gameStore.displayFen.value
  return gameStore.getReplayTacticalPreview(props.currentEntry)
})

const actualAnalysis = computed(() => tacticalPreview.value.actual_move_analysis || null)

const hasAlternativeLines = computed(
  () =>
    Array.isArray(tacticalPreview.value.alternative_candidates) &&
    tacticalPreview.value.alternative_candidates.length > 0
)

const previewLines = computed(() => {
  if (props.currentEntry && hasAlternativeLines.value) {
    return tacticalPreview.value.alternative_candidates.slice(0, 3)
  }
  return (tacticalPreview.value.top_candidates || []).slice(0, 3)
})

function isDangerTag(tag) {
  return DANGER_TAGS.has(tag)
}

function onClearHistory() {
  if (loading.value) return
  messages.value = []
}

async function submitQuestion(text) {
  const clean = String(text || '').trim()
  if (!clean || loading.value) return

  const historySnapshot = messages.value
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content }))

  const stepLabel = props.currentEntry
    ? `第${props.currentEntry.step}步 ${props.currentEntry.notation || props.currentEntry.uci}`
    : '初始局面'

  messages.value.push({
    id: `u_${Date.now()}_${messages.value.length}`,
    role: 'user',
    stepLabel,
    content: clean
  })

  loading.value = true
  try {
    const res = await gameStore.askReplayCoach({
      question: clean,
      persona: props.persona,
      chatHistory: historySnapshot
    })
    messages.value.push({
      id: `a_${Date.now()}_${messages.value.length}`,
      role: 'assistant',
      stepLabel,
      content: res.answer,
      questionType: res.question_type || '',
      modelName: res.model_name || '',
      isFallback: Boolean(res.is_fallback),
      isLocalFallback: Boolean(res.is_local_fallback)
    })
  } finally {
    loading.value = false
  }
}

function onQuickAsk(preset) {
  if (loading.value) return
  const q = preset.buildQuestion(props.currentEntry)
  submitQuestion(q)
}

function onSendCustomQuestion() {
  const clean = questionInput.value.trim()
  if (!clean || loading.value) return
  questionInput.value = ''
  submitQuestion(clean)
}
</script>

<style scoped>
.coach-panel {
  width: 100%;
  box-sizing: border-box;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(15, 23, 42, 0.84);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.coach-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.coach-title-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.head-right {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.clear-btn {
  padding: 3px 8px;
  border-radius: 999px;
  background-color: rgba(51, 65, 85, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.2);
  cursor: pointer;
}

.clear-btn-text {
  font-size: 10px;
  color: #94A3B8;
}

.coach-icon {
  font-size: 15px;
}

.coach-title {
  font-size: 14px;
  font-weight: 800;
}

.step-badge {
  padding: 3px 8px;
  border-radius: 999px;
  background-color: rgba(30, 41, 59, 0.85);
  border: 1px solid rgba(148, 163, 184, 0.22);
}

.step-badge-text {
  font-size: 11px;
  font-weight: 600;
  color: #CBD5E1;
}

.pv-card {
  padding: 9px 11px;
  border-radius: 12px;
  background: rgba(2, 6, 23, 0.56);
  border: 1px solid rgba(148, 163, 184, 0.18);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.actual-tactics-row,
.pv-lines-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.pv-section-label {
  font-size: 11px;
  font-weight: 700;
  color: #94A3B8;
}

.pv-line-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px 8px;
  border-radius: 8px;
  background-color: rgba(15, 23, 42, 0.72);
}

.pv-line-top {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.pv-rank {
  font-size: 11px;
  font-weight: 800;
  color: #60A5FA;
}

.pv-move {
  font-size: 12px;
  font-weight: 700;
  color: #F8FAFC;
}

.pv-score {
  font-size: 11px;
  font-weight: 600;
  color: #CBD5E1;
}

.tag-list {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 4px;
}

.tactic-tag {
  padding: 1px 6px;
  border-radius: 999px;
  background-color: rgba(59, 130, 246, 0.2);
  border: 1px solid rgba(96, 165, 250, 0.35);
}

.tactic-tag.is-danger {
  background-color: rgba(239, 68, 68, 0.22);
  border-color: rgba(248, 113, 113, 0.45);
}

.tactic-tag.is-subtle {
  background-color: rgba(16, 185, 129, 0.16);
  border-color: rgba(52, 211, 153, 0.3);
}

.tactic-tag-text {
  font-size: 10px;
  font-weight: 600;
  color: #E2E8F0;
}

.loss-badge {
  padding: 1px 6px;
  border-radius: 999px;
  background-color: rgba(245, 158, 11, 0.2);
}

.loss-badge-text {
  font-size: 10px;
  font-weight: 700;
  color: #FCD34D;
}

.pv-seq-text {
  font-size: 11px;
  color: #93C5FD;
  line-height: 1.45;
}

.pv-seq-text.is-actual {
  color: #FCA5A5;
}

.quick-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
}

.quick-chip {
  padding: 6px 11px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  cursor: pointer;
  transition: transform 0.12s ease, opacity 0.15s ease;
}

.quick-chip:active {
  transform: scale(0.96);
}

.quick-chip.is-disabled {
  opacity: 0.55;
  pointer-events: none;
}

.quick-text {
  font-size: 12px;
  font-weight: 700;
  color: #E2E8F0;
}

.input-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.ask-input {
  flex: 1;
  height: 38px;
  padding: 0 12px;
  border-radius: 10px;
  background-color: rgba(2, 6, 23, 0.65);
  border: 1px solid rgba(148, 163, 184, 0.24);
  color: #F8FAFC;
  font-size: 13px;
  box-sizing: border-box;
}

.ask-placeholder {
  color: #64748B;
}

.send-btn {
  width: 68px;
  height: 38px;
  line-height: 38px;
  padding: 0;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  color: #FFFFFF;
  border: none;
  flex-shrink: 0;
  cursor: pointer;
}

.send-btn::after {
  border: none;
}

.send-btn[disabled] {
  opacity: 0.45;
}

.chat-thread {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 340px;
  overflow-y: auto;
}

.chat-msg {
  padding: 9px 11px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.chat-msg.is-user {
  background-color: rgba(37, 99, 235, 0.16);
  border: 1px solid rgba(59, 130, 246, 0.28);
}

.chat-msg.is-assistant {
  background-color: rgba(30, 41, 59, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.chat-msg-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.chat-role {
  font-size: 11px;
  font-weight: 700;
  color: #94A3B8;
}

.answer-box {
  padding: 10px 12px;
  border-radius: 12px;
  background-color: rgba(30, 41, 59, 0.66);
  border: 1px solid rgba(148, 163, 184, 0.18);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.loading-box {
  align-items: center;
  padding: 12px;
}

.loading-text {
  font-size: 12px;
  color: #93C5FD;
}

.fallback-pill,
.model-pill {
  padding: 2px 7px;
  border-radius: 999px;
  flex-shrink: 0;
}

.fallback-pill {
  background-color: rgba(245, 158, 11, 0.18);
}

.fallback-pill-text {
  font-size: 10px;
  font-weight: 700;
  color: #FCD34D;
}

.model-pill {
  background-color: rgba(59, 130, 246, 0.18);
}

.model-pill-text {
  font-size: 10px;
  font-weight: 600;
  color: #93C5FD;
}

.answer-text {
  font-size: 13px;
  line-height: 1.62;
  color: #F1F5F9;
  white-space: pre-wrap;
}

.empty-tip {
  padding: 6px 4px;
}

.empty-tip-text {
  font-size: 12px;
  line-height: 1.5;
  color: #64748B;
}
</style>
