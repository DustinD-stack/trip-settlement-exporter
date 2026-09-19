/**
 * Settlement PDF generation, entirely in the browser.
 *
 * The template (`settlement-template.pdf`) is the original United Freight scan
 * with no form layer. It is fetched once, cached as bytes, and COPIED for every
 * export - the cached bytes are never mutated, so the template on disk and in
 * memory is always pristine.
 *
 * Two outputs:
 *   flattened - text drawn straight onto the page, no AcroForm. Ready to email.
 *   fillable  - real AcroForm text fields, pre-filled, still editable.
 *
 * Both are built from the same finalised field values, so the preview and the
 * download can never disagree.
 */
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import {
  PAGE_COUNT,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PDF_FIELDS,
  SIGNATURE_FIELD,
  type FieldSpec,
} from '../config/pdfFieldMapping'
import { buildFieldValues, type FieldValues } from './pdfValues'
import { calculateTrip } from './calc'
import type { Trip } from '../types'

export const TEMPLATE_URL = `${import.meta.env.BASE_URL}settlement-template.pdf`

/** Ink colour for entered values: dark blue, like a pen, clearly not artwork. */
const INK = rgb(0.03, 0.09, 0.42)

let templateBytesPromise: Promise<Uint8Array> | null = null

/** Fetches the template once. Callers always receive a fresh copy. */
export async function loadTemplateBytes(url: string = TEMPLATE_URL): Promise<Uint8Array> {
  if (!templateBytesPromise) {
    templateBytesPromise = fetch(url).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Could not load the settlement template (HTTP ${response.status}).`)
      }
      return new Uint8Array(await response.arrayBuffer())
    })
  }
  const bytes = await templateBytesPromise
  return bytes.slice() // defensive copy - the cached original is never handed out
}

export function resetTemplateCache(): void {
  templateBytesPromise = null
}

/**
 * Largest size <= spec.fontSize at which the text fits the box width.
 * Returns the text (possibly truncated with an ellipsis if even the minimum
 * size is too small) together with the size to draw it at.
 */
export function fitText(
  text: string,
  spec: FieldSpec,
  widthOf: (text: string, size: number) => number,
): { text: string; size: number } {
  const padding = 2
  const available = spec.width - padding * 2
  if (!text) return { text: '', size: spec.fontSize }

  let size = spec.fontSize
  while (size > spec.minFontSize && widthOf(text, size) > available) {
    size = Math.max(spec.minFontSize, Math.round((size - 0.25) * 100) / 100)
  }
  if (widthOf(text, size) <= available) return { text, size }

  // Still too wide at the minimum size: truncate rather than overrun the box
  // and print on top of the form's labels, borders or neighbouring values.
  let truncated = text
  while (truncated.length > 1 && widthOf(`${truncated}…`, size) > available) {
    truncated = truncated.slice(0, -1)
  }
  return { text: `${truncated}…`, size }
}

function drawValue(page: PDFPage, font: PDFFont, spec: FieldSpec, value: string): void {
  const text = value.trim()
  if (!text) return
  const widthOf = (t: string, size: number) => font.widthOfTextAtSize(t, size)
  const fitted = fitText(text, spec, widthOf)

  const padding = 2
  const drawnWidth = widthOf(fitted.text, fitted.size)
  let x = spec.x + padding
  if (spec.align === 'right') x = spec.x + spec.width - padding - drawnWidth
  else if (spec.align === 'center') x = spec.x + (spec.width - drawnWidth) / 2

  // Vertically centre the glyph body inside the box.
  const y = spec.y + (spec.height - fitted.size * 0.72) / 2

  page.drawText(fitted.text, { x, y, size: fitted.size, font, color: INK })
}

async function openTemplate(templateBytes: Uint8Array): Promise<PDFDocument> {
  const doc = await PDFDocument.load(templateBytes)
  if (doc.getPageCount() !== PAGE_COUNT) {
    throw new Error(`The settlement template must have ${PAGE_COUNT} pages.`)
  }
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize()
    if (Math.round(width) !== PAGE_WIDTH || Math.round(height) !== PAGE_HEIGHT) {
      throw new Error('The settlement template page size is not the expected 611 x 841.')
    }
  }
  return doc
}

function assertKnownFields(values: FieldValues): void {
  const known = new Set(PDF_FIELDS.map((spec) => spec.name))
  for (const name of Object.keys(values)) {
    if (!known.has(name)) throw new Error(`Unknown PDF field "${name}".`)
    if (name === SIGNATURE_FIELD) throw new Error('The signature field must stay blank.')
  }
}

/** Ready-to-email PDF: values drawn onto the page, no form layer at all. */
export async function buildFlattenedPdf(
  values: FieldValues,
  templateBytes: Uint8Array,
): Promise<Uint8Array> {
  assertKnownFields(values)
  const doc = await openTemplate(templateBytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = doc.getPages()

  for (const spec of PDF_FIELDS) {
    if (spec.name === SIGNATURE_FIELD) continue // always blank
    drawValue(pages[spec.page], font, spec, values[spec.name] ?? '')
  }
  return doc.save({ useObjectStreams: false })
}

/** Editable PDF: real AcroForm text fields built from the same mapping. */
export async function buildFillablePdf(
  values: FieldValues,
  templateBytes: Uint8Array,
): Promise<Uint8Array> {
  assertKnownFields(values)
  const doc = await openTemplate(templateBytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const form = doc.getForm()
  const pages = doc.getPages()

  for (const spec of PDF_FIELDS) {
    const field = form.createTextField(spec.name)
    field.setAlignment(
      spec.align === 'right' ? 2 : spec.align === 'center' ? 1 : 0,
    )
    const raw = spec.name === SIGNATURE_FIELD ? '' : (values[spec.name] ?? '').trim()
    const fitted = fitText(raw, spec, (t, size) => font.widthOfTextAtSize(t, size))
    field.setText(fitted.text)
    // addToPage creates the widget and its default-appearance entry, so the
    // font size can only be pinned afterwards.
    field.addToPage(pages[spec.page], {
      x: spec.x,
      y: spec.y,
      width: spec.width,
      height: spec.height,
      font,
      textColor: INK,
      borderWidth: 0,
      backgroundColor: undefined,
    })
    field.setFontSize(fitted.size)
  }

  form.updateFieldAppearances(font)
  return doc.save({ useObjectStreams: false })
}

export interface SettlementPdfs {
  flattened: Uint8Array
  fillable: Uint8Array
  values: FieldValues
}

/** Builds both PDFs for one trip from a single set of finalised values. */
export async function buildSettlementPdfs(
  trip: Trip,
  templateBytes?: Uint8Array,
): Promise<SettlementPdfs> {
  const bytes = templateBytes ?? (await loadTemplateBytes())
  const values = buildFieldValues(trip, calculateTrip(trip))
  // Each build gets its own copy of the template bytes.
  const flattened = await buildFlattenedPdf(values, bytes.slice())
  const fillable = await buildFillablePdf(values, bytes.slice())
  await assertTwoPages(flattened)
  await assertTwoPages(fillable)
  return { flattened, fillable, values }
}

export async function assertTwoPages(bytes: Uint8Array): Promise<void> {
  const doc = await PDFDocument.load(bytes.slice())
  if (doc.getPageCount() !== PAGE_COUNT) {
    throw new Error(`Generated PDF has ${doc.getPageCount()} pages, expected ${PAGE_COUNT}.`)
  }
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize()
    if (Math.round(width) !== PAGE_WIDTH || Math.round(height) !== PAGE_HEIGHT) {
      throw new Error('Generated PDF page size does not match the template.')
    }
  }
}

/** Merges several settlements into one weekly PDF. */
export async function combinePdfs(documents: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create()
  for (const bytes of documents) {
    const source = await PDFDocument.load(bytes.slice())
    const pages = await merged.copyPages(source, source.getPageIndices())
    pages.forEach((page) => merged.addPage(page))
  }
  return merged.save({ useObjectStreams: false })
}
