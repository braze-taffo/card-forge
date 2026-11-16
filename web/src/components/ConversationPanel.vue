<script setup>
import { ref, watch, nextTick } from 'vue'
import { state, send, retry, continueIncomplete, answerAgentQuestion, QUICK_ACTIONS } from '../store.js'
import { S, fmt } from '../lib/strings.js'
import BriefForm from './BriefForm.vue'
import ActivityPanel from './ActivityPanel.vue'
import AppIcon from './AppIcon.vue'
import AgentReply from './AgentReply.vue'
import QuestionCard from './QuestionCard.vue'

const input = ref('')
const listRoot = ref(null)
const showCompletedDetails = ref(false)

watch(() => [state.current?.id, state.current?.turns.length, state.busy, state.pendingQuestion != null], async () => {
  await nextTick()
  listRoot.value?.scrollTo({ top: listRoot.value.scrollHeight })
})

watch(() => state.operationStartedAtMillis, () => {
  showCompletedDetails.value = false
})

watch(() => state.current?.pendingReplies?.map((reply) => (reply.text?.length || 0) + (reply.reasoning?.length || 0)).join(','), async () => {
  const root = listRoot.value
  const following = root && root.scrollHeight - root.scrollTop - root.clientHeight < 100
  await nextTick()
  if (following) root.scrollTo({ top: root.scrollHeight })
})

function submit() {
  const text = input.value
  if (!text.trim() || (state.busy && !state.pendingQuestion)) return
  input.value = ''
  if (state.pendingQuestion) answerAgentQuestion(text)
  else send(text)
}

function onBriefStart(prompt) {
  send(prompt)
}

const session = () => state.current
</script>

<template>
  <div class="conversation">
    <div class="conversation-heading"><span class="conversation-heading-icon"><AppIcon name="chat" /></span><div><strong>和灵感聊一聊</strong><p class="muted">从一句设想开始，慢慢写成完整的故事。</p></div></div>
    <div ref="listRoot" class="turn-list">
      <p class="muted intro">{{ S.conversationIntro }}</p>

      <BriefForm v-if="session() && session().turns.length === 0" :kind="session().kind" :busy="state.busy" @start="onBriefStart" />

      <div
        v-for="(turn, index) in (session()?.turns ?? [])"
        :key="index"
        class="bubble-row"
        :class="turn.role === 'user' ? 'mine' : 'agent'"
      >
        <div class="bubble">
          <div class="role">{{ turn.role === 'user' ? S.roleYou : S.roleAgent }}</div>
          <AgentReply :turn="turn" />
        </div>
      </div>

      <div v-for="(turn, index) in (session()?.pendingReplies ?? [])" :key="'pending-' + index" v-show="turn.text || turn.reasoning" class="bubble-row" :class="turn.role === 'user' ? 'mine' : 'agent'">
        <div class="bubble"><div class="role">{{ turn.role === 'user' ? S.roleYou : S.roleAgent }}</div><AgentReply :turn="turn" :streaming="state.busy" /></div>
      </div>

      <div v-if="session() && !state.busy && (session().pendingRun || session().turns.at(-1)?.role === 'user')" class="resume-row">
        <button v-if="session().pendingRun || session().partialTurnSaved" @click="continueIncomplete()">{{ S.continueIncomplete }}</button>
        <button v-else @click="retry()">{{ S.retryLast }}</button>
      </div>

      <template v-if="state.busy || state.modelPhase">
        <ActivityPanel v-if="state.busy || showCompletedDetails" :showResponse="false" />
        <button v-else class="link" @click="showCompletedDetails = true">{{ fmt(S.viewProgress, state.modelPhase) }}</button>
      </template>
      <div v-else-if="session() && session().sourceLength > 0" class="muted">
        {{ fmt(S.sourceExtractedContinue, session().sourceCursor, session().sourceLength) }}
      </div>

      <QuestionCard v-if="state.pendingQuestion" :question="state.pendingQuestion" @answer="answerAgentQuestion" />
    </div>

    <div v-if="session() && session().turns.length > 0" class="quick-row">
      <button class="chip" :disabled="state.busy" @click="send(QUICK_ACTIONS.continueGuide)">{{ S.btnContinueGuide }}</button>
      <button class="chip" :disabled="state.busy" @click="send(QUICK_ACTIONS.aiDecide)">{{ S.btnAiDecide }}</button>
      <button class="chip" :disabled="state.busy" @click="send(session().kind === 'Character' ? QUICK_ACTIONS.generateCharacterDraft : QUICK_ACTIONS.generateWorldBookDraft)">{{ S.btnGenerateDraft }}</button>
      <button v-if="session().kind === 'WorldBook'" class="chip" :disabled="state.busy" @click="send(QUICK_ACTIONS.discussOneByOne)">{{ S.btnDiscussOneByOne }}</button>
      <button v-if="session().kind === 'Character'" class="chip" :disabled="state.busy" @click="send(QUICK_ACTIONS.statusBar)">{{ S.btnStatusBar }}</button>
    </div>

    <div class="input-row">
      <textarea
        v-model="input"
        rows="1"
        :placeholder="state.pendingQuestion ? '回答当前问题，也可以组合选项或提出自己的想法' : S.inputLabel"
        :aria-label="S.inputLabel"
        :disabled="state.busy && !state.pendingQuestion"
        @keydown.enter.exact.prevent="submit"
      ></textarea>
      <button class="primary send" :disabled="(state.busy && !state.pendingQuestion) || !input.trim()" :aria-label="S.send" title="发送（Enter）；Shift + Enter 换行" @click="submit"><AppIcon name="send" /></button>
    </div>
  </div>
</template>

<style scoped>
.conversation {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.turn-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.intro {
  margin: 0;
}

.bubble-row {
  display: flex;
}

.bubble-row.mine {
  justify-content: flex-end;
}

.bubble {
  max-width: 85%;
  border-radius: 12px;
  padding: 8px 12px;
  background: var(--bg-overlay);
}

.bubble-row.mine .bubble {
  background: var(--accent-soft);
}

.bubble .role {
  font-size: 11px;
  color: var(--text-dim);
}

.bubble .text {
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}

.resume-row {
  display: flex;
  justify-content: center;
}

.question {
  border-color: var(--accent);
}

.asking {
  color: var(--accent-text);
  font-size: 13px;
  font-weight: 600;
}

.question-text {
  margin: 6px 0;
}

.option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  margin-bottom: 6px;
  text-align: left;
}

.option .desc {
  font-size: 12px;
}

.quick-row {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 6px 12px 0;
  scrollbar-width: thin;
}

.input-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 8px 12px 12px;
}

.input-row textarea {
  flex: 1;
  max-height: 140px;
  min-height: 40px;
}

.send {
  width: 44px;
  height: 40px;
  padding: 0;
  border-radius: 12px;
}
</style>
