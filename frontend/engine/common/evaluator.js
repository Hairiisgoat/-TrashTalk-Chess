/**
 * 评估分转胜率工具 (centipawn -> 胜率与 win_rate_delta 计算)
 * 严格遵循 API_SPEC.md：
 * - 胜率始终锁定在 [0.1, 99.9] 闭区间，避免极值舍入成 0/100 触发 UI 兜底回跳
 * - win_rate_delta 范围为 [-100.0, 100.0]
 * - 正值代表 AI 胜率上升，负值代表 AI 胜率下降
 */

import { MATE_SCORE } from './types.js'

const WIN_RATE_SCALE = 300
const MIN_WIN_RATE = 0.1
const MAX_WIN_RATE = 99.9

/**
 * 将厘兵分转换为 [0.1, 99.9] 区间胜率百分比（保留 1 位小数）
 * @param {number} cp 厘兵分（正值代表该视角占优）
 * @returns {number}
 */
export function cpToWinRate(cp) {
  if (typeof cp !== 'number' || Number.isNaN(cp)) return 50.0
  if (cp === Infinity || cp >= MATE_SCORE - 500) return MAX_WIN_RATE
  if (cp === -Infinity || cp <= -(MATE_SCORE - 500)) return MIN_WIN_RATE
  const raw = 100 / (1 + Math.exp(-cp / WIN_RATE_SCALE))
  const rounded = Math.round(raw * 10) / 10
  return Math.max(MIN_WIN_RATE, Math.min(MAX_WIN_RATE, rounded))
}

/**
 * 计算单步落子后的 AI 视角胜率变化值 (百分点)
 * @param {number} prevEvalCpForAi 玩家落子前 AI 视角的评估分
 * @param {number} currEvalCpForAi 玩家落子后 AI 视角的评估分
 * @returns {number} [-100.0, 100.0]
 */
export function calcWinRateDelta(prevEvalCpForAi, currEvalCpForAi) {
  const prevWr = cpToWinRate(prevEvalCpForAi)
  const currWr = cpToWinRate(currEvalCpForAi)
  const delta = Math.round((currWr - prevWr) * 10) / 10
  return Math.max(-100.0, Math.min(100.0, delta))
}
