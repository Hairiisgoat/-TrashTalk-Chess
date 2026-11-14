/**
 * 主变线 (Principal Variation) 提取与可读中文记谱格式化工具
 */

const CHESS_FILES = 'abcdefgh'

const CHESS_PIECE_CN = {
  K: '王',
  Q: '后',
  R: '车',
  B: '象',
  N: '马',
  P: '兵'
}

/**
 * 将国际象棋单步走法格式化为直观中文坐标序列（如 "1. 后d1-h5", "3. 后h5xe5+"）
 */
export function formatChessPvStep(stateBefore, move, stepNum, isCheck = false, oppNoMoves = false) {
  const piece = move.piece || (stateBefore.board[move.fromR] && stateBefore.board[move.fromR][move.fromC]) || ''
  const suffix = isCheck ? (oppNoMoves ? '#' : '+') : ''
  if (move.isCastle) {
    const castleLabel = move.toC === 6 ? 'O-O(短易位)' : 'O-O-O(长易位)'
    return `${stepNum}. ${castleLabel}${suffix}`
  }
  const pieceCn = CHESS_PIECE_CN[piece.toUpperCase()] || piece.toUpperCase()
  const fromSq = `${CHESS_FILES[move.fromC]}${8 - move.fromR}`
  const toSq = `${CHESS_FILES[move.toC]}${8 - move.toR}`
  const isCapture = Boolean(move.captured) || Boolean(move.isEnPassant)
  const sep = isCapture ? 'x' : '-'
  const promo = move.promotion
    ? `=${CHESS_PIECE_CN[move.promotion.toUpperCase()] || move.promotion.toUpperCase()}`
    : ''
  return `${stepNum}. ${pieceCn}${fromSq}${sep}${toSq}${promo}${suffix}`
}

/**
 * 从当前状态与置换表提取从 rootMove 开始的 1~maxPlies 步预期主变线
 */
export function extractPvSequence({
  workState,
  rootMove,
  rootLegalMoves,
  maxPlies = 3,
  tt,
  buildKey,
  makeMove,
  unmakeMove,
  getLegalMoves,
  isInCheck,
  pickFallbackMove,
  formatStep
}) {
  const pv = []
  const pvUci = []
  const undoStack = []
  const seenKeys = new Set()

  try {
    let curMove = rootMove
    let curLegal = rootLegalMoves

    for (let stepNum = 1; stepNum <= maxPlies; stepNum++) {
      if (!curMove) break
      pvUci.push(curMove.uci)

      // 记录走子前棋盘快照引用供格式化函数读取（格式化函数仅读 curMove.piece 与坐标/行棋前盘面）
      const prevBoardPiece = workState.board[curMove.fromR]
        ? workState.board[curMove.fromR][curMove.fromC]
        : curMove.piece
      const undo = makeMove(workState, curMove)
      undoStack.push(undo)

      const isCheckAfter = isInCheck(workState, workState.turn)
      const oppMoves = stepNum < maxPlies || isCheckAfter ? getLegalMoves(workState) : []
      const oppNoMoves = isCheckAfter && oppMoves.length === 0

      // 若需要在未还原前格式化中国象棋纵线着法，先短暂撤销再重做会破坏性能；直接提供回调即可
      unmakeMove(workState, undo)
      undoStack.pop()
      const stepLabel = formatStep(workState, curMove, stepNum, curLegal, isCheckAfter, oppNoMoves, prevBoardPiece)
      const reUndo = makeMove(workState, curMove)
      undoStack.push(reUndo)

      pv.push(stepLabel)

      if (stepNum >= maxPlies || oppMoves.length === 0) break

      const stateKey = buildKey(workState)
      if (seenKeys.has(stateKey)) break
      seenKeys.add(stateKey)

      const ttEntry = tt ? tt.get(stateKey) : null
      let nextMove = ttEntry && ttEntry.bestUci
        ? oppMoves.find((m) => m.uci === ttEntry.bestUci)
        : null
      if (!nextMove && pickFallbackMove) {
        nextMove = pickFallbackMove(workState, oppMoves)
      }
      if (!nextMove) break

      curMove = nextMove
      curLegal = oppMoves
    }
  } finally {
    while (undoStack.length > 0) {
      unmakeMove(workState, undoStack.pop())
    }
  }

  return { pv, pvUci }
}
