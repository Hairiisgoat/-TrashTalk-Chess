/**
 * 中国象棋轻量 Alpha-Beta 搜索引擎
 * 特性：迭代加深 + 置换表(TT) + MVV-LVA 吃子排序 + 杀手启发 + 静态吃子延伸 + 位置价值表(PST)
 * 性能目标：单次搜索严格控制在 450ms 内，输出降序排列的 Top-3~5 CandidateMove
 */

import { MATE_SCORE, createCandidateMove } from '../common/types.js'
import { selectCandidatesByDifficulty } from '../common/candidatePicker.js'
import { extractPvSequence } from '../common/pvHelper.js'
import {
  XIANGQI_ROWS,
  XIANGQI_COLS,
  cloneXiangqiState,
  isRedPiece,
  makeXiangqiMoveInPlace,
  unmakeXiangqiMoveInPlace
} from './board.js'
import { generateXiangqiLegalMoves, isXiangqiInCheck } from './rules.js'
import { moveToXiangqiNotation, getPieceDisplayLabel } from './uci.js'

const PIECE_VALUES = {
  K: 10000,
  R: 900,
  C: 450,
  N: 400,
  B: 200,
  A: 200,
  P: 100
}

// 红方视角位置价值表（r=0 为黑方底线，r=9 为红方底线）
const PST_PAWN_RED = [
  [9, 9, 9, 11, 13, 11, 9, 9, 9],
  [19, 24, 34, 42, 44, 42, 34, 24, 19],
  [19, 24, 32, 37, 37, 37, 32, 24, 19],
  [19, 23, 27, 29, 30, 29, 27, 23, 19],
  [14, 18, 20, 27, 29, 27, 20, 18, 14],
  [7, 0, 13, 0, 16, 0, 13, 0, 7],
  [7, 0, 7, 0, 15, 0, 7, 0, 7],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0]
]

const PST_HORSE_RED = [
  [4, 8, 16, 12, 4, 12, 16, 8, 4],
  [4, 10, 28, 16, 8, 16, 28, 10, 4],
  [12, 14, 16, 20, 18, 20, 16, 14, 12],
  [8, 24, 18, 24, 20, 24, 18, 24, 8],
  [12, 16, 20, 22, 22, 22, 20, 16, 12],
  [10, 16, 22, 18, 20, 18, 22, 16, 10],
  [6, 16, 14, 18, 16, 18, 14, 16, 6],
  [4, 12, 16, 14, 12, 14, 16, 12, 4],
  [0, 8, 10, 8, 4, 8, 10, 8, 0],
  [0, -4, 4, 0, 0, 0, 4, -4, 0]
]

const PST_CANNON_RED = [
  [6, 4, 0, -10, -12, -10, 0, 4, 6],
  [2, 2, 0, -4, -14, -4, 0, 2, 2],
  [2, 2, 0, -10, -8, -10, 0, 2, 2],
  [0, 0, -2, 4, 10, 4, -2, 0, 0],
  [0, 0, 0, 2, 8, 2, 0, 0, 0],
  [-2, 0, 4, 2, 6, 2, 4, 0, -2],
  [0, 0, 0, 2, 4, 2, 0, 0, 0],
  [4, 0, 8, 6, 10, 6, 8, 0, 4],
  [0, 2, 4, 6, 6, 6, 4, 2, 0],
  [0, 0, 2, 6, 6, 6, 2, 0, 0]
]

const PST_ROOK_RED = [
  [14, 14, 12, 18, 16, 18, 12, 14, 14],
  [16, 20, 18, 24, 26, 24, 18, 20, 16],
  [12, 12, 12, 18, 18, 18, 12, 12, 12],
  [12, 18, 16, 22, 22, 22, 16, 18, 12],
  [12, 14, 12, 18, 18, 18, 12, 14, 12],
  [12, 16, 14, 20, 20, 20, 14, 16, 12],
  [6, 10, 8, 14, 14, 14, 8, 10, 6],
  [4, 8, 6, 14, 12, 14, 6, 8, 4],
  [8, 4, 8, 16, 8, 16, 8, 4, 8],
  [-2, 10, 6, 14, 12, 14, 6, 10, -2]
]

function getPstBonus(piece, r, c) {
  const isRed = isRedPiece(piece)
  const row = isRed ? r : 9 - r
  switch (piece.toUpperCase()) {
    case 'P':
      return PST_PAWN_RED[row][c]
    case 'N':
      return PST_HORSE_RED[row][c]
    case 'C':
      return PST_CANNON_RED[row][c]
    case 'R':
      return PST_ROOK_RED[row][c]
    case 'A':
    case 'B':
      return row >= 7 ? 6 : 0
    case 'K':
      return row === 9 && c === 4 ? 10 : 0
    default:
      return 0
  }
}

/**
 * 静态局面评估：返回相对于 perspectiveSide（默认当前走子方）的厘兵分
 */
