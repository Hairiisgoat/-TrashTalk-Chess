/**
 * 国际象棋轻量 Alpha-Beta 搜索引擎
 * 特性：迭代加深 + 置换表(TT) + MVV-LVA + 升变优先 + 杀手启发 + 静态吃子搜索 + PST
 * 性能目标：单次搜索严格控制在 450ms 内，输出降序排列的 Top-3~5 CandidateMove
 */

import { MATE_SCORE, createCandidateMove } from '../common/types.js'
import {
  normalizeDifficulty,
  pickTieredCandidatesWithTags
} from '../common/candidatePicker.js'
import { extractPvSequence, formatChessPvStep } from '../common/pvHelper.js'
import {
  CHESS_SIZE,
  cloneChessState,
  isWhitePiece,
  makeChessMoveInPlace,
  unmakeChessMoveInPlace
} from './board.js'
import { generateChessLegalMoves, isChessInCheck } from './rules.js'
import { moveToChessNotation } from './uci.js'

const PIECE_VALUES = {
  P: 100,
  N: 320,
  B: 330,
  R: 500,
  Q: 900,
  K: 20000
}

const PST_PAWN = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [50, 50, 50, 50, 50, 50, 50, 50],
  [10, 10, 20, 30, 30, 20, 10, 10],
  [5, 5, 10, 25, 25, 10, 5, 5],
  [0, 0, 0, 22, 22, 0, 0, 0],
  [5, -5, -10, 0, 0, -10, -5, 5],
  [5, 10, 10, -20, -20, 10, 10, 5],
  [0, 0, 0, 0, 0, 0, 0, 0]
]

const PST_KNIGHT = [
  [-50, -40, -30, -30, -30, -30, -40, -50],
  [-40, -20, 0, 0, 0, 0, -20, -40],
  [-30, 0, 10, 15, 15, 10, 0, -30],
  [-30, 5, 15, 20, 20, 15, 5, -30],
  [-30, 0, 15, 20, 20, 15, 0, -30],
  [-30, 5, 10, 15, 15, 10, 5, -30],
  [-40, -20, 0, 5, 5, 0, -20, -40],
  [-50, -40, -30, -30, -30, -30, -40, -50]
]

const PST_BISHOP = [
  [-20, -10, -10, -10, -10, -10, -10, -20],
  [-10, 0, 0, 0, 0, 0, 0, -10],
  [-10, 0, 5, 10, 10, 5, 0, -10],
  [-10, 5, 5, 10, 10, 5, 5, -10],
  [-10, 0, 10, 10, 10, 10, 0, -10],
  [-10, 10, 10, 10, 10, 10, 10, -10],
  [-10, 5, 0, 0, 0, 0, 5, -10],
  [-20, -10, -10, -10, -10, -10, -10, -20]
]

const PST_ROOK = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [5, 10, 10, 10, 10, 10, 10, 5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [0, 0, 0, 5, 5, 0, 0, 0]
]

const PST_QUEEN = [
  [-20, -10, -10, -5, -5, -10, -10, -20],
  [-10, 0, 0, 0, 0, 0, 0, -10],
  [-10, 0, 5, 5, 5, 5, 0, -10],
  [-5, 0, 5, 5, 5, 5, 0, -5],
  [0, 0, 5, 5, 5, 5, 0, -5],
  [-10, 5, 5, 5, 5, 5, 0, -10],
  [-10, 0, 5, 0, 0, 0, 0, -10],
  [-20, -10, -10, -5, -5, -10, -10, -20]
]

const PST_KING = [
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-20, -30, -30, -40, -40, -30, -30, -20],
  [-10, -20, -20, -20, -20, -20, -20, -10],
  [20, 20, 0, 0, 0, 0, 20, 20],
  [20, 30, 10, 0, 0, 10, 30, 20]
]

function getPstBonus(piece, r, c) {
  const white = isWhitePiece(piece)
  const row = white ? r : 7 - r
  switch (piece.toUpperCase()) {
    case 'P': return PST_PAWN[row][c]
    case 'N': return PST_KNIGHT[row][c]
    case 'B': return PST_BISHOP[row][c]
    case 'R': return PST_ROOK[row][c]
    case 'Q': return PST_QUEEN[row][c]
    case 'K': return PST_KING[row][c]
    default: return 0
  }
}

