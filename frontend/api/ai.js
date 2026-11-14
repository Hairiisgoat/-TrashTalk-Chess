/**
 * AI 对弈与角色配置 API 接口层（严格对齐 API_SPEC.md）
 * - 默认请求 http://127.0.0.1:8000/api/v1，超时 8000ms
 * - 当后端未启动、网络超时或返回 429/5xx 时，自动执行前端本地 Fallback：
 *   直接落子 candidates[0] 并弹出对应角色的本地预设吐槽气泡
 */

import ENV_CONFIG from '../config/env.js'
import {
  DEFAULT_PERSONAS,
  DEFAULT_FALLBACK_COMMENT,
  LOCAL_FALLBACK_COMMENTS
} from '../config/constants.js'
import { request, generateRequestId } from './request.js'
import {
  buildCustomHeadersFromConfig,
  getActiveCustomHeaders
} from '../stores/settings.js'

const VALID_EMOTIONS = new Set([
  'neutral',
  'smug',
  'taunting',
  'panicked',
  'impressed',
  'rage'
])

function pickRandom(list) {
  if (!Array.isArray(list) || list.length === 0) return ''
  const idx = Math.floor(Math.random() * list.length)
  return list[idx]
}

/**
 * 根据对局胜率变化与候选步特征，生成前端本地 Fallback 响应
 */
export function buildLocalFallbackMoveResponse(payload, reason = 'network_offline', elapsedMs = 0) {
  const topCandidate = payload.candidates[0]
  const personaId = payload.persona_id || 'deepseek_master'
  const delta = Number(payload.win_rate_delta || 0)
  const scoreCp = Number(topCandidate.score_cp || 0)

  let emotion = 'neutral'
  if (delta >= 8 || scoreCp >= 350) {
    emotion = 'taunting'
  } else if (delta >= 2.5 || topCandidate.is_capture || topCandidate.is_check) {
    emotion = 'smug'
  } else if (delta <= -10 || scoreCp <= -350) {
    emotion = 'panicked'
  } else if (delta <= -3.5) {
    emotion = 'impressed'
  }

  const personaBank = LOCAL_FALLBACK_COMMENTS[personaId] || LOCAL_FALLBACK_COMMENTS.deepseek_master
  const commentPool = (personaBank && personaBank[emotion]) || (personaBank && personaBank.neutral) || []
  const customPhrase =
    payload.custom_persona && payload.custom_persona.catchphrase
      ? payload.custom_persona.catchphrase
      : ''
  const comment =
    (!LOCAL_FALLBACK_COMMENTS[personaId] && customPhrase) ||
    pickRandom(commentPool) ||
    DEFAULT_FALLBACK_COMMENT

  return {
    selected_move: topCandidate.uci,
    comment: comment.slice(0, 140),
    emotion,
    persona_id: personaId,
    model_provider: 'fallback',
    model_name: 'engine_top1',
    is_fallback: true,
    is_local_fallback: true,
    fallback_reason: reason,
    latency_ms: Math.max(0, Math.round(elapsedMs)),
    request_id: generateRequestId()
  }
}

/**
 * 探活检测：GET /api/v1/health
 */
export async function checkBackendHealth(customHeaders = null) {
  try {
    const res = await request({
      url: '/health',
      method: 'GET',
      headers: customHeaders || getActiveCustomHeaders(),
      timeout: ENV_CONFIG.healthCheckTimeoutMs
    })
    return {
      online: Boolean(res && res.status === 'ok'),
      ...res
    }
  } catch (_err) {
    return { online: false }
  }
}

/**
 * 测试自定义 API 与模型连通性：POST /api/v1/ai/test-connection
 */
export async function testApiConnection(configOverride = null) {
  const startedAt = Date.now()
  const headers = configOverride
    ? buildCustomHeadersFromConfig({ ...configOverride, mode: configOverride.mode || 'custom' })
    : getActiveCustomHeaders()
  const payload = {}
  if (configOverride && configOverride.provider) {
    payload.provider = configOverride.provider
  }
  if (configOverride && configOverride.modelName) {
    payload.model = configOverride.modelName
  }

  try {
    const res = await request({
      url: '/ai/test-connection',
      method: 'POST',
      data: payload,
      headers,
      timeout: ENV_CONFIG.requestTimeoutMs
    })
    return res
  } catch (err) {
    return {
      ok: false,
      provider: (configOverride && configOverride.provider) || 'deepseek',
      model_name: (configOverride && configOverride.modelName) || '',
      latency_ms: Math.max(0, Date.now() - startedAt),
      message: (err && err.message) || '无法连接到后端测试接口，请检查服务端是否已启动',
      using_custom_credentials: Object.keys(headers).length > 0
    }
  }
}

