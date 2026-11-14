/**
 * 端侧双棋种引擎通用类型定义与格式校验工具
 * 严格对齐 API_SPEC.md 第 2、3 节
 */

export const GAME_TYPE = {
  XIANGQI: 'xiangqi',
  CHESS: 'chess'
}

export const SIDE = {
  WHITE_OR_RED: 'w',
  BLACK: 'b'
}

export const HISTORY_SIDE = {
  PLAYER: 'player',
  AI: 'ai'
}

export const XIANGQI_UCI_REGEX = /^[a-i][0-9][a-i][0-9]$/
export const CHESS_UCI_REGEX = /^[a-h][1-8][a-h][1-8][qrbn]?$/

export const MATE_SCORE = 29500
export const MAX_CP = 30000

/**
 * 校验 UCI 字符串是否符合对应棋种规范
 */
export function isValidUci(gameType, uci) {
  if (typeof uci !== 'string') return false
  if (gameType === GAME_TYPE.XIANGQI) {
    return XIANGQI_UCI_REGEX.test(uci)
  }
  if (gameType === GAME_TYPE.CHESS) {
    return CHESS_UCI_REGEX.test(uci)
  }
  return false
}

/**
 * 构造符合 API_SPEC.md CandidateMove 契约的对象
 */
export function createCandidateMove({
  uci,
  score_cp,
  notation = '',
  is_capture = false,
  is_check = false
}) {
  const numericScore = Number(score_cp)
  const safeScore = Number.isFinite(numericScore) ? numericScore : 0
  const clampedScore = Math.max(-MAX_CP, Math.min(MAX_CP, Math.round(safeScore)))
  return {
    uci,
    score_cp: clampedScore,
    notation: String(notation || '').slice(0, 24),
    is_capture: Boolean(is_capture),
    is_check: Boolean(is_check)
  }
}

/**
 * 构造符合 API_SPEC.md HistoryItem 契约的对象
 */
export function createHistoryItem({
  side,
  uci,
  notation = '',
  eval_cp_after = 0
}) {
  return {
    side,
    uci,
    notation: String(notation || '').slice(0, 24),
    eval_cp_after: Math.max(-MAX_CP, Math.min(MAX_CP, Math.round(eval_cp_after)))
  }
}
