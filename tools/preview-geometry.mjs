/**
 * Draws every mapped field box onto the scanned artwork and writes a PNG, so
 * the geometry in `src/config/pdfFieldMapping.ts` can be checked against the
 * printed rules and table cells by eye.
 *
 * Boxes that carry a value for the given trip are drawn solid; empty ones are
 * drawn faint. A short tick marks the text baseline.
 *
 * Development aid only - the app never uses it. It deliberately avoids a PDF
 * renderer: it reads the template's page raster directly, so it has no native
 * dependencies.
 *
 * Usage: node tools/preview-geometry.mjs <page 1|2> <output.png> [--all]
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

/** Decodes an ASCII85 stream body (the '~>' terminated form used by PDF). */
function decodeAscii85(bytes) {
  const out = []
  let tuple = 0
  let count = 0
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i]
    if (c === 0x7e) break
    if (c <= 0x20) continue
    if (c === 0x7a && count === 0) {
      out.push(0, 0, 0, 0)
      continue
    }
    tuple = tuple * 85 + (c - 0x21)
    if (++count === 5) {
      out.push((tuple >>> 24) & 0xff, (tuple >>> 16) & 0xff, (tuple >>> 8) & 0xff, tuple & 0xff)
      tuple = 0
      count = 0
    }
  }
  if (count > 0) {
    for (let i = count; i < 5; i++) tuple = tuple * 85 + 84
    const full = [(tuple >>> 24) & 0xff, (tuple >>> 16) & 0xff, (tuple >>> 8) & 0xff, tuple & 0xff]
    out.push(...full.slice(0, count - 1))
  }
  return Uint8Array.from(out)
}

/** Inflates a page's content stream, whatever filter chain it uses. */
function readPageContent(target) {
  const raw = Buffer.from(target.node.Contents().contents)
  const attempts = [
    () => zlib.inflateSync(Buffer.from(decodeAscii85(raw))),
    () => zlib.inflateSync(raw),
    () => raw,
  ]
  for (const attempt of attempts) {
    try {
      return attempt().toString('latin1')
    } catch {
      /* try the next decoding */
    }
  }
  throw new Error('Could not decode the page content stream.')
}

const pageNumber = Number(process.argv[2] ?? 1)
const output = process.argv[3] ?? path.join(root, 'verification', `geometry-page${pageNumber}.png`)
const showEmpty = process.argv.includes('--all')

/* ---- load the page raster straight out of the template ---- */

const doc = await PDFDocument.load(
  fs.readFileSync(path.join(root, 'public', 'settlement-template.pdf')),
)
const page = doc.getPages()[pageNumber - 1]
const xobjects = page.node.Resources().lookup(PDFName.of('XObject'))
const image = xobjects.lookup(xobjects.keys()[0])
const width = Number(String(image.dict.get(PDFName.of('Width'))))
const height = Number(String(image.dict.get(PDFName.of('Height'))))
const rgb = zlib.inflateSync(Buffer.from(image.contents))
if (rgb.length !== width * height * 3) throw new Error('Unexpected raster size.')

const { width: pageWidth, height: pageHeight } = page.getSize()
const scaleX = width / pageWidth
const scaleY = height / pageHeight

/* ---- which fields carry a value ---- */

const { PDF_FIELDS } = await import('../src/config/pdfFieldMapping.ts').catch(async () => {
  // Plain node cannot import TypeScript; fall back to the compiled preview data.
  throw new Error('Run this through vite-node: npx vite-node tools/preview-geometry.mjs -- <page> <out>')
})
const { createTrip39586Fixture } = await import('../src/lib/fixtures.ts')
const { buildFieldValues } = await import('../src/lib/pdfValues.ts')

const { fitText } = await import('../src/lib/pdfExport.ts')
const values = buildFieldValues(createTrip39586Fixture())
const helvetica = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)

/* ---- draw ---- */

const put = (x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= width || y >= height) return
  const i = (y * width + x) * 3
  rgb[i] = r
  rgb[i + 1] = g
  rgb[i + 2] = b
}

function hLineAt(x0, x1, y, c) {
  for (let x = Math.round(x0); x <= Math.round(x1); x++) put(x, Math.round(y), ...c)
}
function vLineAt(x, y0, y1, c) {
  for (let y = Math.round(y0); y <= Math.round(y1); y++) put(Math.round(x), y, ...c)
}
const hLine = hLineAt
const vLine = vLineAt

/* ---- replay the page's own vector artwork onto the raster ----
 *
 * The template draws the form's rules, boxes and table grids as vector
 * operators on top of the scan, so the raster alone is not what the page looks
 * like. Replaying the handful of operators the page actually uses (`re S`,
 * `re f*`, `m`/`l`/`S`) reproduces the visible artwork without needing a full
 * PDF renderer.
 */
const content = readPageContent(page)
const ARTWORK = [40, 40, 40]

