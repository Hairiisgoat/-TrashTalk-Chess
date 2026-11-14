/**
 * 用户自定义 API 配置、模型切换与角色工坊状态管理 (Vue 3 reactive store)
 * - 持久化至 uni.setStorageSync（兼容浏览器 localStorage 与 Node 单测环境）
 * - 默认采用服务端配置（mode = 'server'），切换为 'custom' 时通过 X-Custom-* 请求头无状态透传
 */

import { reactive, computed } from 'vue'

export const SETTINGS_STORAGE_KEY = 'trashtalk_chess_user_settings_v1'

export const PROVIDER_PRESETS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    modelPlaceholder: '如 deepseek-chat / deepseek-reasoner'
  },
  {
    id: 'openai',
    label: 'OpenAI 兼容',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    modelPlaceholder: '如 gpt-4o-mini / gpt-4o / qwen-plus'
  },
  {
    id: 'anthropic',
    label: 'Claude',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-5-5',
    modelPlaceholder: '如 claude-sonnet-5-5 / claude-3-5-sonnet-latest'
  }
]

export const CUSTOM_THEME_SWATCHES = [
  '#8B5CF6',
  '#EC4899',
  '#EF4444',
  '#F59E0B',
  '#10B981',
  '#06B6D4',
  '#2563EB',
  '#D97706'
]

function readStorage(key) {
  try {
    if (typeof uni !== 'undefined' && typeof uni.getStorageSync === 'function') {
      const val = uni.getStorageSync(key)
      if (val) return typeof val === 'string' ? JSON.parse(val) : val
    }
  } catch (_err) {
    // ignore storage errors
  }
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      const raw = globalThis.localStorage.getItem(key)
      if (raw) return JSON.parse(raw)
    }
  } catch (_err) {
    // ignore storage errors
  }
  return null
}

function writeStorage(key, value) {
  try {
    if (typeof uni !== 'undefined' && typeof uni.setStorageSync === 'function') {
      uni.setStorageSync(key, JSON.stringify(value))
      return
    }
  } catch (_err) {
    // ignore storage errors
  }
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      globalThis.localStorage.setItem(key, JSON.stringify(value))
    }
  } catch (_err) {
    // ignore storage errors
  }
}

function createDefaultState() {
  return {
    mode: 'server', // 'server' | 'custom'
    provider: 'deepseek', // 'deepseek' | 'openai' | 'anthropic'
    baseUrl: '',
    apiKey: '',
    modelName: '',
    customPersonas: []
  }
}

function sanitizeCustomPersona(raw) {
  if (!raw || typeof raw !== 'object') return null
  const name = String(raw.name || '').trim()
  const stylePrompt = String(raw.style_prompt || '').trim()
  if (!name || !stylePrompt) return null
  const catchphrase = String(raw.catchphrase || '').trim()
  const themeColor = String(raw.theme_color || '#8B5CF6').trim() || '#8B5CF6'
  const personaId = String(raw.persona_id || '').trim() || `custom_${Date.now().toString(36)}`
  return {
    persona_id: personaId,
    name: name.slice(0, 40),
    title: '工坊自定义棋手',
    model_provider: String(raw.model_provider || 'custom'),
    model_name: String(raw.model_name || ''),
    theme_color: themeColor,
    avatar_url: '',
    tags: ['自定义人格', '专属人设'],
    supported_games: ['xiangqi', 'chess'],
    greeting: (catchphrase || `我是${name}，少废话，先落子让我瞧瞧你的成色！`).slice(0, 140),
    style_prompt: stylePrompt.slice(0, 500),
    catchphrase: catchphrase.slice(0, 140),
    is_custom: true,
    is_enabled: true
  }
}

const persisted = readStorage(SETTINGS_STORAGE_KEY)
const initial = createDefaultState()
if (persisted && typeof persisted === 'object') {
  initial.mode = persisted.mode === 'custom' ? 'custom' : 'server'
  if (['deepseek', 'openai', 'anthropic'].includes(persisted.provider)) {
    initial.provider = persisted.provider
  }
  initial.baseUrl = String(persisted.baseUrl || '')
  initial.apiKey = String(persisted.apiKey || '')
  initial.modelName = String(persisted.modelName || '')
  if (Array.isArray(persisted.customPersonas)) {
    initial.customPersonas = persisted.customPersonas
      .map(sanitizeCustomPersona)
      .filter(Boolean)
  }
}

