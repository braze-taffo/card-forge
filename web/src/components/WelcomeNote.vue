<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { state } from '../store.js'
import { TELLEV_DOWNLOAD_URL, TELLEV_COMMUNITY_URL } from '../lib/tellev.js'
import AppIcon from './AppIcon.vue'

const dialog = ref(null)
const visitKey = 'cardforge.welcome.seen'
let seen = false
let previousOverflow = ''
try { seen = sessionStorage.getItem(visitKey) === '1' } catch { /* 私密浏览也可关闭欢迎笺。 */ }

function showWelcome() {
  if (seen || state.route !== 'home' || !dialog.value || dialog.value.open) return
  previousOverflow = document.body.style.overflow
  dialog.value.showModal()
  document.body.style.overflow = 'hidden'
}
function rememberVisit() {
  seen = true
  try { sessionStorage.setItem(visitKey, '1') } catch { /* 保留当前页面的关闭状态。 */ }
  document.body.style.overflow = previousOverflow
}
function dismiss() { dialog.value?.close() }
function onBackdrop(event) {
  if (event.target !== dialog.value) return
  const bounds = dialog.value.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss()
}
onMounted(showWelcome)
watch(() => state.route, showWelcome, { flush: 'post' })
onBeforeUnmount(() => { if (dialog.value?.open) document.body.style.overflow = previousOverflow })
</script>

<template>
  <dialog ref="dialog" class="welcome-note" aria-labelledby="welcome-title" aria-describedby="welcome-description" @close="rememberVisit" @click="onBackdrop">
    <button class="note-close link" aria-label="关闭网站介绍" @click="dismiss"><AppIcon name="close" /></button>
    <div class="note-heading">
      <img src="/brand/card-forge-icon.png" alt="" />
      <span class="eyebrow">写给初来这里的你</span>
    </div>
    <h2 id="welcome-title">欢迎来到锻卡炉。</h2>
    <p id="welcome-description" class="note-lead">一个念头，也可以成为故事的开场。</p>
    <div class="note-details">
      <p><AppIcon name="card" /><span>把灵感告诉 AI，一起写角色、补设定，<br class="desktop-only" />也可以慢慢搭起一个世界。</span></p>
      <p><AppIcon name="book" /><span>草稿自动留在当前浏览器，随时回来续写。<br class="desktop-only" />完成后，导出角色卡或世界书，把故事带走。</span></p>
    </div>
    <aside class="note-tellev">
      <span class="note-kicker">然后，让故事继续</span>
      <p>想听听角色会说什么？把角色卡带到 <strong>Tellev</strong>，在 Android 手机上与 TA 聊天，写下接下来的故事。</p>
      <div class="note-links">
        <a :href="TELLEV_DOWNLOAD_URL" target="_blank" rel="noopener noreferrer">看看 Tellev <AppIcon name="arrow" /><span class="download-caption">Android · 官方下载</span></a>
        <a :href="TELLEV_COMMUNITY_URL" target="_blank" rel="noopener noreferrer" aria-label="加入 Tellev 酒馆 QQ 交流群">来酒馆交流群聊聊 <AppIcon name="chat" /><span class="download-caption">QQ</span></a>
      </div>
    </aside>
    <div class="note-actions"><span>不急，灵感可以慢慢来。</span><button class="primary" autofocus @click="dismiss">开始创作<AppIcon name="arrow" /></button></div>
  </dialog>
</template>

<style scoped>
.welcome-note { box-sizing: border-box; width: min(540px, calc(100vw - 32px)); max-height: calc(100dvh - 40px); margin: auto; overflow: auto; padding: 34px 36px 28px; color: var(--text); background: #fcfcf7; border: 1px solid #d4dbcf; border-radius: 22px 27px 20px 25px; box-shadow: 0 24px 90px #27352a26; animation: note-arrive .24s ease-out; }
.welcome-note::backdrop { background: #33433736; backdrop-filter: blur(7px); animation: veil-arrive .2s ease-out; }
.note-close { position: absolute; right: 14px; top: 13px; padding: 8px; }
.note-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.note-heading img { width: 42px; height: 42px; object-fit: contain; transform: rotate(-4deg); }
.welcome-note h2 { font-size: 29px; line-height: 1.5; margin: 0 0 6px; letter-spacing: .5px; }
.note-lead { margin: 0; font-size: 15px; color: var(--text-dim); }
.note-details { display: grid; gap: 16px; margin: 26px 0; }
.note-details p { display: flex; align-items: flex-start; gap: 13px; font-size: 14px; line-height: 1.85; margin: 0; }
.note-details .app-icon { color: #85957b; width: 22px; height: 22px; margin-top: 3px; }
.note-tellev { padding: 18px 20px; background: #eaf0e680; border: 1px solid #dce4d5; border-radius: 12px 16px 13px 15px; }
.note-kicker { color: var(--accent); font-size: 13px; }
.note-tellev p { font-size: 13px; line-height: 1.9; color: var(--text-dim); margin: 8px 0 12px; }
.note-tellev strong { font-weight: 700; color: var(--text); }
.note-tellev a { color: var(--accent); text-decoration: none; display: flex; align-items: center; gap: 7px; width: fit-content; font-size: 13px; min-height: 36px; }
.note-tellev a:hover { text-decoration: underline; text-underline-offset: 4px; }
.note-links { display: flex; flex-wrap: wrap; gap: 0 16px; }
.note-tellev a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
.download-caption { color: var(--text-dim); font-size: 10px; margin-left: 8px; }
.note-actions { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 24px; }
.note-actions > span { font-size: 11px; color: #86917f; }
.note-actions button { border-radius: 9px 12px 10px 11px; padding: 10px 16px; }
@keyframes note-arrive { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes veil-arrive { from { opacity: 0; } to { opacity: 1; } }
@media (max-width: 640px) {
  .welcome-note { padding: 28px 24px 24px; }
  .welcome-note h2 { font-size: 26px; }
  .note-lead { font-size: 13px; }
  .note-details { margin: 22px 0; gap: 14px; }
  .note-details p { font-size: 13px; }
  .desktop-only { display: none; }
  .note-tellev { padding: 15px 16px; }
  .note-actions { margin-top: 20px; }
  .note-actions > span { max-width: 100px; }
  .download-caption { margin-left: 0; font-size: 9px; }
}
</style>