for (const match of content.matchAll(/n ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re (S|f\*)/g)) {
  const [x, y, w, h] = match.slice(1, 5).map(Number)
  if (match[5] === 'f*') continue // white masks are already burned into the raster
  const left = x * scaleX
  const right = (x + w) * scaleX
  const top = (pageHeight - (y + h)) * scaleY
  const bottom = (pageHeight - y) * scaleY
  hLineAt(left, right, top, ARTWORK)
  hLineAt(left, right, bottom, ARTWORK)
  vLineAt(left, top, bottom, ARTWORK)
  vLineAt(right, top, bottom, ARTWORK)
}

for (const match of content.matchAll(/n ([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S/g)) {
  const [x0, y0, x1, y1] = match.slice(1, 5).map(Number)
  if (Math.abs(y0 - y1) < 0.01) {
    hLineAt(x0 * scaleX, x1 * scaleX, (pageHeight - y0) * scaleY, ARTWORK)
  } else if (Math.abs(x0 - x1) < 0.01) {
    vLineAt(x0 * scaleX, (pageHeight - y1) * scaleY, (pageHeight - y0) * scaleY, ARTWORK)
  }
}

const FILLED = [220, 30, 30] // red: field has a value
const EMPTY = [150, 190, 255] // pale blue: field is empty
const BASELINE = [0, 150, 50] // green: the text baseline
const INK = [200, 40, 160] // magenta hatching: the exact area the value's ink covers

let drawn = 0
for (const spec of PDF_FIELDS) {
  if (spec.page !== pageNumber - 1) continue
  const hasValue = Boolean((values[spec.name] ?? '').trim())
  if (!hasValue && !showEmpty) continue

  const colour = hasValue ? FILLED : EMPTY
  const left = spec.x * scaleX
  const right = (spec.x + spec.width) * scaleX
  // PDF y counts from the bottom; the raster counts from the top.
  const top = (pageHeight - (spec.y + spec.height)) * scaleY
  const bottom = (pageHeight - spec.y) * scaleY

  hLine(left, right, top, colour)
  hLine(left, right, bottom, colour)
  vLine(left, top, bottom, colour)
  vLine(right, top, bottom, colour)

  if (hasValue) {
    // Shade the exact area the value's ink will occupy, using the same
    // Helvetica metrics and auto-shrink the exporter applies. Anything that
    // would be clipped or collide shows up here.
    const value = values[spec.name].trim()
    const fitted = fitText(value, spec, (t, size) => helvetica.widthOfTextAtSize(t, size))
    const inkWidth = helvetica.widthOfTextAtSize(fitted.text, fitted.size)
    const padding = 2
    let inkX = spec.x + padding
    if (spec.align === 'right') inkX = spec.x + spec.width - padding - inkWidth
    else if (spec.align === 'center') inkX = spec.x + (spec.width - inkWidth) / 2
    const baseline = spec.y + (spec.height - fitted.size * 0.72) / 2

    const inkTop = (pageHeight - (baseline + fitted.size * 0.72)) * scaleY
    const inkBottom = (pageHeight - baseline) * scaleY
    for (let y = Math.round(inkTop); y <= Math.round(inkBottom); y += 2) {
      hLineAt(inkX * scaleX, (inkX + inkWidth) * scaleX, y, INK)
    }
    hLineAt(inkX * scaleX, (inkX + inkWidth) * scaleX, inkBottom, BASELINE)
  }
  drawn++
}

/* ---- write a PNG without any native dependency ---- */

function png(w, h, rgbBytes) {
  const raw = Buffer.alloc(h * (w * 3 + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0 // filter type 0
    rgbBytes.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3)
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

let crcTable = null
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let c = -1
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return c ^ -1
}

/* ---- optional crop, given in PDF points as --crop x,y,w,h (y from bottom) ---- */

let outWidth = width
let outHeight = height
let outRgb = rgb

const cropArg = process.argv.find((a) => a.startsWith('--crop='))
if (cropArg) {
  const [cx, cy, cw, ch] = cropArg.slice('--crop='.length).split(',').map(Number)
  const px = Math.max(0, Math.round(cx * scaleX))
  const py = Math.max(0, Math.round((pageHeight - (cy + ch)) * scaleY))
  outWidth = Math.min(Math.round(cw * scaleX), width - px)
  outHeight = Math.min(Math.round(ch * scaleY), height - py)
  outRgb = Buffer.alloc(outWidth * outHeight * 3)
  for (let y = 0; y < outHeight; y++) {
    rgb.copy(
      outRgb,
      y * outWidth * 3,
      ((py + y) * width + px) * 3,
      ((py + y) * width + px + outWidth) * 3,
    )
  }
}

fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, png(outWidth, outHeight, outRgb))
console.log(`wrote ${output} (${outWidth} x ${outHeight}, ${drawn} field boxes)`)
