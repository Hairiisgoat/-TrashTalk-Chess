<template>
  <view class="eval-wrap">
    <view class="eval-labels">
      <text class="side-label player">我方胜率 {{ playerWinRate.toFixed(1) }}%</text>
      <text v-if="deltaText" class="delta-label" :class="deltaClass">{{ deltaText }}</text>
      <text class="side-label ai">AI {{ aiWinRate.toFixed(1) }}%</text>
    </view>
    <view class="bar-track">
      <view
        class="bar-player"
        :style="{ width: `${playerPercent}%`, backgroundColor: playerColor }"
      />
      <view
        class="bar-ai"
        :style="{ width: `${100 - playerPercent}%`, backgroundColor: themeColor }"
      />
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  winRateForAi: {
    type: Number,
    default: 50
  },
  winRateDelta: {
    type: Number,
    default: 0
  },
  gameType: {
    type: String,
    default: 'xiangqi'
  },
  themeColor: {
    type: String,
    default: '#2563EB'
  }
})

const aiWinRate = computed(() => {
  const parsed = Number(props.winRateForAi)
  const safe = Number.isFinite(parsed) ? parsed : 50
  return Math.max(0.1, Math.min(99.9, safe))
})
const playerWinRate = computed(() => {
  const diff = Math.round((100 - aiWinRate.value) * 10) / 10
  return Math.max(0.1, Math.min(99.9, diff))
})
const playerPercent = computed(() => Math.max(6, Math.min(94, playerWinRate.value)))
const playerColor = computed(() => (props.gameType === 'xiangqi' ? '#DC2626' : '#E2E8F0'))

const deltaText = computed(() => {
  const parsed = Number(props.winRateDelta)
  const d = Number.isFinite(parsed) ? parsed : 0
  if (Math.abs(d) < 0.5) return '局势均衡'
  if (d >= 5) return `AI 暴涨 +${d.toFixed(1)}%`
  if (d > 0) return `AI +${d.toFixed(1)}%`
  if (d <= -5) return `妙手! AI ${d.toFixed(1)}%`
  return `占优 ${Math.abs(d).toFixed(1)}%`
})

const deltaClass = computed(() => {
  const d = Number(props.winRateDelta || 0)
  if (d >= 3) return 'is-bad'
  if (d <= -3) return 'is-good'
  return 'is-neutral'
})
</script>

<style scoped>
.eval-wrap {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border-radius: 12px;
  background: rgba(30, 41, 59, 0.56);
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.eval-labels {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.side-label {
  font-size: 11.5px;
  font-weight: 600;
}

.side-label.player {
  color: #E2E8F0;
}

.side-label.ai {
  color: #94A3B8;
}

.delta-label {
  font-size: 11px;
  font-weight: 700;
  padding: 1px 8px;
  border-radius: 999px;
}

.delta-label.is-good {
  color: #34D399;
  background-color: rgba(16, 185, 129, 0.16);
}

.delta-label.is-bad {
  color: #FCA5A5;
  background-color: rgba(239, 68, 68, 0.18);
}

.delta-label.is-neutral {
  color: #94A3B8;
  background-color: rgba(148, 163, 184, 0.12);
}

.bar-track {
  width: 100%;
  height: 7px;
  border-radius: 999px;
  overflow: hidden;
  display: flex;
  flex-direction: row;
  background-color: #0F172A;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5);
}

.bar-player,
.bar-ai {
  height: 100%;
  transition: width 0.35s ease;
}
</style>
