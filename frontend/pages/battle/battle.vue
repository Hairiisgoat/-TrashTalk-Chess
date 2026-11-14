<template>
  <view
    class="battle-root"
    :class="gameState.gameType === 'xiangqi' ? 'mode-xiangqi' : 'mode-chess'"
  >
    <!-- 角色主题色动态环境光晕 -->
    <view class="ambient-layer">
      <view
        class="ambient-glow ambient-top"
        :style="{
          background: `radial-gradient(circle at 50% 18%, ${hexWithAlpha(themeColor, 0.24)} 0%, ${hexWithAlpha(themeColor, 0.06)} 46%, transparent 74%)`
        }"
      />
      <view
        class="ambient-glow ambient-board"
        :style="{
          background: `radial-gradient(circle at 50% 56%, ${hexWithAlpha(themeColor, 0.18)} 0%, ${hexWithAlpha(themeColor, 0.04)} 50%, transparent 75%)`
        }"
      />
    </view>

    <!-- 顶部局势与回合状态条 -->
    <view class="top-meta">
      <view class="meta-chips">
        <view class="meta-chip">
          <text class="chip-text">{{ gameLabel }}</text>
        </view>
        <view class="meta-chip">
          <text class="chip-text">{{ diffLabel }}</text>
        </view>
        <view class="meta-chip">
          <text class="chip-text">第 {{ moveRound }} 回合</text>
        </view>
      </view>
      <view class="top-right">
        <view
          v-if="gameState.moveHistory.length > 0 && !gameState.isAiThinking"
          class="replay-toggle-btn"
          :class="{ 'is-active': isReplayMode }"
          :style="isReplayMode ? { borderColor: themeColor, backgroundColor: hexWithAlpha(themeColor, 0.24) } : {}"
          @tap="onToggleReplay"
        >
          <text class="replay-toggle-text">{{ isReplayMode ? '退出复盘' : '🎞️ 复盘' }}</text>
        </view>
        <view class="turn-badge" :class="turnBadgeClass">
          <text class="turn-text">{{ turnStatusText }}</text>
        </view>
        <view
          class="sound-toggle"
          :class="{ 'is-muted': isMuted }"
          :style="!isMuted ? { borderColor: hexWithAlpha(themeColor, 0.45) } : {}"
          @tap="onToggleMute"
        >
          <text class="sound-icon">{{ isMuted ? '🔇' : '🔊' }}</text>
        </view>
      </view>
    </view>

    <!-- AI 头像与动态主题色吐槽气泡 -->
    <view class="bubble-section">
      <TrashTalkBubble
        :persona="currentPersona"
        :bubble="displayBubble"
        :is-thinking="gameState.isAiThinking"
      />
    </view>

    <!-- 局势评估胜率条 -->
    <view class="eval-section">
      <EvalBar
        :win-rate-for-ai="displayWinRateForAi"
        :win-rate-delta="displayWinRateDelta"
        :game-type="gameState.gameType"
        :theme-color="themeColor"
      />
    </view>

    <!-- 交互式双模式棋盘 -->
    <view class="board-section">
      <XiangqiBoard
        v-if="gameState.gameType === 'xiangqi'"
        :board="displayBoardState.board"
        :legal-moves="legalMoves"
        :last-move="displayLastMove"
        :disabled="!isPlayerTurn || isReplayMode"
        :in-check-side="displayInCheckSide"
        :theme-color="themeColor"
        @move="onPlayerMove"
      />
      <ChessBoard
        v-else
        :board="displayBoardState.board"
        :legal-moves="legalMoves"
        :last-move="displayLastMove"
        :disabled="!isPlayerTurn || isReplayMode"
        :in-check-side="displayInCheckSide"
        :theme-color="themeColor"
        @move="onPlayerMove"
      />
    </view>

    <!-- 全量棋谱记录 / 战犯步定位条 -->
    <view class="history-strip">
      <text class="history-label">{{ isReplayMode ? '全量棋谱：' : '近步记录：' }}</text>
      <scroll-view class="history-scroll" scroll-x>
        <view class="history-items">
          <text v-if="gameState.moveHistory.length === 0" class="history-empty">尚未落子，红/白方先行</text>
          <view
            v-for="item in displayHistoryItems"
            :key="`${item.step}-${item.uci}`"
            class="history-tag"
            :class="[
              item.side === 'player' ? 'is-player' : 'is-ai',
              {
                'is-blunder': item.is_blunder,
                'is-active-step': isReplayMode && gameState.replay.stepIndex === item.step
              }
            ]"
            :style="
              isReplayMode && gameState.replay.stepIndex === item.step
                ? { borderColor: themeColor }
                : {}
            "
            @tap="onSelectHistoryStep(item.step)"
          >
            <text class="history-tag-text">
              {{ item.step }}.{{ item.side === 'player' ? '我' : 'AI' }}·{{ item.notation || item.uci }}
            </text>
            <view v-if="item.is_blunder" class="blunder-badge">
              <text class="blunder-badge-text">?! 失误</text>
            </view>
          </view>
        </view>
      </scroll-view>
    </view>

    <!-- 底部控制栏：正常对局操作 vs 复盘时间轴控制条 -->
    <view v-if="!isReplayMode" class="action-bar">
      <button class="ctrl-btn undo-btn" :disabled="!canUndo" @tap="onUndo">
        悔棋 ({{ gameState.undoRemaining }}/{{ gameState.maxUndoCount }})
      </button>
      <button class="ctrl-btn" @tap="onRestart">
        重开
      </button>
      <button class="ctrl-btn warn" :disabled="gameState.gameStatus.isOver" @tap="onResign">
        认输
      </button>
      <button class="ctrl-btn ghost" @tap="onBackHome">
        换对手
      </button>
    </view>

    <view v-else class="replay-dock">
      <view class="replay-slider-row">
        <text class="replay-step-text">
          第 {{ gameState.replay.stepIndex }} / {{ gameState.moveHistory.length }} 步
        </text>
        <view v-if="currentReplayEntry && currentReplayEntry.is_blunder" class="blunder-badge large">
          <text class="blunder-badge-text">?! 失误 ({{ currentReplayEntry.win_rate_delta }}%)</text>
        </view>
        <view v-else-if="blunderSteps.length > 0" class="blunder-jump-pill" @tap="onJumpNextBlunder">
          <text class="blunder-jump-text">定位战犯步 ({{ blunderSteps.length }})</text>
        </view>
      </view>
      <slider
        class="replay-slider"
        :min="0"
        :max="Math.max(1, gameState.moveHistory.length)"
        :value="gameState.replay.stepIndex"
        :disabled="gameState.moveHistory.length === 0"
        :activeColor="themeColor"
        backgroundColor="rgba(148, 163, 184, 0.25)"
        block-size="16"
        @change="onSliderChange"
      />
      <view class="replay-btn-row">
        <button
          class="ctrl-btn replay-btn"
          :disabled="gameState.replay.stepIndex <= 1 || gameState.moveHistory.length === 0"
          @tap="onSeekFirst"
        >
          第一步
        </button>
        <button
          class="ctrl-btn replay-btn"
          :disabled="gameState.replay.stepIndex <= 0"
          @tap="onSeekPrev"
        >
          上一步
        </button>
        <button
          class="ctrl-btn replay-btn"
          :disabled="gameState.replay.stepIndex >= gameState.moveHistory.length"
          @tap="onSeekNext"
        >
          下一步
        </button>
        <button
          class="ctrl-btn replay-btn"
          :disabled="gameState.replay.stepIndex >= gameState.moveHistory.length"
          @tap="onSeekLatest"
        >
          最新一步
        </button>
        <button class="ctrl-btn ghost replay-btn" @tap="onToggleReplay">
          返回
        </button>
      </view>
    </view>

    <!-- AI 教练复盘问答面板 -->
    <view v-if="isReplayMode" class="coach-section">
      <CoachAskPanel
        :persona="currentPersona"
        :current-entry="currentReplayEntry"
      />
    </view>

    <!-- 对局结束弹窗 -->
    <view v-if="gameState.gameStatus.isOver && !isReplayMode" class="gameover-mask">
      <view class="gameover-card" :style="{ borderColor: themeColor }">
        <text class="gameover-emoji">{{ gameoverEmoji }}</text>
        <text class="gameover-title">{{ gameoverTitle }}</text>
        <text class="gameover-sub">{{ gameoverReason }}</text>
        <view class="gameover-quote">
          <text class="quote-text">“{{ gameState.bubble.comment }}”</text>
        </view>
        <view class="gameover-actions vertical">
          <button
            v-if="gameState.moveHistory.length > 0"
            class="modal-btn coach-entry"
            :style="{ borderColor: themeColor, color: themeColor }"
            @tap="onEnterReplay"
          >
            🎓 进入赛后复盘 ({{ blunderSteps.length > 0 ? `含${blunderSteps.length}处失误` : 'AI教练精讲' }})
          </button>
          <view class="gameover-actions">
            <button class="modal-btn secondary" @tap="onBackHome">返回大厅</button>
            <button
              class="modal-btn primary"
              :style="{ backgroundColor: themeColor }"
              @tap="onRestart"
            >
              再来一局
            </button>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { DIFFICULTIES, GAME_TYPE_LIST } from '../../config/constants.js'
