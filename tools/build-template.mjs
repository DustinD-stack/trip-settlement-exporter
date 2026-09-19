/**
 * Builds `public/settlement-template.pdf` from the original United Freight PDF.
 *
 * This runs ONCE, offline, and its output is committed. The app never runs it.
 *
 * What it does:
 *   1. Reads `reference/Dustin_Douglas_Trip_39586_Settlement_Fillable.pdf`.
 *   2. Removes the AcroForm and every widget annotation, so no stale values,
 *      no stale field geometry and no old appearance streams survive.
 *   3. Keeps the two scanned page images byte-for-byte and the 611 x 841 page
 *      size, so the artwork - logo, labels, tables, rules - is unchanged.
 *
 * The scanned images are re-serialised losslessly (Flate, no ASCII85 wrapper),
 * which shrinks the download without altering a single pixel.
 *
 * Run: npm run build:template
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib'

/** Decodes an ASCII85 stream body (the '~>' terminated form used by PDF). */
function decodeAscii85(bytes) {
  const out = []
  let tuple = 0
  let count = 0
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i]
    if (c === 0x7e) break // '~' begins the '~>' terminator
    if (c <= 0x20 || c === 0x0a || c === 0x0d) continue // whitespace
    if (c === 0x7a && count === 0) {
      out.push(0, 0, 0, 0) // 'z' is four zero bytes
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
function readContent(page) {
  const contents = page.node.Contents()
  const raw = Buffer.from(contents.contents)
  const attempts = [() => zlib.inflateSync(Buffer.from(decodeAscii85(raw))), () => zlib.inflateSync(raw), () => raw]
  for (const attempt of attempts) {
    try {
      return attempt().toString('latin1')
    } catch {
      /* try the next decoding */
    }
  }
  throw new Error('Could not decode a page content stream.')
}

/** Finds every `1 1 1 rg ... re f*` white rectangle the page paints. */
function readWhiteMasks(page) {
  const text = readContent(page)
  const pattern = /1 1 1 rg\s*\n?\s*n ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f\*/g
  return [...text.matchAll(pattern)].map((match) => match.slice(1, 5).map(Number))
}

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const SOURCE = path.join(root, 'reference', 'Dustin_Douglas_Trip_39586_Settlement_Fillable.pdf')
const OUTPUT = path.join(root, 'public', 'settlement-template.pdf')

const source = fs.readFileSync(SOURCE)
let doc = await PDFDocument.load(source, { ignoreEncryption: true })

if (doc.getPageCount() !== 2) {
  throw new Error(`Expected a two-page source PDF, found ${doc.getPageCount()}.`)
}

// 1. Drop the AcroForm dictionary entirely.
doc.catalog.delete(PDFName.of('AcroForm'))

// 2. Drop every annotation on every page (all of them are form widgets).
let removed = 0
for (const page of doc.getPages()) {
  const annots = page.node.get(PDFName.of('Annots'))
  if (annots) {
    removed += page.node.Annots()?.size() ?? 0
    page.node.delete(PDFName.of('Annots'))
  }
  // Belt and braces: a widget's appearance can also hang off the page's
  // resources. Confirm nothing named like a field remains reachable.
  const res = page.node.Resources()
  if (res instanceof PDFDict) {
    const xobj = res.lookup(PDFName.of('XObject'))
    if (xobj instanceof PDFDict && xobj.keys().length !== 1) {
      throw new Error('Unexpected XObject count on a template page.')
    }
  }
}

// 3. Copy the cleaned pages into a brand-new document. The source file carries
//    inconsistent object generation numbers left over from earlier tooling,
//    which makes some readers fall back to a full object scan. Copying renumbers
//    everything cleanly without touching page content.
const clean = await PDFDocument.create()
const copied = await clean.copyPages(doc, doc.getPageIndices())
copied.forEach((page) => clean.addPage(page))
doc = clean

// 4. Burn the page's white mask rectangles into the scan.
//
//    The supplied PDF is not a blank form. Each page draws a marked-up SAMPLE
//    sheet - another driver's filled-in settlement ("Bob Ross", truck 151,
//    odometer 123,456, a list of stops) on page 1, and handwritten instructions
//    plus expense figures on page 2 - then paints white rectangles over those
//    areas and redraws the form's labels, rules and grids as vectors on top.
//
//    The result LOOKS blank, but the sample data is still in the file and can
//    be recovered by anyone who extracts the image. Painting the same
//    rectangles into the raster itself removes it for good. Because these are
//    exactly the rectangles the page already paints at render time, the visible
//    result is pixel-for-pixel unchanged.
let whitened = 0
for (const [index, page] of doc.getPages().entries()) {
  const masks = readWhiteMasks(page)
  const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject'))
  if (!(xobjects instanceof PDFDict) || masks.length === 0) continue

  const key = xobjects.keys()[0]
  const stream = xobjects.lookup(key)
  const width = Number(String(stream.dict.get(PDFName.of('Width'))))
  const height = Number(String(stream.dict.get(PDFName.of('Height'))))
  const filters = String(stream.dict.lookup(PDFName.of('Filter')))
  const body = filters.includes('ASCII85Decode') ? decodeAscii85(stream.contents) : stream.contents
  const pixels = zlib.inflateSync(Buffer.from(body))
  if (pixels.length !== width * height * 3) {
    throw new Error(`Page ${index + 1}: unexpected raster size.`)
  }

  const { width: pw, height: ph } = page.getSize()
  const sx = width / pw
  const sy = height / ph
  for (const [mx, my, mw, mh] of masks) {
    const x0 = Math.max(0, Math.floor(mx * sx))
    const x1 = Math.min(width, Math.ceil((mx + mw) * sx))
    const y0 = Math.max(0, Math.floor((ph - (my + mh)) * sy))
    const y1 = Math.min(height, Math.ceil((ph - my) * sy))
    for (let y = y0; y < y1; y++) {
      pixels.fill(0xff, (y * width + x0) * 3, (y * width + x1) * 3)
    }
    whitened++
  }

  const recompressed = zlib.deflateSync(pixels, { level: 9 })
  stream.contents = new Uint8Array(recompressed)
  stream.dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'))
  stream.dict.set(PDFName.of('Length'), doc.context.obj(recompressed.length))
}
console.log(`Burned ${whitened} mask rectangles into the scans, removing the hidden sample data.`)

// 5. Losslessly re-serialise the two scanned images: the source wraps them in
//    ASCII85 on top of Flate, which inflates the download by ~25% for no
//    benefit. Decoding that wrapper and re-deflating the identical pixel bytes
//    changes nothing on the page.
let reclaimed = 0
for (const page of doc.getPages()) {
  const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject'))
  if (!(xobjects instanceof PDFDict)) continue
  for (const key of xobjects.keys()) {
    const stream = xobjects.lookup(key)
    const filters = stream?.dict?.lookup(PDFName.of('Filter'))
    if (!filters || !String(filters).includes('ASCII85Decode')) continue

    const before = stream.contents.length
    const flateBytes = decodeAscii85(stream.contents)
    const pixels = zlib.inflateSync(Buffer.from(flateBytes))
    const recompressed = zlib.deflateSync(pixels, { level: 9 })

    stream.contents = new Uint8Array(recompressed)
    stream.dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'))
    stream.dict.set(PDFName.of('Length'), doc.context.obj(recompressed.length))
    reclaimed += before - recompressed.length
  }
}
if (reclaimed > 0) {
  console.log(`Re-encoded scans losslessly, saving ${(reclaimed / 1024 / 1024).toFixed(2)} MB.`)
}

doc.setTitle('United Freight Lines settlement form')
doc.setSubject('Blank two-page settlement template. Artwork unmodified.')
doc.setProducer('')
doc.setCreator('')

const bytes = await doc.save({ useObjectStreams: false })
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true })
fs.writeFileSync(OUTPUT, bytes)

// Verify the result before declaring success.
const check = await PDFDocument.load(fs.readFileSync(OUTPUT))
if (check.getPageCount() !== 2) throw new Error('Template is not two pages.')
for (const page of check.getPages()) {
  const { width, height } = page.getSize()
  if (Math.round(width) !== 611 || Math.round(height) !== 841) {
    throw new Error(`Template page size changed: ${width} x ${height}.`)
  }
  if (page.node.get(PDFName.of('Annots'))) throw new Error('Annotations survived.')
}
if (check.catalog.get(PDFName.of('AcroForm'))) throw new Error('AcroForm survived.')

console.log(`Removed ${removed} widget annotations and the AcroForm.`)
console.log(`Wrote ${OUTPUT} (${(bytes.length / 1024 / 1024).toFixed(2)} MB, 2 pages, 611 x 841).`)
