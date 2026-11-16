// PNG tEXt 读写：V2 (chara) / V3 (ccv3) 角色卡元数据嵌入与提取。
// 与 Android PngCardParser 行为一致：保留除旧 chara/ccv3 外的全部 chunk。

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function crc32(bytes) {
  let c
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c >>> 0
    }
    return t
  })())
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function bytesToBinaryString(bytes) {
  let out = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return out
}

function binaryStringToBytes(text) {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}

function validateSignature(bytes) {
  if (bytes.length < 8) throw new Error('数据太短，不是 PNG 文件')
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error(`PNG 签名校验失败（第 ${i} 字节）`)
  }
}

function parseChunks(bytes) {
  const chunks = []
  let offset = 8
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error(`PNG 数据在 ${offset} 处意外结束`)
    const length = view.getUint32(offset)
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
    offset += 8
    if (offset + length + 4 > bytes.length) throw new Error(`PNG chunk 超出文件边界（${offset}）`)
    const data = bytes.subarray(offset, offset + length)
    offset += length + 4 // 跳过 CRC
    chunks.push({ type, data })
    if (type === 'IEND') break
  }
  return chunks
}

function writeChunk(sink, type, data) {
  const header = new Uint8Array(8)
  new DataView(header.buffer).setUint32(0, data.length)
  for (let i = 0; i < 4; i++) header[4 + i] = type.charCodeAt(i)
  const crcInput = new Uint8Array(4 + data.length)
  crcInput.set(header.subarray(4), 0)
  crcInput.set(data, 4)
  const crc = new Uint8Array(4)
  new DataView(crc.buffer).setUint32(0, crc32(crcInput))
  sink.push(header, data, crc)
}

function writeTextChunk(sink, keyword, text) {
  const keywordBytes = binaryStringToBytes(keyword)
  const textBytes = binaryStringToBytes(text)
  const data = new Uint8Array(keywordBytes.length + 1 + textBytes.length)
  data.set(keywordBytes, 0)
  data[keywordBytes.length] = 0
  data.set(textBytes, keywordBytes.length + 1)
  writeChunk(sink, 'tEXt', data)
}

async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前环境不支持 inflate（缺少 DecompressionStream）')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** 解析三种文本 chunk；zTXt 需要 inflate，故为异步。 */
async function decodeTextChunk(chunk) {
  const data = chunk.data
  if (chunk.type === 'tEXt') {
    const nullIndex = data.indexOf(0)
    if (nullIndex < 0) return null
    return {
      keyword: bytesToBinaryString(data.subarray(0, nullIndex)),
      text: bytesToBinaryString(data.subarray(nullIndex + 1)),
    }
  }
  if (chunk.type === 'iTXt') {
    const nullIndex = data.indexOf(0)
    if (nullIndex < 0) return null
    const keyword = bytesToBinaryString(data.subarray(0, nullIndex))
    let i = nullIndex + 1
    if (i >= data.length) return null
    const compressionFlag = data[i]
    i += 1 // compression method
    i = data.indexOf(0, i) // language tag
    if (i < 0) return null
    i = data.indexOf(0, i + 1) // translated keyword
    if (i < 0) return null
    const textBytes = data.subarray(i + 1)
    const text = compressionFlag === 1 ? bytesToBinaryString(await inflate(textBytes))
      : new TextDecoder('utf-8').decode(textBytes)
    return { keyword, text }
  }
  if (chunk.type === 'zTXt') {
    const nullIndex = data.indexOf(0)
    if (nullIndex < 0) return null
    const keyword = bytesToBinaryString(data.subarray(0, nullIndex))
    if (nullIndex + 2 > data.length) return null
    const textBytes = await inflate(data.subarray(nullIndex + 2))
    return { keyword, text: new TextDecoder('utf-8').decode(textBytes) }
  }
  return null
}

function decodeBase64ToJson(encoded) {
  const binary = atob(encoded.replace(/\s+/g, ''))
  const bytes = binaryStringToBytes(binary)
  const text = new TextDecoder('utf-8').decode(bytes)
  return JSON.parse(text)
}

/** 从 PNG 提取角色卡 JSON；ccv3 优先于 chara。 */
export async function extractCardJson(bytes) {
  validateSignature(bytes)
  let charaValue = null
  let ccv3Value = null
  for (const chunk of parseChunks(bytes)) {
    if (chunk.type !== 'tEXt' && chunk.type !== 'iTXt' && chunk.type !== 'zTXt') continue
    const decoded = await decodeTextChunk(chunk)
    if (!decoded) continue
    const keyword = decoded.keyword.toLowerCase()
    if (keyword === 'chara') charaValue = decoded.text
    else if (keyword === 'ccv3') ccv3Value = decoded.text
  }
  const encoded = ccv3Value ?? charaValue
  if (!encoded) return null
  return decodeBase64ToJson(encoded)
}

/** 把角色卡 JSON 以 chara + ccv3 双关键字嵌入 PNG（base64，tEXt）。 */
export function embedCardJson(pngBytes, cardJson) {
  validateSignature(pngBytes)
  const jsonText = typeof cardJson === 'string' ? cardJson : JSON.stringify(cardJson)
  const encoded = btoa(bytesToBinaryString(new TextEncoder().encode(jsonText)))
  const chunks = parseChunks(pngBytes)
  const sink = []
  const signature = new Uint8Array(PNG_SIGNATURE)
  sink.push(signature)
  for (const chunk of chunks) {
    if (chunk.type === 'tEXt') {
      const nullIndex = chunk.data.indexOf(0)
      if (nullIndex >= 0) {
        const keyword = bytesToBinaryString(chunk.data.subarray(0, nullIndex))
        if (keyword === 'chara' || keyword === 'ccv3') continue
      }
    }
    if (chunk.type !== 'IEND') writeChunk(sink, chunk.type, chunk.data)
  }
  writeTextChunk(sink, 'chara', encoded)
  writeTextChunk(sink, 'ccv3', encoded)
  writeChunk(sink, 'IEND', new Uint8Array(0))
  const total = sink.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of sink) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
