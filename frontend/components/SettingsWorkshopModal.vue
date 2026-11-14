<template>
  <view v-if="visible" class="modal-backdrop" @tap="onBackdropTap">
    <view class="drawer-card" @tap.stop>
      <!-- 顶部标题与关闭按钮 -->
      <view class="drawer-head">
        <view>
          <text class="drawer-title">API 与模型设置</text>
          <text class="drawer-sub">本地存储 · 请求头无状态透传 · 自定义人格工坊</text>
        </view>
        <view class="close-btn" @tap="$emit('close')">
          <text class="close-icon">✕</text>
        </view>
      </view>

      <!-- 一级导航标签 -->
      <view class="tab-bar">
        <view
          class="tab-item"
          :class="{ 'is-active': activeTab === 'api' }"
          @tap="activeTab = 'api'"
        >
          <text class="tab-text">🔌 模型与密钥</text>
        </view>
        <view
          class="tab-item"
          :class="{ 'is-active': activeTab === 'persona' }"
          @tap="activeTab = 'persona'"
        >
          <text class="tab-text">🎭 角色工坊 ({{ customPersonas.length }})</text>
        </view>
      </view>

      <scroll-view scroll-y class="drawer-scroll">
        <!-- Tab 1: API 与模型配置 -->
        <view v-if="activeTab === 'api'" class="tab-panel">
          <view class="field-block">
            <text class="field-label">运行模式</text>
            <view class="mode-switch">
              <view
                class="mode-btn"
                :class="{ 'is-active': form.mode === 'server' }"
                @tap="form.mode = 'server'"
              >
                <text class="mode-title">使用服务端默认配置</text>
                <text class="mode-desc">直接调用服务器 .env 配置</text>
              </view>
              <view
                class="mode-btn"
                :class="{ 'is-active': form.mode === 'custom' }"
                @tap="form.mode = 'custom'"
              >
                <text class="mode-title">自定义我的 API Key</text>
                <text class="mode-desc">BYOK 密钥仅存于本机</text>
              </view>
            </view>
          </view>

          <view v-if="form.mode === 'custom'" class="custom-fields">
            <view class="field-block">
              <text class="field-label">模型厂商</text>
              <view class="provider-row">
                <view
                  v-for="item in PROVIDER_PRESETS"
                  :key="item.id"
                  class="provider-pill"
                  :class="{ 'is-active': form.provider === item.id }"
                  @tap="onSelectProvider(item.id)"
                >
                  <text class="provider-label">{{ item.label }}</text>
                </view>
              </view>
            </view>

            <view class="field-block">
              <text class="field-label">Base URL（支持中转站 / 私有代理）</text>
              <input
                v-model="form.baseUrl"
                class="text-input"
                :placeholder="`留空默认：${currentPreset.defaultBaseUrl}`"
                placeholder-class="input-placeholder"
              />
            </view>

            <view class="field-block">
              <view class="label-row">
                <text class="field-label">API Key（仅保存在本地缓存）</text>
                <text class="toggle-secret" @tap="showApiKey = !showApiKey">
                  {{ showApiKey ? '隐藏密钥' : '显示密钥' }}
                </text>
              </view>
              <input
                v-model="form.apiKey"
                class="text-input"
                :password="!showApiKey"
                placeholder="sk-... 或代理站点密钥"
                placeholder-class="input-placeholder"
              />
            </view>

            <view class="field-block">
              <text class="field-label">具体模型名称</text>
              <input
                v-model="form.modelName"
                class="text-input"
                :placeholder="currentPreset.modelPlaceholder"
                placeholder-class="input-placeholder"
              />
              <text class="field-hint">
                示例：deepseek-chat / gpt-4o-mini / claude-sonnet-5-5（留空将使用该厂商默认模型）
              </text>
            </view>
          </view>

          <view v-else class="server-tip-box">
            <text class="server-tip-text">
              当前将使用服务端预设的 DeepSeek / GPT / Claude 接口。如果服务端未填写密钥或你想体验指定模型/中转站，可随时切换为上方「自定义我的 API Key」。
            </text>
          </view>

          <!-- 连通性测试结果条 -->
          <view
            v-if="testResult"
            class="test-banner"
            :class="testResult.ok ? 'is-ok' : 'is-fail'"
          >
            <text class="test-status">
              {{ testResult.ok ? '✅ 连通性验证通过' : '⚠️ 连通性测试未通过' }}
              <text v-if="testResult.latency_ms >= 0"> · {{ testResult.latency_ms }}ms</text>
            </text>
            <text class="test-msg">{{ testResult.message }}</text>
          </view>

          <view class="action-row">
            <button
              class="btn-secondary"
              :disabled="testingConnection"
              @tap="onTestConnection"
            >
              {{ testingConnection ? '测试中...' : '测试连通性' }}
            </button>
            <button class="btn-primary" @tap="onSaveApiConfig">
              保存配置
            </button>
          </view>
        </view>

        <!-- Tab 2: 自定义对手人格工坊 -->
        <view v-else class="tab-panel">
          <!-- 已创建列表 -->
          <view v-if="customPersonas.length > 0" class="saved-persona-list">
            <text class="field-label">已保存的自定义对手</text>
            <view
              v-for="item in customPersonas"
              :key="item.persona_id"
              class="saved-persona-item"
            >
              <view class="saved-left">
                <view class="color-dot" :style="{ backgroundColor: item.theme_color }" />
                <view class="saved-meta">
                  <text class="saved-name">{{ item.name }}</text>
                  <text class="saved-desc">{{ item.style_prompt }}</text>
                </view>
              </view>
              <view class="saved-actions">
                <text class="link-btn" @tap="onEditPersona(item)">编辑</text>
                <text class="link-btn danger" @tap="onDeletePersona(item.persona_id)">删除</text>
              </view>
            </view>
          </view>

          <!-- 新建/编辑表单 -->
          <view class="workshop-form">
            <view class="label-row">
              <text class="field-label">
                {{ editingPersonaId ? '编辑自定义对手' : '新建自定义对手' }}
              </text>
              <text v-if="editingPersonaId" class="toggle-secret" @tap="resetPersonaDraft">
                取消编辑 / 新建
              </text>
            </view>

            <view class="field-block">
              <text class="sub-label">角色名称</text>
              <input
                v-model="personaDraft.name"
                class="text-input"
                maxlength="40"
                placeholder="例如：暴躁广州棋王"
                placeholder-class="input-placeholder"
              />
            </view>

            <view class="field-block">
              <text class="sub-label">主题氛围色</text>
              <view class="swatch-row">
                <view
                  v-for="color in CUSTOM_THEME_SWATCHES"
                  :key="color"
                  class="swatch-item"
                  :class="{ 'is-picked': personaDraft.theme_color === color }"
                  :style="{ backgroundColor: color }"
                  @tap="personaDraft.theme_color = color"
                >
                  <text v-if="personaDraft.theme_color === color" class="swatch-check">✓</text>
                </view>
              </view>
            </view>

            <view class="field-block">
              <text class="sub-label">性格与说话风格描述</text>
              <textarea
                v-model="personaDraft.style_prompt"
                class="text-area"
                maxlength="500"
                placeholder="例如：暴躁傲娇的广州棋王，爱喝早茶、说话夹杂粤语梗，顺风狂吹、逆风嘴硬甩锅"
                placeholder-class="input-placeholder"
              />
            </view>

            <view class="field-block">
              <text class="sub-label">开局口头禅（可选）</text>
              <input
                v-model="personaDraft.catchphrase"
                class="text-input"
                maxlength="140"
                placeholder="例如：得闲饮茶啦喂！先让你三步都唔惊！"
                placeholder-class="input-placeholder"
              />
            </view>

            <button class="btn-primary full-width" @tap="onSavePersona">
              {{ editingPersonaId ? '更新角色并选中出战' : '保存到角色列表并选中' }}
            </button>
          </view>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import {
  useSettingsStore,
  PROVIDER_PRESETS,
  CUSTOM_THEME_SWATCHES
} from '../stores/settings.js'
import { usePersonaStore } from '../stores/persona.js'
import { testApiConnection } from '../api/ai.js'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'saved'])

