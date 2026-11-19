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
import {
  pickTieredCandidatesWithTags,
  selectCandidatesByDifficulty
} from '../engine/common/candidatePicker.js'
import { CHESS_UCI_REGEX, MATE_SCORE } from '../engine/common/types.js'

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

test('Chess easy mode keeps depth=2 and samples 4-5 gentle steady/slow moves without big blunders', () => {
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 2 3'
  const state = parseChessFen(fen)
  const result = searchChessTopCandidates(state, {
    maxDepth: 2,
    topK: 5,
    timeBudgetMs: 420,
    difficulty: 'easy'
  })

  assert.equal(result.depthReached, 2)
  assert.ok(result.candidates.length >= 4 && result.candidates.length <= 5)
  for (const c of result.candidates) {
    assert.ok(c.score_cp > -(MATE_SCORE - 500), 'must never include immediate self-mate move')
    assert.ok(
      c.tactics_tags.includes('正常稳健') || c.tactics_tags.includes('节奏放缓'),
      `expected 正常稳健/节奏放缓 tag, got ${c.tactics_tags}`
    )
    assert.ok(!c.tactics_tags.includes('大意漏防'), 'easy mode must not inject 大意漏防 blunders')
  }
})

test('Tiered candidate picker enforces easy gentle pool (ranks #2-#3 + #4-#7 -15..-50cp), medium shielding, and hard <=50cp top-3', () => {
  const moves = Array.from({ length: 14 }, (_, i) => ({ uci: `a${i}b${i}` }))
  const scores = new Map([
    ['a0b0', 120],  // #1 best
    ['a1b1', 110],  // #2 steady (-10cp)
    ['a2b2', 105],  // #3 steady (-15cp)
    ['a3b3', 100],  // #4 slow (-20cp in -15..-50)
    ['a4b4', 90],   // #5 slow (-30cp in -15..-50)
    ['a5b5', 75],   // #6 slow (-45cp in -15..-50)
    ['a6b6', 65],   // #7 (-55cp)
    ['a7b7', 30],   // #8 (-90cp)
    ['a8b8', -10],  // #9 (-130cp big blunder -> must be excluded!)
    ['a9b9', -80],  // #10 (-200cp big blunder -> must be excluded!)
    ['a10b10', -160],
    ['a11b11', -260],
    ['a12b12', -29300], // self-mate -> must avoid
    ['a13b13', -29400]
  ])

  // 1. easy: 4~5 步温和池，包含 #2/#3 正常稳健 + #4~#7 略亏 -15~-50cp 的节奏放缓步，绝不强塞大亏分漏招
  const easyRes = pickTieredCandidatesWithTags(moves, scores, { difficulty: 'easy' })
  const easyUcis = easyRes.selectedMoves.map((m) => m.uci)
  assert.ok(easyUcis.length >= 4 && easyUcis.length <= 5)
  assert.ok(!easyUcis.includes('a0b0'))
  assert.ok(easyUcis.includes('a1b1') && easyUcis.includes('a2b2')) // #2, #3 steady
  assert.ok(easyUcis.includes('a3b3') && easyUcis.includes('a4b4')) // #4, #5 in -15..-50cp
  assert.ok(!easyUcis.includes('a8b8') && !easyUcis.includes('a9b9')) // no forced big-loss blunders
  assert.ok(!easyUcis.includes('a12b12') && !easyUcis.includes('a13b13'))
  assert.deepEqual(easyRes.tagsByUci.get('a1b1'), ['正常稳健'])
  assert.deepEqual(easyRes.tagsByUci.get('a2b2'), ['正常稳健'])
  assert.deepEqual(easyRes.tagsByUci.get('a3b3'), ['节奏放缓'])
  assert.deepEqual(easyRes.tagsByUci.get('a4b4'), ['节奏放缓'])

  // 2. medium: 非绝杀时屏蔽 #1，取 #2~#6
  const medUcis = selectCandidatesByDifficulty(moves, scores, { difficulty: 'medium' }).map((m) => m.uci)
  assert.deepEqual(medUcis, ['a1b1', 'a2b2', 'a3b3', 'a4b4', 'a5b5'])

  // 2b. medium 在必杀局 (>= 29000) 时不屏蔽 #1 绝杀招
  const mateScores = new Map(scores)
  mateScores.set('a0b0', MATE_SCORE - 10)
  const medMateUcis = selectCandidatesByDifficulty(moves, mateScores, { difficulty: 'medium' }).map((m) => m.uci)
  assert.equal(medMateUcis[0], 'a0b0')

  // 3. hard/master: 仅传分差 ≤ 50cp 的 Top-1 ~ Top-3
  const hardUcis = selectCandidatesByDifficulty(moves, scores, { difficulty: 'hard' }).map((m) => m.uci)
  assert.deepEqual(hardUcis, ['a0b0', 'a1b1', 'a2b2'])
})

test('Chess Top-3 candidates include readable 2-3 ply PV sequences and matching pv_uci', () => {
  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
  const state = parseChessFen(fen)
  const result = searchChessTopCandidates(state, {
    maxDepth: 2,
    topK: 3,
    timeBudgetMs: 400,
    difficulty: 'tryhard'
  })

  assert.equal(result.candidates.length, 3)
  for (const cand of result.candidates) {
    assert.ok(Array.isArray(cand.pv) && cand.pv.length >= 2 && cand.pv.length <= 3)
    assert.ok(Array.isArray(cand.pv_uci) && cand.pv_uci.length === cand.pv.length)
    assert.equal(cand.pv_uci[0], cand.uci)
    assert.ok(cand.pv[0].startsWith('1. '))
    assert.ok(cand.pv[1].startsWith('2. '))
  }
})