export function evaluateXiangqiState(state, perspectiveSide = state.turn) {
  let redScore = 0
  let blackScore = 0
  const board = state.board

  for (let r = 0; r < XIANGQI_ROWS; r++) {
    for (let c = 0; c < XIANGQI_COLS; c++) {
      const piece = board[r][c]
      if (!piece) continue
      const val = (PIECE_VALUES[piece.toUpperCase()] || 0) + getPstBonus(piece, r, c)
      if (isRedPiece(piece)) {
        redScore += val
      } else {
        blackScore += val
      }
    }
  }

  const diff = redScore - blackScore
  return perspectiveSide === 'w' ? diff : -diff
}

function getMoveOrderScore(move, ttBestUci, killerPair) {
  if (ttBestUci && move.uci === ttBestUci) return 1000000
  if (move.captured) {
    const victimVal = PIECE_VALUES[move.captured.toUpperCase()] || 100
    const attackerVal = PIECE_VALUES[move.piece.toUpperCase()] || 100
    return 100000 + victimVal * 10 - attackerVal
  }
  if (killerPair && (killerPair[0] === move.uci || killerPair[1] === move.uci)) {
    return 50000
  }
  return getPstBonus(move.piece, move.toR, move.toC) - getPstBonus(move.piece, move.fromR, move.fromC)
}

function orderMoves(moves, ttBestUci, killerPair) {
  for (let i = 0; i < moves.length; i++) {
    moves[i]._order = getMoveOrderScore(moves[i], ttBestUci, killerPair)
  }
  moves.sort((a, b) => b._order - a._order)
}

function buildStateKey(state) {
  let key = state.turn
  for (let r = 0; r < XIANGQI_ROWS; r++) {
    const row = state.board[r]
    for (let c = 0; c < XIANGQI_COLS; c++) {
      key += row[c] || '.'
    }
  }
  return key
}

/**
 * 轻量 Alpha-Beta 搜索并返回降序排列的 Top-K 候选步
 */
