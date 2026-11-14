/**
 * 对局状态管理 (Vue 3 reactive store)
 * 维护当前棋种、FEN、悔棋栈、recent_history(滑动窗口3步)、胜率曲线与回合锁
 */

import { reactive, computed } from 'vue'
import ENV_CONFIG from '../config/env.js'
import {
  DIFFICULTIES,
  GAME_TYPES,
  MAX_UNDO_COUNT,
  UNDO_TAUNT_COMMENTS,
  DEFAULT_UNDO_TAUNT
} from '../config/constants.js'
import { createHistoryItem, HISTORY_SIDE, MATE_SCORE } from '../engine/common/types.js'
import { cpToWinRate, calcWinRateDelta } from '../engine/common/evaluator.js'
import {
  getInitialFen,
  parseFen,
  getLegalMoves,
  applyUciMove,
  evaluateForSide,
  getGameStatus,
  searchTopCandidates
} from '../engine/index.js'
import { requestAiMove } from '../api/ai.js'
import { usePersonaStore } from './persona.js'
import { soundManager } from '../utils/sound.js'

function playOutcomeSound(appliedResult) {
  if (!appliedResult) return
  if (appliedResult.status && appliedResult.status.isOver) {
    soundManager.playGameOver(appliedResult.status.winner === 'w')
  } else if (appliedResult.isCheck) {
    soundManager.playCheck()
  } else if (appliedResult.isCapture) {
    soundManager.playCapture()
  } else {
    soundManager.playMove()
  }
}

function createEmptyBubble(greeting = '请落子吧，让我看看你的实力。') {
  return {
    comment: greeting,
    emotion: 'neutral',
    isFallback: false,
    isLocalFallback: false,
    modelProvider: '',
    modelName: '',
    latencyMs: 0,
    requestId: ''
  }
}

function createSafeInitialData() {
  try {
    const initialFen = getInitialFen(GAME_TYPES.XIANGQI)
    const initialBoardState = parseFen(GAME_TYPES.XIANGQI, initialFen)
    const initialStatus = getGameStatus(GAME_TYPES.XIANGQI, initialBoardState, 1)
    return {
      fen: initialFen,
      boardState: initialBoardState,
      gameStatus: initialStatus
    }
  } catch (err) {
    console.error('[gameStore] createSafeInitialData failed:', err)
    return {
      fen: '',
      boardState: {
        gameType: GAME_TYPES.XIANGQI,
        grid: [],
        turn: 'red',
        halfmoveClock: 0,
        fullmoveNumber: 1
      },
      gameStatus: {
        isGameOver: false,
        winner: null,
        reason: ''
      }
    }
  }
}

const initialData = createSafeInitialData()

const state = reactive({
  gameType: GAME_TYPES.XIANGQI,
  difficulty: 'balanced',
  fen: initialData.fen,
  boardState: initialData.boardState,
  moveLog: [],
  undoStack: [],
  maxUndoCount: MAX_UNDO_COUNT,
  undoRemaining: MAX_UNDO_COUNT,
  repetitionMap: {},
  evalCpForAi: 0,
  winRateForAi: 50.0,
  winRateDelta: 0.0,
  winRateHistory: [50.0],
  isAiThinking: false,
  gameStatus: initialData.gameStatus,
  lastMove: null,
  bubble: createEmptyBubble(),
  sessionId: 1,
  lastSearchInfo: null
})

// API_SPEC 3.1：最近 3 步滑动窗口历史（仅含接口所需字段）
const recentHistory = computed(() => state.moveLog.slice(-3))

const legalMoves = computed(() => {
  if (state.gameStatus.isOver) return []
  return getLegalMoves(state.gameType, state.boardState)
})

const currentTurn = computed(() => state.boardState.turn)
const isPlayerTurn = computed(
  () => !state.gameStatus.isOver && !state.isAiThinking && state.boardState.turn === 'w'
)
const canUndo = computed(
  () => state.undoStack.length > 0 && state.undoRemaining > 0 && !state.gameStatus.isOver
)