const settingsStore = useSettingsStore()
const personaStore = usePersonaStore()

const activeTab = ref('api')
const showApiKey = ref(false)
const testingConnection = ref(false)
const testResult = ref(null)
const editingPersonaId = ref('')

const form = reactive({
  mode: settingsStore.state.mode,
  provider: settingsStore.state.provider,
  baseUrl: settingsStore.state.baseUrl,
  apiKey: settingsStore.state.apiKey,
  modelName: settingsStore.state.modelName
})

const personaDraft = reactive({
  name: '',
  theme_color: CUSTOM_THEME_SWATCHES[0],
  style_prompt: '',
  catchphrase: ''
})

const customPersonas = computed(() => settingsStore.state.customPersonas)
const currentPreset = computed(() => settingsStore.getProviderPreset(form.provider))

watch(
  () => props.visible,
  (isOpen) => {
    if (isOpen) {
      form.mode = settingsStore.state.mode
      form.provider = settingsStore.state.provider
      form.baseUrl = settingsStore.state.baseUrl
      form.apiKey = settingsStore.state.apiKey
      form.modelName = settingsStore.state.modelName
      testResult.value = null
    }
  }
)

function onBackdropTap() {
  emit('close')
}

function onSelectProvider(providerId) {
  const prevPreset = settingsStore.getProviderPreset(form.provider)
  const nextPreset = settingsStore.getProviderPreset(providerId)
  form.provider = providerId
  if (!form.modelName || form.modelName === prevPreset.defaultModel) {
    form.modelName = nextPreset.defaultModel
  }
  testResult.value = null
}

