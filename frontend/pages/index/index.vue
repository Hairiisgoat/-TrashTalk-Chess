<template>
  <view class="page-root">
    <!-- 角色主题色动态环境光晕 -->
    <view class="ambient-layer">
      <view
        class="ambient-glow ambient-hero"
        :style="{
          background: `radial-gradient(circle at 50% 15%, ${hexWithAlpha(activeThemeColor, 0.25)} 0%, ${hexWithAlpha(activeThemeColor, 0.06)} 48%, transparent 75%)`
        }"
      />
    </view>

    <view class="page-container">
      <!-- 顶部品牌与联机状态 -->
    <view class="hero-header">
      <view class="brand-row">
        <view>
          <text class="brand-title">棋逢嘴手</text>
          <text class="brand-sub">TRASHTALK CHESS · 端云协同拟人博弈</text>
        </view>
        <view class="header-actions">
          <view
            class="settings-entry-btn"
            :class="{ 'is-custom': settingsStore.isCustomApiActive.value }"
            @tap="settingsModalOpen = true"
          >
            <text class="settings-entry-icon">⚙️</text>
            <text class="settings-entry-text">API 与模型设置</text>
          </view>
          <view class="status-pill" :class="personaStore.state.backendOnline ? 'is-online' : 'is-offline'">
            <view class="status-dot" />
            <text class="status-text">
              {{ personaStore.state.backendOnline ? '云端大模型在线' : '离线本地引擎' }}
            </text>
          </view>
        </view>
      </view>
    </view>

    <!-- 1. 棋种切换 -->
    <view class="section-block">
      <view class="section-head">
        <text class="section-title">选择棋种</text>
        <text class="section-hint">本地 Alpha-Beta 实时算步</text>
      </view>
      <view class="game-grid">
        <view
          v-for="item in GAME_TYPE_LIST"
          :key="item.id"
          class="game-card"
          :class="{ 'is-active': selectedGameType === item.id }"
          :style="selectedGameType === item.id ? { borderColor: activeThemeColor } : {}"
          @tap="onSelectGameType(item.id)"
        >
          <view class="game-card-top">
            <text class="game-icon">{{ item.id === 'xiangqi' ? '將' : '♚' }}</text>
            <view class="game-badge">
              <text class="game-badge-text">{{ item.badge }}</text>
            </view>
          </view>
          <text class="game-name">{{ item.name }}</text>
          <text class="game-sub">{{ item.subtitle }}</text>
        </view>
      </view>
    </view>

    <!-- 2. 难度选择 -->
    <view class="section-block">
      <view class="section-head">
        <text class="section-title">思考强度</text>
        <text class="section-hint">决定搜索深度与嘴炮烈度</text>
      </view>
      <view class="diff-row">
        <view
          v-for="diff in DIFFICULTIES"
          :key="diff.id"
          class="diff-pill"
          :class="{ 'is-active': selectedDifficulty === diff.id }"
          :style="
            selectedDifficulty === diff.id
              ? { borderColor: diff.tagColor, backgroundColor: 'rgba(30, 41, 59, 0.95)' }
              : {}
          "
          @tap="selectedDifficulty = diff.id"
        >
          <text
            class="diff-name"
            :style="selectedDifficulty === diff.id ? { color: diff.tagColor } : {}"
          >
            {{ diff.label }}
          </text>
          <text class="diff-code">{{ diff.id }}</text>
        </view>
      </view>
      <text class="diff-desc">{{ activeDifficultyDesc }}</text>
    </view>

    <!-- 3. 角色卡片选择 -->
    <view class="section-block">
      <view class="section-head">
        <text class="section-title">选择对手人格</text>
        <text class="section-hint">不同模型与毒舌风格</text>
      </view>
      <PersonaSelector
        :personas="personaStore.state.personas"
        :selected-id="personaStore.state.selectedPersonaId"
        :game-type="selectedGameType"
        @select="onSelectPersona"
      />
    </view>

    <!-- 底部开始按钮占位与固定栏 -->
    <view class="bottom-spacer" />
    </view>

    <view class="cta-bar">
      <view class="cta-inner">
        <button
          class="cta-btn"
          :style="{
            backgroundColor: activeThemeColor,
            boxShadow: `0 8px 24px ${hexWithAlpha(activeThemeColor, 0.42)}, inset 0 1px 0 rgba(255, 255, 255, 0.24)`
          }"
          @tap="startMatch"
        >
          与「{{ currentPersonaName }}」开局交锋
        </button>
      </view>
    </view>

    <SettingsWorkshopModal
      :visible="settingsModalOpen"
      @close="settingsModalOpen = false"
      @saved="onSettingsSaved"
    />
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { GAME_TYPE_LIST, DIFFICULTIES } from '../../config/constants.js'
import { usePersonaStore } from '../../stores/persona.js'
import { useGameStore } from '../../stores/game.js'
import { useSettingsStore } from '../../stores/settings.js'
import { hexWithAlpha } from '../../utils/color.js'
import PersonaSelector from '../../components/PersonaSelector.vue'
import SettingsWorkshopModal from '../../components/SettingsWorkshopModal.vue'

