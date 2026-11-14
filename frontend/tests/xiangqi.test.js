import test from 'node:test'
import assert from 'node:assert/strict'

import {
  INITIAL_XIANGQI_FEN,
  parseXiangqiFen,
  serializeXiangqiFen,
  makeXiangqiMoveInPlace
} from '../engine/xiangqi/board.js'
import {
  generateXiangqiLegalMoves,
  getXiangqiGameStatus,
  isKingsFacing
} from '../engine/xiangqi/rules.js'
import {
  coordsToXiangqiUci,
  xiangqiUciToCoords,
  moveToXiangqiNotation
} from '../engine/xiangqi/uci.js'
import { searchXiangqiTopCandidates } from '../engine/xiangqi/search.js'
import { XIANGQI_UCI_REGEX } from '../engine/common/types.js'

test('Xiangqi FEN parse & serialize round-trip', () => {
  const state = parseXiangqiFen(INITIAL_XIANGQI_FEN)
  assert.equal(serializeXiangqiFen(state), INITIAL_XIANGQI_FEN)
})

test('Xiangqi initial position has exactly 44 legal moves', () => {
  const state = parseXiangqiFen(INITIAL_XIANGQI_FEN)
  const moves = generateXiangqiLegalMoves(state)
  assert.equal(moves.length, 44)
})

test('Xiangqi UCI and Chinese notation match API_SPEC examples', () => {
  const state = parseXiangqiFen(INITIAL_XIANGQI_FEN)
  const moves = generateXiangqiLegalMoves(state)

  const h2e2 = moves.find((m) => m.uci === 'h2e2')
  assert.ok(h2e2)
  assert.equal(moveToXiangqiNotation(state, h2e2), '炮二平五')

  const b0c2 = moves.find((m) => m.uci === 'b0c2')
  assert.ok(b0c2)
  assert.equal(moveToXiangqiNotation(state, b0c2), '马八进七')

  makeXiangqiMoveInPlace(state, h2e2)
  assert.equal(
    serializeXiangqiFen(state),
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 1 1'
  )

  const blackMoves = generateXiangqiLegalMoves(state)
  const b9c7 = blackMoves.find((m) => m.uci === 'b9c7')
  const h7e7 = blackMoves.find((m) => m.uci === 'h7e7')
  assert.equal(moveToXiangqiNotation(state, b9c7), '马2进3')
  assert.equal(moveToXiangqiNotation(state, h7e7), '炮8平5')
})

test('Xiangqi forbids flying general (kings facing)', () => {
  // 红帅 e0 与黑将 e9 之间仅隔一个红仕 e1，红仕不能平移出 e 线导致照面
  const fen = '4k4/9/9/9/9/9/9/9/4A4/4K4 w - - 0 1'
  const state = parseXiangqiFen(fen)
  const moves = generateXiangqiLegalMoves(state)
  for (const m of moves) {
    const clone = parseXiangqiFen(serializeXiangqiFen(state))
    makeXiangqiMoveInPlace(clone, m)
    assert.equal(isKingsFacing(clone), false)
  }
})

test('Xiangqi checkmate and stalemate detection', () => {
  // 双车绝杀局：黑将 e9 被 d9 红车将军，d8 红车与 e0 红帅封锁全部退路
  const mateFen = '3Rk4/3R5/9/9/9/9/9/9/9/4K4 b - - 0 1'
  const mateState = parseXiangqiFen(mateFen)
  const status = getXiangqiGameStatus(mateState)
  assert.equal(status.isOver, true)
  assert.equal(status.result, 'checkmate')
  assert.equal(status.winner, 'w')

  // 困毙局（非将军但无子可走）：黑将 d9，红车 c8 封锁 c9 与 d8，红帅 e0 封锁 e9
  const staleFen = '3k5/2R6/9/9/9/9/9/9/9/4K4 b - - 0 1'
  const staleState = parseXiangqiFen(staleFen)
  const staleStatus = getXiangqiGameStatus(staleState)
  assert.equal(staleStatus.isOver, true)
  assert.equal(staleStatus.result, 'stalemate')
  assert.equal(staleStatus.winner, 'w')
})

test('Xiangqi Alpha-Beta returns sorted Top-5 candidates within 500ms', () => {
  const state = parseXiangqiFen(
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 0 1'
  )
  const result = searchXiangqiTopCandidates(state, {
    maxDepth: 3,
    topK: 5,
    timeBudgetMs: 420
  })

  assert.ok(result.elapsedMs < 500, `Expected < 500ms, got ${result.elapsedMs}ms`)
  assert.ok(result.candidates.length >= 3 && result.candidates.length <= 5)

  for (let i = 0; i < result.candidates.length; i++) {
    const c = result.candidates[i]
    assert.match(c.uci, XIANGQI_UCI_REGEX)
    assert.ok(c.notation.length > 0)
    if (i > 0) {
      assert.ok(result.candidates[i - 1].score_cp >= c.score_cp)
    }
  }
})

test('Xiangqi uci coordinate round-trip', () => {
  const uci = coordsToXiangqiUci(7, 7, 7, 4)
  assert.equal(uci, 'h2e2')
  assert.deepEqual(xiangqiUciToCoords(uci), { fromR: 7, fromC: 7, toR: 7, toC: 4 })
})

test('Xiangqi casual mode searches depth 2 and appends gentle suboptimal moves at the tail', () => {
  const state = parseXiangqiFen(
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 0 1'
  )
  const result = searchXiangqiTopCandidates(state, {
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