async function onTestConnection() {
  testingConnection.value = true
  testResult.value = null
  try {
    const res = await testApiConnection(
      form.mode === 'custom'
        ? {
            mode: 'custom',
            provider: form.provider,
            baseUrl: form.baseUrl,
            apiKey: form.apiKey,
            modelName: form.modelName
          }
        : { mode: 'server' }
    )
    testResult.value = res
  } finally {
    testingConnection.value = false
  }
}

function onSaveApiConfig() {
  settingsStore.updateApiConfig({
    mode: form.mode,
    provider: form.provider,
    baseUrl: form.baseUrl,
    apiKey: form.apiKey,
    modelName: form.modelName
  })
  personaStore.syncPersonas()
  uni.showToast({
    title: form.mode === 'custom' ? '已启用自定义 API 配置' : '已切换服务端默认配置',
    icon: 'none'
  })
  emit('saved')
  emit('close')
}

function resetPersonaDraft() {
  editingPersonaId.value = ''
  personaDraft.name = ''
  personaDraft.theme_color = CUSTOM_THEME_SWATCHES[0]
  personaDraft.style_prompt = ''
  personaDraft.catchphrase = ''
}

function onEditPersona(item) {
  editingPersonaId.value = item.persona_id
  personaDraft.name = item.name
  personaDraft.theme_color = item.theme_color || CUSTOM_THEME_SWATCHES[0]
  personaDraft.style_prompt = item.style_prompt || ''
  personaDraft.catchphrase = item.catchphrase || ''
}

function onDeletePersona(personaId) {
  settingsStore.deleteCustomPersona(personaId)
  personaStore.syncPersonas()
  if (editingPersonaId.value === personaId) {
    resetPersonaDraft()
  }
  uni.showToast({ title: '已删除自定义角色', icon: 'none' })
}