/**
 * 获取角色列表：GET /api/v1/personas
 * 若后端不可达，自动降级为前端内置 DEFAULT_PERSONAS
 */
export async function getPersonas(gameType = null) {
  try {
    const res = await request({
      url: '/personas',
      method: 'GET',
      params: gameType ? { game_type: gameType } : undefined,
      timeout: ENV_CONFIG.healthCheckTimeoutMs
    })

    if (res && Array.isArray(res.personas) && res.personas.length > 0) {
      return {
        personas: res.personas,
        total: typeof res.total === 'number' ? res.total : res.personas.length,
        request_id: res.request_id || generateRequestId(),
        fromLocalFallback: false
      }
    }
    throw new Error('Empty personas response')
  } catch (_err) {
    const filtered = gameType
      ? DEFAULT_PERSONAS.filter((p) => p.supported_games.includes(gameType))
      : DEFAULT_PERSONAS.slice()
    return {
      personas: filtered,
      total: filtered.length,
      request_id: generateRequestId(),
      fromLocalFallback: true
    }
  }
}

function sanitizeCustomPersona(customPersona) {
  if (!customPersona || !customPersona.name || !customPersona.style_prompt) {
    return undefined
  }
  return {
    name: String(customPersona.name).slice(0, 40),
    style_prompt: String(customPersona.style_prompt).slice(0, 500),
    catchphrase: customPersona.catchphrase
      ? String(customPersona.catchphrase).slice(0, 140)
      : undefined
  }
}

function formatCandidateForCoach(cand) {
  return {
    uci: cand.uci,
    score_cp: cand.score_cp,
    notation: cand.notation || '',
    is_capture: Boolean(cand.is_capture),
    is_check: Boolean(cand.is_check),
    pv: Array.isArray(cand.pv) ? cand.pv.slice(0, 6) : [],
    tactics_tags: Array.isArray(cand.tactics_tags) ? cand.tactics_tags.slice(0, 8) : []
  }
}

export function buildLocalCoachFallback(payload, elapsedMs = 0) {
  const moveLabel = payload.last_move_notation || '当前开局'
  const cands =
    (Array.isArray(payload.alternative_candidates) && payload.alternative_candidates.length > 0
      ? payload.alternative_candidates
      : payload.top_candidates) || []
  const bestLine = cands.length
    ? cands
        .slice(0, 3)
        .map((c, idx) => {
          const pvStr = Array.isArray(c.pv) && c.pv.length > 0 ? ` | 主变: ${c.pv.join(' -> ')}` : ''
          const tagStr =
            Array.isArray(c.tactics_tags) && c.tactics_tags.length > 0
              ? ` [${c.tactics_tags.join('、')}]`
              : ''
          return `${idx + 1}. ${c.notation || c.uci} (${c.score_cp >= 0 ? '+' : ''}${c.score_cp})${tagStr}${pvStr}`
        })
        .join('\n')
    : '当前局面已无后续合法着法。'
  const deltaNote =
    typeof payload.win_rate_delta === 'number' && payload.win_rate_delta < -15
      ? `这一步后我方胜率骤降 ${payload.win_rate_delta.toFixed(1)}%，属于关键战犯步！`
      : ''
  const actualNote =
    payload.actual_move_analysis && payload.actual_move_analysis.summary
      ? `\n实走推演：${payload.actual_move_analysis.summary}`
      : ''

  return {
    answer: `（本地引擎离线复盘）针对「${moveLabel}」，当前我方胜率 ${Number(payload.win_rate || 50).toFixed(1)}%。${deltaNote}${actualNote}\n引擎推荐变例：\n${bestLine}`,
    persona_id: payload.persona_id || 'deepseek_master',
    model_provider: 'fallback',
    model_name: 'engine_coach_local',
    is_fallback: true,
    is_local_fallback: true,
    fallback_reason: 'backend_unavailable',
    latency_ms: Math.max(0, Math.round(elapsedMs)),
    request_id: generateRequestId()
  }
}

/**
 * 复盘 AI 教练自由追问：POST /api/v1/ai/coach/ask
 */
