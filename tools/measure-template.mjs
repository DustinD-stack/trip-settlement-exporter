/**
 * Measures the printed artwork in `public/settlement-template.pdf`: the y of
 * each horizontal rule inside a region, and the x at which it starts and ends.
 *
 * These measurements are what `src/config/pdfFieldMapping.ts` is built from.
 * Development aid only - the app never uses it, and it needs no PDF renderer:
 * it reads the template's page raster directly.
 *
 * Usage:
 *   npx vite-node tools/measure-template.mjs -- <page> <x0> <x1> <y0> <y1>
 * Coordinates are PDF points, y measured from the bottom of the page.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { PDFDocument, PDFName } from 'pdf-lib'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const [pageArg, x0Arg, x1Arg, y0Arg, y1Arg] = process.argv.slice(2)
const pageNumber = Number(pageArg ?? 1)
const x0 = Number(x0Arg ?? 0)
const x1 = Number(x1Arg ?? 611)
const y0 = Number(y0Arg ?? 0)
const y1 = Number(y1Arg ?? 841)

const doc = await PDFDocument.load(
  fs.readFileSync(path.join(root, 'public', 'settlement-template.pdf')),
)
const page = doc.getPages()[pageNumber - 1]
const xobjects = page.node.Resources().lookup(PDFName.of('XObject'))
const image = xobjects.lookup(xobjects.keys()[0])
const width = Number(String(image.dict.get(PDFName.of('Width'))))
const height = Number(String(image.dict.get(PDFName.of('Height'))))
const rgb = zlib.inflateSync(Buffer.from(image.contents))

const { width: pw, height: ph } = page.getSize()
const sx = width / pw
const sy = height / ph
const dark = (x, y) => rgb[(y * width + x) * 3] < 150

const px0 = Math.max(0, Math.round(x0 * sx))
const px1 = Math.min(width, Math.round(x1 * sx))
const py0 = Math.max(0, Math.round((ph - y1) * sy))
const py1 = Math.min(height, Math.round((ph - y0) * sy))

console.log(`page ${pageNumber}, x ${x0}-${x1}, y ${y0}-${y1}`)
console.log('rule_y   starts_x  ends_x  coverage')

let run = null
for (let py = py0; py < py1; py++) {
  let first = -1
  let last = -1
  let count = 0
  for (let px = px0; px < px1; px++) {
    if (!dark(px, py)) continue
    if (first < 0) first = px
    last = px
    count++
  }
  const coverage = count / (px1 - px0)
  // A rule is a row that is mostly dark across the span it covers.
  const isRule = last > first && count / (last - first + 1) > 0.9 && last - first > 20 * sx
  if (isRule) {
    if (!run) run = { top: py, bottom: py, first, last, coverage }
    else {
      run.bottom = py
      run.first = Math.min(run.first, first)
      run.last = Math.max(run.last, last)
      run.coverage = Math.max(run.coverage, coverage)
    }
  } else if (run) {
    report(run)
    run = null
  }
}
if (run) report(run)

function report(r) {
  const y = (height - (r.top + r.bottom) / 2) / sy
  console.log(
    `${y.toFixed(1).padStart(7)}  ${(r.first / sx).toFixed(1).padStart(8)}  ${(r.last / sx)
      .toFixed(1)
      .padStart(6)}  ${r.coverage.toFixed(2)}`,
  )
}
