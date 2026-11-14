<template>
  <view class="talk-wrapper">
    <!-- AI 头像区域 -->
    <view class="avatar-col">
      <view
        class="avatar-ring"
        :class="{ 'is-thinking': isThinking, 'is-rage': bubble.emotion === 'rage' }"
        :style="{
          borderColor: themeColor,
          boxShadow: `0 0 20rpx ${hexWithAlpha(themeColor, 0.35)}`,
          backgroundColor: !persona.avatar_url ? hexWithAlpha(themeColor, 0.22) : '#1E293B'
        }"
      >
        <image v-if="persona.avatar_url" class="avatar-img" :src="persona.avatar_url" mode="aspectFill" />
        <view v-else class="avatar-monogram">
          <text class="monogram-text" :style="{ color: themeColor }">
            {{ (persona.name || 'AI').slice(0, 1) }}
          </text>
        </view>
      </view>
      <view class="emotion-pill" :style="{ backgroundColor: emotionInfo.badgeBg }">
        <text class="emotion-text" :style="{ color: emotionInfo.badgeColor }">
          {{ emotionInfo.icon }} {{ emotionInfo.label }}
        </text>
      </view>
    </view>

    <!-- 吐槽气泡主体 -->
    <view
      class="bubble-box"
      :style="{
        borderColor: hexWithAlpha(themeColor, 0.45),
        background: `linear-gradient(135deg, ${hexWithAlpha(themeColor, 0.16)} 0%, rgba(15, 23, 42, 0.78) 100%)`,
        boxShadow: `0 8px 24px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.1)`
      }"
    >
      <view class="bubble-header">
        <text class="ai-name" :style="{ color: themeColor }">{{ persona.name }}</text>
        <view class="meta-badges">
          <view v-if="bubble.isLocalFallback" class="fallback-badge local">
            <text class="fallback-text">本地兜底</text>
          </view>
          <view v-else-if="bubble.isFallback" class="fallback-badge server">
            <text class="fallback-text">保底应手</text>
          </view>
          <view v-else-if="bubble.modelName" class="model-badge">
            <text class="model-text">{{ bubble.modelName }}</text>
          </view>
        </view>
      </view>

      <view v-if="isThinking" class="thinking-row">
        <view class="dot dot-1" :style="{ backgroundColor: themeColor }" />
        <view class="dot dot-2" :style="{ backgroundColor: themeColor }" />
        <view class="dot dot-3" :style="{ backgroundColor: themeColor }" />
        <text class="thinking-label">正在算棋并组织语言…</text>
      </view>

      <text v-else class="comment-text">{{ displayedText }}</text>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { EMOTION_META } from '../config/constants.js'
import { hexWithAlpha } from '../utils/color.js'

const props = defineProps({
  persona: {
    type: Object,
    required: true
  },
  bubble: {
    type: Object,
    required: true
  },
  isThinking: {
    type: Boolean,
    default: false
  }
})

const displayedText = ref(props.bubble && props.bubble.comment ? props.bubble.comment : '')
let typingTimer = null

const themeColor = computed(() =>
  props.persona && props.persona.theme_color ? props.persona.theme_color : '#2563EB'
)

const emotionInfo = computed(() => {
  const key = props.bubble && props.bubble.emotion ? props.bubble.emotion : 'neutral'
  return EMOTION_META[key] || EMOTION_META.neutral
})

function clearTyping() {
  if (typingTimer) {
    clearInterval(typingTimer)
    typingTimer = null
  }
}

watch(
  () => (props.bubble ? props.bubble.comment : ''),
  (newText) => {
    clearTyping()
    const target = String(newText || '')
    if (!target) {
      displayedText.value = ''
      return
    }
    let idx = 0
    displayedText.value = ''
    typingTimer = setInterval(() => {
      idx += 2
      if (idx >= target.length) {
        displayedText.value = target
        clearTyping()
      } else {
        displayedText.value = target.slice(0, idx)
      }
    }, 24)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  clearTyping()
})
</script>

<style scoped>
.talk-wrapper {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
}

.avatar-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.avatar-ring {
  width: 52px;
  height: 52px;
  border-radius: 26px;
  border-width: 2.5px;
  border-style: solid;
  overflow: hidden;
  background-color: #1E293B;
  transition: border-color 0.35s ease, box-shadow 0.35s ease;
}

.avatar-ring.is-thinking {
  animation: pulseRing 1.1s infinite ease-in-out;
}

.avatar-ring.is-rage {
  animation: shakeHead 0.35s ease-in-out 2;
}

.avatar-img {
  width: 100%;
  height: 100%;
}

.avatar-monogram {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.monogram-text {
  font-size: 20px;
  font-weight: 800;
}

.emotion-pill {
  padding: 2px 7px;
  border-radius: 999px;
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.emotion-text {
  font-size: 11px;
  font-weight: 600;
}

.bubble-box {
  flex: 1;
  min-height: 62px;
  border-radius: 14px;
  border-top-left-radius: 4px;
  border-width: 1px;
  border-style: solid;
  padding: 10px 13px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: flex;
  flex-direction: column;
  justify-content: center;
  transition: border-color 0.35s ease, background 0.35s ease;
}

.bubble-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  gap: 8px;
}

.ai-name {
  font-size: 13px;
  font-weight: 700;
}

.meta-badges {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.model-badge,
.fallback-badge {
  padding: 2px 7px;
  border-radius: 6px;
  background-color: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.14);
}

.model-text {
  font-size: 11px;
  color: #94A3B8;
}

.fallback-badge.local {
  background-color: rgba(245, 158, 11, 0.2);
}

.fallback-badge.server {
  background-color: rgba(148, 163, 184, 0.22);
}

.fallback-text {
  font-size: 11px;
  color: #FCD34D;
  font-weight: 600;
}

.comment-text {
  font-size: clamp(13px, 3.4vw, 14.5px);
  line-height: 1.5;
  color: #F1F5F9;
}

.thinking-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 4px;
  opacity: 0.7;
  animation: dotBounce 1s infinite ease-in-out;
}

.dot-2 {
  animation-delay: 0.16s;
}

.dot-3 {
  animation-delay: 0.32s;
}

.thinking-label {
  margin-left: 4px;
  font-size: 13px;
  color: #94A3B8;
}

@keyframes pulseRing {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}

@keyframes shakeHead {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-5rpx); }
  75% { transform: translateX(5rpx); }
}

@keyframes dotBounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40% { transform: translateY(-6rpx); opacity: 1; }
}
</style>
