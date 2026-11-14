/**
 * 双棋种引擎统一门面 (Facade)
 * 隔离中国象棋与国际象棋底层差异，向 Store 和 UI 暴露一致的操作接口
 */

import { GAME_TYPE } from './common/types.js'
import {
  INITIAL_XIANGQI_FEN,
  parseXiangqiFen,
  serializeXiangqiFen,
  cloneXiangqiState,
  makeXiangqiMoveInPlace
} from './xiangqi/board.js'
import {
  generateXiangqiLegalMoves,
  getXiangqiGameStatus,
  isXiangqiInCheck
} from './xiangqi/rules.js'
import { moveToXiangqiNotation } from './xiangqi/uci.js'
import {
  evaluateXiangqiState,
  searchXiangqiTopCandidates
} from './xiangqi/search.js'

import {
  INITIAL_CHESS_FEN,
  parseChessFen,
  serializeChessFen,
  cloneChessState,
  makeChessMoveInPlace
} from './chess/board.js'
import {
  generateChessLegalMoves,
  getChessGameStatus,
  isChessInCheck
} from './chess/rules.js'
import { moveToChessNotation } from './chess/uci.js'
import {
  evaluateChessState,
  searchChessTopCandidates
} from './chess/search.js'

const ADAPTERS = {
  [GAME_TYPE.XIANGQI]: {
    initialFen: INITIAL_XIANGQI_FEN,
    parseFen: parseXiangqiFen,
    serializeFen: serializeXiangqiFen,
    cloneState: cloneXiangqiState,
    makeMoveInPlace: makeXiangqiMoveInPlace,
    getLegalMoves: generateXiangqiLegalMoves,
    isInCheck: isXiangqiInCheck,
    getGameStatus: getXiangqiGameStatus,
    evaluate: evaluateXiangqiState,
    search: searchXiangqiTopCandidates,
    getNotation: (state, move, legalMoves, isCheck, oppHasNoMoves) =>
      moveToXiangqiNotation(state, move)
  },
  [GAME_TYPE.CHESS]: {
    initialFen: INITIAL_CHESS_FEN,
    parseFen: parseChessFen,
    serializeFen: serializeChessFen,
    cloneState: cloneChessState,
    makeMoveInPlace: makeChessMoveInPlace,
    getLegalMoves: generateChessLegalMoves,
    isInCheck: isChessInCheck,
    getGameStatus: getChessGameStatus,
    evaluate: evaluateChessState,
    search: searchChessTopCandidates,
    getNotation: (state, move, legalMoves, isCheck, oppHasNoMoves) => {
      const suffix = isCheck ? (oppHasNoMoves ? '#' : '+') : ''
      return moveToChessNotation(state, move, legalMoves, suffix)
    }
  }
}

function getAdapter(gameType) {
  const adapter = ADAPTERS[gameType]
  if (!adapter) {
    throw new Error(`Unsupported game_type: ${gameType}`)
  }
  return adapter
}

export function getInitialFen(gameType) {
  return getAdapter(gameType).initialFen
}

export function parseFen(gameType, fen) {
  return getAdapter(gameType).parseFen(fen)
}

export function serializeFen(gameType, state) {
  return getAdapter(gameType).serializeFen(state)
}

export function getLegalMoves(gameType, state) {
  return getAdapter(gameType).getLegalMoves(state)
}

export function isInCheck(gameType, state, side = state.turn) {
  return getAdapter(gameType).isInCheck(state, side)
}

export function evaluateForSide(gameType, state, side = 'b') {
  return getAdapter(gameType).evaluate(state, side)
}

export function getGameStatus(gameType, state, repetitionCount = 1) {
  return getAdapter(gameType).getGameStatus(state, repetitionCount)
}

export function searchTopCandidates(gameType, state, options = {}) {
  return getAdapter(gameType).search(state, options)
}

/**
 * 校验并执行一步 UCI 走法，返回更新后的不可变状态与元数据
 */
export function applyUciMove(gameType, state, uci, repetitionCounts = null) {
  const adapter = getAdapter(gameType)
  const legalMoves = adapter.getLegalMoves(state)
  const matched = legalMoves.find((m) => m.uci === uci)
  if (!matched) {
    throw new Error(`Illegal UCI move "${uci}" for ${gameType}`)
  }

  const nextState = adapter.cloneState(state)
  adapter.makeMoveInPlace(nextState, matched)

  const fen = adapter.serializeFen(nextState)
  const boardRepKey = fen.split(' ').slice(0, 4).join(' ')
  let repCount = 1
  if (repetitionCounts) {
    repCount = (repetitionCounts.get(boardRepKey) || 0) + 1
  }

  const status = adapter.getGameStatus(nextState, repCount)
  const notation = adapter.getNotation(
    state,
    matched,
    legalMoves,
    status.inCheck,
    status.isOver && status.result === 'checkmate'
  )

  return {
    nextState,
    fen,
    boardRepKey,
    move: matched,
    notation,
    isCapture: Boolean(matched.captured) || Boolean(matched.isEnPassant),
    isCheck: status.inCheck,
    status
  }
}
