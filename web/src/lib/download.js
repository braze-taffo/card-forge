// 浏览器下载工具。

function sanitizeFileName(name, fallback) {
  const cleaned = String(name ?? '').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80)
  return cleaned !== '' ? cleaned : fallback
}

export function downloadBytes(bytes, filename, mime) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime ?? 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function downloadJson(value, name, fallback = 'export') {
  const text = JSON.stringify(value, null, 2)
  downloadBytes(new TextEncoder().encode(text), `${sanitizeFileName(name, fallback)}.json`, 'application/json')
}

export function downloadPng(bytes, name) {
  downloadBytes(bytes, `${sanitizeFileName(name, 'character')}.png`, 'image/png')
}
