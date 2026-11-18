/**
 * 候选步分级采样策略：按难度梯度控制提交给大模型的候选池与战术标签
 * - casual / easy（简单）：混合候选池（1个第3~4名常规步 + 2~3个第6~12名(-30~-120cp)平庸步 + 1个非送王漏招），标为 ["节奏放缓"] / ["大意漏防"]
 * - balanced / medium（中等）：传第2~6名稳健与次优走法，屏蔽第1名绝对杀招（除非必杀局）
 * - tryhard / hard / master（困难/大师）：仅传分差 ≤ 50cp 的 Top-1 ~ Top-3 最优候选步
 */

import { MATE_SCORE } from './types.js'

const DIFFICULTY_ALIASES = {
  easy: 'casual',
  casual: 'casual',
  medium: 'balanced',
  balanced: 'balanced',
  hard: 'tryhard',
  master: 'tryhard',
  tryhard: 'tryhard'
}

export function normalizeDifficulty(difficulty = 'balanced') {
  const key = String(difficulty || 'balanced').trim().toLowerCase()
  return DIFFICULTY_ALIASES[key] || 'balanced'
}

function getMoveScore(rootScores, move) {
  return rootScores && rootScores.has(move.uci) ? rootScores.get(move.uci) : 0
}

function addUniqueMove(picked, tagsByUci, seen, move, tags) {
  if (!move || seen.has(move.uci)) return false
  seen.add(move.uci)
  picked.push(move)
  tagsByUci.set(move.uci, tags.slice())
  return true
}

function pickEasyMixedPool(rankedMoves, rootScores, mateThreshold) {
  const bestScore = getMoveScore(rootScores, rankedMoves[0])
  const safeMateFloor = -mateThreshold
  const targetTotal = Math.min(6, rankedMoves.length)

  const picked = []
  const tagsByUci = new Map()
  const seen = new Set()

  // 1. 1 个排名第 3~4 的常规步（下标 2 或 3，不足时向内退让）
  const steadyOrder = [2, 3, 1, 0].filter((idx) => idx < rankedMoves.length)
  for (const idx of steadyOrder) {
    const m = rankedMoves[idx]
    if (getMoveScore(rootScores, m) > safeMateFloor || idx === steadyOrder[steadyOrder.length - 1]) {
      addUniqueMove(picked, tagsByUci, seen, m, ['节奏放缓'])
      break
    }
  }

  // 2. 2~3 个排名中游（第 6~12 名、分差略亏 30~120 cp）的平庸步
  const midTargetCount = Math.min(3, Math.max(0, targetTotal - 2))
  const midSlice = rankedMoves.slice(5, 12)
  const primaryMid = midSlice.filter((m) => {
    const sc = getMoveScore(rootScores, m)
    const delta = sc - bestScore
    return !seen.has(m.uci) && sc > safeMateFloor && delta <= -30 && delta >= -120
  })
  const fallbackMidRange = rankedMoves.slice(2).filter((m) => {
    const sc = getMoveScore(rootScores, m)
    const delta = sc - bestScore
    return !seen.has(m.uci) && sc > safeMateFloor && delta <= -30 && delta >= -120
  })
  const fallbackMidGentle = rankedMoves
    .slice(2)
    .filter((m) => {
      const sc = getMoveScore(rootScores, m)
      const delta = sc - bestScore
      return !seen.has(m.uci) && sc > safeMateFloor && delta >= -160
    })
    .sort((a, b) => {
      const da = Math.abs(getMoveScore(rootScores, a) - bestScore + 75)
      const db = Math.abs(getMoveScore(rootScores, b) - bestScore + 75)
      return da - db
    })

  let midAdded = 0
  for (const pool of [primaryMid, fallbackMidRange, fallbackMidGentle]) {
    for (const m of pool) {
      if (midAdded >= midTargetCount) break
      if (addUniqueMove(picked, tagsByUci, seen, m, ['节奏放缓'])) {
        midAdded++
      }
    }
    if (midAdded >= midTargetCount) break
  }

  // 3. 1 个非送王但存在局部破绽的“漏招”（若存在：非绝杀、比最优低 125~420 cp）
  const blunderCandidates = rankedMoves
    .slice(3)
    .filter((m) => {
      const sc = getMoveScore(rootScores, m)
      const delta = sc - bestScore
      return !seen.has(m.uci) && sc > safeMateFloor && delta < -120 && delta >= -420
    })
    .sort((a, b) => {
      const da = Math.abs(getMoveScore(rootScores, a) - bestScore + 210)
      const db = Math.abs(getMoveScore(rootScores, b) - bestScore + 210)
      return da - db
    })

  if (blunderCandidates.length > 0 && picked.length < targetTotal) {
    addUniqueMove(picked, tagsByUci, seen, blunderCandidates[0], ['大意漏防'])
  }

  // 4. 若候选数量不足 5 个，先从中下游非送王走法补足，最后才兜底极少步局面
  const minDesired = Math.min(5, rankedMoves.length)
  if (picked.length < minDesired) {
    const nonMateFallback = rankedMoves
      .slice(2)
      .filter((m) => !seen.has(m.uci) && getMoveScore(rootScores, m) > safeMateFloor)
    for (const m of nonMateFallback) {
      if (picked.length >= targetTotal) break
      addUniqueMove(picked, tagsByUci, seen, m, ['节奏放缓'])
    }
  }
  if (picked.length < minDesired) {
    for (const m of rankedMoves) {
      if (picked.length >= minDesired) break
      addUniqueMove(picked, tagsByUci, seen, m, ['节奏放缓'])
    }
  }

  picked.sort((a, b) => getMoveScore(rootScores, b) - getMoveScore(rootScores, a))
  return { selectedMoves: picked, tagsByUci }
}

