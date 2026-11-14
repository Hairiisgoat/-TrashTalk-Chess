<template>
  <view class="persona-list">
    <view
      v-for="item in filteredPersonas"
      :key="item.persona_id"
      class="persona-card"
      :class="{ 'is-selected': item.persona_id === selectedId }"
      :style="cardStyle(item)"
      @tap="onSelect(item)"
    >
      <view class="card-top">
        <view
          class="avatar-wrap"
          :style="{
            borderColor: item.theme_color,
            backgroundColor: !item.avatar_url ? hexWithAlpha(item.theme_color, 0.22) : '#0F172A'
          }"
        >
          <image v-if="item.avatar_url" class="avatar-img" :src="item.avatar_url" mode="aspectFill" />
          <view v-else class="avatar-monogram">
            <text class="monogram-text" :style="{ color: item.theme_color }">
              {{ (item.name || 'AI').slice(0, 1) }}
            </text>
          </view>
        </view>
        <view class="card-info">
          <view class="name-row">
            <text class="persona-name">{{ item.name }}</text>
            <view
              class="provider-badge"
              :style="{
                backgroundColor: hexWithAlpha(item.theme_color, 0.16),
                color: item.theme_color,
                borderColor: hexWithAlpha(item.theme_color, 0.4)
              }"
            >
              <text class="provider-text">{{ formatProvider(item.model_provider) }}</text>
            </view>
          </view>
          <text class="persona-title">{{ item.title }}</text>
        </view>
        <view v-if="item.persona_id === selectedId" class="check-dot" :style="{ backgroundColor: item.theme_color }">
          <text class="check-icon">✓</text>
        </view>
      </view>

      <view class="tag-row">
        <view v-for="tag in item.tags" :key="tag" class="tag-chip">
          <text class="tag-text">{{ tag }}</text>
        </view>
      </view>

      <view class="greeting-preview">
        <text class="greeting-text">“{{ item.greeting }}”</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import { hexWithAlpha } from '../utils/color.js'

const props = defineProps({
  personas: {
    type: Array,
    default: () => []
  },
  selectedId: {
    type: String,
    default: ''
  },
  gameType: {
    type: String,
    default: 'xiangqi'
  }
})

const emit = defineEmits(['select'])

const filteredPersonas = computed(() => {
  return props.personas.filter((p) => {
    if (p.is_enabled === false) return false
    if (!Array.isArray(p.supported_games)) return true
    return p.supported_games.includes(props.gameType)
  })
})

function formatProvider(provider) {
  const map = {
    deepseek: 'DeepSeek',
    openai: 'GPT',
    anthropic: 'Claude'
  }
  return map[provider] || provider
}

function cardStyle(item) {
  const selected = item.persona_id === props.selectedId
  if (!selected) {
    return {
      borderColor: 'rgba(148, 163, 184, 0.16)',
      backgroundColor: 'rgba(30, 41, 59, 0.62)'
    }
  }
  return {
    borderColor: item.theme_color,
    backgroundColor: hexWithAlpha(item.theme_color, 0.14),
    boxShadow: `0 8px 24px ${hexWithAlpha(item.theme_color, 0.25)}, inset 0 1px 0 rgba(255, 255, 255, 0.12)`
  }
}

function onSelect(item) {
  emit('select', item.persona_id)
}
</script>

<style scoped>
.persona-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.persona-card {
  border-radius: 16px;
  border-width: 1.5px;
  border-style: solid;
  padding: 14px;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  transition: all 0.22s ease;
  cursor: pointer;
}

.card-top {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 20rpx;
}

.avatar-wrap {
  width: 92rpx;
  height: 92rpx;
  border-radius: 46rpx;
  border-width: 4rpx;
  border-style: solid;
  overflow: hidden;
  flex-shrink: 0;
  background-color: #0F172A;
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
  font-size: 36rpx;
  font-weight: 800;
}

.card-info {
  flex: 1;
  min-width: 0;
}

.name-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
  flex-wrap: wrap;
}

.persona-name {
  font-size: 30rpx;
  font-weight: 700;
  color: #F8FAFC;
}

.provider-badge {
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
  border-width: 1rpx;
  border-style: solid;
}

.provider-text {
  font-size: 20rpx;
  font-weight: 600;
}

.persona-title {
  display: block;
  margin-top: 6rpx;
  font-size: 24rpx;
  color: #94A3B8;
}

.check-dot {
  width: 40rpx;
  height: 40rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.check-icon {
  font-size: 22rpx;
  font-weight: 700;
  color: #FFFFFF;
}

.tag-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 10rpx;
  margin-top: 16rpx;
}

.tag-chip {
  padding: 6rpx 14rpx;
  border-radius: 10rpx;
  background-color: rgba(15, 23, 42, 0.55);
}

.tag-text {
  font-size: 21rpx;
  color: #CBD5E1;
}

.greeting-preview {
  margin-top: 14rpx;
  padding-top: 14rpx;
  border-top: 1rpx solid rgba(148, 163, 184, 0.14);
}

.greeting-text {
  font-size: 23rpx;
  color: #94A3B8;
  line-height: 1.45;
}
</style>
