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
import { buildCoachTacticalContext } from '../engine/common/tacticsAnalyzer.js'
import {
  getInitialFen,
  parseFen,
  getLegalMoves,
  applyUciMove,
  evaluateForSide,
  getGameStatus,
  searchTopCandidates
} from '../engine/index.js'
import { requestAiMove, askCoach } from '../api/ai.js'
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
  initialFen: initialData.fen,
  initialEvalCpForAi: 0,
  initialWinRateForAi: 50.0,
  initialGreeting: '请落子吧，让我看看你的实力。',
  fen: initialData.fen,
  boardState: initialData.boardState,
  moveLog: [],
  moveHistory: [],
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
  replay: {
    active: false,
    stepIndex: 0
  },
  sessionId: 1,
  lastSearchInfo: null
})

// API_SPEC 3.1：最近 3 步滑动窗口历史（仅含接口所需字段）
const recentHistory = computed(() => state.moveLog.slice(-3))

const isReplayMode = computed(() => state.replay.active)

const currentReplayEntry = computed(() => {
  if (!state.replay.active || state.replay.stepIndex <= 0) return null
  return state.moveHistory[state.replay.stepIndex - 1] || null
})

const blunderSteps = computed(() => state.moveHistory.filter((item) => item.is_blunder))

const displayFen = computed(() => {
  if (!state.replay.active) return state.fen
  if (state.replay.stepIndex <= 0) return state.initialFen
  const entry = currentReplayEntry.value
  return entry ? entry.fen : state.fen
})

const displayBoardState = computed(() => {
  if (!state.replay.active) return state.boardState
  return parseFen(state.gameType, displayFen.value)
})

const displayLastMove = computed(() => {
  if (!state.replay.active) return state.lastMove
  const entry = currentReplayEntry.value
  return entry ? entry.lastMove : null
})

const displayWinRateForAi = computed(() => {
  if (!state.replay.active) return state.winRateForAi
  const entry = currentReplayEntry.value
  return entry ? entry.win_rate_for_ai : state.initialWinRateForAi
})

const displayWinRateDelta = computed(() => {
  if (!state.replay.active) return state.winRateDelta
  const entry = currentReplayEntry.value
  return entry ? Number((-entry.win_rate_delta).toFixed(1)) : 0
})

const displayBubble = computed(() => {
  if (!state.replay.active) return state.bubble
  const entry = currentReplayEntry.value
  if (!entry) {
    return createEmptyBubble(state.initialGreeting)
  }
  return {
    ...createEmptyBubble(entry.comment || `第 ${entry.step} 步：${entry.notation || entry.uci}`),
    emotion: entry.emotion || 'neutral'
  }
})

const legalMoves = computed(() => {
  if (state.replay.active || state.gameStatus.isOver) return []
  return getLegalMoves(state.gameType, state.boardState)
})

const currentTurn = computed(() => state.boardState.turn)
const isPlayerTurn = computed(
  () =>
    !state.replay.active &&
    !state.gameStatus.isOver &&
    !state.isAiThinking &&
    state.boardState.turn === 'w'
)
const canUndo = computed(
  () =>
    !state.replay.active &&
    state.undoStack.length > 0 &&
    state.undoRemaining > 0 &&
    !state.gameStatus.isOver
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
  const initGreeting = greeting || '请落子吧，让我看看你今天能撑几个回合。'

  state.initialFen = fen
  state.initialEvalCpForAi = evalCp
  state.initialWinRateForAi = wr
  state.initialGreeting = initGreeting
  state.fen = fen
  state.boardState = boardState
  state.moveLog = []
  state.moveHistory = []
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
  state.replay = { active: false, stepIndex: 0 }
  state.bubble = createEmptyBubble(initGreeting)
}

