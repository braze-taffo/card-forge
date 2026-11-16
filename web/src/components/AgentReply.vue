<script setup>
defineProps({ turn: { type: Object, required: true }, streaming: { type: Boolean, default: false } })
</script>

<template>
  <details v-if="turn.reasoning" class="reply-reasoning">
    <summary>思考过程<span>{{ turn.reasoning.length }} 字</span></summary>
    <div class="reasoning-text">{{ turn.reasoning }}</div>
  </details>
  <div v-if="turn.text" class="reply-text">{{ turn.text }}</div>
  <div v-if="turn.incomplete && !streaming" class="reply-incomplete">已保留的回复片段</div>
</template>

<style scoped>
.reply-text, .reasoning-text { white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.reply-reasoning { margin: 5px 0 10px; color: var(--text-dim); font-size: 12px; }
.reply-reasoning summary { cursor: pointer; padding: 4px 0; }
.reply-reasoning summary span { margin-left: 10px; font-size: 10px; opacity: .8; }
.reasoning-text { max-height: 220px; overflow: auto; margin-top: 8px; padding: 10px 12px; border-left: 2px solid var(--border); line-height: 1.8; }
.reply-incomplete { color: var(--text-dim); font-size: 10px; margin-top: 8px; }
</style>