function onSavePersona() {
  if (!personaDraft.name.trim() || !personaDraft.style_prompt.trim()) {
    uni.showToast({ title: '请填写角色名称与性格描述', icon: 'none' })
    return
  }
  const saved = settingsStore.saveCustomPersona({
    persona_id: editingPersonaId.value || undefined,
    name: personaDraft.name,
    theme_color: personaDraft.theme_color,
    style_prompt: personaDraft.style_prompt,
    catchphrase: personaDraft.catchphrase
  })
  if (!saved) return
  personaStore.syncPersonas(saved.persona_id)
  resetPersonaDraft()
  uni.showToast({ title: `已保存「${saved.name}」并选中`, icon: 'none' })
  emit('saved')
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background-color: rgba(2, 6, 23, 0.72);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.drawer-card {
  width: 100%;
  max-width: 560px;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: rgba(15, 23, 42, 0.94);
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 20px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  padding: 18px 18px 20px;
  overflow: hidden;
}

.drawer-head {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.drawer-title {
  display: block;
  font-size: 18px;
  font-weight: 800;
  color: #F8FAFC;
}

.drawer-sub {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: #94A3B8;
}

.close-btn {
  width: 30px;
  height: 30px;
  border-radius: 15px;
  background-color: rgba(51, 65, 85, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.close-icon {
  font-size: 14px;
  color: #CBD5E1;
}

.tab-bar {
  display: flex;
  flex-direction: row;
  gap: 8px;
  margin-bottom: 14px;
  padding: 4px;
  border-radius: 12px;
  background-color: rgba(30, 41, 59, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.14);
}

.tab-item {
  flex: 1;
  padding: 8px 10px;
  border-radius: 9px;
  text-align: center;
  cursor: pointer;
}

.tab-item.is-active {
  background-color: rgba(59, 130, 246, 0.22);
  border: 1px solid rgba(96, 165, 250, 0.45);
}

.tab-text {
  font-size: 13px;
  font-weight: 700;
  color: #E2E8F0;
}

.drawer-scroll {
  max-height: 62vh;
}

.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.field-label {
  font-size: 13px;
  font-weight: 700;
  color: #CBD5E1;
}

.sub-label {
  font-size: 12px;
  font-weight: 600;
  color: #94A3B8;
}

.toggle-secret {
  font-size: 12px;
  color: #60A5FA;
  cursor: pointer;
}

.mode-switch {
  display: flex;
  flex-direction: row;
  gap: 10px;
}

.mode-btn {
  flex: 1;
  padding: 10px 12px;
  border-radius: 12px;
  background-color: rgba(30, 41, 59, 0.68);
  border: 1px solid rgba(148, 163, 184, 0.18);
  cursor: pointer;
}

.mode-btn.is-active {
  background-color: rgba(37, 99, 235, 0.2);
  border-color: #60A5FA;
}

.mode-title {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: #F8FAFC;
}

.mode-desc {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: #94A3B8;
}

.custom-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.provider-row {
  display: flex;
  flex-direction: row;
  gap: 8px;
}

.provider-pill {
  flex: 1;
  padding: 8px 10px;
  border-radius: 10px;
  text-align: center;
  background-color: rgba(30, 41, 59, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.2);
  cursor: pointer;
}

.provider-pill.is-active {
  background-color: rgba(16, 185, 129, 0.18);
  border-color: #34D399;
}

.provider-label {
  font-size: 12px;
  font-weight: 700;
  color: #F1F5F9;
}

.text-input,
.text-area {
  width: 100%;
  box-sizing: border-box;
  border-radius: 10px;
  background-color: rgba(2, 6, 23, 0.65);
  border: 1px solid rgba(148, 163, 184, 0.22);
  color: #F8FAFC;
  font-size: 13px;
  padding: 9px 12px;
}

.text-input {
  height: 38px;
}

.text-area {
  min-height: 76px;
  line-height: 1.45;
}

.input-placeholder {
  color: #64748B;
}

.field-hint {
  font-size: 11px;
  color: #64748B;
}

.server-tip-box {
  padding: 12px;
  border-radius: 12px;
  background-color: rgba(30, 41, 59, 0.62);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.server-tip-text {
  font-size: 12px;
  line-height: 1.55;
  color: #94A3B8;
}

.test-banner {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid transparent;
}

.test-banner.is-ok {
  background-color: rgba(16, 185, 129, 0.14);
  border-color: rgba(52, 211, 153, 0.4);
}

.test-banner.is-fail {
  background-color: rgba(239, 68, 68, 0.14);
  border-color: rgba(248, 113, 113, 0.4);
}

.test-status {
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: #F8FAFC;
}

.test-msg {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: #CBD5E1;
  word-break: break-all;
}

.action-row {
  display: flex;
  flex-direction: row;
  gap: 10px;
  margin-top: 4px;
}

.btn-secondary,
.btn-primary {
  flex: 1;
  height: 40px;
  line-height: 40px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 700;
  border: none;
  cursor: pointer;
}

.btn-secondary {
  background-color: rgba(51, 65, 85, 0.85);
  color: #E2E8F0;
}

.btn-primary {
  background-color: #2563EB;
  color: #FFFFFF;
}

.btn-secondary::after,
.btn-primary::after {
  border: none;
}

.full-width {
  width: 100%;
  margin-top: 4px;
}

.saved-persona-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.saved-persona-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background-color: rgba(30, 41, 59, 0.68);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.saved-left {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.color-dot {
  width: 12px;
  height: 12px;
  border-radius: 6px;
  flex-shrink: 0;
}

.saved-meta {
  flex: 1;
  min-width: 0;
}

.saved-name {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: #F8FAFC;
}

.saved-desc {
  display: block;
  font-size: 11px;
  color: #94A3B8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.saved-actions {
  display: flex;
  flex-direction: row;
  gap: 10px;
  flex-shrink: 0;
}

.link-btn {
  font-size: 12px;
  color: #60A5FA;
  cursor: pointer;
}

.link-btn.danger {
  color: #F87171;
}

.workshop-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
  background-color: rgba(30, 41, 59, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.swatch-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
}

.swatch-item {
  width: 28px;
  height: 28px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid transparent;
  cursor: pointer;
}

.swatch-item.is-picked {
  border-color: #FFFFFF;
  transform: scale(1.08);
}

.swatch-check {
  font-size: 13px;
  font-weight: 800;
  color: #FFFFFF;
}
</style>
