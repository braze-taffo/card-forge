<script setup>
defineProps({ name: { type: String, required: true } })
const paths = {
  card: ['M6 3.5 18 3a2 2 0 0 1 2 2l-.5 14a2 2 0 0 1-2 2L6 20.5a2 2 0 0 1-2-2L4.5 5a2 2 0 0 1 1.5-1.5Z', 'M8.5 16.5c.5-4 7.5-4 8 0M9 18h6', 'M12 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'],
  book: ['M12 5v15', 'M12 5C8 2 3 3.5 3 3.5l.5 15s4.5-1 8.5 2c4-3 8.5-2 8.5-2l.5-15s-5-1.5-9 1.5Z', 'm6 7 3 .5m6-.5 3-.5m-12 5 3 .5m6-.5 3-.5'],
  settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'm9 3-1 3-3 1-2 3 2 2-1 3 3 2 2-1 3 1 2-2 3-1 2-3-1-2 1-3-3-2-2 1-3-1Z'],
  arrow: ['M5 12h14m-5-5 5 5-5 5'],
  back: ['M19 12H5m5-5-5 5 5 5'],
  upload: ['M12 16V3m-5 5 5-5 5 5', 'M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4'],
  download: ['M12 3v13m-5-5 5 5 5-5', 'M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4'],
  image: ['M4 3.5 20 3v18l-16-.5Z', 'm4 16 5-5 4 4 3-3 4 4', 'M8 8h.01'],
  plus: ['M12 4v16M4 12h16'],
  close: ['m6 6 12 12M18 6 6 18'],
  folder: ['M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z'],
  trash: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'],
  chat: ['M21 11a9 8 0 0 1-9 8H7l-4 3v-6a8 8 0 0 1-1-5 9 8 0 0 1 19 0Z', 'M8 11h.01M12 11h.01M16 11h.01'],
  code: ['m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18'],
  tavern: ['m3 11 9-8 9 8M5 10v11h14V10', 'M9 21v-7h6v7', 'm8 9 4-3 4 3'],
  layers: ['m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5'],
  chevron: ['m8 10 4 4 4-4'],
  send: ['m3 3 18 9-18 9 3-9-3-9ZM6 12h15'],
  check: ['m5 12 4 4L19 6'],
  shield: ['m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z', 'm8 12 3 3 5-6'],
}
</script>

<template>
  <svg class="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path v-for="(path, index) in paths[name] || paths.card" :key="index" :d="path" />
  </svg>
</template>
