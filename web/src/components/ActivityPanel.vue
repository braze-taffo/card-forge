<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { state, cancelGeneration } from '../store.js'
import { S, fmt } from '../lib/strings.js'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  showHeader: { type: Boolean, default: true },
  showResponse: { type: Boolean, default: true },
})

const showRawStream = ref(false)
const showFullStream = ref(false)
const clockSeconds = ref(0)
let clockTimer = null
onBeforeUnmount(() => clearInterval(clockTimer))

watch(() => [state.busy, state.operationStartedAtMillis], ([busy]) => {
  clearInterval(clockTimer)
  clockTimer = null
  if (busy) {
    clockTimer = setInterval(() => {
      clockSeconds.value = Math.max(0, Math.floor((Date.now() - state.operationStartedAtMillis) / 1000))
    }, 1000)
  }
}, { immediate: true })

const lastRoundEvents = computed(() => state.toolEvents.slice(-60))

const streamLimit = 6000
const shortened = computed(() => !showFullStream.value && state.liveOutput.length > streamLimit)

const secondsOf = (ms) => Math.floor((ms ?? 0) / 1000)
</script>

<template>
  <div class="card activity">
    <div class="row head">
      <div class="row left">
        <span v-if="state.busy" class="spinner"></span>
        <strong>{{ state.operationLabel || S.progressTitle }}</strong>
      </div>
      <button v-if="state.busy" class="danger stop" @click="cancelGeneration()">{{ S.stop }}</button>
    </div>
    <div class="phase">{{ state.modelPhase }}</div>

    <template v-if="state.toolEvents.length > 0">
      <div class="muted tools-title">{{ fmt(S.toolEventsTitle, state.toolEvents.length) }}</div>
      <div class="tool-log">
        <template v-for="(event, i) in lastRoundEvents" :key="i">
          <div v-if="event.round !== lastRoundEvents[i - 1]?.round" class="muted round-line">{{ fmt(S.toolRound, event.round) }}</div>
          <div class="tool-line">
            <AppIcon :class="event.ok ? 'ok' : 'fail'" :name="event.ok ? 'check' : 'close'" />
            <span class="mono">#{{ event.index }} {{ event.name }}{{ event.detail ? ` — ${event.detail}` : '' }}</span>
          </div>
        </template>
      </div>
    </template>

    <div v-if="state.providerLabel" class="muted">{{ fmt(S.providerConnected, state.providerLabel) }}</div>
    <div v-if="state.busy && state.operationStartedAtMillis > 0" class="muted">{{ fmt(S.taskElapsed, clockSeconds) }}</div>
    <div v-if="state.deltaCount > 0" class="muted">
      {{ fmt(S.deltaStats, secondsOf(state.firstDeltaMillis), secondsOf(state.lastDeltaMillis),
        Math.max(0, Math.floor(((state.lastDeltaMillis ?? 0) - (state.firstDeltaMillis ?? 0)) / 1000)), state.deltaCount) }}
    </div>

    <template v-if="state.current && state.current.sourceLength > 0">
      <div class="progress-track">
        <div class="progress-fill" :style="{ width: `${Math.min(100, (state.current.sourceCursor / Math.max(1, state.current.sourceLength)) * 100)}%` }"></div>
      </div>
      <div class="muted">
        {{ fmt(S.sourceSavedPct, state.current.sourceCursor, state.current.sourceLength,
          Math.min(100, Math.floor((state.current.sourceCursor / Math.max(1, state.current.sourceLength)) * 100))) }}
      </div>
    </template>
    <div v-if="state.extractionProgress" class="muted">{{ state.extractionProgress }}</div>

    <details v-if="showResponse && state.liveReasoning" class="activity-reasoning">
      <summary>{{ S.reasoningTitle }} · {{ state.liveReasoning.length }} 字</summary>
      <div class="scroll-box pre">{{ state.liveReasoning }}</div>
    </details>
    <div v-if="showResponse && state.liveAssistantMessage">
      <div class="section-title">{{ S.agentReplying }}</div>
      <div class="scroll-box pre">{{ state.liveAssistantMessage }}</div>
    </div>


    <div v-if="state.liveOutput">
      <button class="link" @click="showRawStream = !showRawStream">
        {{ showRawStream ? S.collapseDraftStream : fmt(S.viewDraftStream, state.liveOutput.length) }}
      </button>
    </div>
    <div v-if="showRawStream && state.liveOutput">
      <button v-if="shortened || showFullStream" class="link" @click="showFullStream = !showFullStream">
        {{ showFullStream ? S.showLatestOnly : S.viewFullStream }}
      </button>
      <div class="scroll-box pre">{{ showFullStream ? state.liveOutput : state.liveOutput.slice(-streamLimit) }}</div>
      <div v-if="shortened" class="muted">{{ fmt(S.streamTruncated, streamLimit) }}</div>
    </div>
    <div v-else-if="state.busy && !state.pendingQuestion && !state.liveReasoning && !state.liveAssistantMessage" class="muted">
      {{ S.waitingProviderText }}
    </div>
  </div>
</template>

<style scoped>
.activity {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.head {
  justify-content: space-between;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
  display: inline-block;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.phase {
  color: var(--accent-text);
}

.tools-title {
  margin-top: 4px;
}

.tool-log {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 8px;
  background: var(--bg);
}

.round-line {
  margin-top: 4px;
}

.tool-line .ok { color: var(--ok); }
.tool-line .fail { color: var(--danger); }
.mono { font-family: Consolas, Menlo, monospace; font-size: 12px; }

.progress-track {
  height: 6px;
  background: var(--bg);
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--border);
}

.progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s;
}

.section-title {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 4px;
}
.activity-reasoning summary { cursor: pointer; color: var(--text-dim); font-size: 12px; padding: 8px 0; }
.activity-reasoning .scroll-box { margin-top: 6px; }

.scroll-box {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 8px;
  background: var(--bg);
}

.pre {
  white-space: pre-wrap;
  word-break: break-word;
}

.stop {
  padding: 4px 10px;
  font-size: 13px;
}
</style>
