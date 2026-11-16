import { createApp } from 'vue'
import App from './App.vue'
import 'lxgw-wenkai-webfont/lxgwwenkai-regular.css'
import 'lxgw-wenkai-webfont/lxgwwenkai-bold.css'
import './style.css'
import { state, loadServerConfig, refresh } from './store.js'

loadServerConfig()
refresh()

createApp(App).mount('#app')

// 开发期暴露状态便于调试；生产无害。
if (import.meta.env.DEV) {
  window.__cardforge = state
}
