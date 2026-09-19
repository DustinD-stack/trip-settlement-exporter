/** Browser download helpers. Everything happens locally; nothing is uploaded. */

export function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string): void {
  const view = new Uint8Array(bytes)
  const blob = new Blob([view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)], {
    type: mimeType,
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function downloadText(text: string, fileName: string, mimeType: string): void {
  downloadBytes(new TextEncoder().encode(text), fileName, mimeType)
}

export const PDF_MIME = 'application/pdf'
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const JSON_MIME = 'application/json'
