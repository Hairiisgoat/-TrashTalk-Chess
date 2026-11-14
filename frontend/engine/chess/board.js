/**
 * 国际象棋 8×8 棋盘状态与标准 FEN 解析/生成
 * 支持：王车易位（KQkq）、吃过路兵（en passant）、兵升变、半回合计数、完整回合计数
 * 坐标系约定：
 * - board[r][c]：r ∈ [0..7]（r=0 为第8行黑方底线，r=7 为第1行白方底线）；c ∈ [0..7]（a..h）
 */

export const INITIAL_CHESS_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export const CHESS_SIZE = 8

const VALID_CHESS_PIECES = new Set([
  'K', 'Q', 'R', 'B', 'N', 'P',
  'k', 'q', 'r', 'b', 'n', 'p'
])

const FILES = 'abcdefgh'

export function isWhitePiece(piece) {
  return Boolean(piece) && piece >= 'A' && piece <= 'Z'
}

export function isBlackChessPiece(piece) {
  return Boolean(piece) && piece >= 'a' && piece <= 'z'
}

export function getChessPieceSide(piece) {
  if (!piece) return null
  return isWhitePiece(piece) ? 'w' : 'b'
}

export function parseChessFen(fen = INITIAL_CHESS_FEN) {
  if (typeof fen !== 'string' || !fen.trim()) {
    throw new Error('Invalid Chess FEN: empty string')
  }
  const parts = fen.trim().split(/\s+/)
  if (parts.length < 4) {
    throw new Error('Invalid Chess FEN: insufficient fields')
  }

  const [boardPart, turnPart, castlingPart, epPart, halfPart, fullPart] = parts
  const ranks = boardPart.split('/')
  if (ranks.length !== CHESS_SIZE) {
    throw new Error(`Invalid Chess FEN: expected 8 ranks, got ${ranks.length}`)
  }

  const board = Array.from({ length: CHESS_SIZE }, () =>
    Array(CHESS_SIZE).fill(null)
  )
  let whiteKing = null
  let blackKing = null

  for (let r = 0; r < CHESS_SIZE; r++) {
    let c = 0
    for (const ch of ranks[r]) {
      if (ch >= '1' && ch <= '8') {
        c += parseInt(ch, 10)
      } else {
        if (!VALID_CHESS_PIECES.has(ch)) {
          throw new Error(`Invalid Chess piece char: ${ch}`)
        }
        if (c >= CHESS_SIZE) {
          throw new Error(`Invalid Chess FEN rank width at row ${r}`)
        }
        board[r][c] = ch
        if (ch === 'K') whiteKing = { r, c }
        if (ch === 'k') blackKing = { r, c }
        c++
      }
    }
    if (c !== CHESS_SIZE) {
      throw new Error(`Invalid Chess FEN rank width at row ${r}`)
    }
  }

  const turn = turnPart === 'b' ? 'b' : 'w'
  const castling = {
    K: castlingPart.includes('K'),
    Q: castlingPart.includes('Q'),
    k: castlingPart.includes('k'),
    q: castlingPart.includes('q')
  }

  let enPassant = null
  if (epPart && epPart !== '-' && /^[a-h][1-8]$/.test(epPart)) {
    enPassant = {
      c: FILES.indexOf(epPart[0]),
      r: 8 - parseInt(epPart[1], 10)
    }
  }

  const halfmove = halfPart ? Math.max(0, parseInt(halfPart, 10) || 0) : 0
  const fullmove = fullPart ? Math.max(1, parseInt(fullPart, 10) || 1) : 1

  return {
    board,
    turn,
    castling,
    enPassant,
    halfmove,
    fullmove,
    kings: { w: whiteKing, b: blackKing }
  }
}

export function serializeChessFen(state) {
  const rankStrings = []
  for (let r = 0; r < CHESS_SIZE; r++) {
    let rowStr = ''
    let empty = 0
    for (let c = 0; c < CHESS_SIZE; c++) {
      const p = state.board[r][c]
      if (!p) {
        empty++
      } else {
        if (empty > 0) {
          rowStr += String(empty)
          empty = 0
        }
        rowStr += p
      }
    }
    if (empty > 0) rowStr += String(empty)
    rankStrings.push(rowStr)
  }

  let castlingStr = ''
  if (state.castling.K) castlingStr += 'K'
  if (state.castling.Q) castlingStr += 'Q'
  if (state.castling.k) castlingStr += 'k'
  if (state.castling.q) castlingStr += 'q'
  if (!castlingStr) castlingStr = '-'

  const epStr = state.enPassant
    ? `${FILES[state.enPassant.c]}${8 - state.enPassant.r}`
    : '-'

  return `${rankStrings.join('/')} ${state.turn} ${castlingStr} ${epStr} ${state.halfmove} ${state.fullmove}`
}

