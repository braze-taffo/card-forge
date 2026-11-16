// IndexedDB 草稿仓库：会话、长文原文、封面（Blob）三个 store。
// 键约定与 Android 文件名一致：sessions 主键 id；sources/covers 键 `${id}.${sha256}`。
// 另存 meta（摘要）避免列表页解码全部长文草稿。

const DB_NAME = 'cardforge'
const DB_VERSION = 1

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('sources')) db.createObjectStore('sources')
      if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败'))
  })
}

async function tx(storeNames, mode, run) {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeNames, mode)
      const result = run(transaction)
      transaction.oncomplete = () => resolve(result?.result ?? result)
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'))
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务中止'))
    })
  } finally {
    db.close()
  }
}

function storeRequest(store, method, ...args) {
  return new Promise((resolve, reject) => {
    const request = store[method](...args)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes instanceof Blob ? await bytes.arrayBuffer() : bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 会话摘要（列表页用，不携带正文）。 */
export function summarize(session) {
  return {
    id: session.id,
    kind: session.kind,
    cardName: session.card?.name ?? '',
    worldName: session.worldName ?? '',
    turnsCount: session.turns.length,
    loreCount: session.lore.length,
    sourceCursor: session.sourceCursor,
    sourceLength: session.sourceLength,
    updatedAt: session.updatedAt,
  }
}

export async function listSummaries() {
  return tx(['meta'], 'readonly', (t) => {
    const request = t.objectStore('meta').getAll()
    return { result: new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result.sort((a, b) => b.updatedAt - a.updatedAt))
      request.onerror = () => reject(request.error)
    }) }
  })
}

export async function loadSession(id) {
  const value = await tx(['sessions'], 'readonly', (t) => {
    const request = t.objectStore('sessions').get(id)
    return { result: new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }) }
  })
  if (!value) throw new Error(`草稿 ${id} 不存在或已损坏`)
  return value
}

export async function saveSession(session) {
  // Vue reactive 代理无法被 IndexedDB 结构化克隆（DataCloneError）；
  // 草稿本身是纯 JSON 数据，与 Android 版存文件语义一致，先做 JSON 归一化。
  const record = JSON.parse(JSON.stringify(session))
  record.updatedAt = Date.now()
  return tx(['sessions', 'meta'], 'readwrite', (t) => {
    t.objectStore('sessions').put(record)
    t.objectStore('meta').put(summarize(record))
    return { result: undefined }
  })
}

export async function saveSource(id, text) {
  const bytes = new TextEncoder().encode(text)
  const hash = await sha256Hex(bytes)
  await tx(['sources'], 'readwrite', (t) => {
    t.objectStore('sources').put(text, `${id}.${hash}`)
    return { result: undefined }
  })
  return { hash, length: text.length }
}

export async function readSource(id, sourceKey) {
  const value = await tx(['sources'], 'readonly', (t) => {
    const request = t.objectStore('sources').get(`${id}.${sourceKey}`)
    return { result: new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }) }
  })
  if (typeof value !== 'string') throw new Error('原文不存在，请重新导入。')
  return value
}

export async function saveCover(id, pngBytes) {
  if (!(pngBytes instanceof Uint8Array) || pngBytes.length < 8 ||
    pngBytes[0] !== 0x89 || pngBytes[1] !== 0x50 || pngBytes[2] !== 0x4e || pngBytes[3] !== 0x47) {
    throw new Error('封面不是有效的 PNG 数据')
  }
  if (pngBytes.length > 10_000_000) throw new Error('封面超过 10 MB')
  const hash = await sha256Hex(pngBytes)
  await tx(['covers'], 'readwrite', (t) => {
    t.objectStore('covers').put(pngBytes, `${id}.${hash}`)
    return { result: undefined }
  })
  return hash
}

export async function readCover(id, expectedSha256) {
  const value = await tx(['covers'], 'readonly', (t) => {
    const request = t.objectStore('covers').get(`${id}.${expectedSha256}`)
    return { result: new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }) }
  })
  if (!value) throw new Error('封面缺失')
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(await value.arrayBuffer?.() ?? value)
  const hash = await sha256Hex(bytes)
  if (hash !== expectedSha256) throw new Error('封面校验失败（SHA-256 不匹配）')
  return bytes
}

export async function pruneCovers(id, keepSha256) {
  const prefix = `${id}.`
  return tx(['covers'], 'readwrite', (t) => {
    const store = t.objectStore('covers')
    const request = store.getAllKeys()
    request.onsuccess = () => {
      for (const key of request.result) {
        if (typeof key === 'string' && key.startsWith(prefix) && key !== `${id}.${keepSha256}`) {
          store.delete(key)
        }
      }
    }
    return { result: undefined }
  })
}

export async function deleteSession(id) {
  return tx(['sessions', 'meta', 'sources', 'covers'], 'readwrite', (t) => {
    t.objectStore('sessions').delete(id)
    t.objectStore('meta').delete(id)
    const prune = (store) => {
      const request = store.getAllKeys()
      request.onsuccess = () => {
        for (const key of request.result) {
          if (typeof key === 'string' && key.startsWith(`${id}.`)) store.delete(key)
        }
      }
    }
    prune(t.objectStore('sources'))
    prune(t.objectStore('covers'))
    return { result: undefined }
  })
}
