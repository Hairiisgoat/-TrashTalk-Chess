/**
 * 端侧战术语义分析器：模拟后续 2~3 步主变线并计算子力净变化与战术事实标签
 * 输出结构化标签（如：一换一兑子、弃兵抢先手、白丢大子、将军逼迫、中心控制等）供 AI 复盘教练严格引用
 */

import { GAME_TYPE } from './types.js'
import { formatChessPvStep } from './pvHelper.js'
import {
  parseChessFen,
  isWhitePiece,
  makeChessMoveInPlace
} from '../chess/board.js'
import { generateChessLegalMoves, isChessInCheck } from '../chess/rules.js'
import {
  parseXiangqiFen,
  isRedPiece,
  makeXiangqiMoveInPlace
} from '../xiangqi/board.js'
import { generateXiangqiLegalMoves, isXiangqiInCheck } from '../xiangqi/rules.js'
import { moveToXiangqiNotation, getPieceDisplayLabel } from '../xiangqi/uci.js'

const CHESS_PIECE_VALUES = {
  P: 100,
  N: 320,
  B: 330,
  R: 500,
  Q: 900,
  K: 20000
}

const XIANGQI_PIECE_VALUES = {
  P: 100,
  A: 200,
  B: 200,
  N: 400,
  C: 450,
  R: 900,
  K: 10000
}

const CHESS_PIECE_CN = {
  P: '兵',
  N: '马',
  B: '象',
  R: '车',
  Q: '后',
  K: '王'
}

function getPieceValue(gameType, piece) {
  if (!piece) return 0
  const upper = piece.toUpperCase()
  return gameType === GAME_TYPE.CHESS
    ? CHESS_PIECE_VALUES[upper] || 0
    : XIANGQI_PIECE_VALUES[upper] || 0
}

function getPieceLabel(gameType, piece) {
  if (!piece) return ''
  if (gameType === GAME_TYPE.XIANGQI) {
    return getPieceDisplayLabel(piece) || piece
  }
  return CHESS_PIECE_CN[piece.toUpperCase()] || piece
}

function formatCapEntry(gameType, piece) {
  const label = getPieceLabel(gameType, piece)
  const val = getPieceValue(gameType, piece)
  return `${label}(${val})`
}

function parseState(gameType, fen) {
  return gameType === GAME_TYPE.CHESS ? parseChessFen(fen) : parseXiangqiFen(fen)
}

function getLegal(gameType, state) {
  return gameType === GAME_TYPE.CHESS
    ? generateChessLegalMoves(state)
    : generateXiangqiLegalMoves(state)
}

function makeMove(gameType, state, move) {
  return gameType === GAME_TYPE.CHESS
    ? makeChessMoveInPlace(state, move)
    : makeXiangqiMoveInPlace(state, move)
}

function inCheck(gameType, state, side) {
  return gameType === GAME_TYPE.CHESS
    ? isChessInCheck(state, side)
    : isXiangqiInCheck(state, side)
}

function checkCenterControl(gameType, move, moverSide) {
  if (!move) return false
  if (gameType === GAME_TYPE.CHESS) {
    // 占据核心中心格 d4/e4/d5/e5 或跃居中心拓展格 c3..f6
    const inCore = move.toR >= 3 && move.toR <= 4 && move.toC >= 3 && move.toC <= 4
    const pieceUpper = (move.piece || '').toUpperCase()
    const knightCenter =
      pieceUpper === 'N' &&
      move.toR >= 2 &&
      move.toR <= 5 &&
      move.toC >= 2 &&
      move.toC <= 5
    return inCore || knightCenter
  }
  // 中国象棋：抢占中路(4列)、肋道(3/5列过河或要道)、或兵卒过河压制
  const isCenterFile = move.toC === 4
  const crossedRiver = moverSide === 'w' ? move.toR <= 4 : move.toR >= 5
  const isRibForward = (move.toC === 3 || move.toC === 5) && crossedRiver
  return isCenterFile || isRibForward
}

function formatReadableStep(gameType, stateBefore, move, stepNum, isCheckAfter, oppNoMoves) {
  if (gameType === GAME_TYPE.CHESS) {
    return formatChessPvStep(stateBefore, move, stepNum, isCheckAfter, oppNoMoves)
  }
  const base = moveToXiangqiNotation(stateBefore, move)
  const capTag = move.captured ? `(吃${getPieceDisplayLabel(move.captured) || move.captured})` : ''
  const chkTag = isCheckAfter ? (oppNoMoves ? '(绝杀)' : '(将)') : ''
  return `${stepNum}. ${base}${capTag}${chkTag}`
}

/**
 * 在给定 FEN 上沿着 pvUcis（最多 3 步）推演双方子力净变化与战术标签
 */