function setConfig({ gameType, difficulty }) {
  if (gameType && (gameType === GAME_TYPES.XIANGQI || gameType === GAME_TYPES.CHESS)) {
    state.gameType = gameType
  }
  if (difficulty && DIFFICULTIES.some((d) => d.id === difficulty)) {
    state.difficulty = difficulty
  }
}

function startNewGame({ gameType, difficulty, greeting } = {}) {
  if (gameType) state.gameType = gameType
  if (difficulty) state.difficulty = difficulty

  state.sessionId += 1
  const fen = getInitialFen(state.gameType)
  const boardState = parseFen(state.gameType, fen)
  const repKey = fen.split(' ').slice(0, 4).join(' ')
  const evalCp = evaluateForSide(state.gameType, boardState, 'b')
  const wr = cpToWinRate(evalCp)

  state.fen = fen
  state.boardState = boardState
  state.moveLog = []
  state.undoStack = []
  state.maxUndoCount = MAX_UNDO_COUNT
  state.undoRemaining = MAX_UNDO_COUNT
  state.repetitionMap = { [repKey]: 1 }
  state.evalCpForAi = evalCp
  state.winRateForAi = wr
  state.winRateDelta = 0.0
  state.winRateHistory = [wr]
  state.isAiThinking = false
  state.gameStatus = getGameStatus(state.gameType, boardState, 1)
  state.lastMove = null
  state.lastSearchInfo = null
  state.bubble = createEmptyBubble(
    greeting || '请落子吧，让我看看你今天能撑几个回合。'
  )
}

function pushUndoSnapshot() {
  state.undoStack.push({
    fen: state.fen,
    moveLogLen: state.moveLog.length,
    repetitionMap: { ...state.repetitionMap },
    evalCpForAi: state.evalCpForAi,
    winRateForAi: state.winRateForAi,
    winRateDelta: state.winRateDelta,
    winRateHistoryLen: state.winRateHistory.length,
    lastMove: state.lastMove
      ? {
          ...state.lastMove,
          from: state.lastMove.from ? { ...state.lastMove.from } : undefined,
          to: state.lastMove.to ? { ...state.lastMove.to } : undefined
        }
      : null,
    bubble: { ...state.bubble }
  })
}

function makePlayerMove(uci) {
  if (!isPlayerTurn.value) {
    return { applied: false, reason: 'not_player_turn' }
  }

  pushUndoSnapshot()

  const repMapAdapter = {
    get: (k) => state.repetitionMap[k] || 0
  }

  let appliedResult
  try {
    appliedResult = applyUciMove(state.gameType, state.boardState, uci, repMapAdapter)
  } catch (err) {
    state.undoStack.pop()
    return { applied: false, reason: err.message }
  }

  const prevEvalCp = state.evalCpForAi
  let currEvalCp = evaluateForSide(state.gameType, appliedResult.nextState, 'b')
  if (appliedResult.status.isOver) {
    if (appliedResult.status.winner === 'w') currEvalCp = -MATE_SCORE
    else if (appliedResult.status.winner === 'b') currEvalCp = MATE_SCORE
    else currEvalCp = 0
  }
  const delta = calcWinRateDelta(prevEvalCp, currEvalCp)
  const currWr = cpToWinRate(currEvalCp)

  state.fen = appliedResult.fen
  state.boardState = appliedResult.nextState
  state.repetitionMap[appliedResult.boardRepKey] =
    (state.repetitionMap[appliedResult.boardRepKey] || 0) + 1
  state.evalCpForAi = currEvalCp
  state.winRateForAi = currWr
  state.winRateDelta = delta
  state.winRateHistory.push(currWr)
  state.gameStatus = appliedResult.status
  state.lastMove = {
    from: { r: appliedResult.move.fromR, c: appliedResult.move.fromC },
    to: { r: appliedResult.move.toR, c: appliedResult.move.toC },
    fromR: appliedResult.move.fromR,
    fromC: appliedResult.move.fromC,
    toR: appliedResult.move.toR,
    toC: appliedResult.move.toC,
    side: 'player',
    uci,
    notation: appliedResult.notation
  }

  state.moveLog.push(
    createHistoryItem({
      side: HISTORY_SIDE.PLAYER,
      uci,
      notation: appliedResult.notation,
      eval_cp_after: currEvalCp
    })
  )

  playOutcomeSound(appliedResult)

  if (appliedResult.status.isOver) {
    if (appliedResult.status.winner === 'w') {
      state.bubble = {
        ...state.bubble,
        comment: '这局算你赢了！下盘我可不会再手下留情。',
        emotion: 'rage'
      }
    } else {
      state.bubble = {
        ...state.bubble,
        comment: '和棋收场，勉强算你守住了底线。',
        emotion: 'neutral'
      }
    }
    return { applied: true, gameOver: true, needsAiMove: false }
  }

  return { applied: true, gameOver: false, needsAiMove: true }
}

