/**
 * 前端环境与网络请求配置
 * 严格遵循 API_SPEC.md 第 1.1 节与第 7 节超时契约：
 * - App 端开发默认请求 http://10.0.2.2:8000/api/v1（适配雷电/Android 模拟器访问宿主机）
 * - 小程序 / H5 开发默认请求 http://127.0.0.1:8000/api/v1
 * - uni.request 超时时间 8000ms（大于后端上游 LLM 6000ms 超时）
 */

const isProd = false // 上线发布时切换为 true 并替换为 HTTPS 正式域名

let devBaseUrl = 'http://127.0.0.1:8000/api/v1'
// #ifdef APP-PLUS
devBaseUrl = 'http://10.0.2.2:8000/api/v1'
// #endif

export const ENV_CONFIG = {
  env: isProd ? 'production' : 'development',
  baseUrl: isProd
    ? 'https://api.trashtalk-chess.example.com/api/v1'
    : devBaseUrl,
  requestTimeoutMs: 8000,
  healthCheckTimeoutMs: 2500,
  engineTimeBudgetMs: 420,
  clientVersion: '1.0.0'
}

export default ENV_CONFIG