export function cloneChessState(state) {
  return {
    board: state.board.map((row) => row.slice()),
    turn: state.turn,
    castling: { ...state.castling },
    enPassant: state.enPassant ? { ...state.enPassant } : null,
    halfmove: state.halfmove,
    fullmove: state.fullmove,
    kings: {
      w: state.kings.w ? { ...state.kings.w } : null,
      b: state.kings.b ? { ...state.kings.b } : null
    }
  }
}

export function makeChessMoveInPlace(state, move) {
  const { fromR, fromC, toR, toC, promotion, isEnPassant, isCastle } = move
  const board = state.board
  const piece = board[fromR][fromC]
  const captured = isEnPassant ? board[fromR][toC] : board[toR][toC]

  const prevTurn = state.turn
  const prevCastling = { ...state.castling }
  const prevEnPassant = state.enPassant ? { ...state.enPassant } : null
  const prevHalfmove = state.halfmove
  const prevFullmove = state.fullmove
  const prevWhiteKing = state.kings.w ? { ...state.kings.w } : null
  const prevBlackKing = state.kings.b ? { ...state.kings.b } : null

  board[fromR][fromC] = null

  if (isEnPassant) {
    board[fromR][toC] = null
  }

  let placedPiece = piece
  if (promotion) {
    placedPiece = prevTurn === 'w' ? promotion.toUpperCase() : promotion.toLowerCase()
  }
  board[toR][toC] = placedPiece

  // 王车易位移动车
  if (isCastle) {
    if (toC === 6) {
      board[fromR][5] = board[fromR][7]
      board[fromR][7] = null
    } else if (toC === 2) {
      board[fromR][3] = board[fromR][0]
      board[fromR][0] = null
    }
  }

  // 更新王位置
  if (piece === 'K') state.kings.w = { r: toR, c: toC }
  if (piece === 'k') state.kings.b = { r: toR, c: toC }

  // 更新王车易位权限
  if (piece === 'K') {
    state.castling.K = false
    state.castling.Q = false
  } else if (piece === 'k') {
    state.castling.k = false
    state.castling.q = false
  }
  if (fromR === 7 && fromC === 7) state.castling.K = false
  if (fromR === 7 && fromC === 0) state.castling.Q = false
  if (fromR === 0 && fromC === 7) state.castling.k = false
  if (fromR === 0 && fromC === 0) state.castling.q = false
  if (toR === 7 && toC === 7) state.castling.K = false
  if (toR === 7 && toC === 0) state.castling.Q = false
  if (toR === 0 && toC === 7) state.castling.k = false
  if (toR === 0 && toC === 0) state.castling.q = false

  // 更新过路兵目标格
  if ((piece === 'P' || piece === 'p') && Math.abs(toR - fromR) === 2) {
    state.enPassant = { r: (fromR + toR) / 2, c: fromC }
  } else {
    state.enPassant = null
  }

  // 更新半回合与全回合计数
  if (piece === 'P' || piece === 'p' || captured) {
    state.halfmove = 0
  } else {
    state.halfmove = prevHalfmove + 1
  }

  if (prevTurn === 'b') {
    state.fullmove = prevFullmove + 1
  }
  state.turn = prevTurn === 'w' ? 'b' : 'w'

  return {
    move,
    piece,
    captured,
    prevTurn,
    prevCastling,
    prevEnPassant,
    prevHalfmove,
    prevFullmove,
    prevWhiteKing,
    prevBlackKing
  }
}

export function unmakeChessMoveInPlace(state, undo) {
  const { fromR, fromC, toR, toC, isEnPassant, isCastle } = undo.move
  const board = state.board

  board[fromR][fromC] = undo.piece

  if (isEnPassant) {
    board[toR][toC] = null
    board[fromR][toC] = undo.captured
  } else {
    board[toR][toC] = undo.captured
  }

  if (isCastle) {
    if (toC === 6) {
      board[fromR][7] = board[fromR][5]
      board[fromR][5] = null
    } else if (toC === 2) {
      board[fromR][0] = board[fromR][3]
      board[fromR][3] = null
    }
  }

  state.turn = undo.prevTurn
  state.castling = undo.prevCastling
  state.enPassant = undo.prevEnPassant
  state.halfmove = undo.prevHalfmove
  state.fullmove = undo.prevFullmove
  state.kings.w = undo.prevWhiteKing
  state.kings.b = undo.prevBlackKing
}
