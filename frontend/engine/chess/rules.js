/**
 * 国际象棋走法生成与规则裁判
 * 完整支持：王车易位（穿格/起点/终点受攻检测）、吃过路兵、兵升变（q/r/b/n）、将军、将杀、逼和、50步与子力不足和棋
 */

import {
  CHESS_SIZE,
  getChessPieceSide,
  makeChessMoveInPlace,
  unmakeChessMoveInPlace
} from './board.js'
import { coordsToChessUci } from './uci.js'

const KNIGHT_OFFSETS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1]
]

const BISHOP_DIRS = [
  [-1, -1], [-1, 1], [1, -1], [1, 1]
]

const ROOK_DIRS = [
  [-1, 0], [1, 0], [0, -1], [0, 1]
]

const KING_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1]
]

function inBounds(r, c) {
  return r >= 0 && r < CHESS_SIZE && c >= 0 && c < CHESS_SIZE
}

/**
 * 判断 (r, c) 是否受到 attackerSide 方棋子攻击
 */
export function isSquareAttackedBy(state, r, c, attackerSide) {
  const board = state.board

  // 1. 兵攻击检测
  const pawnChar = attackerSide === 'w' ? 'P' : 'p'
  const pawnFromR = attackerSide === 'w' ? r + 1 : r - 1
  if (inBounds(pawnFromR, c - 1) && board[pawnFromR][c - 1] === pawnChar) return true
  if (inBounds(pawnFromR, c + 1) && board[pawnFromR][c + 1] === pawnChar) return true

  // 2. 马攻击检测
  const knightChar = attackerSide === 'w' ? 'N' : 'n'
  for (const [dr, dc] of KNIGHT_OFFSETS) {
    const nr = r + dr
    const nc = c + dc
    if (inBounds(nr, nc) && board[nr][nc] === knightChar) return true
  }

  // 3. 王攻击检测
  const kingChar = attackerSide === 'w' ? 'K' : 'k'
  for (const [dr, dc] of KING_OFFSETS) {
    const nr = r + dr
    const nc = c + dc
    if (inBounds(nr, nc) && board[nr][nc] === kingChar) return true
  }

  // 4. 斜线：象与后
  const bishopChar = attackerSide === 'w' ? 'B' : 'b'
  const queenChar = attackerSide === 'w' ? 'Q' : 'q'
  for (const [dr, dc] of BISHOP_DIRS) {
    let nr = r + dr
    let nc = c + dc
    while (inBounds(nr, nc)) {
      const p = board[nr][nc]
      if (p) {
        if (p === bishopChar || p === queenChar) return true
        break
      }
      nr += dr
      nc += dc
    }
  }

  // 5. 直线：车与后
  const rookChar = attackerSide === 'w' ? 'R' : 'r'
  for (const [dr, dc] of ROOK_DIRS) {
    let nr = r + dr
    let nc = c + dc
    while (inBounds(nr, nc)) {
      const p = board[nr][nc]
      if (p) {
        if (p === rookChar || p === queenChar) return true
        break
      }
      nr += dr
      nc += dc
    }
  }

  return false
}

export function isChessInCheck(state, side = state.turn) {
  const king = state.kings[side]
  if (!king) return true
  const enemy = side === 'w' ? 'b' : 'w'
  return isSquareAttackedBy(state, king.r, king.c, enemy)
}

