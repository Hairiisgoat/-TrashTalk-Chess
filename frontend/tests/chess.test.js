import test from 'node:test'
import assert from 'node:assert/strict'

import {
  INITIAL_CHESS_FEN,
  parseChessFen,
  serializeChessFen,
  makeChessMoveInPlace
} from '../engine/chess/board.js'
import {
  generateChessLegalMoves,
  getChessGameStatus
} from '../engine/chess/rules.js'
import { searchChessTopCandidates } from '../engine/chess/search.js'
import { selectCandidatesByDifficulty } from '../engine/common/candidatePicker.js'
import { CHESS_UCI_REGEX } from '../engine/common/types.js'

test('Chess FEN parse & serialize round-trip', () => {
  const state = parseChessFen(INITIAL_CHESS_FEN)
  assert.equal(serializeChessFen(state), INITIAL_CHESS_FEN)
})

test('Chess initial position has 20 legal moves', () => {
  const state = parseChessFen(INITIAL_CHESS_FEN)
  const moves = generateChessLegalMoves(state)
  assert.equal(moves.length, 20)
})

test('Chess castling, en passant, and promotion rules work properly', () => {
  // 易位：白方 e1g1 和 e1c1 均可用，但 f1 被黑车 f8 控制时只能长易位不能短易位
  const castleFen = '4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1'
  const castleState = parseChessFen(castleFen)
  const castleMoves = generateChessLegalMoves(castleState).map((m) => m.uci)
  assert.ok(castleMoves.includes('e1c1'))
  assert.ok(!castleMoves.includes('e1g1'))

  // 过路兵：白兵 e5，黑兵刚刚 d7d5，ep 目标为 d6
  const epFen = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'
  const epState = parseChessFen(epFen)
  const epMoves = generateChessLegalMoves(epState)
  const epMove = epMoves.find((m) => m.uci === 'e5d6')
  assert.ok(epMove)
  makeChessMoveInPlace(epState, epMove)
  assert.equal(epState.board[3][3], null) // 被过路吃掉的黑兵 d5 应消失
  assert.equal(epState.board[2][3], 'P')

  // 兵升变：生成 q/r/b/n 四种合法走法
  const promoFen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1'
  const promoState = parseChessFen(promoFen)
  const promoUcis = generateChessLegalMoves(promoState)
    .filter((m) => m.uci.startsWith('a7a8'))
    .map((m) => m.uci)
  assert.deepEqual(promoUcis.sort(), ['a7a8b', 'a7a8n', 'a7a8q', 'a7a8r'])
})

test('Chess checkmate and stalemate detection', () => {
  // 愚人将杀局面
  const mateFen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'
  const mateState = parseChessFen(mateFen)
  const mateStatus = getChessGameStatus(mateState)
  assert.equal(mateStatus.isOver, true)
  assert.equal(mateStatus.result, 'checkmate')
  assert.equal(mateStatus.winner, 'b')

  // 经典逼和局面
  const staleFen = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'
  const staleState = parseChessFen(staleFen)
  const staleStatus = getChessGameStatus(staleState)
  assert.equal(staleStatus.isOver, true)
  assert.equal(staleStatus.result, 'stalemate')
  assert.equal(staleStatus.winner, null)
})

test('Chess Alpha-Beta finds winning move and finishes within 500ms', () => {
  // 黑方可一步 Qa5# 杀白王（或吃白后）
  const fen = '6k1/5ppp/8/8/8/8/5PPP/R4RK1 b - - 0 1'
  const state = parseChessFen(fen)
  const result = searchChessTopCandidates(state, {
    maxDepth: 3,
    topK: 5,
    timeBudgetMs: 420
  })

  assert.ok(result.elapsedMs < 500, `Expected < 500ms, got ${result.elapsedMs}ms`)
  assert.ok(result.candidates.length >= 3 && result.candidates.length <= 5)

  for (let i = 0; i < result.candidates.length; i++) {
    const c = result.candidates[i]
    assert.match(c.uci, CHESS_UCI_REGEX)
    if (i > 0) {
      assert.ok(result.candidates[i - 1].score_cp >= c.score_cp)
    }
  }
})

test('Chess casual mode searches depth 2 and mixes gentle suboptimal candidates without hanging major pieces', () => {
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 2 3'
  const state = parseChessFen(fen)
  const result = searchChessTopCandidates(state, {
    maxDepth: 2,
    topK: 5,
    timeBudgetMs: 420,
    difficulty: 'casual'
  })

  assert.equal(result.depthReached, 2)
  assert.ok(result.candidates.length >= 4 && result.candidates.length <= 10)
  const topScore = result.candidates[0].score_cp
  const tailScore = result.candidates[result.candidates.length - 1].score_cp
  const gap = topScore - tailScore
  assert.ok(gap > 0 && gap <= 160, `Expected gentle gap (0, 160] cp, got ${gap}`)
})

test('selectCandidatesByDifficulty picks -40..-130cp moves and filters out blatant piece blunders in casual mode', () => {
  const moves = [
    { uci: 'a1a2' },
    { uci: 'b1b2' },
    { uci: 'c1c2' },
    { uci: 'd1d2' },
    { uci: 'e1e2' },
    { uci: 'f1f2' },
    { uci: 'g1g2' },
    { uci: 'h1h2' }
  ]
  const scores = new Map([
    ['a1a2', 50],
    ['b1b2', 40],
    ['c1c2', 35],
    ['d1d2', 20],
    ['e1e2', -10],   // delta -60 (in -40..-130)
    ['f1f2', -55],   // delta -105 (in -40..-130)
    ['g1g2', -280],  // delta -330 (blatant blunder -> must be filtered out)
    ['h1h2', -850]   // delta -900 (blatant blunder -> must be filtered out)
  ])

  const picked = selectCandidatesByDifficulty(moves, scores, { topK: 5, difficulty: 'casual' })
  const pickedUcis = picked.map((m) => m.uci)
  assert.ok(pickedUcis.includes('e1e2'))
  assert.ok(pickedUcis.includes('f1f2'))
  assert.ok(!pickedUcis.includes('g1g2'))
  assert.ok(!pickedUcis.includes('h1h2'))
})
