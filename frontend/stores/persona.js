/**
 * 角色状态管理 (Vue 3 reactive store)
 * 管理已加载角色列表、当前选中对手与动态主题色绑定
 */

import { reactive, computed } from 'vue'
import { DEFAULT_PERSONAS } from '../config/constants.js'
import { getPersonas, checkBackendHealth } from '../api/ai.js'
import { useSettingsStore } from './settings.js'

const settingsStore = useSettingsStore()

let basePersonas = DEFAULT_PERSONAS.slice()

function buildMergedPersonas(baseList) {
  const customList = Array.isArray(settingsStore.state.customPersonas)
    ? settingsStore.state.customPersonas
    : []
  return [...customList, ...baseList]
}

const state = reactive({
  personas: buildMergedPersonas(basePersonas),
  selectedPersonaId: DEFAULT_PERSONAS[0].persona_id,
  loading: false,
  backendOnline: false,
  fromLocalFallback: true
})

function syncPersonas(selectPersonaId = null) {
  state.personas = buildMergedPersonas(basePersonas)
  if (selectPersonaId) {
    const targetExists = state.personas.some(
      (p) => p.persona_id === selectPersonaId && p.is_enabled !== false
    )
    if (targetExists) {
      state.selectedPersonaId = selectPersonaId
      return
    }
  }
  const stillExists = state.personas.some(
    (p) => p.persona_id === state.selectedPersonaId && p.is_enabled !== false
  )
  if (!stillExists && state.personas.length > 0) {
    const firstEnabled = state.personas.find((p) => p.is_enabled !== false) || state.personas[0]
    state.selectedPersonaId = firstEnabled.persona_id
  }
}

const currentPersona = computed(() => {
  return (
    state.personas.find((p) => p.persona_id === state.selectedPersonaId) ||
    state.personas[0] ||
    DEFAULT_PERSONAS[0]
  )
})

const themeColor = computed(() => {
  return currentPersona.value && currentPersona.value.theme_color
    ? currentPersona.value.theme_color
    : '#2563EB'
})

async function loadPersonas(gameType = null) {
  state.loading = true
  try {
    const [personaRes, healthRes] = await Promise.all([
      getPersonas(gameType),
      checkBackendHealth()
    ])
    basePersonas = personaRes.personas
    state.fromLocalFallback = personaRes.fromLocalFallback
    state.backendOnline = Boolean(healthRes && healthRes.online)
    syncPersonas()
  } finally {
    state.loading = false
  }
}

function selectPersona(personaId) {
  const exists = state.personas.some((p) => p.persona_id === personaId)
  if (exists) {
    state.selectedPersonaId = personaId
  }
}

export function usePersonaStore() {
  return {
    state,
    currentPersona,
    themeColor,
    loadPersonas,
    selectPersona,
    syncPersonas
  }
}
