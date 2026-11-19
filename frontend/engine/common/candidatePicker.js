/**
 * 候选步分级采样策略：按难度梯度控制提交给大模型的候选池与战术标签
 * - casual / easy（简单）：4~5 步温和候选池（2 个第 2~3 名正常稳健走法 + 2~3 个第 4~7 名略亏 -15~-50cp 的平庸缓手，标签 ["正常稳健"] / ["节奏放缓"]），严禁强塞大亏分送子漏招
 * - balanced / medium（中等）：传第 2~6 名稳健与次优走法，屏蔽第 1 名绝对杀招（除非必杀局）
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

function pickEasyGentlePool(rankedMoves, rootScores, mateThreshold) {
  const bestScore = getMoveScore(rootScores, rankedMoves[0])
  const safeMateFloor = -mateThreshold
  const targetTotal = Math.min(5, rankedMoves.length)
  const minDesired = Math.min(4, rankedMoves.length)

  const picked = []
  const tagsByUci = new Map()
  const seen = new Set()

  // 若仅有极少数合法走法或被迫解将，确保必保王安全
  if (rankedMoves.length <= 2) {
    rankedMoves.forEach((m, idx) => {
      addUniqueMove(picked, tagsByUci, seen, m, [idx === 0 ? '正常稳健' : '节奏放缓'])
    })
    return { selectedMoves: picked, tagsByUci }
  }

  // 1. 选取 2 个排名第 2~3 名的正常稳健走法（下标 1、2），保证基础看吃与防守意识
  const steadyIndices = [1, 2].filter((idx) => idx < rankedMoves.length)
  let steadyAdded = 0
  for (const idx of steadyIndices) {
    const m = rankedMoves[idx]
    const sc = getMoveScore(rootScores, m)
    const delta = sc - bestScore
    // 仅当该步非送王且未严重送大子（delta >= -90）时作为稳健步；否则回退至排名第 1 步保底防守
    if (sc > safeMateFloor && delta >= -90) {
      if (addUniqueMove(picked, tagsByUci, seen, m, ['正常稳健'])) {
        steadyAdded++
      }
    }
  }
  if (steadyAdded === 0) {
    addUniqueMove(picked, tagsByUci, seen, rankedMoves[0], ['正常稳健'])
    steadyAdded++
  }

  // 2. 选取 2 个（最多 3 个以组成 4~5 步温和池）排名第 4~7 名、分差略亏 -15 ~ -50 cp 的平庸缓手
  const slowDesired = Math.min(2, Math.max(0, targetTotal - picked.length))
  const slowCap = Math.min(3, Math.max(slowDesired, targetTotal - picked.length))
  const rank4To7 = rankedMoves.slice(3, 7)

  const primarySlow = rank4To7.filter((m) => {
    const sc = getMoveScore(rootScores, m)
    const delta = sc - bestScore
    return !seen.has(m.uci) && sc > safeMateFloor && delta <= -15 && delta >= -50
  })
  const extendedSlowRange = rankedMoves.slice(3).filter((m) => {
    const sc = getMoveScore(rootScores, m)
    const delta = sc - bestScore
    return !seen.has(m.uci) && sc > safeMateFloor && delta <= -15 && delta >= -50
  })
  // 若局部无严格落在 -15~-50cp 的走法，优先在温和区 [-75, 0] 内就近选，严禁抓取 <= -120cp 的白送大子漏招
  const gentleFallback = rank4To7
    .concat(rankedMoves.slice(7))
    .filter((m) => {
      const sc = getMoveScore(rootScores, m)
      const delta = sc - bestScore
      return !seen.has(m.uci) && sc > safeMateFloor && delta >= -75
    })
    .sort((a, b) => {
      const da = Math.abs(getMoveScore(rootScores, a) - bestScore + 32)
      const db = Math.abs(getMoveScore(rootScores, b) - bestScore + 32)
      return da - db
    })

  let slowAdded = 0
  // 主池允许凑齐 2~3 步（总池 4~5 步）；回退池仅补足到至少 2 步平庸缓手
  for (const m of primarySlow) {
    if (slowAdded >= slowCap || picked.length >= targetTotal) break
    if (addUniqueMove(picked, tagsByUci, seen, m, ['节奏放缓'])) {
      slowAdded++
    }
  }
  for (const pool of [extendedSlowRange, gentleFallback]) {
    if (slowAdded >= slowDesired) break
    for (const m of pool) {
      if (slowAdded >= slowDesired || picked.length >= targetTotal) break
      if (addUniqueMove(picked, tagsByUci, seen, m, ['节奏放缓'])) {
        slowAdded++
      }
    }
  }

  // 3. 若因局面极其尖锐（几乎只剩少数不亏大子的应手）导致候选不足 4 个，仅补足温和走法，必要时纳入第 1 名避免塞入送子恶手
  if (picked.length < minDesired) {
    const safeRemaining = rankedMoves
      .slice(1)
      .filter((m) => {
        const sc = getMoveScore(rootScores, m)
        return !seen.has(m.uci) && sc > safeMateFloor && sc - bestScore >= -85
      })
    for (const m of safeRemaining) {
      if (picked.length >= minDesired) break
      addUniqueMove(picked, tagsByUci, seen, m, ['节奏放缓'])
    }
  }
  if (picked.length < minDesired && !seen.has(rankedMoves[0].uci)) {
    addUniqueMove(picked, tagsByUci, seen, rankedMoves[0], ['正常稳健'])
  }
  if (picked.length < minDesired) {
    for (const m of rankedMoves) {
      if (picked.length >= minDesired) break
      if (getMoveScore(rootScores, m) > safeMateFloor) {
        addUniqueMove(picked, tagsByUci, seen, m, ['节奏放缓'])
      }
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
    const res = pickEasyGentlePool(rankedMoves, rootScores, mateThreshold)
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