export function evaluateChessState(state, perspectiveSide = state.turn) {
  let whiteScore = 0
  let blackScore = 0
  const board = state.board

  for (let r = 0; r < CHESS_SIZE; r++) {
    for (let c = 0; c < CHESS_SIZE; c++) {
      const piece = board[r][c]
      if (!piece) continue
      const val = (PIECE_VALUES[piece.toUpperCase()] || 0) + getPstBonus(piece, r, c)
      if (isWhitePiece(piece)) {
        whiteScore += val
      } else {
        blackScore += val
      }
    }
  }

  const diff = whiteScore - blackScore
  return perspectiveSide === 'w' ? diff : -diff
}

function getMoveOrderScore(move, ttBestUci, killerPair) {
  if (ttBestUci && move.uci === ttBestUci) return 1000000
  let score = 0
  if (move.captured) {
    const victimVal = PIECE_VALUES[move.captured.toUpperCase()] || 100
    const attackerVal = PIECE_VALUES[move.piece.toUpperCase()] || 100
    score += 100000 + victimVal * 10 - attackerVal
  }
  if (move.promotion) {
    score += 90000 + (PIECE_VALUES[move.promotion.toUpperCase()] || 0)
  }
  if (score > 0) return score
  if (killerPair && (killerPair[0] === move.uci || killerPair[1] === move.uci)) {
    return 50000
  }
  if (move.isCastle) return 20000
  return getPstBonus(move.piece, move.toR, move.toC) - getPstBonus(move.piece, move.fromR, move.fromC)
}

function orderMoves(moves, ttBestUci, killerPair) {
  for (let i = 0; i < moves.length; i++) {
    moves[i]._order = getMoveOrderScore(moves[i], ttBestUci, killerPair)
  }
  moves.sort((a, b) => b._order - a._order)
}

function buildChessKey(state) {
  let key = `${state.turn}${state.castling.K ? 1 : 0}${state.castling.Q ? 1 : 0}${state.castling.k ? 1 : 0}${state.castling.q ? 1 : 0}`
  if (state.enPassant) key += `${state.enPassant.r}${state.enPassant.c}`
  for (let r = 0; r < CHESS_SIZE; r++) {
    const row = state.board[r]
    for (let c = 0; c < CHESS_SIZE; c++) {
      key += row[c] || '.'
    }
  }
  return key
}