export async function askCoach(payload) {
  if (!payload || !payload.fen || !payload.question) {
    throw new Error('askCoach requires fen and question')
  }
  const startedAt = Date.now()
  try {
    const body = {
      game_type: payload.game_type,
      fen: payload.fen,
      last_move_notation: payload.last_move_notation || null,
      score_cp: Math.max(-30000, Math.min(30000, Math.round(Number(payload.score_cp || 0)))),
      win_rate: Math.max(0, Math.min(100, Number(payload.win_rate ?? 50))),
      top_candidates: Array.isArray(payload.top_candidates)
        ? payload.top_candidates.slice(0, 3).map(formatCandidateForCoach)
        : [],
      question: String(payload.question).trim().slice(0, 500),
      persona_id: payload.persona_id || 'deepseek_master'
    }
    const customPersona = sanitizeCustomPersona(payload.custom_persona)
    if (customPersona) body.custom_persona = customPersona
    if (typeof payload.win_rate_delta === 'number') {
      body.win_rate_delta = Math.max(-100, Math.min(100, payload.win_rate_delta))
    }
    if (Array.isArray(payload.alternative_candidates) && payload.alternative_candidates.length > 0) {
      body.alternative_candidates = payload.alternative_candidates
        .slice(0, 3)
        .map(formatCandidateForCoach)
    }
    if (payload.actual_move_analysis && typeof payload.actual_move_analysis === 'object') {
      body.actual_move_analysis = payload.actual_move_analysis
    }
    if (Array.isArray(payload.chat_history) && payload.chat_history.length > 0) {
      body.chat_history = payload.chat_history
        .slice(-8)
        .filter((turn) => turn && (turn.role === 'user' || turn.role === 'assistant') && turn.content)
        .map((turn) => ({
          role: turn.role,
          content: String(turn.content).trim().slice(0, 1200)
        }))
    }
    if (payload.summary_context) {
      body.summary_context = String(payload.summary_context).slice(0, 1000)
    }

    const res = await request({
      url: '/ai/coach/ask',
      method: 'POST',
      data: body,
      headers: getActiveCustomHeaders(),
      timeout: Math.max(ENV_CONFIG.requestTimeoutMs, 12000)
    })

    return {
      ...res,
      is_local_fallback: false
    }
  } catch (_err) {
    return buildLocalCoachFallback(payload, Date.now() - startedAt)
  }
}

/**
 * 核心对弈决策请求：POST /api/v1/ai/move
 * 任何网络异常、8000ms 超时、非 200 错误或非法走法，均自动触发本地 Fallback，保证永不卡死
 */
export async function requestAiMove(payload) {
  if (!payload || !Array.isArray(payload.candidates) || payload.candidates.length === 0) {
    throw new Error('requestAiMove requires at least 1 candidate move')
  }

  const startedAt = Date.now()
  const whitelist = new Set(payload.candidates.map((c) => c.uci))

  try {
    const body = {
      game_type: payload.game_type,
      fen: payload.fen,
      candidates: payload.candidates.slice(0, 10).map((c) => ({
        uci: c.uci,
        score_cp: c.score_cp,
        notation: c.notation || '',
        is_capture: Boolean(c.is_capture),
        is_check: Boolean(c.is_check)
      })),
      persona_id: payload.persona_id,
      difficulty: payload.difficulty,
      recent_history: (payload.recent_history || []).slice(-3),
      win_rate_delta: Math.max(-100, Math.min(100, Number(payload.win_rate_delta || 0))),
      move_number: Math.max(1, parseInt(payload.move_number || 1, 10))
    }
    const customPersona = sanitizeCustomPersona(payload.custom_persona)
    if (customPersona) {
      body.custom_persona = customPersona
    }

    const res = await request({
      url: '/ai/move',
      method: 'POST',
      data: body,
      headers: getActiveCustomHeaders(),
      timeout: ENV_CONFIG.requestTimeoutMs
    })

    if (!res || !whitelist.has(res.selected_move)) {
      return buildLocalFallbackMoveResponse(
        payload,
        'illegal_move',
        Date.now() - startedAt
      )
    }

    return {
      ...res,
      emotion: VALID_EMOTIONS.has(res.emotion) ? res.emotion : 'neutral',
      comment: String(res.comment || DEFAULT_FALLBACK_COMMENT).slice(0, 140),
      is_local_fallback: false
    }
  } catch (err) {
    const reason = err && err.isTimeout ? 'frontend_timeout' : 'backend_unavailable'
    return buildLocalFallbackMoveResponse(
      payload,
      reason,
      Date.now() - startedAt
    )
  }
}