function recordMoveHistory({
  side,
  uci,
  notation,
  fenBefore,
  fenAfter,
  lastMove,
  evalCpAfter,
  winRateForAiAfter,
  playerWinRateDelta,
  comment,
  emotion
}) {
  const playerWinRate = Number((100 - winRateForAiAfter).toFixed(1))
  const cleanDelta = Number(Number(playerWinRateDelta || 0).toFixed(1))
  const isBlunder = side === HISTORY_SIDE.PLAYER && cleanDelta < -15.0
  state.moveHistory.push({
    step: state.moveHistory.length + 1,
    side,
    uci,
    notation: notation || uci,
    fen: fenAfter,
    fenBefore,
    lastMove: lastMove
      ? {
          ...lastMove,
          from: lastMove.from ? { ...lastMove.from } : undefined,
          to: lastMove.to ? { ...lastMove.to } : undefined
        }
      : null,
    score_cp: evalCpAfter,
    win_rate: playerWinRate,
    win_rate_for_ai: winRateForAiAfter,
    win_rate_delta: cleanDelta,
    is_blunder: isBlunder,
    comment: comment || '',
    emotion: emotion || 'neutral'
  })
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

  const prevFen = state.fen
  const prevEvalCp = state.evalCpForAi
  let currEvalCp = evaluateForSide(state.gameType, appliedResult.nextState, 'b')
  if (appliedResult.status.isOver) {
    if (appliedResult.status.winner === 'w') currEvalCp = -MATE_SCORE
    else if (appliedResult.status.winner === 'b') currEvalCp = MATE_SCORE
    else currEvalCp = 0
  }
  const delta = calcWinRateDelta(prevEvalCp, currEvalCp)
  const currWr = cpToWinRate(currEvalCp)
  const playerDelta = Number((-delta).toFixed(1))

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

  let stepComment = `我方落子：${appliedResult.notation || uci}`
  let stepEmotion = playerDelta < -15 ? 'taunting' : playerDelta > 10 ? 'panicked' : 'neutral'

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
    stepComment = state.bubble.comment
    stepEmotion = state.bubble.emotion
    recordMoveHistory({
      side: HISTORY_SIDE.PLAYER,
      uci,
      notation: appliedResult.notation,
      fenBefore: prevFen,
      fenAfter: appliedResult.fen,
      lastMove: state.lastMove,
      evalCpAfter: currEvalCp,
      winRateForAiAfter: currWr,
      playerWinRateDelta: playerDelta,
      comment: stepComment,
      emotion: stepEmotion
    })
    return { applied: true, gameOver: true, needsAiMove: false }
  }

  recordMoveHistory({
    side: HISTORY_SIDE.PLAYER,
    uci,
    notation: appliedResult.notation,
    fenBefore: prevFen,
    fenAfter: appliedResult.fen,
    lastMove: state.lastMove,
    evalCpAfter: currEvalCp,
    winRateForAiAfter: currWr,
    playerWinRateDelta: playerDelta,
    comment: stepComment,
    emotion: stepEmotion
  })

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

    // 用端侧前瞻搜索的最优分值修正玩家刚走出这一步的真实评估与“战犯步”判定
    const bestReplyCand = searchRes.candidates[0]
    const lastEntry = state.moveHistory[state.moveHistory.length - 1]
    if (lastEntry && lastEntry.side === HISTORY_SIDE.PLAYER && bestReplyCand) {
      const prevBeforePlayerAiWr =
        state.moveHistory.length >= 2
          ? state.moveHistory[state.moveHistory.length - 2].win_rate_for_ai
          : state.initialWinRateForAi
      const refinedAiWr = cpToWinRate(bestReplyCand.score_cp)
      const refinedPlayerDelta = Number(
        (100 - refinedAiWr - (100 - prevBeforePlayerAiWr)).toFixed(1)
      )
      lastEntry.score_cp = bestReplyCand.score_cp
      lastEntry.win_rate_for_ai = refinedAiWr
      lastEntry.win_rate = Number((100 - refinedAiWr).toFixed(1))
      lastEntry.win_rate_delta = refinedPlayerDelta
      lastEntry.is_blunder = refinedPlayerDelta < -15.0
      state.evalCpForAi = bestReplyCand.score_cp
      state.winRateForAi = refinedAiWr
      state.winRateDelta = Number((-refinedPlayerDelta).toFixed(1))
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
    const prevFen = state.fen
    const prevAiWr = state.winRateForAi
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
    const playerDelta = Number(((100 - currWr) - (100 - prevAiWr)).toFixed(1))

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

    recordMoveHistory({
      side: HISTORY_SIDE.AI,
      uci: chosenCand.uci,
      notation: applied.notation,
      fenBefore: prevFen,
      fenAfter: applied.fen,
      lastMove: state.lastMove,
      evalCpAfter: currEvalCp,
      winRateForAiAfter: currWr,
      playerWinRateDelta: playerDelta,
      comment: aiRes.comment,
      emotion: aiRes.emotion
    })

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
  state.moveHistory = state.moveHistory.slice(0, snap.moveLogLen)
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

function enterReplayMode(initialStep = null) {
  if (state.isAiThinking) return false
  const total = state.moveHistory.length
  const target =
    typeof initialStep === 'number' && !Number.isNaN(initialStep)
      ? Math.max(0, Math.min(total, Math.round(initialStep)))
      : total
  state.replay = {
    active: true,
    stepIndex: target
  }
  return true
}

function seekReplayStep(stepIndex) {
  if (!state.replay.active) {
    state.replay.active = true
  }
  const total = state.moveHistory.length
  const clamped = Math.max(0, Math.min(total, Math.round(Number(stepIndex || 0))))
  state.replay.stepIndex = clamped
  return clamped
}

function exitReplayMode() {
  state.replay.active = false
}

const replayCandidatesCache = new Map()

function computeTopCandidatesForFen(fenStr) {
  if (!fenStr) return []
  const cacheKey = `${state.gameType}::${fenStr}`
  if (replayCandidatesCache.has(cacheKey)) {
    return replayCandidatesCache.get(cacheKey)
  }
  try {
    const parsed = parseFen(state.gameType, fenStr)
    const moves = getLegalMoves(state.gameType, parsed)
    if (!moves || moves.length === 0) return []
    const res = searchTopCandidates(state.gameType, parsed, {
      maxDepth: 2,
      topK: 3,
      timeBudgetMs: 260,
      difficulty: 'tryhard'
    })
    const top = (res && Array.isArray(res.candidates) ? res.candidates : []).slice(0, 3)
    if (replayCandidatesCache.size > 60) {
      replayCandidatesCache.clear()
    }
    replayCandidatesCache.set(cacheKey, top)
    return top
  } catch (_err) {
    return []
  }
}

function getReplayTacticalPreview(entry = null) {
  const targetEntry = entry || (state.replay.active ? currentReplayEntry.value : state.moveHistory[state.moveHistory.length - 1] || null)
  const fenAfter = targetEntry ? targetEntry.fen : (state.replay.active ? displayFen.value : state.fen)
  const topCandidatesAfter = computeTopCandidatesForFen(fenAfter)
  const alternativeCandidatesBefore =
    targetEntry && targetEntry.fenBefore ? computeTopCandidatesForFen(targetEntry.fenBefore) : []

  return buildCoachTacticalContext({
    gameType: state.gameType,
    fenBefore: targetEntry ? targetEntry.fenBefore : null,
    fenAfter,
    actualUci: targetEntry ? targetEntry.uci : null,
    actualNotation: targetEntry ? targetEntry.notation || targetEntry.uci : null,
    winRateDelta: targetEntry ? targetEntry.win_rate_delta : null,
    topCandidatesAfter,
    alternativeCandidatesBefore
  })
}

function buildReplaySummaryContext() {
  if (!state.moveHistory.length) return '尚无走棋记录。'
  const lines = [`总步数：${state.moveHistory.length} 步`]
  const blunders = blunderSteps.value
  if (blunders.length > 0) {
    lines.push(
      '关键失误/战犯步：' +
        blunders
          .slice(0, 5)
          .map(
            (b) =>
              `第${b.step}步 ${b.notation || b.uci} (我方胜率 ${b.win_rate_delta >= 0 ? '+' : ''}${b.win_rate_delta}%)`
          )
          .join('；')
    )
  } else {
    lines.push('全盘无我方单步暴跌超15%的重大漏着。')
  }
  const lastEntry = state.moveHistory[state.moveHistory.length - 1]
  lines.push(`终局/最新我方胜率：${lastEntry.win_rate.toFixed(1)}%`)
  return lines.join('\n')
}

function buildCoachAskPayload({ question, persona = null, chatHistory = [] } = {}) {
  const personaStore = usePersonaStore()
  const activePersona = persona || personaStore.currentPersona.value
  const entry = state.replay.active
    ? currentReplayEntry.value
    : state.moveHistory[state.moveHistory.length - 1] || null

  const fen = state.replay.active ? displayFen.value : state.fen
  const scoreCp = entry ? entry.score_cp : state.initialEvalCpForAi
  const winRate = entry
    ? entry.win_rate
    : Number((100 - state.initialWinRateForAi).toFixed(1))

  const tacticalContext = getReplayTacticalPreview(entry)

  const payload = {
    game_type: state.gameType,
    fen,
    last_move_notation: entry ? entry.notation || entry.uci : null,
    score_cp: scoreCp,
    win_rate: winRate,
    win_rate_delta: entry ? entry.win_rate_delta : 0,
    top_candidates: tacticalContext.top_candidates,
    alternative_candidates: tacticalContext.alternative_candidates,
    actual_move_analysis: tacticalContext.actual_move_analysis,
    chat_history: Array.isArray(chatHistory) ? chatHistory : [],
    summary_context: buildReplaySummaryContext(),
    question: String(question || '').trim() || '请诊断当前步的得失并给出最佳走法思路。',
    persona_id: (activePersona && activePersona.persona_id) || 'deepseek_master'
  }
  if (activePersona && activePersona.is_custom && activePersona.style_prompt) {
    payload.custom_persona = {
      name: activePersona.name,
      style_prompt: activePersona.style_prompt,
      catchphrase: activePersona.catchphrase || activePersona.greeting || ''
    }
  }
  return payload
}

async function askReplayCoach({ question, persona = null, chatHistory = [] } = {}) {
  const payload = buildCoachAskPayload({ question, persona, chatHistory })
  return await askCoach(payload)
}

export function useGameStore() {
  return {
    state,
    recentHistory,
    legalMoves,
    currentTurn,
    isPlayerTurn,
    canUndo,
    isReplayMode,
    currentReplayEntry,
    blunderSteps,
    displayFen,
    displayBoardState,
    displayLastMove,
    displayWinRateForAi,
    displayWinRateDelta,
    displayBubble,
    setConfig,
    startNewGame,
    makePlayerMove,
    triggerAiTurn,
    undoLastTurn,
    resignGame,
    enterReplayMode,
    seekReplayStep,
    exitReplayMode,
    getReplayTacticalPreview,
    buildCoachAskPayload,
    askReplayCoach
  }
}