import { usePersonaStore } from '../../stores/persona.js'
import { useGameStore } from '../../stores/game.js'
import { hexWithAlpha } from '../../utils/color.js'
import { soundManager } from '../../utils/sound.js'
import TrashTalkBubble from '../../components/TrashTalkBubble.vue'
import EvalBar from '../../components/EvalBar.vue'
import XiangqiBoard from '../../components/XiangqiBoard.vue'
import ChessBoard from '../../components/ChessBoard.vue'
import CoachAskPanel from '../../components/CoachAskPanel.vue'

const personaStore = usePersonaStore()
const gameStore = useGameStore()

const gameState = gameStore.state
const legalMoves = gameStore.legalMoves
const isPlayerTurn = gameStore.isPlayerTurn
const canUndo = gameStore.canUndo
const isReplayMode = gameStore.isReplayMode
const currentReplayEntry = gameStore.currentReplayEntry
const blunderSteps = gameStore.blunderSteps
const displayBoardState = gameStore.displayBoardState
const displayLastMove = gameStore.displayLastMove
const displayWinRateForAi = gameStore.displayWinRateForAi
const displayWinRateDelta = gameStore.displayWinRateDelta
const displayBubble = gameStore.displayBubble
const currentPersona = personaStore.currentPersona
const themeColor = personaStore.themeColor
const isMuted = ref(soundManager.isMuted())

