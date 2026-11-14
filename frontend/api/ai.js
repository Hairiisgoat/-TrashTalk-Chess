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
      candidates: payload.candidates.slice(0, 10),
      persona_id: payload.persona_id,
      difficulty: payload.difficulty,
      recent_history: (payload.recent_history || []).slice(-3),
      win_rate_delta: Math.max(-100, Math.min(100, Number(payload.win_rate_delta || 0))),
      move_number: Math.max(1, parseInt(payload.move_number || 1, 10))
    }
    if (
      payload.custom_persona &&
      payload.custom_persona.name &&
      payload.custom_persona.style_prompt
    ) {
      body.custom_persona = {
        name: String(payload.custom_persona.name).slice(0, 40),
        style_prompt: String(payload.custom_persona.style_prompt).slice(0, 500),
        catchphrase: payload.custom_persona.catchphrase
          ? String(payload.custom_persona.catchphrase).slice(0, 140)
          : undefined
      }
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