function pickMediumBalancedPool(rankedMoves, rootScores, mateThreshold) {
  const bestScore = getMoveScore(rootScores, rankedMoves[0])
  const isForcedMateOrSingle = bestScore >= mateThreshold || rankedMoves.length === 1
  const tagsByUci = new Map()

  if (isForcedMateOrSingle) {
    const picked = rankedMoves.slice(0, Math.min(5, rankedMoves.length))
    picked.forEach((m, idx) => {
      tagsByUci.set(m.uci, [idx === 0 ? '必杀首选' : '稳健均衡'])
    })
    return { selectedMoves: picked, tagsByUci }
  }

  // 屏蔽排名第 1 的绝对最优杀招，选取排名第 2~6 的稳健与次优走法
  const picked = rankedMoves.slice(1, Math.min(6, rankedMoves.length))
  const secondScore = getMoveScore(rootScores, picked[0])
  picked.forEach((m) => {
    const gap = secondScore - getMoveScore(rootScores, m)
    tagsByUci.set(m.uci, [gap <= 45 ? '稳健均衡' : '次优试探'])
  })
  return { selectedMoves: picked, tagsByUci }
}

function pickHardMasterPool(rankedMoves, rootScores) {
  const bestScore = getMoveScore(rootScores, rankedMoves[0])
  const top3 = rankedMoves.slice(0, Math.min(3, rankedMoves.length))
  const picked = top3.filter((m, idx) => idx === 0 || bestScore - getMoveScore(rootScores, m) <= 50)
  const tagsByUci = new Map()

  picked.forEach((m, idx) => {
    tagsByUci.set(m.uci, [idx === 0 ? '最优杀招' : '强力压迫'])
  })
  return { selectedMoves: picked, tagsByUci }
}

/**
 * 分级采样并返回候选步列表及每个走法对应的分级战术标签
 */
export function pickTieredCandidatesWithTags(rankedMoves, rootScores, options = {}) {
  const {
    difficulty = 'balanced',
    mateScore = MATE_SCORE
  } = options

  if (!Array.isArray(rankedMoves) || rankedMoves.length === 0) {
    return { selectedMoves: [], tagsByUci: new Map(), bestEvalCp: 0 }
  }

  const normalized = normalizeDifficulty(difficulty)
  const mateThreshold = mateScore - 500
  const bestEvalCp = getMoveScore(rootScores, rankedMoves[0])

  if (normalized === 'casual') {
    const res = pickEasyMixedPool(rankedMoves, rootScores, mateThreshold)
    return { ...res, bestEvalCp }
  }
  if (normalized === 'tryhard') {
    const res = pickHardMasterPool(rankedMoves, rootScores)
    return { ...res, bestEvalCp }
  }
  const res = pickMediumBalancedPool(rankedMoves, rootScores, mateThreshold)
  return { ...res, bestEvalCp }
}

/**
 * 向后兼容的候选筛选函数，返回挑选后的走法数组
 */
export function selectCandidatesByDifficulty(rankedMoves, rootScores, options = {}) {
  return pickTieredCandidatesWithTags(rankedMoves, rootScores, options).selectedMoves
}