export function analyzeLineTactics(gameType, fenStart, pvUcis = [], options = {}) {
  const {
    scoreCp = null,
    bestScoreCp = null,
    evalLossCp = null,
    winRateDelta = null,
    isBestLine = false
  } = options

  if (!fenStart || !Array.isArray(pvUcis) || pvUcis.length === 0) {
    return {
      pv: [],
      net_material_cp: 0,
      captured_by_mover: [],
      captured_by_opponent: [],
      tactics_tags: [],
      eval_loss_cp: typeof evalLossCp === 'number' ? evalLossCp : null,
      summary: ''
    }
  }

  const workState = parseState(gameType, fenStart)
  const moverSide = workState.turn
  const wasInCheckInitially = inCheck(gameType, workState, moverSide)

  const pvReadable = []
  const capturedByMover = []
  const capturedByOpponent = []
  let gainCp = 0
  let lossCp = 0
  let moverChecks = 0
  let opponentChecks = 0
  let isMate = false
  let firstMove = null

  for (let i = 0; i < Math.min(3, pvUcis.length); i++) {
    const uci = pvUcis[i]
    if (!uci) break
    const legal = getLegal(gameType, workState)
    const move = legal.find((m) => m.uci === uci)
    if (!move) break

    if (i === 0) firstMove = move
    const actingSide = workState.turn
    const stepNum = i + 1

    const capPiece = move.captured || (move.isEnPassant ? (actingSide === 'w' ? 'p' : 'P') : null)
    const capVal = getPieceValue(gameType, capPiece)

    makeMove(gameType, workState, move)
    const oppCheck = inCheck(gameType, workState, workState.turn)
    const oppMoves = oppCheck ? getLegal(gameType, workState) : []
    const oppNoMoves = oppCheck && oppMoves.length === 0

    if (actingSide === moverSide) {
      if (capPiece) {
        gainCp += capVal
        capturedByMover.push(formatCapEntry(gameType, capPiece))
      }
      if (oppCheck) moverChecks += 1
      if (oppNoMoves) isMate = true
    } else {
      if (capPiece) {
        lossCp += capVal
        capturedByOpponent.push(formatCapEntry(gameType, capPiece))
      }
      if (oppCheck) opponentChecks += 1
    }

    // 利用一步前状态无法在未 unmake 时调用，这里用精简规则生成可读记谱
    if (gameType === GAME_TYPE.CHESS) {
      pvReadable.push(
        formatChessPvStep({ board: [] }, move, stepNum, oppCheck, oppNoMoves)
      )
    } else {
      // 重建前一步棋盘极快，仅对这 <=3 步复盘步重放，确保象棋前/后消歧 100% 精确
      const tmp = parseState(gameType, fenStart)
      for (let j = 0; j < i; j++) {
        const l2 = getLegal(gameType, tmp)
        const m2 = l2.find((x) => x.uci === pvUcis[j])
        if (m2) makeMove(gameType, tmp, m2)
      }
      pvReadable.push(formatReadableStep(gameType, tmp, move, stepNum, oppCheck, oppNoMoves))
    }
  }

  const netMaterialCp = gainCp - lossCp
  const tags = []
  const addTag = (t) => {
    if (t && !tags.includes(t)) tags.push(t)
  }

  const significantLoss =
    (typeof evalLossCp === 'number' && evalLossCp >= 180) ||
    (typeof winRateDelta === 'number' && winRateDelta <= -12)

  // 1. 兑子与子力交换判断
  if (capturedByMover.length > 0 && capturedByOpponent.length > 0) {
    if (Math.abs(netMaterialCp) <= 60) {
      addTag(gainCp >= 200 ? '一换一兑子' : '兵卒互换')
    } else if (netMaterialCp > 60) {
      addTag('兑子得利')
    } else {
      addTag('亏子兑换')
    }
  } else if (capturedByMover.length > 0 && capturedByOpponent.length === 0) {
    addTag(gainCp >= 300 ? '得大子' : '吃兵得利')
  } else if (netMaterialCp <= -280) {
    if (significantLoss || (!isBestLine && typeof scoreCp === 'number' && typeof bestScoreCp === 'number' && bestScoreCp - scoreCp >= 160)) {
      addTag('白丢大子')
      addTag('漏防丢子')
    } else {
      addTag('弃大子攻杀')
    }
  } else if (netMaterialCp < 0 && netMaterialCp > -280) {
    const minorDrop =
      typeof evalLossCp === 'number'
        ? evalLossCp <= 80
        : typeof winRateDelta === 'number'
          ? winRateDelta > -10
          : true
    if (minorDrop || moverChecks > 0 || isBestLine) {
      addTag('弃兵抢先手')
    } else {
      addTag('漏防失兵')
    }
  }

  // 2. 将军与绝杀
  if (isMate) {
    addTag('绝杀定音')
  } else if (moverChecks > 0) {
    addTag('将军逼迫')
  }
  if (opponentChecks > 0) {
    addTag('遭反将受压')
  }

  // 3. 特殊战术特征
  if (firstMove && checkCenterControl(gameType, firstMove, moverSide)) {
    addTag('中心控制')
  }
  if (firstMove && firstMove.isCastle) {
    addTag('易位护王')
  }
  if (firstMove && firstMove.promotion) {
    addTag('升变强化')
  }
  if (wasInCheckInitially && firstMove) {
    addTag('解将防守')
  }

  if (tags.length === 0) {
    addTag(significantLoss ? '缓手失先' : '稳健布局')
  }

  // 生成客观结构化事实摘要
  const parts = []
  if (pvReadable.length > 0) {
    parts.push(`后续推演 ${pvReadable.join(' -> ')}`)
  }
  if (capturedByMover.length > 0 || capturedByOpponent.length > 0) {
    const capDesc = []
    if (capturedByMover.length > 0) capDesc.push(`吃掉${capturedByMover.join('+')}`)
    if (capturedByOpponent.length > 0) capDesc.push(`损失${capturedByOpponent.join('+')}`)
    parts.push(`2~3步子力净变化 ${netMaterialCp >= 0 ? '+' : ''}${netMaterialCp}cp（${capDesc.join('，')}）`)
  } else {
    parts.push('2~3步内无直接子力交换（偏先手/位置争夺）')
  }
  if (typeof evalLossCp === 'number' && evalLossCp > 0) {
    parts.push(`较引擎正解亏损约 ${evalLossCp}cp`)
  }

  return {
    pv: pvReadable,
    net_material_cp: netMaterialCp,
    captured_by_mover: capturedByMover,
    captured_by_opponent: capturedByOpponent,
    tactics_tags: tags.slice(0, 6),
    eval_loss_cp: typeof evalLossCp === 'number' ? Math.max(0, Math.round(evalLossCp)) : null,
    summary: parts.join('；') + '。'
  }
}