onLoad(() => {
  // 防止直接刷新 battle 页时角色列表未初始化
  if (!personaStore.state.personas.length) {
    personaStore.loadPersonas(gameState.gameType)
  }
})

const gameLabel = computed(() => {
  const found = GAME_TYPE_LIST.find((g) => g.id === gameState.gameType)
  return found ? found.name : gameState.gameType
})

const diffLabel = computed(() => {
  const found = DIFFICULTIES.find((d) => d.id === gameState.difficulty)
  return found ? found.shortLabel : gameState.difficulty
})

const moveRound = computed(() => Math.max(1, displayBoardState.value.fullmove || 1))

const displayInCheckSide = computed(() => {
  if (isReplayMode.value) return null
  if (!gameState.gameStatus.inCheck) return null
  return gameState.boardState.turn
})

const turnStatusText = computed(() => {
  if (isReplayMode.value) {
    return `复盘 ${gameState.replay.stepIndex}/${gameState.moveHistory.length}`
  }
  if (gameState.gameStatus.isOver) return '对局已结束'
  if (gameState.isAiThinking) return 'AI 算步中…'
  if (gameState.gameStatus.inCheck) return '⚠️ 你被将军!'
  return gameState.gameType === 'xiangqi' ? '红方走子' : '白方走子'
})

const turnBadgeClass = computed(() => {
  if (isReplayMode.value) return 'is-thinking'
  if (gameState.gameStatus.isOver) return 'is-over'
  if (gameState.isAiThinking) return 'is-thinking'
  if (gameState.gameStatus.inCheck) return 'is-check'
  return 'is-player'
})

