/**
 * 中国象棋走法生成与规则裁判
 * 完整覆盖：九宫限制、蹩马腿、塞象眼、炮架隔子吃子、过河兵卒、将帅不能照面、绝杀与困毙判定
 */

import {
  XIANGQI_ROWS,
  XIANGQI_COLS,
  getPieceSide,
  makeXiangqiMoveInPlace,
  unmakeXiangqiMoveInPlace
} from './board.js'
import { coordsToXiangqiUci } from './uci.js'

const ORTHO_DIRS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1]
]

const ADVISOR_DIRS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1]
]

const ELEPHANT_STEPS = [
  { dr: -2, dc: -2, er: -1, ec: -1 },
  { dr: -2, dc: 2, er: -1, ec: 1 },
  { dr: 2, dc: -2, er: 1, ec: -1 },
  { dr: 2, dc: 2, er: 1, ec: 1 }
]

const HORSE_STEPS = [
  { dr: -2, dc: -1, lr: -1, lc: 0 },
  { dr: -2, dc: 1, lr: -1, lc: 0 },
  { dr: 2, dc: -1, lr: 1, lc: 0 },
  { dr: 2, dc: 1, lr: 1, lc: 0 },
  { dr: -1, dc: -2, lr: 0, lc: -1 },
  { dr: 1, dc: -2, lr: 0, lc: -1 },
  { dr: -1, dc: 2, lr: 0, lc: 1 },
  { dr: 1, dc: 2, lr: 0, lc: 1 }
]

function inBounds(r, c) {
  return r >= 0 && r < XIANGQI_ROWS && c >= 0 && c < XIANGQI_COLS
}

function inPalace(r, c, side) {
  if (c < 3 || c > 5) return false
  return side === 'w' ? r >= 7 && r <= 9 : r >= 0 && r <= 2
}

function inOwnHalf(r, side) {
  return side === 'w' ? r >= 5 : r <= 4
}

/**
 * 判断红黑将帅是否照面（同列且中间无子）
 */
export function isKingsFacing(state) {
  const wk = state.kings.w
  const bk = state.kings.b
  if (!wk || !bk || wk.c !== bk.c) return false
  const col = wk.c
  const minR = Math.min(wk.r, bk.r)
  const maxR = Math.max(wk.r, bk.r)
  for (let r = minR + 1; r < maxR; r++) {
    if (state.board[r][col]) return false
  }
  return true
}

/**
 * 快速判断指定方是否正被将军（或将帅照面）
 */
export function isXiangqiInCheck(state, side = state.turn) {
  const king = state.kings[side]
  if (!king) return true
  if (isKingsFacing(state)) return true

  const enemy = side === 'w' ? 'b' : 'w'
  const board = state.board
  const kr = king.r
  const kc = king.c

  const enemyRook = enemy === 'w' ? 'R' : 'r'
  const enemyCannon = enemy === 'w' ? 'C' : 'c'
  const enemyHorse = enemy === 'w' ? 'N' : 'n'
  const enemyPawn = enemy === 'w' ? 'P' : 'p'

  // 1. 车与炮直线攻击检测
  for (const [dr, dc] of ORTHO_DIRS) {
    let r = kr + dr
    let c = kc + dc
    let screenCount = 0
    while (inBounds(r, c)) {
      const p = board[r][c]
      if (p) {
        if (screenCount === 0) {
          if (p === enemyRook) return true
          screenCount = 1
        } else {
          if (p === enemyCannon) return true
          break
        }
      }
      r += dr
      c += dc
    }
  }

  // 2. 马攻击检测（逆向检查马脚）
  for (const step of HORSE_STEPS) {
    const hr = kr + step.dr
    const hc = kc + step.dc
    if (!inBounds(hr, hc)) continue
    if (board[hr][hc] === enemyHorse) {
      // 从敌方马位置 (hr, hc) 跳向 (kr, kc) 的马腿在相邻直格
      const legR = hr + (Math.abs(step.dr) === 2 ? -Math.sign(step.dr) : 0)
      const legC = hc + (Math.abs(step.dc) === 2 ? -Math.sign(step.dc) : 0)
      if (!board[legR][legC]) return true
    }
  }

  // 3. 过河兵/卒攻击检测
  // 若我方是红方(w)，敌方黑卒只能向下(+1行)或左右攻击我帅，所以检查上方(kr-1, kc)及左右(kr, kc±1)
  const pawnAttackFromDr = side === 'w' ? -1 : 1
  if (inBounds(kr + pawnAttackFromDr, kc) && board[kr + pawnAttackFromDr][kc] === enemyPawn) {
    return true
  }
  if (inBounds(kr, kc - 1) && board[kr][kc - 1] === enemyPawn) return true
  if (inBounds(kr, kc + 1) && board[kr][kc + 1] === enemyPawn) return true

  return false
}

/**
 * 生成当前行动方的全部伪合法走法
 */