const personaStore = usePersonaStore()
const gameStore = useGameStore()
const settingsStore = useSettingsStore()

const settingsModalOpen = ref(false)
const selectedGameType = ref(gameStore.state.gameType)
const selectedDifficulty = ref(gameStore.state.difficulty)
const currentPersona = personaStore.currentPersona
let initialLoaded = false

const activeThemeColor = computed(() => personaStore.themeColor.value)
const currentPersonaName = computed(() =>
  currentPersona.value && currentPersona.value.name ? currentPersona.value.name : 'AI 对手'
)

const activeDifficultyDesc = computed(() => {
  const found = DIFFICULTIES.find((d) => d.id === selectedDifficulty.value)
  return found ? found.desc : ''
})

function safeLoadPersonas(gameType) {
  try {
    const req = personaStore.loadPersonas(gameType)
    if (req && typeof req.catch === 'function') {
      req.catch((err) => {
        console.warn('[index] loadPersonas failed:', err)
      })
    }
  } catch (err) {
    console.warn('[index] loadPersonas sync error:', err)
  }
}

onLoad(() => {
  initialLoaded = true
  safeLoadPersonas(selectedGameType.value)
})

onShow(() => {
  if (initialLoaded) {
    initialLoaded = false
    return
  }
  safeLoadPersonas(selectedGameType.value)
})

function onSelectGameType(gameType) {
  selectedGameType.value = gameType
  safeLoadPersonas(gameType)
}

function onSelectPersona(personaId) {
  personaStore.selectPersona(personaId)
}

function onSettingsSaved() {
  safeLoadPersonas(selectedGameType.value)
}

function startMatch() {
  const persona = personaStore.currentPersona.value
  gameStore.startNewGame({
    gameType: selectedGameType.value,
    difficulty: selectedDifficulty.value,
    greeting: persona.greeting
  })
  uni.navigateTo({
    url: '/pages/battle/battle'
  })
}
</script>