async function triggerAiTurn(personaOrId) {
  if (state.gameStatus.isOver || state.boardState.turn !== 'b') {
    return null
  }

  const activeSession = state.sessionId
  state.isAiThinking = true

  try {
    // 让 UI 先渲染出玩家的落子与“思考中”态（小程序/H5 均兼容）
    await new Promise((resolve) => setTimeout(resolve, 35))
    if (state.sessionId !== activeSession) return null

    const personaStore = usePersonaStore()
    const resolvedPersona =
      typeof personaOrId === 'object' && personaOrId !== null
        ? personaOrId
        : personaStore.state.personas.find((p) => p.persona_id === personaOrId) || null
    const personaId =
      (resolvedPersona && resolvedPersona.persona_id) ||
      (typeof personaOrId === 'string' ? personaOrId : personaStore.state.selectedPersonaId)

    const diffMeta = DIFFICULTIES.find((d) => d.id === state.difficulty) || DIFFICULTIES[1]
    const searchRes = searchTopCandidates(state.gameType, state.boardState, {
      maxDepth: diffMeta.searchDepth,
      topK: 5,
      timeBudgetMs: ENV_CONFIG.engineTimeBudgetMs,
      difficulty: state.difficulty
    })

    state.lastSearchInfo = {
      depth: searchRes.depthReached,
      elapsedMs: searchRes.elapsedMs,
      nodes: searchRes.nodes
    }

    if (!searchRes.candidates || searchRes.candidates.length === 0) {
      state.gameStatus = getGameStatus(state.gameType, state.boardState, 1)
      return null
    }

    const moveNumber = Math.max(1, state.boardState.fullmove || 1)
    const apiPayload = {
      game_type: state.gameType,
      fen: state.fen,
      candidates: searchRes.candidates,
      persona_id: personaId,
      difficulty: state.difficulty,
      recent_history: recentHistory.value,
      win_rate_delta: state.winRateDelta,
      move_number: moveNumber
    }
    if (resolvedPersona && resolvedPersona.is_custom && resolvedPersona.style_prompt) {
      apiPayload.custom_persona = {
        name: resolvedPersona.name,
        style_prompt: resolvedPersona.style_prompt,
        catchphrase: resolvedPersona.catchphrase || resolvedPersona.greeting || ''
      }
    }

    const aiRes = await requestAiMove(apiPayload)

    // 若等待期间用户点击了悔棋或重开，直接丢弃过期响应
    if (state.sessionId !== activeSession) return null

    const chosenUci = aiRes.selected_move || searchRes.candidates[0].uci
    const chosenCand =
      searchRes.candidates.find((c) => c.uci === chosenUci) || searchRes.candidates[0]

    const repMapAdapter = {
      get: (k) => state.repetitionMap[k] || 0
    }
    const applied = applyUciMove(state.gameType, state.boardState, chosenCand.uci, repMapAdapter)

    let currEvalCp = evaluateForSide(state.gameType, applied.nextState, 'b')
    if (applied.status.isOver) {
      if (applied.status.winner === 'b') currEvalCp = MATE_SCORE
      else if (applied.status.winner === 'w') currEvalCp = -MATE_SCORE
      else currEvalCp = 0
    } else if (Math.abs(chosenCand.score_cp) >= MATE_SCORE - 500) {
      currEvalCp = chosenCand.score_cp
    }
    const currWr = cpToWinRate(currEvalCp)

    state.fen = applied.fen
    state.boardState = applied.nextState
    state.repetitionMap[applied.boardRepKey] =
      (state.repetitionMap[applied.boardRepKey] || 0) + 1
    state.evalCpForAi = currEvalCp
    state.winRateForAi = currWr
    state.winRateHistory.push(currWr)
    state.gameStatus = applied.status
    state.lastMove = {
      from: { r: applied.move.fromR, c: applied.move.fromC },
      to: { r: applied.move.toR, c: applied.move.toC },
      fromR: applied.move.fromR,
      fromC: applied.move.fromC,
      toR: applied.move.toR,
      toC: applied.move.toC,
      side: 'ai',
      uci: chosenCand.uci,
      notation: applied.notation
    }

    state.moveLog.push(
      createHistoryItem({
        side: HISTORY_SIDE.AI,
        uci: chosenCand.uci,
        notation: applied.notation,
        eval_cp_after: currEvalCp
      })
    )

    playOutcomeSound(applied)

    state.bubble = {
      comment: aiRes.comment,
      emotion: aiRes.emotion,
      isFallback: Boolean(aiRes.is_fallback),
      isLocalFallback: Boolean(aiRes.is_local_fallback),
      modelProvider: aiRes.model_provider || '',
      modelName: aiRes.model_name || '',
      latencyMs: aiRes.latency_ms || 0,
      requestId: aiRes.request_id || ''
    }

    return aiRes
  } finally {
    if (state.sessionId === activeSession) {
      state.isAiThinking = false
    }
  }
}

