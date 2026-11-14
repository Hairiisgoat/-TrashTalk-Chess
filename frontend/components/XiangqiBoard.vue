<template>
  <view
    class="xq-board-outer"
    :style="{
      boxShadow: `0 18px 46px rgba(0, 0, 0, 0.62), 0 0 38px ${hexWithAlpha(themeColor, 0.22)}, inset 0 1px 0 rgba(253, 230, 186, 0.28)`
    }"
  >
    <view class="xq-board">
      <!-- 棋盘底线层（百分比自适应 9×10 网格） -->
      <view class="xq-lines">
        <!-- 10 条横线 -->
        <view
          v-for="r in 10"
          :key="`h-${r}`"
          class="h-line"
          :style="{ top: `${(r - 0.5) * 10}%` }"
        />

        <!-- 左右边线贯通全盘 -->
        <view class="v-line-full" style="left: 5.5556%;" />
        <view class="v-line-full" style="left: 94.4444%;" />

        <!-- 中间 7 条竖线分上下半区（留出楚河汉界） -->
        <view
          v-for="c in 7"
          :key="`vt-${c}`"
          class="v-line-half top"
          :style="{ left: `${((c + 0.5) / 9) * 100}%` }"
        />
        <view
          v-for="c in 7"
          :key="`vb-${c}`"
          class="v-line-half bottom"
          :style="{ left: `${((c + 0.5) / 9) * 100}%` }"
        />

        <!-- 楚河汉界 -->
        <view class="river-bar">
          <text class="river-text">楚 河</text>
          <text class="river-text">汉 界</text>
        </view>

        <!-- 黑方九宫格斜线 -->
        <view class="palace-box top">
          <view class="palace-diag diag-1" />
          <view class="palace-diag diag-2" />
        </view>

        <!-- 红方九宫格斜线 -->
        <view class="palace-box bottom">
          <view class="palace-diag diag-1" />
          <view class="palace-diag diag-2" />
        </view>
      </view>

      <!-- 10×9 交叉点交互网格 -->
      <view class="xq-grid">
        <view v-for="(row, r) in board" :key="`row-${r}`" class="xq-row">
          <view
            v-for="(piece, c) in row"
            :key="`cell-${r}-${c}`"
            class="xq-cell"
            @tap="onCellTap(r, c, piece)"
          >
            <!-- 上一步起点：半透明虚线框 + 残影点 -->
            <view
              v-if="isLastMoveFrom(r, c)"
              class="last-from-marker"
            >
              <view v-if="!piece" class="last-from-ghost" />
            </view>

            <!-- 上一步终点：脉冲光圈 + 四角角标 -->
            <view
              v-if="isLastMoveTo(r, c)"
              class="last-to-marker"
              :style="{ '--accent': moveAccentColor }"
            >
              <view class="corner corner-tl" />
              <view class="corner corner-tr" />
              <view class="corner corner-bl" />
              <view class="corner corner-br" />
            </view>

            <!-- 合法落子提示（空位） -->
            <view
              v-if="!piece && isLegalTarget(r, c)"
              class="legal-dot"
            />

            <!-- 棋子 -->
            <view
              v-if="piece"
              :key="isLastMoveTo(r, c) ? `land-${lastMoveKey}-${r}-${c}` : `p-${r}-${c}`"
              class="xq-piece"
              :class="[
                isRed(piece) ? 'is-red' : 'is-black',
                isSelected(r, c) ? 'is-selected' : '',
                isLegalTarget(r, c) ? 'is-capturable' : '',
                isCheckedKing(piece) ? 'is-checked' : '',
                isLastMoveTo(r, c) ? 'is-just-landed' : ''
              ]"
            >
              <view class="piece-inner">
                <text class="piece-char">{{ getLabel(piece) }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { isRedPiece } from '../engine/xiangqi/board.js'
import { getPieceDisplayLabel } from '../engine/xiangqi/uci.js'
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

const selected = ref(null)

// 棋局变动时清空选中态
watch(
  () => props.board,
  () => {
    selected.value = null
  }
)

const legalTargetsFromSelected = computed(() => {
  if (!selected.value) return new Map()
  const map = new Map()
  for (const m of props.legalMoves) {
    if (m.fromR === selected.value.r && m.fromC === selected.value.c) {
      map.set(`${m.toR},${m.toC}`, m)
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
  return '#38BDF8'
})

function isRed(piece) {
  return isRedPiece(piece)
}

function getLabel(piece) {
  return getPieceDisplayLabel(piece)
}

function isSelected(r, c) {
  return Boolean(selected.value && selected.value.r === r && selected.value.c === c)
}

function isLegalTarget(r, c) {
  return legalTargetsFromSelected.value.has(`${r},${c}`)
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

  // 1. 若点击当前选中格的合法目标，直接落子
  const targetMove = legalTargetsFromSelected.value.get(`${r},${c}`)
  if (targetMove) {
    selected.value = null
    emit('move', targetMove.uci)
    return
  }

  // 2. 点击我方（红方）棋子 -> 选中或切换选中
  if (piece && isRedPiece(piece)) {
    if (selected.value && selected.value.r === r && selected.value.c === c) {
      selected.value = null
    } else {
      selected.value = { r, c }
    }
    return
  }

  // 3. 点击其他空白/无效敌子 -> 取消选中
  selected.value = null
}
</script>

<style scoped>
.xq-board-outer {
  --board-w: min(92vw, 55.8vh, 560px);
  padding: clamp(7px, 1.5vw, 13px);
  border-radius: 18px;
  background: linear-gradient(145deg, #9A6332 0%, #6D3F1A 52%, #4A290E 100%);
  border: 1px solid rgba(253, 224, 172, 0.3);
  transition: box-shadow 0.45s ease;
}

.xq-board {
  position: relative;
  width: var(--board-w);
  height: calc(var(--board-w) * 10 / 9);
  background:
    repeating-linear-gradient(
      90deg,
      rgba(120, 65, 20, 0.03) 0px,
      rgba(120, 65, 20, 0.03) 2px,
      transparent 2px,
      transparent 10px
    ),
    linear-gradient(165deg, #F0CFA0 0%, #E3B87D 48%, #D4A15F 100%);
  border-radius: 8px;
  border: 2px solid #5C3412;
  box-shadow: inset 0 0 0 1px rgba(255, 244, 214, 0.35), inset 0 4px 14px rgba(92, 52, 18, 0.22);
  overflow: hidden;
}

.xq-lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.h-line {
  position: absolute;
  left: 5.5556%;
  width: 88.8889%;
  height: 1.5px;
  background-color: rgba(107, 63, 26, 0.88);
  transform: translateY(-50%);
}

.v-line-full {
  position: absolute;
  top: 5%;
  width: 1.5px;
  height: 90%;
  background-color: rgba(107, 63, 26, 0.88);
  transform: translateX(-50%);
}

.v-line-half {
  position: absolute;
  width: 1.5px;
  height: 40%;
  background-color: rgba(107, 63, 26, 0.88);
  transform: translateX(-50%);
}

.v-line-half.top {
  top: 5%;
}

.v-line-half.bottom {
  top: 55%;
}

.river-bar {
  position: absolute;
  left: 5.5556%;
  top: 45%;
  width: 88.8889%;
  height: 10%;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-around;
}

.river-text {
  font-family: 'STKaiti', 'KaiTi', 'Songti SC', serif;
  font-size: clamp(15px, calc(var(--board-w) / 21), 25px);
  font-weight: 800;
  color: #8F5618;
  letter-spacing: 8px;
  text-shadow: 0 1px 0 rgba(255, 238, 192, 0.65), 0 -1px 0 rgba(68, 35, 8, 0.25);
}

@supports (-webkit-background-clip: text) {
  .river-text {
    background: linear-gradient(180deg, #FFF0BA 0%, #C88928 48%, #73420D 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    text-shadow: none;
    filter: drop-shadow(0 1px 1px rgba(66, 32, 6, 0.45));
  }
}

.palace-box {
  position: absolute;
  left: 38.8889%;
  width: 22.2222%;
  height: 20%;
  overflow: hidden;
}

.palace-box.top {
  top: 5%;
}

.palace-box.bottom {
  top: 75%;
}

.palace-diag {
  position: absolute;
  left: -20.71%;
  top: 50%;
  width: 141.42%;
  height: 1.5px;
  background-color: rgba(107, 63, 26, 0.85);
}

.palace-diag.diag-1 {
  transform: translateY(-50%) rotate(45deg);
}

.palace-diag.diag-2 {
  transform: translateY(-50%) rotate(-45deg);
}

.xq-grid {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.xq-row {
  flex: 1;
  width: 100%;
  display: flex;
  flex-direction: row;
}

.xq-cell {
  flex: 1;
  height: 100%;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  user-select: none;
}

.last-from-marker {
  position: absolute;
  width: 80%;
  height: 80%;
  border-radius: 10px;
  border: 2px dashed rgba(217, 119, 6, 0.88);
  background-color: rgba(250, 204, 21, 0.16);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.last-from-ghost {
  width: 30%;
  height: 30%;
  border-radius: 50%;
  background-color: rgba(217, 119, 6, 0.45);
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.45);
}

.last-to-marker {
  --accent: #FACC15;
  position: absolute;
  width: 92%;
  height: 92%;
  border-radius: 12px;
  border: 2px solid rgba(250, 204, 21, 0.85);
  box-shadow: 0 0 14px rgba(250, 204, 21, 0.72), inset 0 0 10px rgba(250, 204, 21, 0.25);
  pointer-events: none;
  animation: xqToPulse 1.6s ease-in-out infinite;
}

.corner {
  position: absolute;
  width: 24%;
  height: 24%;
  border-color: var(--accent);
  border-style: solid;
  border-width: 0;
}

.corner-tl {
  top: -1px;
  left: -1px;
  border-top-width: 3px;
  border-left-width: 3px;
  border-top-left-radius: 6px;
}

.corner-tr {
  top: -1px;
  right: -1px;
  border-top-width: 3px;
  border-right-width: 3px;
  border-top-right-radius: 6px;
}

.corner-bl {
  bottom: -1px;
  left: -1px;
  border-bottom-width: 3px;
  border-left-width: 3px;
  border-bottom-left-radius: 6px;
}

.corner-br {
  bottom: -1px;
  right: -1px;
  border-bottom-width: 3px;
  border-right-width: 3px;
  border-bottom-right-radius: 6px;
}

.legal-dot {
  width: 28%;
  height: 28%;
  border-radius: 50%;
  background-color: rgba(16, 185, 129, 0.88);
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.7);
  z-index: 2;
}

.xq-piece {
  width: 86%;
  height: 86%;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, #FFFDF8 0%, #F5E2C2 65%, #DFBF8B 100%);
  box-shadow:
    0 4px 10px rgba(15, 23, 42, 0.45),
    0 1px 2px rgba(15, 23, 42, 0.35),
    inset 0 2px 3px rgba(255, 255, 255, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.16s ease, box-shadow 0.16s ease;
  z-index: 3;
}

.piece-inner {
  width: 84%;
  height: 84%;
  border-radius: 50%;
  border-width: 1.5px;
  border-style: solid;
  display: flex;
  align-items: center;
  justify-content: center;
}

.xq-piece.is-red .piece-inner {
  border-color: rgba(185, 28, 28, 0.72);
}

.xq-piece.is-black .piece-inner {
  border-color: rgba(15, 23, 42, 0.72);
}

.piece-char {
  font-size: calc(var(--board-w) / 9 * 0.48);
  font-weight: 800;
  line-height: 1;
}

.xq-piece.is-red .piece-char {
  color: #B91C1C;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.7);
}

.xq-piece.is-black .piece-char {
  color: #0F172A;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.65);
}

.xq-piece.is-selected {
  transform: scale(1.1);
  box-shadow: 0 0 0 3px #10B981, 0 8px 18px rgba(0, 0, 0, 0.48);
}

.xq-piece.is-capturable {
  box-shadow: 0 0 0 3px #F59E0B, 0 4px 12px rgba(245, 158, 11, 0.55);
}

.xq-piece.is-checked {
  box-shadow: 0 0 0 3.5px #EF4444, 0 0 16px #EF4444;
}

.xq-piece.is-just-landed {
  animation: xqPieceLand 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes xqToPulse {
  0%, 100% {
    opacity: 0.96;
    transform: scale(1);
  }
  50% {
    opacity: 0.64;
    transform: scale(0.95);
  }
}

@keyframes xqPieceLand {
  0% {
    transform: scale(1.2) translateY(-4px);
  }
  100% {
    transform: scale(1) translateY(0);
  }
}
</style>