/**
 * 为候选走法列表补充结构化战术标签（保持原有 pv 可读序列）
 */
export function enrichCandidatesWithTactics(gameType, fenStart, candidates = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) return []
  const bestScore = Number(candidates[0].score_cp || 0)

  return candidates.slice(0, 3).map((cand, idx) => {
    const lineUcis =
      Array.isArray(cand.pv_uci) && cand.pv_uci.length > 0 ? cand.pv_uci : [cand.uci]
    const analysis = analyzeLineTactics(gameType, fenStart, lineUcis, {
      scoreCp: cand.score_cp,
      bestScoreCp: bestScore,
      isBestLine: idx === 0
    })

    return {
      uci: cand.uci,
      score_cp: cand.score_cp,
      notation: cand.notation || '',
      is_capture: Boolean(cand.is_capture),
      is_check: Boolean(cand.is_check),
      pv: Array.isArray(cand.pv) && cand.pv.length > 0 ? cand.pv : analysis.pv,
      tactics_tags: analysis.tactics_tags
    }
  })
}

/**
 * 为 AI 复盘教练构建完整的实走后果 vs 正解主变线战术对比数据
 */
export function buildCoachTacticalContext({
  gameType,
  fenBefore,
  fenAfter,
  actualUci,
  actualNotation,
  winRateDelta = null,
  topCandidatesAfter = [],
  alternativeCandidatesBefore = []
}) {
  const enrichedTop = enrichCandidatesWithTactics(gameType, fenAfter, topCandidatesAfter)
  const enrichedAlt = fenBefore
    ? enrichCandidatesWithTactics(gameType, fenBefore, alternativeCandidatesBefore)
    : []

  let actualMoveAnalysis = null
  if (fenBefore && actualUci) {
    const replyPvUcis =
      topCandidatesAfter[0] && Array.isArray(topCandidatesAfter[0].pv_uci)
        ? topCandidatesAfter[0].pv_uci.slice(0, 2)
        : topCandidatesAfter[0]
          ? [topCandidatesAfter[0].uci]
          : []
    const actualLineUcis = [actualUci, ...replyPvUcis]

    let evalLossCp = null
    if (alternativeCandidatesBefore.length > 0 && topCandidatesAfter.length > 0) {
      // before_score 为走子方视角，topCandidatesAfter[0].score_cp 为对手视角，两者相加即走子亏损厘兵分
      const bestBeforeCp = Number(alternativeCandidatesBefore[0].score_cp || 0)
      const bestReplyOppCp = Number(topCandidatesAfter[0].score_cp || 0)
      evalLossCp = Math.max(0, Math.round(bestBeforeCp + bestReplyOppCp))
    }

    const lineResult = analyzeLineTactics(gameType, fenBefore, actualLineUcis, {
      evalLossCp,
      winRateDelta,
      isBestLine:
        alternativeCandidatesBefore.length > 0 &&
        alternativeCandidatesBefore[0].uci === actualUci
    })

    actualMoveAnalysis = {
      uci: actualUci,
      notation: actualNotation || actualUci,
      pv: lineResult.pv,
      net_material_cp: lineResult.net_material_cp,
      captured_by_mover: lineResult.captured_by_mover,
      captured_by_opponent: lineResult.captured_by_opponent,
      tactics_tags: lineResult.tactics_tags,
      eval_loss_cp: lineResult.eval_loss_cp,
      summary: lineResult.summary
    }
  }

  return {
    top_candidates: enrichedTop,
    alternative_candidates: enrichedAlt,
    actual_move_analysis: actualMoveAnalysis
  }
}