<style scoped>
.page-root {
  position: relative;
  min-height: 100vh;
  padding: 20px 16px 32px;
  background: linear-gradient(180deg, #0B1120 0%, #0F172A 55%, #090E1A 100%);
  overflow-x: hidden;
}

.ambient-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.ambient-glow {
  position: absolute;
  left: 50%;
  top: -10vh;
  transform: translateX(-50%);
  width: min(120vw, 900px);
  height: 62vh;
  transition: background 0.55s ease;
}

.page-container {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 600px;
  margin: 0 auto;
}

.hero-header {
  margin-bottom: 30rpx;
}

.brand-row {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16rpx;
}

.brand-title {
  display: block;
  font-size: 46rpx;
  font-weight: 800;
  color: #F8FAFC;
  letter-spacing: 2rpx;
}

.brand-sub {
  display: block;
  margin-top: 6rpx;
  font-size: 20rpx;
  color: #64748B;
  letter-spacing: 1rpx;
}

.header-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.settings-entry-btn {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 999px;
  background-color: rgba(30, 41, 59, 0.82);
  border: 1px solid rgba(148, 163, 184, 0.28);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  cursor: pointer;
}

.settings-entry-btn.is-custom {
  border-color: rgba(96, 165, 250, 0.6);
  background-color: rgba(37, 99, 235, 0.22);
}

.settings-entry-icon {
  font-size: 12px;
}

.settings-entry-text {
  font-size: 12px;
  font-weight: 700;
  color: #E2E8F0;
}

.status-pill {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  background-color: rgba(30, 41, 59, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.22);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.status-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 7rpx;
}

.status-pill.is-online .status-dot {
  background-color: #10B981;
  box-shadow: 0 0 10rpx #10B981;
}

.status-pill.is-offline .status-dot {
  background-color: #F59E0B;
}

.status-text {
  font-size: 21rpx;
  color: #CBD5E1;
  font-weight: 600;
}

.section-block {
  margin-bottom: 32rpx;
}

.section-head {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 16rpx;
}

.section-title {
  font-size: 30rpx;
  font-weight: 700;
  color: #F1F5F9;
}

.section-hint {
  font-size: 22rpx;
  color: #64748B;
}

.game-grid {
  display: flex;
  flex-direction: row;
  gap: 20rpx;
}

.game-card {
  flex: 1;
  padding: 14px;
  border-radius: 16px;
  background-color: rgba(30, 41, 59, 0.62);
  border: 1.5px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: border-color 0.25s ease, background-color 0.25s ease, transform 0.15s ease;
  cursor: pointer;
}

.game-card.is-active {
  background-color: rgba(30, 41, 59, 0.88);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

.game-card-top {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.game-icon {
  font-size: 42rpx;
  font-weight: 800;
  color: #F8FAFC;
}

.game-badge {
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
  background-color: rgba(15, 23, 42, 0.6);
}

.game-badge-text {
  font-size: 19rpx;
  color: #94A3B8;
}

.game-name {
  font-size: 30rpx;
  font-weight: 700;
  color: #F8FAFC;
  margin-top: 4rpx;
}

.game-sub {
  font-size: 21rpx;
  color: #94A3B8;
}

.diff-row {
  display: flex;
  flex-direction: row;
  gap: 16rpx;
}

.diff-pill {
  flex: 1;
  padding: 11px 8px;
  border-radius: 12px;
  border: 1.5px solid rgba(148, 163, 184, 0.16);
  background-color: rgba(30, 41, 59, 0.56);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  transition: border-color 0.2s ease, background-color 0.2s ease;
  cursor: pointer;
}

.diff-name {
  font-size: 26rpx;
  font-weight: 700;
  color: #E2E8F0;
}

.diff-code {
  font-size: 19rpx;
  color: #64748B;
  text-transform: uppercase;
}

.diff-desc {
  display: block;
  margin-top: 12rpx;
  font-size: 22rpx;
  color: #94A3B8;
}

.bottom-spacer {
  height: 130rpx;
}

.cta-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 14px 16px 18px;
  padding-bottom: calc(18px + env(safe-area-inset-bottom));
  background: linear-gradient(180deg, rgba(15, 23, 42, 0), rgba(11, 17, 32, 0.94) 36%);
  z-index: 20;
}

.cta-inner {
  width: 100%;
  max-width: 600px;
  margin: 0 auto;
}

.cta-btn {
  width: 100%;
  height: 48px;
  line-height: 48px;
  border-radius: 24px;
  font-size: 16px;
  font-weight: 700;
  color: #FFFFFF;
  border: none;
  transition: background-color 0.35s ease, box-shadow 0.35s ease, transform 0.12s ease;
  cursor: pointer;
}

.cta-btn::after {
  border: none;
}

.cta-btn:active {
  transform: scale(0.985);
}
</style>