function undoLastTurn(personaId = null) {
  if (state.undoStack.length === 0 || state.undoRemaining <= 0) return false

  // 取消正在飞行中的 AI 请求
  state.sessionId += 1
  state.isAiThinking = false
  state.undoRemaining -= 1

  // 每个玩家回合前都会压入一次快照，直接恢复到上一次玩家行动前
  const snap = state.undoStack.pop()
  state.fen = snap.fen
  state.boardState = parseFen(state.gameType, snap.fen)
  state.moveLog = state.moveLog.slice(0, snap.moveLogLen)
  state.repetitionMap = { ...snap.repetitionMap }
  state.evalCpForAi = snap.evalCpForAi
  state.winRateForAi = snap.winRateForAi
  state.winRateDelta = snap.winRateDelta
  state.winRateHistory = state.winRateHistory.slice(0, snap.winRateHistoryLen)
  state.lastMove = snap.lastMove
    ? {
        ...snap.lastMove,
        from: snap.lastMove.from ? { ...snap.lastMove.from } : undefined,
        to: snap.lastMove.to ? { ...snap.lastMove.to } : undefined
      }
    : null
  state.gameStatus = getGameStatus(state.gameType, state.boardState, 1)

  const usedIndex = Math.max(0, state.maxUndoCount - state.undoRemaining - 1)
  const personaTaunts = personaId ? UNDO_TAUNT_COMMENTS[personaId] : null
  const chosenTaunt =
    personaTaunts && personaTaunts.length > 0
      ? personaTaunts[usedIndex % personaTaunts.length]
      : DEFAULT_UNDO_TAUNT

  state.bubble = {
    ...snap.bubble,
    comment: chosenTaunt.comment,
    emotion: chosenTaunt.emotion,
    isFallback: false,
    isLocalFallback: false
  }
  return true
}

function resignGame() {
  state.sessionId += 1
  state.isAiThinking = false
  soundManager.playGameOver(false)
  state.gameStatus = {
    isOver: true,
    result: 'resign',
    winner: 'b',
    inCheck: false,
    legalMoveCount: 0
  }
  state.bubble = {
    ...state.bubble,
    comment: '承让承让，早点认输也能省不少脑细胞！',
    emotion: 'taunting'
  }
}

export function useGameStore() {
  return {
    state,
    recentHistory,
    legalMoves,
    currentTurn,
    isPlayerTurn,
    canUndo,
    setConfig,
    startNewGame,
    makePlayerMove,
    triggerAiTurn,
    undoLastTurn,
    resignGame
  }
}
