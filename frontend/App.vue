<script>
export default {
  onLaunch() {
    console.log('[TrashTalk Chess] App Launch')
    // #ifdef APP-PLUS
    try {
      if (typeof plus !== 'undefined') {
        if (plus.screen && typeof plus.screen.lockOrientation === 'function') {
          plus.screen.lockOrientation('portrait-primary')
        }
        if (plus.navigator && typeof plus.navigator.closeSplashscreen === 'function') {
          plus.navigator.closeSplashscreen()
        }
      }
    } catch (e) {
      console.warn('[TrashTalk Chess] APP-PLUS init warning:', e)
    }
    // #endif
  },
  onShow() {
    console.log('[TrashTalk Chess] App Show')
  },
  onHide() {
    console.log('[TrashTalk Chess] App Hide')
  },
  onError(err) {
    console.error('[TrashTalk Chess] Global Error:', err)
    try {
      const message = err && err.message ? err.message : String(err || 'Unknown app error')
      const stack = err && err.stack ? String(err.stack) : ''
      const content = stack ? `${message}\n${stack}`.slice(0, 600) : message
      if (typeof uni !== 'undefined' && typeof uni.showModal === 'function') {
        uni.showModal({
          title: 'JS Error',
          content,
          showCancel: false
        })
      }
    } catch (_modalErr) {
      // ignore modal error
    }
  }
}
</script>

<style>
/* 全局暗色竞技质感基础样式 */
page {
  background-color: #0F172A;
  color: #F8FAFC;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', Arial, sans-serif;
  box-sizing: border-box;
  -webkit-font-smoothing: antialiased;
}

view,
text,
button,
scroll-view {
  box-sizing: border-box;
}

button::after {
  border: none;
}
</style>
