/**
 * 候选步筛选策略：根据对局难度调整最终提交给后端大模型的候选集合
 * - balanced / tryhard：严格返回评估分最高的 Top-K
 * - casual（娱乐陪练）：保留前段稳健走法，同时在尾部混入 1~2 步温和次优步（-40~-130 cp），过滤直接白送大子的离谱步
 */

import { MATE_SCORE } from './types.js'

export function selectCandidatesByDifficulty(rankedMoves, rootScores, options = {}) {
  const {
    topK = 5,
    difficulty = 'balanced',
    mateScore = MATE_SCORE
  } = options

  if (!Array.isArray(rankedMoves) || rankedMoves.length === 0) {
    return []
  }

  if (difficulty !== 'casual') {
    const limit = Math.min(Math.max(1, topK), rankedMoves.length)
    return rankedMoves.slice(0, limit)
  }

  if (rankedMoves.length <= 2) {
    return rankedMoves.slice()
  }

  const gentleTarget = rankedMoves.length >= 5 ? 2 : 1
  const maxTotal = Math.min(10, Math.max(topK, 3) + gentleTarget)
  const frontLimit = Math.min(
    Math.max(2, Math.min(topK, maxTotal - gentleTarget)),
    rankedMoves.length - gentleTarget
  )

  const frontMoves = rankedMoves.slice(0, frontLimit)
  const remaining = rankedMoves.slice(frontLimit)
  const bestScore = rootScores.has(rankedMoves[0].uci) ? rootScores.get(rankedMoves[0].uci) : 0
  const mateThreshold = -(mateScore - 500)

  // 过滤掉直接白送大子或被绝杀的离谱步（delta < -160 cp）
  const nonBlunderPool = remaining.filter((m) => {
    const sc = rootScores.has(m.uci) ? rootScores.get(m.uci) : 0
    const delta = sc - bestScore
    return sc > mateThreshold && delta >= -160
  })

  const nonMatePool = remaining.filter((m) => {
    const sc = rootScores.has(m.uci) ? rootScores.get(m.uci) : 0
    return sc > mateThreshold
  })

  const searchPool =
    nonBlunderPool.length > 0
      ? nonBlunderPool
      : nonMatePool.length > 0
        ? nonMatePool
        : remaining

  const picked = []
  const pickedUcis = new Set()

  const pickFrom = (list) => {
    for (const m of list) {
      if (picked.length >= gentleTarget) break
      if (pickedUcis.has(m.uci)) continue
      picked.push(m)
      pickedUcis.add(m.uci)
    }
  }

  // 第一梯队：比最佳走法低 40~130 cp 的温和次优步（轻微位置劣势或丢小兵）
  const idealGentle = searchPool
    .filter((m) => {
      const sc = rootScores.has(m.uci) ? rootScores.get(m.uci) : 0
      const delta = sc - bestScore
      return delta <= -40 && delta >= -130
    })
    .sort((a, b) => {
      const da = (rootScores.get(a.uci) ?? 0) - bestScore
      const db = (rootScores.get(b.uci) ?? 0) - bestScore
      return Math.abs(da + 85) - Math.abs(db + 85)
    })
  pickFrom(idealGentle)

  // 第二梯队：若不足，则优先从轻微劣势（-15~-40 或 -130~-160）中按分差绝对值从小到大补充，避免白送大子
  if (picked.length < gentleTarget) {
    const nearGentle = searchPool
      .filter((m) => {
        const sc = rootScores.has(m.uci) ? rootScores.get(m.uci) : 0
        const delta = sc - bestScore
        return (delta > -40 && delta <= -15) || (delta < -130 && delta >= -160)
      })
      .sort((a, b) => (rootScores.get(b.uci) ?? 0) - (rootScores.get(a.uci) ?? 0))
    pickFrom(nearGentle)
  }

  // 第三梯队兜底：仅取温和池中分数最高的走法，绝不回退去抓末尾丢大子的恶手
  if (picked.length < gentleTarget && nonBlunderPool.length > 0) {
    pickFrom(nonBlunderPool)
  }

  picked.sort((a, b) => (rootScores.get(b.uci) ?? 0) - (rootScores.get(a.uci) ?? 0))

  return [...frontMoves, ...picked]
}