export function generateXiangqiPseudoMoves(state, capturesOnly = false) {
  const moves = []
  const side = state.turn
  const board = state.board

  const pushMove = (fromR, fromC, toR, toC) => {
    const target = board[toR][toC]
    if (target && getPieceSide(target) === side) return
    if (capturesOnly && !target) return
    moves.push({
      fromR,
      fromC,
      toR,
      toC,
      piece: board[fromR][fromC],
      captured: target || null,
      uci: coordsToXiangqiUci(fromR, fromC, toR, toC)
    })
  }

  for (let r = 0; r < XIANGQI_ROWS; r++) {
    for (let c = 0; c < XIANGQI_COLS; c++) {
      const piece = board[r][c]
      if (!piece || getPieceSide(piece) !== side) continue
      const upper = piece.toUpperCase()

      if (upper === 'K') {
        for (const [dr, dc] of ORTHO_DIRS) {
          const nr = r + dr
          const nc = c + dc
          if (inPalace(nr, nc, side)) {
            pushMove(r, c, nr, nc)
          }
        }
      } else if (upper === 'A') {
        for (const [dr, dc] of ADVISOR_DIRS) {
          const nr = r + dr
          const nc = c + dc
          if (inPalace(nr, nc, side)) {
            pushMove(r, c, nr, nc)
          }
        }
      } else if (upper === 'B') {
        for (const step of ELEPHANT_STEPS) {
          const nr = r + step.dr
          const nc = c + step.dc
          if (!inBounds(nr, nc) || !inOwnHalf(nr, side)) continue
          if (board[r + step.er][c + step.ec]) continue // 塞象眼
          pushMove(r, c, nr, nc)
        }
      } else if (upper === 'N') {
        for (const step of HORSE_STEPS) {
          const lr = r + step.lr
          const lc = c + step.lc
          if (!inBounds(lr, lc) || board[lr][lc]) continue // 蹩马腿
          const nr = r + step.dr
          const nc = c + step.dc
          if (inBounds(nr, nc)) {
            pushMove(r, c, nr, nc)
          }
        }
      } else if (upper === 'R') {
        for (const [dr, dc] of ORTHO_DIRS) {
          let nr = r + dr
          let nc = c + dc
          while (inBounds(nr, nc)) {
            const target = board[nr][nc]
            if (!target) {
              if (!capturesOnly) pushMove(r, c, nr, nc)
            } else {
              if (getPieceSide(target) !== side) {
                pushMove(r, c, nr, nc)
              }
              break
            }
            nr += dr
            nc += dc
          }
        }
      } else if (upper === 'C') {
        for (const [dr, dc] of ORTHO_DIRS) {
          let nr = r + dr
          let nc = c + dc
          let jumped = false
          while (inBounds(nr, nc)) {
            const target = board[nr][nc]
            if (!jumped) {
              if (!target) {
                if (!capturesOnly) pushMove(r, c, nr, nc)
              } else {
                jumped = true
              }
            } else if (target) {
              if (getPieceSide(target) !== side) {
                pushMove(r, c, nr, nc)
              }
              break
            }
            nr += dr
            nc += dc
          }
        }
      } else if (upper === 'P') {
        const forwardDr = side === 'w' ? -1 : 1
        if (inBounds(r + forwardDr, c)) {
          pushMove(r, c, r + forwardDr, c)
        }
        // 过河后可横走
        if (!inOwnHalf(r, side)) {
          if (inBounds(r, c - 1)) pushMove(r, c, r, c - 1)
          if (inBounds(r, c + 1)) pushMove(r, c, r, c + 1)
        }
      }
    }
  }

  return moves
}

/**
 * 生成当前局面的全部合法走法
 */
export function generateXiangqiLegalMoves(state, capturesOnly = false) {
  const pseudo = generateXiangqiPseudoMoves(state, capturesOnly)
  const legal = []
  const moverSide = state.turn

  for (const move of pseudo) {
    const undo = makeXiangqiMoveInPlace(state, move)
    if (!isXiangqiInCheck(state, moverSide)) {
      legal.push(move)
    }
    unmakeXiangqiMoveInPlace(state, undo)
  }

  return legal
}

/**
 * 判定中国象棋当前对局状态
 */
export function getXiangqiGameStatus(state) {
  const legalMoves = generateXiangqiLegalMoves(state)
  if (legalMoves.length === 0) {
    const inCheck = isXiangqiInCheck(state, state.turn)
    const winner = state.turn === 'w' ? 'b' : 'w'
    return {
      isOver: true,
      result: inCheck ? 'checkmate' : 'stalemate',
      winner,
      inCheck,
      legalMoveCount: 0
    }
  }

  if (state.halfmove >= 120) {
    return {
      isOver: true,
      result: 'draw',
      winner: null,
      inCheck: isXiangqiInCheck(state, state.turn),
      legalMoveCount: legalMoves.length
    }
  }

  return {
    isOver: false,
    result: 'ongoing',
    winner: null,
    inCheck: isXiangqiInCheck(state, state.turn),
    legalMoveCount: legalMoves.length
  }
}
