<script setup>
import { watch } from 'vue'
import { state, navigate } from './store.js'
import HomeView from './views/HomeView.vue'
import EditorView from './views/EditorView.vue'
import SettingsView from './views/SettingsView.vue'
import AdminView from './views/AdminView.vue'
import { S } from './lib/strings.js'
import AppIcon from './components/AppIcon.vue'
import WelcomeNote from './components/WelcomeNote.vue'
watch(() => state.route, () => window.scrollTo({ top: 0, left: 0 }))
</script>

<template>
  <header class="app-header">
    <button class="brand" :disabled="state.busy" aria-label="锻卡炉首页" @click="navigate('home')">
      <img class="brand-mark" src="/brand/card-forge-icon.png" alt="" />
      <span class="brand-copy"><strong>{{ S.homeTitle }}</strong><small>CARD FORGE</small></span>
    </button>
    <div class="spacer"></div>
    <nav class="header-nav" aria-label="主导航">
      <button class="link header-home" :class="{ active: state.route === 'home' }" :disabled="state.busy" @click="navigate('home')">创作空间</button>
      <button class="link" :class="{ active: state.route === 'settings' }" @click="navigate('settings')"><AppIcon name="settings" />{{ S.settings }}</button>
    </nav>
  </header>
  <main class="app-main" :class="{ 'editor-main': state.route === 'editor' }">
    <HomeView v-if="state.route === 'home'" />
    <EditorView v-else-if="state.route === 'editor'" />
    <SettingsView v-else-if="state.route === 'settings'" />
    <AdminView v-else />
  </main>
  <WelcomeNote />
</template>
