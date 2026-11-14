/**
 * 中国象棋 9×10 棋盘状态与 WXF FEN 解析/生成
 * 坐标系约定：
 * - board[r][c]：r ∈ [0..9]（r=0 为黑方底线第9行，r=9 为红方底线第0行）；c ∈ [0..8]（a..i）
 * - 行动方：'w' 表示红方（先手），'b' 表示黑方
 */

export const INITIAL_XIANGQI_FEN =
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

export const XIANGQI_ROWS = 10
export const XIANGQI_COLS = 9

const PIECE_NORMALIZE_MAP = {
  E: 'B',
  e: 'b',
  H: 'N',
  h: 'n'
}

const VALID_PIECES = new Set([
  'K', 'A', 'B', 'N', 'R', 'C', 'P',
  'k', 'a', 'b', 'n', 'r', 'c', 'p'
])

export function isRedPiece(piece) {
  return Boolean(piece) && piece >= 'A' && piece <= 'Z'
}

export function isBlackPiece(piece) {
  return Boolean(piece) && piece >= 'a' && piece <= 'z'
}

export function getPieceSide(piece) {
  if (!piece) return null
  return isRedPiece(piece) ? 'w' : 'b'
}

/**
 * 解析 WXF FEN 字符串为内部棋盘状态
 * @param {string} fen
 */
export function parseXiangqiFen(fen = INITIAL_XIANGQI_FEN) {
  if (typeof fen !== 'string' || !fen.trim()) {
    throw new Error('Invalid Xiangqi FEN: empty string')
  }
  const parts = fen.trim().split(/\s+/)
  const boardPart = parts[0]
  const turnRaw = (parts[1] || 'w').toLowerCase()
  const turn = turnRaw === 'r' || turnRaw === 'w' ? 'w' : 'b'
  const halfmove = parts[4] ? Math.max(0, parseInt(parts[4], 10) || 0) : 0
  const fullmove = parts[5] ? Math.max(1, parseInt(parts[5], 10) || 1) : 1

  const ranks = boardPart.split('/')
  if (ranks.length !== XIANGQI_ROWS) {
    throw new Error(`Invalid Xiangqi FEN: expected 10 ranks, got ${ranks.length}`)
  }

  const board = Array.from({ length: XIANGQI_ROWS }, () =>
    Array(XIANGQI_COLS).fill(null)
  )

  let redKing = null
  let blackKing = null

  for (let r = 0; r < XIANGQI_ROWS; r++) {
    let c = 0
    for (const ch of ranks[r]) {
      if (ch >= '1' && ch <= '9') {
        c += parseInt(ch, 10)
      } else {
        const normalized = PIECE_NORMALIZE_MAP[ch] || ch
        if (!VALID_PIECES.has(normalized)) {
          throw new Error(`Invalid Xiangqi piece char: ${ch}`)
        }
        if (c >= XIANGQI_COLS) {
          throw new Error(`Invalid Xiangqi FEN rank width at row ${r}`)
        }
        board[r][c] = normalized
        if (normalized === 'K') redKing = { r, c }
        if (normalized === 'k') blackKing = { r, c }
        c++
      }
    }
    if (c !== XIANGQI_COLS) {
      throw new Error(`Invalid Xiangqi FEN rank width at row ${r}: ${c}`)
    }
  }

  return {
    board,
    turn,
    halfmove,
    fullmove,
    kings: { w: redKing, b: blackKing }
  }
}

/**
 * 将内部棋盘状态序列化为 WXF FEN 字符串
 */
export function serializeXiangqiFen(state) {
  const rankStrings = []
  for (let r = 0; r < XIANGQI_ROWS; r++) {
    let rowStr = ''
    let emptyCount = 0
    for (let c = 0; c < XIANGQI_COLS; c++) {
      const piece = state.board[r][c]
      if (!piece) {
        emptyCount++
      } else {
        if (emptyCount > 0) {
          rowStr += String(emptyCount)
          emptyCount = 0
        }
        rowStr += piece
      }
    }
    if (emptyCount > 0) {
      rowStr += String(emptyCount)
    }
    rankStrings.push(rowStr)
  }

  return `${rankStrings.join('/')} ${state.turn} - - ${state.halfmove} ${state.fullmove}`
}

export function cloneXiangqiState(state) {
  return {
    board: state.board.map((row) => row.slice()),
    turn: state.turn,
    halfmove: state.halfmove,
    fullmove: state.fullmove,
    kings: {
      w: state.kings.w ? { ...state.kings.w } : null,
      b: state.kings.b ? { ...state.kings.b } : null
    }
  }
}

/**
 * 在原地执行走法并返回回退快照（供搜索与悔棋使用）
 */
export function makeXiangqiMoveInPlace(state, move) {
  const { fromR, fromC, toR, toC } = move
  const piece = state.board[fromR][fromC]
  const captured = state.board[toR][toC]
  const prevTurn = state.turn
  const prevHalfmove = state.halfmove
  const prevFullmove = state.fullmove
  const prevRedKing = state.kings.w ? { ...state.kings.w } : null
  const prevBlackKing = state.kings.b ? { ...state.kings.b } : null

  state.board[toR][toC] = piece
  state.board[fromR][fromC] = null

  if (piece === 'K') state.kings.w = { r: toR, c: toC }
  if (piece === 'k') state.kings.b = { r: toR, c: toC }
  if (captured === 'K') state.kings.w = null
  if (captured === 'k') state.kings.b = null

  state.halfmove = captured ? 0 : prevHalfmove + 1
  if (prevTurn === 'b') {
    state.fullmove = prevFullmove + 1
  }
  state.turn = prevTurn === 'w' ? 'b' : 'w'

  return {
    move,
    piece,
    captured,
    prevTurn,
    prevHalfmove,
    prevFullmove,
    prevRedKing,
    prevBlackKing
  }
}

export function unmakeXiangqiMoveInPlace(state, undo) {
  const { fromR, fromC, toR, toC } = undo.move
  state.board[fromR][fromC] = undo.piece
  state.board[toR][toC] = undo.captured
  state.turn = undo.prevTurn
  state.halfmove = undo.prevHalfmove
  state.fullmove = undo.prevFullmove
  state.kings.w = undo.prevRedKing
  state.kings.b = undo.prevBlackKing
}
