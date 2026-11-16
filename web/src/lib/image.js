// 封面处理：解码 → 最长边 1024 的 PNG（与 Android decodeImageAsPng 对齐）。

export const MAX_COVER_INPUT_BYTES = 12_000_000
export const MAX_COVER_EDGE = 1024

export async function decodeImageAsPng(sourceBytes, maxEdge = MAX_COVER_EDGE) {
  const bitmap = await createImageBitmap(new Blob([sourceBytes]))
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建画布上下文')
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result)
        else reject(new Error('PNG 编码失败'))
      }, 'image/png')
    })
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    bitmap.close()
  }
}

/** Uint8Array → 可直接用于 <img> 的对象 URL。 */
export function pngObjectUrl(bytes) {
  return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
}
