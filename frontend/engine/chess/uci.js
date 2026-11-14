/**
 * 国际象棋 UCI 坐标与 SAN 可读记谱转换
 * - UCI 规范：^[a-h][1-8][a-h][1-8][qrbn]?$
 */

const FILES = 'abcdefgh'

export function coordsToChessUci(fromR, fromC, toR, toC, promotion = '') {
  const fFile = FILES[fromC]
  const fRank = 8 - fromR
  const tFile = FILES[toC]
  const tRank = 8 - toR
  return `${fFile}${fRank}${tFile}${tRank}${promotion ? promotion.toLowerCase() : ''}`
}

export function chessUciToCoords(uci) {
  if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
    return null
  }
  return {
    fromC: FILES.indexOf(uci[0]),
    fromR: 8 - parseInt(uci[1], 10),
    toC: FILES.indexOf(uci[2]),
    toR: 8 - parseInt(uci[3], 10),
    promotion: uci[4] || ''
  }
}

/**
 * 将国际象棋走法转为紧凑 SAN 记谱（如 e4, Nf3, O-O, exd5, e8=Q）
 */
export function moveToChessNotation(state, move, allLegalMoves = [], suffix = '') {
  if (move.isCastle) {
    return (move.toC === 6 ? 'O-O' : 'O-O-O') + suffix
  }

  const piece = move.piece || state.board[move.fromR][move.fromC]
  const upper = piece.toUpperCase()
  const destSquare = `${FILES[move.toC]}${8 - move.toR}`
  const isCapture = Boolean(move.captured) || Boolean(move.isEnPassant)

  if (upper === 'P') {
    const promo = move.promotion ? `=${move.promotion.toUpperCase()}` : ''
    if (isCapture) {
      return `${FILES[move.fromC]}x${destSquare}${promo}${suffix}`
    }
    return `${destSquare}${promo}${suffix}`
  }

  // 同类棋子消歧
  let disambig = ''
  if (allLegalMoves.length > 0) {
    const others = allLegalMoves.filter(
      (m) =>
        m.piece === piece &&
        m.toR === move.toR &&
        m.toC === move.toC &&
        (m.fromR !== move.fromR || m.fromC !== move.fromC)
    )
    if (others.length > 0) {
      const sameFile = others.some((m) => m.fromC === move.fromC)
      const sameRank = others.some((m) => m.fromR === move.fromR)
      if (!sameFile) {
        disambig = FILES[move.fromC]
      } else if (!sameRank) {
        disambig = String(8 - move.fromR)
      } else {
        disambig = `${FILES[move.fromC]}${8 - move.fromR}`
      }
    }
  }

  return `${upper}${disambig}${isCapture ? 'x' : ''}${destSquare}${suffix}`
}
