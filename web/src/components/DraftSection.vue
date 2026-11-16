<script setup>
import { ref } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  title: { type: String, required: true },
  initiallyExpanded: { type: Boolean, default: false },
})
const expanded = ref(props.initiallyExpanded)
function toggle() {
  expanded.value = !expanded.value
}
function open() {
  expanded.value = true
}
defineExpose({ open })
</script>

<template>
  <div class="section card">
    <button class="section-head" :aria-expanded="expanded" @click="toggle">
      <span class="title">{{ title }}</span>
      <AppIcon class="chevron" :class="{ collapsed: !expanded }" name="chevron" />
    </button>
    <div v-if="expanded" class="section-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.section {
  padding: 0;
  overflow: hidden;
}

.section-head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: none;
  border: none;
  padding: 12px 14px;
  text-align: left;
  font-weight: 600;
  border-radius: var(--radius);
}

.section-head:hover:not(:disabled) {
  background: var(--bg-overlay);
  border: none;
}

.chevron {
  color: var(--text-dim);
}

.section-body {
  padding: 0 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
