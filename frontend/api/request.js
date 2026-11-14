/**
 * uni.request 统一网络封装
 * - 自动注入 X-Request-ID 与 X-Client-Version
 * - 强制执行 8000ms 硬超时（对齐 API_SPEC.md 第 7.1 节）
 * - 兼容无 uni 全局对象的单元测试环境（回退至 fetch）
 */

import ENV_CONFIG from '../config/env.js'

export function generateRequestId() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const rand = Math.random().toString(16).slice(2, 8)
  return `req_${y}${m}${d}_${rand}`
}

function buildQueryString(params) {
  if (!params || typeof params !== 'object') return ''
  const entries = Object.entries(params).filter(
    ([, val]) => val !== undefined && val !== null && val !== ''
  )
  if (entries.length === 0) return ''
  const qs = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
  return `?${qs}`
}

export class ApiRequestError extends Error {
  constructor({ message, statusCode = 0, code = 0, requestId = '', isTimeout = false, detail = null }) {
    super(message)
    this.name = 'ApiRequestError'
    this.statusCode = statusCode
    this.code = code
    this.requestId = requestId
    this.isTimeout = isTimeout
    this.detail = detail
  }
}

export function request({
  url,
  method = 'GET',
  data = undefined,
  params = undefined,
  timeout = ENV_CONFIG.requestTimeoutMs,
  headers = {}
}) {
  const requestId = generateRequestId()
  const fullUrl = `${ENV_CONFIG.baseUrl}${url}${buildQueryString(params)}`
  const mergedHeaders = {
    'Content-Type': 'application/json',
    'X-Request-ID': requestId,
    'X-Client-Version': ENV_CONFIG.clientVersion,
    ...headers
  }

  // 微信小程序 / uni-app 运行时
  if (typeof uni !== 'undefined' && typeof uni.request === 'function') {
    return new Promise((resolve, reject) => {
      uni.request({
        url: fullUrl,
        method,
        data,
        timeout,
        header: mergedHeaders,
        success: (res) => {
          const status = res.statusCode || 0
          if (status >= 200 && status < 300) {
            resolve(res.data)
            return
          }
          const errBody = res.data && typeof res.data === 'object' ? res.data : {}
          reject(
            new ApiRequestError({
              message: errBody.message || `HTTP ${status}`,
              statusCode: status,
              code: errBody.code || status * 100,
              requestId: errBody.request_id || requestId,
              detail: errBody.detail || null
            })
          )
        },
        fail: (err) => {
          const msg = (err && err.errMsg) || 'Network request failed'
          const isTimeout = /timeout/i.test(msg)
          reject(
            new ApiRequestError({
              message: msg,
              statusCode: 0,
              code: isTimeout ? 40800 : 0,
              requestId,
              isTimeout
            })
          )
        }
      })
    })
  }

  if (typeof fetch !== 'function') {
    return Promise.reject(
      new ApiRequestError({
        message: 'Network client unavailable',
        statusCode: 0,
        code: 0,
        requestId
      })
    )
  }

  // Node / 浏览器测试环境回退至 fetch + AbortController
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller
    ? setTimeout(() => controller.abort(), timeout)
    : null

  return fetch(fullUrl, {
    method,
    headers: mergedHeaders,
    body: data !== undefined && method !== 'GET' ? JSON.stringify(data) : undefined,
    signal: controller ? controller.signal : undefined
  })
    .then(async (res) => {
      if (timer) clearTimeout(timer)
      const json = await res.json().catch(() => ({}))
      if (res.ok) return json
      throw new ApiRequestError({
        message: json.message || `HTTP ${res.status}`,
        statusCode: res.status,
        code: json.code || res.status * 100,
        requestId: json.request_id || requestId,
        detail: json.detail || null
      })
    })
    .catch((err) => {
      if (timer) clearTimeout(timer)
      if (err instanceof ApiRequestError) throw err
      const isTimeout = err && err.name === 'AbortError'
      throw new ApiRequestError({
        message: (err && err.message) || 'Network error',
        statusCode: 0,
        code: isTimeout ? 40800 : 0,
        requestId,
        isTimeout
      })
    })
}
