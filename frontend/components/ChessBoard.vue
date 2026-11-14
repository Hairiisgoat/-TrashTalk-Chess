<template>
  <view
    class="chess-board-outer"
    :style="{
      boxShadow: `0 18px 46px rgba(0, 0, 0, 0.62), 0 0 38px ${hexWithAlpha(themeColor, 0.22)}, inset 0 1px 0 rgba(255, 245, 228, 0.16)`
    }"
  >
    <view class="chess-board">
      <view v-for="(row, r) in board" :key="`r-${r}`" class="chess-row">
        <view
          v-for="(piece, c) in row"
          :key="`c-${r}-${c}`"
          class="chess-cell"
          :class="[
            (r + c) % 2 === 0 ? 'is-light' : 'is-dark',
            isSelected(r, c) ? 'is-selected' : '',
            isLastMoveFrom(r, c) ? 'is-last-from' : '',
            isLastMoveTo(r, c) ? 'is-last-to' : '',
            isCheckedKing(piece) ? 'is-checked' : ''
          ]"
          @tap="onCellTap(r, c, piece)"
        >
          <!-- 左列行号 / 底行字母坐标 -->
          <text v-if="c === 0" class="coord-rank" :class="(r + c) % 2 === 0 ? 'on-light' : 'on-dark'">
            {{ 8 - r }}
          </text>
          <text v-if="r === 7" class="coord-file" :class="(r + c) % 2 === 0 ? 'on-light' : 'on-dark'">
            {{ files[c] }}
          </text>

          <!-- 上一步起点：半透明虚线框 + 残影点 -->
          <view v-if="isLastMoveFrom(r, c)" class="last-from-frame">
            <view v-if="!piece" class="last-from-ghost" />
          </view>

          <!-- 上一步终点：脉冲光圈 + 四角角标 -->
          <view v-if="isLastMoveTo(r, c)" class="last-to-halo" :style="{ '--accent': moveAccentColor }">
            <view class="corner corner-tl" />
            <view class="corner corner-tr" />
            <view class="corner corner-bl" />
            <view class="corner corner-br" />
          </view>

          <!-- 可落子圆点（空格） -->
          <view v-if="!piece && isLegalTarget(r, c)" class="legal-dot" />

          <!-- 可吃子角环 -->
          <view v-if="piece && isLegalTarget(r, c)" class="capture-ring" />

          <!-- 棋子图标 -->
          <text
            v-if="piece"
            :key="isLastMoveTo(r, c) ? `land-${lastMoveKey}-${r}-${c}` : `p-${r}-${c}`"
            class="chess-piece"
            :class="[
              isWhite(piece) ? 'piece-white' : 'piece-black',
              isSelected(r, c) ? 'piece-selected' : '',
              isLastMoveTo(r, c) ? 'is-just-landed' : ''
            ]"
          >
            {{ getGlyph(piece) }}
          </text>
        </view>
      </view>
    </view>

    <!-- 兵升变选择弹窗 -->
    <view v-if="pendingPromoMoves.length > 0" class="promo-mask" @tap="cancelPromo">
      <view class="promo-dialog" @tap.stop>
        <text class="promo-title">选择升变棋子</text>
        <view class="promo-options">
          <view
            v-for="pm in pendingPromoMoves"
            :key="pm.uci"
            class="promo-btn"
            :style="{ borderColor: themeColor }"
            @tap="confirmPromo(pm)"
          >
            <text class="promo-glyph">{{ getGlyph(pm.promotion.toUpperCase()) }}</text>
            <text class="promo-name">{{ promoLabel(pm.promotion) }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { isWhitePiece } from '../engine/chess/board.js'
import { hexWithAlpha } from '../utils/color.js'

const props = defineProps({
  board: {
    type: Array,
    required: true
  },
  legalMoves: {
    type: Array,
    default: () => []
  },
  lastMove: {
    type: Object,
    default: null
  },
  disabled: {
    type: Boolean,
    default: false
  },
  inCheckSide: {
    type: String,
    default: null
  },
  themeColor: {
    type: String,
    default: '#2563EB'
  }
})

const emit = defineEmits(['move'])

const files = 'abcdefgh'
const GLYPHS = {
  K: '♔',
  Q: '♕',
  R: '♖',
  B: '♗',
  N: '♘',
  P: '♙',
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟'
}

const selected = ref(null)
const pendingPromoMoves = ref([])

watch(
  () => props.board,
  () => {
    selected.value = null
    pendingPromoMoves.value = []
  }
)

const legalTargetGroups = computed(() => {
  const map = new Map()
  if (!selected.value) return map
  for (const m of props.legalMoves) {
    if (m.fromR === selected.value.r && m.fromC === selected.value.c) {
      const key = `${m.toR},${m.toC}`
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(m)
    }
  }
  return map
})

const fromCoord = computed(() => {
  if (!props.lastMove) return null
  if (props.lastMove.from && props.lastMove.from.r !== undefined) {
    return props.lastMove.from
  }
  if (props.lastMove.fromR !== undefined) {
    return { r: props.lastMove.fromR, c: props.lastMove.fromC }
  }
  return null
})

const toCoord = computed(() => {
  if (!props.lastMove) return null
  if (props.lastMove.to && props.lastMove.to.r !== undefined) {
    return props.lastMove.to
  }
  if (props.lastMove.toR !== undefined) {
    return { r: props.lastMove.toR, c: props.lastMove.toC }
  }
  return null
})

const lastMoveKey = computed(() => {
  if (!props.lastMove) return 'none'
  const t = toCoord.value
  return `${props.lastMove.uci || ''}-${t ? `${t.r}_${t.c}` : ''}`
})

const moveAccentColor = computed(() => {
  if (props.lastMove && props.lastMove.side === 'ai') {
    return '#FACC15'
  }
  return '#FDE047'
})

function isWhite(piece) {
  return isWhitePiece(piece)
}

function getGlyph(piece) {
  return GLYPHS[piece] || ''
}

function promoLabel(code) {
  const map = { q: '后', r: '车', b: '象', n: '马' }
  return map[code] || code
}

function isSelected(r, c) {
  return Boolean(selected.value && selected.value.r === r && selected.value.c === c)
}

function isLegalTarget(r, c) {
  return legalTargetGroups.value.has(`${r},${c}`)
}

function isLastMoveFrom(r, c) {
  const f = fromCoord.value
  return Boolean(f && f.r === r && f.c === c)
}

function isLastMoveTo(r, c) {
  const t = toCoord.value
  return Boolean(t && t.r === r && t.c === c)
}

function isCheckedKing(piece) {
  if (!props.inCheckSide) return false
  if (props.inCheckSide === 'w' && piece === 'K') return true
  if (props.inCheckSide === 'b' && piece === 'k') return true
  return false
}

function onCellTap(r, c, piece) {
  if (props.disabled) return

  const matchingMoves = legalTargetGroups.value.get(`${r},${c}`)
  if (matchingMoves && matchingMoves.length > 0) {
    if (matchingMoves.length === 1) {
      selected.value = null
      emit('move', matchingMoves[0].uci)
    } else {
      pendingPromoMoves.value = matchingMoves
    }
    return
  }

  if (piece && isWhitePiece(piece)) {
    if (selected.value && selected.value.r === r && selected.value.c === c) {
      selected.value = null
    } else {
      selected.value = { r, c }
    }
    return
  }

  selected.value = null
}

function confirmPromo(move) {
  pendingPromoMoves.value = []
  selected.value = null
  emit('move', move.uci)
}

function cancelPromo() {
  pendingPromoMoves.value = []
}
</script>

<style scoped>
.chess-board-outer {
  --board-size: min(92vw, 60vh, 560px);
  position: relative;
  padding: clamp(7px, 1.5vw, 13px);
  border-radius: 18px;
  background: linear-gradient(145deg, #4A3222 0%, #2D1D13 55%, #1B110B 100%);
  border: 1px solid rgba(229, 193, 145, 0.26);
  transition: box-shadow 0.45s ease;
}

.chess-board {
  width: var(--board-size);
  height: var(--board-size);
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid #1C1008;
  box-shadow: inset 0 0 0 1px rgba(255, 245, 230, 0.12);
  display: flex;
  flex-direction: column;
}

.chess-row {
  flex: 1;
  width: 100%;
  display: flex;
  flex-direction: row;
}

.chess-cell {
  flex: 1;
  height: 100%;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  user-select: none;
}

.chess-cell.is-light {
  background: linear-gradient(135deg, #F7EFE2 0%, #ECE0CB 100%);
}

.chess-cell.is-dark {
  background: linear-gradient(135deg, #6E4730 0%, #563522 100%);
}

.chess-cell.is-last-from.is-light {
  background: linear-gradient(135deg, #F4E2A7 0%, #E7CE86 100%);
}

.chess-cell.is-last-from.is-dark {
  background: linear-gradient(135deg, #8B6135 0%, #734E28 100%);
}

.chess-cell.is-last-to.is-light {
  background: linear-gradient(135deg, #F9E595 0%, #EED06B 100%);
}

.chess-cell.is-last-to.is-dark {
  background: linear-gradient(135deg, #9C7233 0%, #835C23 100%);
}

.chess-cell.is-selected {
  background-color: #6EE7B7 !important;
}

.chess-cell.is-checked {
  background-color: #FCA5A5 !important;
}

.last-from-frame {
  position: absolute;
  inset: 7%;
  border: 2px dashed rgba(250, 204, 21, 0.85);
  border-radius: 6px;
  background-color: rgba(250, 204, 21, 0.14);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 1;
}

.last-from-ghost {
  width: 26%;
  height: 26%;
  border-radius: 50%;
  background-color: rgba(250, 204, 21, 0.45);
  box-shadow: 0 0 8px rgba(250, 204, 21, 0.45);
}

.last-to-halo {
  --accent: #FACC15;
  position: absolute;
  inset: 4%;
  border-radius: 8px;
  border: 2px solid rgba(250, 204, 21, 0.88);
  box-shadow: 0 0 12px rgba(250, 204, 21, 0.65), inset 0 0 8px rgba(250, 204, 21, 0.25);
  pointer-events: none;
  z-index: 1;
  animation: toPulse 1.6s ease-in-out infinite;
}

.corner {
  position: absolute;
  width: 22%;
  height: 22%;
  border-color: var(--accent);
  border-style: solid;
  border-width: 0;
}

.corner-tl {
  top: -1px;
  left: -1px;
  border-top-width: 3px;
  border-left-width: 3px;
  border-top-left-radius: 4px;
}

.corner-tr {
  top: -1px;
  right: -1px;
  border-top-width: 3px;
  border-right-width: 3px;
  border-top-right-radius: 4px;
}

.corner-bl {
  bottom: -1px;
  left: -1px;
  border-bottom-width: 3px;
  border-left-width: 3px;
  border-bottom-left-radius: 4px;
}

.corner-br {
  bottom: -1px;
  right: -1px;
  border-bottom-width: 3px;
  border-right-width: 3px;
  border-bottom-right-radius: 4px;
}

.coord-rank {
  position: absolute;
  top: 2px;
  left: 4px;
  font-size: clamp(9px, calc(var(--board-size) / 44), 13px);
  font-weight: 700;
  z-index: 2;
  pointer-events: none;
}

.coord-file {
  position: absolute;
  bottom: 2px;
  right: 4px;
  font-size: clamp(9px, calc(var(--board-size) / 44), 13px);
  font-weight: 700;
  z-index: 2;
  pointer-events: none;
}

.on-light {
  color: rgba(86, 53, 34, 0.78);
}

.on-dark {
  color: rgba(247, 239, 226, 0.84);
}

.legal-dot {
  width: 28%;
  height: 28%;
  border-radius: 50%;
  background-color: rgba(16, 185, 129, 0.82);
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.55);
  z-index: 2;
}

.capture-ring {
  position: absolute;
  width: 84%;
  height: 84%;
  border-radius: 50%;
  border: max(3px, calc(var(--board-size) / 100)) solid rgba(16, 185, 129, 0.88);
  z-index: 2;
}

.chess-piece {
  font-size: calc(var(--board-size) / 8 * 0.75);
  line-height: 1;
  z-index: 3;
  transition: transform 0.16s ease;
}

.piece-white {
  color: #FFFDF8;
  text-shadow:
    0 2px 6px rgba(20, 12, 6, 0.92),
    0 0 2px rgba(20, 12, 6, 0.96);
}

.piece-black {
  color: #111620;
  text-shadow:
    0 1px 3px rgba(255, 248, 232, 0.52),
    0 2px 5px rgba(0, 0, 0, 0.65);
}

.piece-selected {
  transform: scale(1.1);
}

.is-just-landed {
  animation: pieceLand 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes toPulse {
  0%, 100% {
    opacity: 0.95;
    transform: scale(1);
  }
  50% {
    opacity: 0.62;
    transform: scale(0.96);
  }
}

@keyframes pieceLand {
  0% {
    transform: scale(1.22) translateY(-4px);
  }
  100% {
    transform: scale(1) translateY(0);
  }
}

.promo-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background-color: rgba(15, 23, 42, 0.72);
  z-index: 99;
  display: flex;
  align-items: center;
  justify-content: center;
}

.promo-dialog {
  width: min(86vw, 340px);
  padding: 20px;
  border-radius: 18px;
  background-color: #1E293B;
  border: 1px solid rgba(148, 163, 184, 0.28);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.promo-title {
  font-size: 17px;
  font-weight: 700;
  color: #F8FAFC;
}

.promo-options {
  display: flex;
  flex-direction: row;
  gap: 10px;
}

.promo-btn {
  width: 62px;
  height: 74px;
  border-radius: 12px;
  border-width: 2px;
  border-style: solid;
  background-color: #0F172A;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.promo-glyph {
  font-size: 28px;
  color: #FFFFFF;
}

.promo-name {
  font-size: 12px;
  color: #CBD5E1;
}
</style>