export function searchChessTopCandidates(state, options = {}) {
  const {
    maxDepth = 3,
    topK = 5,
    timeBudgetMs = 420,
    difficulty = 'balanced'
  } = options
  const normDifficulty = normalizeDifficulty(difficulty)
  const effectiveMaxDepth =
    normDifficulty === 'casual'
      ? Math.min(maxDepth, 2)
      : normDifficulty === 'balanced'
        ? Math.min(maxDepth, 3)
        : maxDepth

  const workState = cloneChessState(state)
  const rootSide = workState.turn
  const legalMoves = generateChessLegalMoves(workState)

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
    if (aborted) return evaluateChessState(workState, workState.turn)

    const standPat = evaluateChessState(workState, workState.turn)
    if (qDepth <= 0) return standPat
    if (standPat >= beta) return beta
    if (standPat > alpha) alpha = standPat

    const captures = generateChessLegalMoves(workState, true)
    orderMoves(captures, null, null)

    for (const move of captures) {
      const undo = makeChessMoveInPlace(workState, move)
      const score = -quiescence(-beta, -alpha, qDepth - 1)
      unmakeChessMoveInPlace(workState, undo)
      if (aborted) return alpha
      if (score >= beta) return beta
      if (score > alpha) alpha = score
    }
    return alpha
  }

  function alphaBeta(depth, ply, alpha, beta) {
    checkTime()
    if (aborted) return evaluateChessState(workState, workState.turn)

    const key = buildChessKey(workState)
    const ttEntry = tt.get(key)
    if (ttEntry && ttEntry.depth >= depth) {
      if (ttEntry.flag === 'EXACT') return ttEntry.score
      if (ttEntry.flag === 'LOWER' && ttEntry.score >= beta) return ttEntry.score
      if (ttEntry.flag === 'UPPER' && ttEntry.score <= alpha) return ttEntry.score
    }

    if (depth <= 0) {
      return quiescence(alpha, beta, 2)
    }

    const moves = generateChessLegalMoves(workState)
    if (moves.length === 0) {
      if (isChessInCheck(workState, workState.turn)) {
        return -MATE_SCORE + ply
      }
      return 0 // 逼和
    }

    orderMoves(moves, ttEntry ? ttEntry.bestUci : null, killers[ply])

    const origAlpha = alpha
    let bestScore = -Infinity
    let bestUci = moves[0].uci

    for (const move of moves) {
      const undo = makeChessMoveInPlace(workState, move)
      const score = -alphaBeta(depth - 1, ply + 1, -beta, -alpha)
      unmakeChessMoveInPlace(workState, undo)

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

  orderMoves(legalMoves, null, null)
  const rootScores = new Map()
  for (const m of legalMoves) {
    const undo = makeChessMoveInPlace(workState, m)
    const s = -evaluateChessState(workState, workState.turn)
    unmakeChessMoveInPlace(workState, undo)
    rootScores.set(m.uci, s)
  }

  let depthReached = 0
  for (let depth = 1; depth <= effectiveMaxDepth; depth++) {
    const iterScores = new Map()
    legalMoves.sort((a, b) => {
      const sb = rootScores.has(b.uci) ? rootScores.get(b.uci) : 0
      const sa = rootScores.has(a.uci) ? rootScores.get(a.uci) : 0
      return sb - sa
    })

    let iterCompleted = true
    for (const move of legalMoves) {
      const undo = makeChessMoveInPlace(workState, move)
      const score = -alphaBeta(depth - 1, 1, -MATE_SCORE, MATE_SCORE)
      unmakeChessMoveInPlace(workState, undo)

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

  const rankedMoves = legalMoves.slice().sort((a, b) => {
    const sb = rootScores.has(b.uci) ? rootScores.get(b.uci) : 0
    const sa = rootScores.has(a.uci) ? rootScores.get(a.uci) : 0
    return sb - sa
  })

  const { selectedMoves, tagsByUci, bestEvalCp } = pickTieredCandidatesWithTags(
    rankedMoves,
    rootScores,
    {
      topK,
      difficulty: normDifficulty,
      mateScore: MATE_SCORE
    }
  )
  const candidates = []

  const pickChessFallbackMove = (curState, oppMoves) => {
    let bestM = oppMoves[0]
    let bestS = -Infinity
    for (let j = 0; j < oppMoves.length; j++) {
      const m = oppMoves[j]
      const u = makeChessMoveInPlace(curState, m)
      const s = -evaluateChessState(curState, curState.turn)
      unmakeChessMoveInPlace(curState, u)
      if (s > bestS) {
        bestS = s
        bestM = m
      }
    }
    return bestM
  }

  for (let i = 0; i < selectedMoves.length; i++) {
    const move = selectedMoves[i]
    const undo = makeChessMoveInPlace(workState, move)
    const isCheck = isChessInCheck(workState, workState.turn)
    const oppMoves = isCheck ? generateChessLegalMoves(workState) : null
    const suffix = isCheck ? (oppMoves.length === 0 ? '#' : '+') : ''
    unmakeChessMoveInPlace(workState, undo)

    const notation = moveToChessNotation(state, move, legalMoves, suffix)
    const pvInfo =
      i < 3
        ? extractPvSequence({
            workState,
            rootMove: move,
            rootLegalMoves: legalMoves,
            maxPlies: 3,
            tt,
            buildKey: buildChessKey,
            makeMove: makeChessMoveInPlace,
            unmakeMove: unmakeChessMoveInPlace,
            getLegalMoves: generateChessLegalMoves,
            isInCheck: isChessInCheck,
            pickFallbackMove: pickChessFallbackMove,
            formatStep: (st, m, stepNum, _curLegal, chk, oppNoMoves) =>
              formatChessPvStep(st, m, stepNum, chk, oppNoMoves)
          })
        : { pv: [], pvUci: [] }

    candidates.push(
      createCandidateMove({
        uci: move.uci,
        score_cp: rootScores.has(move.uci)
          ? rootScores.get(move.uci)
          : evaluateChessState(state, rootSide),
        notation,
        is_capture: Boolean(move.captured) || Boolean(move.isEnPassant),
        is_check: isCheck,
        pv: pvInfo.pv,
        pv_uci: pvInfo.pvUci,
        tactics_tags: tagsByUci.get(move.uci) || []
      })
    )
  }

  return {
    candidates,
    bestEvalCp,
    depthReached,
    elapsedMs: Date.now() - startTime,
    nodes
  }
}
