<script setup>
import { ref, computed } from 'vue'
import { S } from '../lib/strings.js'
import { DETAIL_OPTIONS, briefToPrompt } from '../lib/brief.js'

const props = defineProps({
  kind: { type: String, required: true },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['start'])

const guided = ref(true)
const title = ref('')
const premise = ref('')
const relationship = ref('')
const userPersona = ref('')
const characters = ref('')
const multipleCharacters = ref(false)
const detail = ref('Normal')
const loreOneByOne = ref(false)

const characterLines = computed(() =>
  characters.value.split('\n').filter((line) => line.trim() !== '').length)

const canStart = computed(() =>
  !props.busy && (!multipleCharacters.value || characterLines.value >= 2))

function submit() {
  if (!canStart.value) return
  emit('start', briefToPrompt({
    kind: props.kind,
    guided: guided.value,
    title: title.value,
    premise: premise.value,
    relationship: relationship.value,
    userPersona: userPersona.value,
    characters: multipleCharacters.value ? characters.value : '',
    detail: detail.value,
    loreOneByOne: loreOneByOne.value,
  }))
}
</script>

<template>
  <div class="card brief">
    <h3>{{ S.briefTitle }}</h3>
    <p class="muted">{{ S.briefHint }}</p>
    <div class="mode-row">
      <button class="chip" :class="{ active: guided }" :aria-pressed="guided" :disabled="busy" @click="guided = true">{{ S.modeChat }}</button>
      <button class="chip" :class="{ active: !guided }" :aria-pressed="!guided" :disabled="busy" @click="guided = false">{{ S.modeDirectDraft }}</button>
    </div>
    <label class="field">
      <span>{{ kind === 'Character' ? S.fieldTitleCharacter : S.fieldTitleWorldbook }}</span>
      <input v-model="title" type="text" />
    </label>
    <label class="field">
      <span>{{ kind === 'Character' ? S.fieldPremiseCharacter : S.fieldPremiseWorldbook }}</span>
      <textarea v-model="premise" rows="3"></textarea>
    </label>
    <template v-if="kind === 'Character'">
      <label class="field">
        <span>{{ S.fieldRelationship }}</span>
        <input v-model="relationship" type="text" />
      </label>
      <label class="field">
        <span>{{ S.fieldPersona }}</span>
        <input v-model="userPersona" type="text" />
      </label>
      <label class="switch-row">
        <input v-model="multipleCharacters" type="checkbox" />
        <span>{{ S.multiCharacters }}</span>
      </label>
      <label v-if="multipleCharacters" class="field">
        <span>{{ S.fieldCharacters }}</span>
        <textarea v-model="characters" rows="4"></textarea>
      </label>
      <p v-if="multipleCharacters && characterLines < 2" class="muted hint-warn">{{ S.minCharactersHint }}</p>
      <div class="length-row">
        <span class="muted">{{ S.lengthTitle }}</span>
        <div class="chips">
          <button
            v-for="option in DETAIL_OPTIONS"
            :key="option.key"
            class="chip"
            :class="{ active: detail === option.key }"
            :aria-pressed="detail === option.key"
            :disabled="busy"
            @click="detail = option.key"
          >{{ option.label }}</button>
        </div>
      </div>
    </template>
    <label v-else class="switch-row">
      <input v-model="loreOneByOne" type="checkbox" />
      <span>{{ S.loreOneByOne }}</span>
    </label>
    <button class="primary block" :disabled="!canStart" @click="submit">
      {{ guided ? S.startGuided : (kind === 'WorldBook' && loreOneByOne ? S.startOneByOne : S.startFirstDraft) }}
    </button>
  </div>
</template>

<style scoped>
.brief {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.brief h3 {
  margin: 0;
}

.mode-row, .length-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.length-row {
  justify-content: space-between;
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.hint-warn {
  color: var(--accent-text);
}

.block {
  width: 100%;
  margin-top: 6px;
}

input[type='checkbox'] {
  width: 18px;
  height: 18px;
  accent-color: var(--accent);
}
</style>