const displayHistoryItems = computed(() => {
  if (isReplayMode.value) return gameState.moveHistory
  return gameState.moveHistory.slice(-8)
})

const gameoverEmoji = computed(() => {
  const w = gameState.gameStatus.winner
  if (w === 'w') return '🏆'
  if (w === 'b') return '😈'
  return '🤝'
})

const gameoverTitle = computed(() => {
  const w = gameState.gameStatus.winner
  if (w === 'w') return '漂亮！你赢下了这盘棋'
  if (w === 'b') return `${currentPersona.value.name} 获胜`
  return '双方握手言和'
})

const gameoverReason = computed(() => {
  const res = gameState.gameStatus.result
  const map = {
    checkmate: '绝杀定局 (Checkmate)',
    stalemate: gameState.gameType === 'xiangqi' ? '无子可走 · 困毙判负' : '无子可走 · 逼和 (Stalemate)',
    resign: '你选择了投子认负',
    draw: '触发和棋规则'
  }
  return map[res] || '对局结束'
})

async function onPlayerMove(uci) {
  const res = gameStore.makePlayerMove(uci)
  if (!res.applied || !res.needsAiMove) return
  await gameStore.triggerAiTurn(currentPersona.value)
}

function onUndo() {
  gameStore.undoLastTurn(currentPersona.value.persona_id)
}

function onToggleMute() {
  const nextMuted = soundManager.toggleMute()
  isMuted.value = nextMuted
  if (!nextMuted) {
    soundManager.playMove()
  }
}

function onRestart() {
  gameStore.startNewGame({
    gameType: gameState.gameType,
    difficulty: gameState.difficulty,
    greeting: currentPersona.value.greeting
  })
}

function onResign() {
  uni.showModal({
    title: '确认认输？',
    content: '认输后 AI 可不会放过嘲讽你的机会哦。',
    confirmText: '确认认输',
    cancelText: '再挣扎一下',
    success: (res) => {
      if (res.confirm) {
        gameStore.resignGame()
      }
    }
  })
}

function onBackHome() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
  } else {
    uni.reLaunch({ url: '/pages/index/index' })
  }
}

function onToggleReplay() {
  if (isReplayMode.value) {
    gameStore.exitReplayMode()
  } else {
    gameStore.enterReplayMode()
  }
}

function onEnterReplay() {
  const firstBlunder = blunderSteps.value[0]
  gameStore.enterReplayMode(firstBlunder ? firstBlunder.step : gameState.moveHistory.length)
}

function onSelectHistoryStep(step) {
  if (!isReplayMode.value) {
    gameStore.enterReplayMode(step)
  } else {
    gameStore.seekReplayStep(step)
  }
}

function onSliderChange(e) {
  const val = e && e.detail ? e.detail.value : 0
  gameStore.seekReplayStep(val)
}

function onSeekFirst() {
  gameStore.seekReplayStep(gameState.moveHistory.length > 0 ? 1 : 0)
}

function onSeekPrev() {
  gameStore.seekReplayStep(gameState.replay.stepIndex - 1)
}

function onSeekNext() {
  gameStore.seekReplayStep(gameState.replay.stepIndex + 1)
}

function onSeekLatest() {
  gameStore.seekReplayStep(gameState.moveHistory.length)
}

function onJumpNextBlunder() {
  const blunders = blunderSteps.value
  if (!blunders.length) return
  const next = blunders.find((b) => b.step > gameState.replay.stepIndex) || blunders[0]
  gameStore.seekReplayStep(next.step)
}
</script>

