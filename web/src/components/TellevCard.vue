<script setup>
import AppIcon from './AppIcon.vue'
import { TELLEV_DOWNLOAD_URL, TELLEV_COMMUNITY_URL } from '../lib/tellev.js'
</script>

<template>
  <aside class="tellev-card" aria-label="认识 Tellev">
    <div class="tellev-heading"><span class="tellev-drawing"><AppIcon name="chat" /></span><span class="tellev-name">Tellev<small>故事的下一站</small></span></div>
    <p>在这里写下角色，<br />在手机里，和 TA 聊聊。</p>
    <div class="tellev-links">
      <a :href="TELLEV_DOWNLOAD_URL" target="_blank" rel="noopener noreferrer">认识 Tellev<AppIcon name="arrow" /><span>Android</span></a>
      <a :href="TELLEV_COMMUNITY_URL" target="_blank" rel="noopener noreferrer" aria-label="加入 Tellev 酒馆 QQ 交流群">酒馆交流群<AppIcon name="chat" /><span>QQ</span></a>
    </div>
  </aside>
</template>

<style scoped>
.tellev-card { width: 276px; padding: 20px 23px 15px; background: #f7f9f1b3; border: 1px solid #dce2d2; border-radius: 14px 19px 13px 17px; position: relative; }
.tellev-card::before { content: ''; position: absolute; width: 42px; height: 10px; top: -6px; right: 30px; background: #dfcbb27a; transform: rotate(4deg); border-radius: 1px; }
.tellev-heading { display: flex; align-items: center; gap: 11px; }
.tellev-drawing { color: #73886c; display: flex; transform: rotate(-6deg); }
.tellev-drawing .app-icon { width: 31px; height: 31px; stroke-width: 1.25; }
.tellev-name { font-size: 20px; line-height: 1.3; letter-spacing: .6px; }
.tellev-name small { display: block; font-size: 10px; color: #87907e; margin-top: 4px; letter-spacing: 1px; }
.tellev-card p { font-size: 13px; color: var(--text-dim); line-height: 1.8; margin: 12px 0 8px; }
.tellev-card a { display: flex; align-items: center; gap: 7px; width: 100%; color: var(--accent); text-decoration: none; font-size: 12px; min-height: 38px; border-top: 1px solid #dce2d2; padding-top: 7px; }
.tellev-card a:hover { text-decoration: underline; text-underline-offset: 4px; }
.tellev-card a > span { margin-left: auto; font-size: 10px; color: #87907e; }
.tellev-card a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
@media (max-width: 640px) {
  .tellev-card { width: 100%; padding: 17px 18px; display: grid; grid-template-columns: 1fr auto; column-gap: 12px; }
  .tellev-heading { gap: 10px; grid-column: 1; }
  .tellev-name { font-size: 18px; }
  .tellev-name small { display: inline; font-size: 10px; margin-left: 12px; letter-spacing: 0; }
  .tellev-drawing .app-icon { width: 25px; height: 25px; }
  .tellev-card p { grid-column: 1; margin: 7px 0 0; font-size: 12px; }
  .tellev-links { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 0 16px; border-top: 1px solid #dce2d2; margin-top: 12px; }
  .tellev-card a { flex: 1 1 130px; width: auto; min-height: 44px; border-top: 0; padding-top: 5px; }
  .tellev-card a .app-icon { width: 16px; height: 16px; }
  .tellev-card a > span { font-size: 9px; }
}
</style>
