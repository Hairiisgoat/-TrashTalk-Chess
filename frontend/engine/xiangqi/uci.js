/**
 * 中国象棋 UCI 坐标与中文纵线着法转换
 * - UCI 规范：^[a-i][0-9][a-i][0-9]$（红方视角：a..i 对应 0..8 列，0..9 对应 r=9..0 行）
 */

import { isRedPiece } from './board.js'

const FILES = 'abcdefghi'
const RED_NUMERALS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const BLACK_NUMERALS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

const PIECE_CN_NAME = {
  K: '帅',
  A: '仕',
  B: '相',
  N: '马',
  R: '车',
  C: '炮',
  P: '兵',
  k: '将',
  a: '士',
  b: '象',
  n: '马',
  r: '车',
  c: '炮',
  p: '卒'
}

export function coordsToXiangqiUci(fromR, fromC, toR, toC) {
  const fFile = FILES[fromC]
  const fRank = 9 - fromR
  const tFile = FILES[toC]
  const tRank = 9 - toR
  return `${fFile}${fRank}${tFile}${tRank}`
}

export function xiangqiUciToCoords(uci) {
  if (typeof uci !== 'string' || !/^[a-i][0-9][a-i][0-9]$/.test(uci)) {
    return null
  }
  const fromC = FILES.indexOf(uci[0])
  const fromR = 9 - parseInt(uci[1], 10)
  const toC = FILES.indexOf(uci[2])
  const toR = 9 - parseInt(uci[3], 10)
  return { fromR, fromC, toR, toC }
}

/**
 * 将内部走法转换为标准中文纵线着法（如 "炮二平五" / "马2进3"）
 */
export function moveToXiangqiNotation(state, move) {
  const { fromR, fromC, toR, toC } = move
  const piece = state.board[fromR][fromC]
  if (!piece) return coordsToXiangqiUci(fromR, fromC, toR, toC)

  const isRed = isRedPiece(piece)
  const name = PIECE_CN_NAME[piece] || piece
  const numMap = isRed ? RED_NUMERALS : BLACK_NUMERALS

  // 红方从右到左 1..9（c=8 -> 1, c=0 -> 9）；黑方从黑方右到左（c=0 -> 1, c=8 -> 9）
  const colToFileNum = (col) => (isRed ? 9 - col : col + 1)
  const fromFile = colToFileNum(fromC)
  const toFile = colToFileNum(toC)

  // 同纵线同名子前后消歧
  const sameColRows = []
  for (let r = 0; r < 10; r++) {
    if (state.board[r][fromC] === piece) {
      sameColRows.push(r)
    }
  }

  let prefix = ''
  if (sameColRows.length >= 2) {
    // 对红方而言 r 越小越靠前；对黑方而言 r 越大越靠前
    const ordered = isRed
      ? sameColRows.slice().sort((a, b) => a - b)
      : sameColRows.slice().sort((a, b) => b - a)
    const idx = ordered.indexOf(fromR)
    if (ordered.length === 2) {
      prefix = idx === 0 ? `前${name}` : `后${name}`
    } else if (ordered.length === 3) {
      prefix = idx === 0 ? `前${name}` : idx === 1 ? `中${name}` : `后${name}`
    } else {
      prefix = `${numMap[idx + 1]}${name}`
    }
  } else {
    prefix = `${name}${numMap[fromFile]}`
  }

  let action = '平'
  let targetStr = numMap[toFile]

  if (toR === fromR) {
    action = '平'
    targetStr = numMap[toFile]
  } else {
    const isAdvancing = isRed ? toR < fromR : toR > fromR
    action = isAdvancing ? '进' : '退'

    const upper = piece.toUpperCase()
    if (upper === 'K' || upper === 'R' || upper === 'C' || upper === 'P') {
      const steps = Math.abs(toR - fromR)
      targetStr = numMap[steps]
    } else {
      targetStr = numMap[toFile]
    }
  }

  return `${prefix}${action}${targetStr}`
}

export function getPieceDisplayLabel(piece) {
  return PIECE_CN_NAME[piece] || ''
}