export function searchXiangqiTopCandidates(state, options = {}) {
  const {
    maxDepth = 3,
    topK = 5,
    timeBudgetMs = 420,
    difficulty = 'balanced'
  } = options
  const effectiveMaxDepth = difficulty === 'casual' ? Math.min(maxDepth, 2) : maxDepth

  const workState = cloneXiangqiState(state)
  const rootSide = workState.turn
  const legalMoves = generateXiangqiLegalMoves(workState)

  if (legalMoves.length === 0) {
    return { candidates: [], depthReached: 0, elapsedMs: 0, nodes: 0 }
  }

  const startTime = Date.now()
  let aborted = false
  let nodes = 0
  const tt = new Map()
  const killers = Array.from({ length: 12 }, () => [null, null])

  const checkTime = () => {
    nodes++
    if ((nodes & 127) === 0 && Date.now() - startTime >= timeBudgetMs) {
      aborted = true
    }
  }

  function quiescence(alpha, beta, qDepth) {
    checkTime()
    if (aborted) return evaluateXiangqiState(workState, workState.turn)

    const standPat = evaluateXiangqiState(workState, workState.turn)
    if (qDepth <= 0) return standPat
    if (standPat >= beta) return beta
    if (standPat > alpha) alpha = standPat

    const captures = generateXiangqiLegalMoves(workState, true)
    orderMoves(captures, null, null)

    for (const move of captures) {
      const undo = makeXiangqiMoveInPlace(workState, move)
      const score = -quiescence(-beta, -alpha, qDepth - 1)
      unmakeXiangqiMoveInPlace(workState, undo)
      if (aborted) return alpha
      if (score >= beta) return beta
      if (score > alpha) alpha = score
    }
    return alpha
  }

  function alphaBeta(depth, ply, alpha, beta) {
    checkTime()
    if (aborted) return evaluateXiangqiState(workState, workState.turn)

    const key = buildStateKey(workState)
    const ttEntry = tt.get(key)
    if (ttEntry && ttEntry.depth >= depth) {
      if (ttEntry.flag === 'EXACT') return ttEntry.score
      if (ttEntry.flag === 'LOWER' && ttEntry.score >= beta) return ttEntry.score
      if (ttEntry.flag === 'UPPER' && ttEntry.score <= alpha) return ttEntry.score
    }

    if (depth <= 0) {
      return quiescence(alpha, beta, 2)
    }

    const moves = generateXiangqiLegalMoves(workState)
    if (moves.length === 0) {
      return -MATE_SCORE + ply
    }

    orderMoves(moves, ttEntry ? ttEntry.bestUci : null, killers[ply])

    const origAlpha = alpha
    let bestScore = -Infinity
    let bestUci = moves[0].uci

    for (const move of moves) {
      const undo = makeXiangqiMoveInPlace(workState, move)
      const score = -alphaBeta(depth - 1, ply + 1, -beta, -alpha)
      unmakeXiangqiMoveInPlace(workState, undo)

      if (aborted) return bestScore > -Infinity ? bestScore : origAlpha

      if (score > bestScore) {
        bestScore = score
        bestUci = move.uci
      }
      if (score > alpha) {
        alpha = score
      }
      if (alpha >= beta) {
        if (!move.captured && ply < killers.length) {
          killers[ply][1] = killers[ply][0]
          killers[ply][0] = move.uci
        }
        break
      }
    }

    if (tt.size < 30000) {
      const flag = bestScore <= origAlpha ? 'UPPER' : bestScore >= beta ? 'LOWER' : 'EXACT'
      tt.set(key, { depth, score: bestScore, flag, bestUci })
    }

    return bestScore
  }

  // 初始化每个根走法的基础排序和静态分数，保证即便超时也有可靠排序
  orderMoves(legalMoves, null, null)
  const rootScores = new Map()
  for (const m of legalMoves) {
    const undo = makeXiangqiMoveInPlace(workState, m)
    const s = -evaluateXiangqiState(workState, workState.turn)
    unmakeXiangqiMoveInPlace(workState, undo)
    rootScores.set(m.uci, s)
  }

  let depthReached = 0
  for (let depth = 1; depth <= effectiveMaxDepth; depth++) {
    const iterScores = new Map()
    // 每一层按上一层分数降序尝试
    legalMoves.sort((a, b) => {
      const sb = rootScores.has(b.uci) ? rootScores.get(b.uci) : 0
      const sa = rootScores.has(a.uci) ? rootScores.get(a.uci) : 0
      return sb - sa
    })

    let iterCompleted = true
    for (const move of legalMoves) {
      const undo = makeXiangqiMoveInPlace(workState, move)
      const score = -alphaBeta(depth - 1, 1, -MATE_SCORE, MATE_SCORE)
      unmakeXiangqiMoveInPlace(workState, undo)

      if (aborted) {
        iterCompleted = false
        break
      }
      iterScores.set(move.uci, score)
    }

    if (iterCompleted) {
      for (const [uci, sc] of iterScores.entries()) {
        rootScores.set(uci, sc)
      }
      depthReached = depth
    } else {
      break
    }

    if (Date.now() - startTime >= timeBudgetMs * 0.65) {
      break
    }
  }

  // 按 AI 视角评估分从高到低降序排列
  const rankedMoves = legalMoves.slice().sort((a, b) => {
    const sb = rootScores.has(b.uci) ? rootScores.get(b.uci) : 0
    const sa = rootScores.has(a.uci) ? rootScores.get(a.uci) : 0
    return sb - sa
  })

  const selectedMoves = selectCandidatesByDifficulty(rankedMoves, rootScores, {
    topK,
    difficulty,
    mateScore: MATE_SCORE
  })
  const candidates = []

  const pickXiangqiFallbackMove = (curState, oppMoves) => {
    let bestM = oppMoves[0]
    let bestS = -Infinity
    for (let j = 0; j < oppMoves.length; j++) {
      const m = oppMoves[j]
      const u = makeXiangqiMoveInPlace(curState, m)
      const s = -evaluateXiangqiState(curState, curState.turn)
      unmakeXiangqiMoveInPlace(curState, u)
      if (s > bestS) {
        bestS = s
        bestM = m
      }
    }
    return bestM
  }

  for (let i = 0; i < selectedMoves.length; i++) {
    const move = selectedMoves[i]
    const notation = moveToXiangqiNotation(state, move)
    const undo = makeXiangqiMoveInPlace(workState, move)
    const isCheck = isXiangqiInCheck(workState, workState.turn)
    unmakeXiangqiMoveInPlace(workState, undo)

    const pvInfo =
      i < 3
        ? extractPvSequence({
            workState,
            rootMove: move,
            rootLegalMoves: legalMoves,
            maxPlies: 3,
            tt,
            buildKey: buildStateKey,
            makeMove: makeXiangqiMoveInPlace,
            unmakeMove: unmakeXiangqiMoveInPlace,
            getLegalMoves: generateXiangqiLegalMoves,
            isInCheck: isXiangqiInCheck,
            pickFallbackMove: pickXiangqiFallbackMove,
            formatStep: (st, m, stepNum, _curLegal, chk, oppNoMoves) => {
              const base = moveToXiangqiNotation(st, m)
              const capTag = m.captured ? `(吃${getPieceDisplayLabel(m.captured) || m.captured})` : ''
              const chkTag = chk ? (oppNoMoves ? '(绝杀)' : '(将)') : ''
              return `${stepNum}. ${base}${capTag}${chkTag}`
            }
          })
        : { pv: [], pvUci: [] }

    candidates.push(
      createCandidateMove({
        uci: move.uci,
        score_cp: rootScores.has(move.uci)
          ? rootScores.get(move.uci)
          : evaluateXiangqiState(state, rootSide),
        notation,
        is_capture: Boolean(move.captured),
        is_check: isCheck,
        pv: pvInfo.pv,
        pv_uci: pvInfo.pvUci
      })
    )
  }

  return {
    candidates,
    depthReached,
    elapsedMs: Date.now() - startTime,
    nodes
  }
}