<style scoped>
.battle-root {
  --stage-w: calc(min(92vw, 60vh, 560px) + clamp(12px, 2.8vw, 24px));
  position: relative;
  min-height: 100vh;
  box-sizing: border-box;
  padding: 12px 12px 18px;
  padding-bottom: calc(18px + env(safe-area-inset-bottom));
  background: linear-gradient(180deg, #0B1120 0%, #0F172A 55%, #090E1A 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  overflow-x: hidden;
}

.battle-root.mode-xiangqi {
  --stage-w: calc(min(92vw, 55.8vh, 560px) + clamp(12px, 2.8vw, 24px));
}

.ambient-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.ambient-glow {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: min(120vw, 900px);
  height: 60vh;
  transition: background 0.55s ease;
}

.ambient-top {
  top: -12vh;
}

.ambient-board {
  bottom: -6vh;
  height: 75vh;
}

.top-meta,
.bubble-section,
.eval-section,
.board-section,
.history-strip,
.action-bar,
.replay-dock,
.coach-section {
  position: relative;
  z-index: 1;
}

.top-meta,
.bubble-section,
.eval-section,
.history-strip,
.action-bar,
.replay-dock,
.coach-section {
  width: 100%;
  max-width: var(--stage-w);
  box-sizing: border-box;
}

.top-meta {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.meta-chips {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.meta-chip {
  padding: 4px 10px;
  border-radius: 999px;
  background-color: rgba(30, 41, 59, 0.68);
  border: 1px solid rgba(148, 163, 184, 0.18);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.chip-text {
  font-size: 12px;
  color: #CBD5E1;
  font-weight: 600;
}

.top-right {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.turn-badge {
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  flex-shrink: 0;
}

.sound-toggle {
  width: 30px;
  height: 28px;
  border-radius: 999px;
  background-color: rgba(30, 41, 59, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.24);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.2s ease, border-color 0.25s ease;
}

.sound-toggle:active {
  transform: scale(0.92);
}

.sound-toggle.is-muted {
  opacity: 0.58;
  background-color: rgba(15, 23, 42, 0.65);
}

.sound-icon {
  font-size: 13px;
  line-height: 1;
}

.turn-badge.is-player {
  background-color: rgba(16, 185, 129, 0.16);
}

.turn-badge.is-thinking {
  background-color: rgba(59, 130, 246, 0.2);
}

.turn-badge.is-check {
  background-color: rgba(239, 68, 68, 0.26);
}

.turn-badge.is-over {
  background-color: rgba(148, 163, 184, 0.2);
}

.turn-text {
  font-size: 12px;
  font-weight: 700;
  color: #F8FAFC;
}

.eval-section {
  padding: 2px 2px;
}

.board-section {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 2px 0;
}

.history-strip {
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: rgba(30, 41, 59, 0.62);
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 12px;
  padding: 8px 12px;
  gap: 8px;
}

.history-label {
  font-size: 12px;
  color: #94A3B8;
  flex-shrink: 0;
}

.history-scroll {
  flex: 1;
  white-space: nowrap;
}

.history-items {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.history-empty {
  font-size: 12px;
  color: #64748B;
}

.history-tag {
  padding: 3px 8px;
  border-radius: 6px;
  flex-shrink: 0;
}

.history-tag.is-player {
  background-color: rgba(226, 232, 240, 0.14);
}

.history-tag.is-ai {
  background-color: rgba(59, 130, 246, 0.2);
}

.history-tag-text {
  font-size: 12px;
  color: #E2E8F0;
}

.action-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  padding: 8px;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.78), rgba(15, 23, 42, 0.88));
  border: 1px solid rgba(148, 163, 184, 0.2);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.09);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.ctrl-btn {
  flex: 1;
  height: 44px;
  line-height: 44px;
  border-radius: 11px;
  background-color: rgba(51, 65, 85, 0.72);
  color: #F8FAFC;
  font-size: clamp(12px, 3.1vw, 14px);
  font-weight: 600;
  padding: 0 6px;
  margin: 0;
  border: 1px solid rgba(148, 163, 184, 0.22);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22);
  transition: transform 0.12s ease, background-color 0.15s ease, opacity 0.15s ease;
  cursor: pointer;
}

.ctrl-btn::after {
  border: none;
}

.ctrl-btn:active:not([disabled]) {
  transform: scale(0.97);
}

.ctrl-btn.undo-btn {
  flex: 1.25;
  background-color: rgba(37, 99, 235, 0.2);
  border-color: rgba(96, 165, 250, 0.35);
  color: #DBEAFE;
}

.ctrl-btn[disabled] {
  opacity: 0.38;
  background-color: rgba(15, 23, 42, 0.55);
  border-color: rgba(148, 163, 184, 0.12);
  color: #64748B;
  box-shadow: none;
  cursor: not-allowed;
}

.ctrl-btn.warn {
  background-color: rgba(239, 68, 68, 0.14);
  border-color: rgba(248, 113, 113, 0.28);
  color: #FCA5A5;
}

.ctrl-btn.ghost {
  background-color: rgba(30, 41, 59, 0.55);
  border-color: rgba(148, 163, 184, 0.16);
  color: #CBD5E1;
}

.gameover-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background-color: rgba(15, 23, 42, 0.78);
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.gameover-card {
  width: 100%;
  max-width: 360px;
  border-radius: 18px;
  border-width: 2px;
  border-style: solid;
  background-color: #1E293B;
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.55);
}

.gameover-emoji {
  font-size: 38px;
}

.gameover-title {
  font-size: 19px;
  font-weight: 800;
  color: #F8FAFC;
  text-align: center;
}

.gameover-sub {
  font-size: 13px;
  color: #94A3B8;
}

.gameover-quote {
  width: 100%;
  box-sizing: border-box;
  padding: 12px;
  border-radius: 12px;
  background-color: rgba(15, 23, 42, 0.65);
  margin: 4px 0;
}

.quote-text {
  font-size: 14px;
  color: #E2E8F0;
  line-height: 1.5;
}

.gameover-actions {
  width: 100%;
  display: flex;
  flex-direction: row;
  gap: 10px;
  margin-top: 4px;
}

.gameover-actions.vertical {
  flex-direction: column;
  gap: 8px;
}

.modal-btn {
  flex: 1;
  height: 44px;
  line-height: 44px;
  border-radius: 22px;
  font-size: 15px;
  font-weight: 700;
}

.modal-btn::after {
  border: none;
}

.modal-btn.secondary {
  background-color: #334155;
  color: #E2E8F0;
}

.modal-btn.primary {
  color: #FFFFFF;
}

.modal-btn.coach-entry {
  width: 100%;
  flex: none;
  background-color: rgba(15, 23, 42, 0.85);
  border-width: 1.5px;
  border-style: solid;
  font-size: 14px;
}

.replay-toggle-btn {
  padding: 5px 10px;
  border-radius: 999px;
  background-color: rgba(30, 41, 59, 0.78);
  border: 1px solid rgba(148, 163, 184, 0.28);
  cursor: pointer;
}

.replay-toggle-text {
  font-size: 12px;
  font-weight: 700;
  color: #E2E8F0;
}

.history-tag {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  border: 1px solid transparent;
  cursor: pointer;
}

.history-tag.is-blunder {
  background-color: rgba(239, 68, 68, 0.2);
  border-color: rgba(248, 113, 113, 0.45);
}

.history-tag.is-active-step {
  border-width: 1.5px;
  box-shadow: 0 0 10px rgba(96, 165, 250, 0.3);
}

.blunder-badge {
  padding: 1px 5px;
  border-radius: 4px;
  background-color: #EF4444;
}

.blunder-badge.large {
  padding: 2px 8px;
  border-radius: 999px;
}

.blunder-badge-text {
  font-size: 10px;
  font-weight: 800;
  color: #FFFFFF;
}

.replay-dock {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.84), rgba(15, 23, 42, 0.92));
  border: 1px solid rgba(148, 163, 184, 0.22);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.replay-slider-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.replay-step-text {
  font-size: 12px;
  font-weight: 700;
  color: #E2E8F0;
}

.blunder-jump-pill {
  padding: 3px 9px;
  border-radius: 999px;
  background-color: rgba(239, 68, 68, 0.18);
  border: 1px solid rgba(248, 113, 113, 0.45);
  cursor: pointer;
}

.blunder-jump-text {
  font-size: 11px;
  font-weight: 700;
  color: #FCA5A5;
}

.replay-slider {
  margin: 2px 4px;
}

.replay-btn-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.ctrl-btn.replay-btn {
  height: 38px;
  line-height: 38px;
  font-size: 12px;
  padding: 0 4px;
}
</style>