export function generateChessPseudoMoves(state, capturesOnly = false) {
  const moves = []
  const side = state.turn
  const enemy = side === 'w' ? 'b' : 'w'
  const board = state.board

  const addMove = (fromR, fromC, toR, toC, extra = {}) => {
    const piece = board[fromR][fromC]
    const captured = extra.isEnPassant ? board[fromR][toC] : board[toR][toC]
    moves.push({
      fromR,
      fromC,
      toR,
      toC,
      piece,
      captured: captured || null,
      promotion: extra.promotion || '',
      isEnPassant: Boolean(extra.isEnPassant),
      isCastle: Boolean(extra.isCastle),
      uci: coordsToChessUci(fromR, fromC, toR, toC, extra.promotion || '')
    })
  }

  for (let r = 0; r < CHESS_SIZE; r++) {
    for (let c = 0; c < CHESS_SIZE; c++) {
      const piece = board[r][c]
      if (!piece || getChessPieceSide(piece) !== side) continue
      const upper = piece.toUpperCase()

      if (upper === 'P') {
        const dir = side === 'w' ? -1 : 1
        const startRow = side === 'w' ? 6 : 1
        const promoRow = side === 'w' ? 0 : 7
        const nr = r + dir

        // 前进
        if (!capturesOnly && inBounds(nr, c) && !board[nr][c]) {
          if (nr === promoRow) {
            for (const p of ['q', 'r', 'b', 'n']) {
              addMove(r, c, nr, c, { promotion: p })
            }
          } else {
            addMove(r, c, nr, c)
            if (r === startRow && !board[r + dir * 2][c]) {
              addMove(r, c, r + dir * 2, c)
            }
          }
        }

        // 斜吃 & 过路兵
        for (const dc of [-1, 1]) {
          const nc = c + dc
          if (!inBounds(nr, nc)) continue
          const target = board[nr][nc]
          if (target && getChessPieceSide(target) === enemy) {
            if (nr === promoRow) {
              for (const p of ['q', 'r', 'b', 'n']) {
                addMove(r, c, nr, nc, { promotion: p })
              }
            } else {
              addMove(r, c, nr, nc)
            }
          } else if (
            state.enPassant &&
            state.enPassant.r === nr &&
            state.enPassant.c === nc
          ) {
            addMove(r, c, nr, nc, { isEnPassant: true })
          }
        }
      } else if (upper === 'N') {
        for (const [dr, dc] of KNIGHT_OFFSETS) {
          const nr = r + dr
          const nc = c + dc
          if (!inBounds(nr, nc)) continue
          const target = board[nr][nc]
          if (!target) {
            if (!capturesOnly) addMove(r, c, nr, nc)
          } else if (getChessPieceSide(target) === enemy) {
            addMove(r, c, nr, nc)
          }
        }
      } else if (upper === 'B' || upper === 'R' || upper === 'Q') {
        const dirs =
          upper === 'B'
            ? BISHOP_DIRS
            : upper === 'R'
            ? ROOK_DIRS
            : [...BISHOP_DIRS, ...ROOK_DIRS]
        for (const [dr, dc] of dirs) {
          let nr = r + dr
          let nc = c + dc
          while (inBounds(nr, nc)) {
            const target = board[nr][nc]
            if (!target) {
              if (!capturesOnly) addMove(r, c, nr, nc)
            } else {
              if (getChessPieceSide(target) === enemy) {
                addMove(r, c, nr, nc)
              }
              break
            }
            nr += dr
            nc += dc
          }
        }
      } else if (upper === 'K') {
        for (const [dr, dc] of KING_OFFSETS) {
          const nr = r + dr
          const nc = c + dc
          if (!inBounds(nr, nc)) continue
          const target = board[nr][nc]
          if (!target) {
            if (!capturesOnly) addMove(r, c, nr, nc)
          } else if (getChessPieceSide(target) === enemy) {
            addMove(r, c, nr, nc)
          }
        }

        // 王车易位
        if (!capturesOnly) {
          const homeRow = side === 'w' ? 7 : 0
          if (r === homeRow && c === 4 && !isSquareAttackedBy(state, homeRow, 4, enemy)) {
            const kingSideRight = side === 'w' ? state.castling.K : state.castling.k
            const queenSideRight = side === 'w' ? state.castling.Q : state.castling.q
            const expectedRook = side === 'w' ? 'R' : 'r'

            if (
              kingSideRight &&
              board[homeRow][7] === expectedRook &&
              !board[homeRow][5] &&
              !board[homeRow][6] &&
              !isSquareAttackedBy(state, homeRow, 5, enemy) &&
              !isSquareAttackedBy(state, homeRow, 6, enemy)
            ) {
              addMove(r, c, homeRow, 6, { isCastle: true })
            }

            if (
              queenSideRight &&
              board[homeRow][0] === expectedRook &&
              !board[homeRow][1] &&
              !board[homeRow][2] &&
              !board[homeRow][3] &&
              !isSquareAttackedBy(state, homeRow, 3, enemy) &&
              !isSquareAttackedBy(state, homeRow, 2, enemy)
            ) {
              addMove(r, c, homeRow, 2, { isCastle: true })
            }
          }
        }
      }
    }
  }

  return moves
}

export function generateChessLegalMoves(state, capturesOnly = false) {
  const pseudo = generateChessPseudoMoves(state, capturesOnly)
  const legal = []
  const moverSide = state.turn

  for (const move of pseudo) {
    const undo = makeChessMoveInPlace(state, move)
    if (!isChessInCheck(state, moverSide)) {
      legal.push(move)
    }
    unmakeChessMoveInPlace(state, undo)
  }

  return legal
}

export function isInsufficientMaterial(state) {
  const minors = []
  for (let r = 0; r < CHESS_SIZE; r++) {
    for (let c = 0; c < CHESS_SIZE; c++) {
      const p = state.board[r][c]
      if (!p) continue
      const u = p.toUpperCase()
      if (u === 'P' || u === 'R' || u === 'Q') return false
      if (u === 'B' || u === 'N') minors.push({ p: u, color: (r + c) % 2 })
    }
  }
  if (minors.length <= 1) return true
  if (minors.length === 2 && minors[0].p === 'B' && minors[1].p === 'B') {
    return minors[0].color === minors[1].color
  }
  return false
}

export function getChessGameStatus(state, repetitionCount = 1) {
  const legalMoves = generateChessLegalMoves(state)
  const inCheck = isChessInCheck(state, state.turn)

  if (legalMoves.length === 0) {
    return {
      isOver: true,
      result: inCheck ? 'checkmate' : 'stalemate',
      winner: inCheck ? (state.turn === 'w' ? 'b' : 'w') : null,
      inCheck,
      legalMoveCount: 0
    }
  }

  if (state.halfmove >= 100 || isInsufficientMaterial(state) || repetitionCount >= 3) {
    return {
      isOver: true,
      result: 'draw',
      winner: null,
      inCheck,
      legalMoveCount: legalMoves.length
    }
  }

  return {
    isOver: false,
    result: 'ongoing',
    winner: null,
    inCheck,
    legalMoveCount: legalMoves.length
  }
}
