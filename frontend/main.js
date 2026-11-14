import App from './App.vue'

// #ifndef VUE3
import Vue from 'vue'
Vue.config.productionTip = false
App.mpType = 'app'
const app = new Vue({
  ...App
})
app.$mount()
// #endif

// #ifdef VUE3
import { createSSRApp } from 'vue'

export function createApp() {
  const app = createSSRApp(App)

  app.config.errorHandler = (err, instance, info) => {
    console.error('[TrashTalk Chess][Vue ErrorHandler]', info, err)
    try {
      const message = err && err.message ? err.message : String(err || 'Unknown error')
      const stack = err && err.stack ? String(err.stack) : ''
      const content = stack ? `${message}\n${stack}`.slice(0, 600) : message
      if (typeof uni !== 'undefined' && typeof uni.showModal === 'function') {
        uni.showModal({
          title: 'JS Error',
          content,
          showCancel: false
        })
      }
    } catch (modalErr) {
      console.error('[TrashTalk Chess] Failed to show error modal:', modalErr)
    }
  }

  return {
    app
  }
}
// #endif