const state = reactive(initial)

function persistSettings() {
  writeStorage(SETTINGS_STORAGE_KEY, {
    mode: state.mode,
    provider: state.provider,
    baseUrl: state.baseUrl,
    apiKey: state.apiKey,
    modelName: state.modelName,
    customPersonas: state.customPersonas
  })
}

const isCustomApiActive = computed(() => state.mode === 'custom')

function getProviderPreset(providerId = state.provider) {
  return PROVIDER_PRESETS.find((p) => p.id === providerId) || PROVIDER_PRESETS[0]
}

/**
 * 构建需透传给后端的 X-Custom-* 请求头
 * @param {object|null} overrideConfig 可选临时表单配置（用于保存前测试连通性）
 */
export function buildCustomHeadersFromConfig(config) {
  if (!config) return {}
  const mode = config.mode || 'custom'
  if (mode !== 'custom') return {}

  const headers = {}
  const provider = String(config.provider || '').trim().toLowerCase()
  const baseUrl = String(config.baseUrl || '').trim()
  const apiKey = String(config.apiKey || '').trim()
  const modelName = String(config.modelName || '').trim()

  if (provider) headers['X-Custom-Provider'] = provider
  if (baseUrl) headers['X-Custom-Base-Url'] = baseUrl
  if (apiKey) headers['X-Custom-Api-Key'] = apiKey
  if (modelName) headers['X-Custom-Model'] = modelName
  return headers
}

export function getActiveCustomHeaders() {
  return buildCustomHeadersFromConfig(state)
}

function updateApiConfig(patch = {}) {
  if (patch.mode === 'custom' || patch.mode === 'server') {
    state.mode = patch.mode
  }
  if (['deepseek', 'openai', 'anthropic'].includes(patch.provider)) {
    state.provider = patch.provider
  }
  if (patch.baseUrl !== undefined) {
    state.baseUrl = String(patch.baseUrl || '').trim()
  }
  if (patch.apiKey !== undefined) {
    state.apiKey = String(patch.apiKey || '').trim()
  }
  if (patch.modelName !== undefined) {
    state.modelName = String(patch.modelName || '').trim()
  }
  // 刷新自定义角色展示的模型厂商标签
  state.customPersonas = state.customPersonas.map((p) => ({
    ...p,
    model_provider: state.mode === 'custom' ? state.provider : 'deepseek',
    model_name: state.mode === 'custom' ? state.modelName : ''
  }))
  persistSettings()
}

function resetApiConfig() {
  state.mode = 'server'
  state.provider = 'deepseek'
  state.baseUrl = ''
  state.apiKey = ''
  state.modelName = ''
  persistSettings()
}

function saveCustomPersona(draft) {
  const normalized = sanitizeCustomPersona({
    ...draft,
    persona_id:
      draft && draft.persona_id
        ? draft.persona_id
        : `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    model_provider: state.mode === 'custom' ? state.provider : 'deepseek',
    model_name: state.mode === 'custom' ? state.modelName : ''
  })
  if (!normalized) return null

  const idx = state.customPersonas.findIndex((p) => p.persona_id === normalized.persona_id)
  if (idx >= 0) {
    state.customPersonas.splice(idx, 1, normalized)
  } else {
    state.customPersonas.unshift(normalized)
  }
  persistSettings()
  return normalized
}

function deleteCustomPersona(personaId) {
  const next = state.customPersonas.filter((p) => p.persona_id !== personaId)
  if (next.length !== state.customPersonas.length) {
    state.customPersonas = next
    persistSettings()
    return true
  }
  return false
}

function resetAllForTest() {
  const def = createDefaultState()
  state.mode = def.mode
  state.provider = def.provider
  state.baseUrl = def.baseUrl
  state.apiKey = def.apiKey
  state.modelName = def.modelName
  state.customPersonas = []
  persistSettings()
}

export function useSettingsStore() {
  return {
    state,
    isCustomApiActive,
    getProviderPreset,
    getCustomHeaders: getActiveCustomHeaders,
    updateApiConfig,
    resetApiConfig,
    saveCustomPersona,
    deleteCustomPersona,
    resetAllForTest
  }
}
