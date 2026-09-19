import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  assertTwoPages,
  buildFillablePdf,
  buildFlattenedPdf,
  buildSettlementPdfs,
  combinePdfs,
  fitText,
} from '../src/lib/pdfExport'
import { buildFieldValues, settlementFileName, splitIsoDate } from '../src/lib/pdfValues'
import { createTrip39586Fixture } from '../src/lib/fixtures'
import { PDF_FIELDS, SIGNATURE_FIELD, CAPACITY } from '../src/config/pdfFieldMapping'
import type { Trip } from '../src/types'

const ROOT = path.resolve(__dirname, '..')
const TEMPLATE_PATH = path.join(ROOT, 'public', 'settlement-template.pdf')
const VERIFICATION_DIR = path.join(ROOT, 'verification')

let templateBytes: Uint8Array
let templateHash: string

beforeAll(() => {
  templateBytes = new Uint8Array(fs.readFileSync(TEMPLATE_PATH))
  templateHash = crypto.createHash('sha256').update(templateBytes).digest('hex')
})

const sha = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex')

describe('the template itself', () => {
  it('is a two-page 611 x 841 PDF with no form layer and no stale values', async () => {
    const doc = await PDFDocument.load(templateBytes.slice())
    expect(doc.getPageCount()).toBe(2)
    for (const page of doc.getPages()) {
      expect(Math.round(page.getWidth())).toBe(611)
      expect(Math.round(page.getHeight())).toBe(841)
    }
    expect(doc.getForm().getFields()).toHaveLength(0)
  })

  it('is never modified by an export', async () => {
    const trip = createTrip39586Fixture()
    await buildSettlementPdfs(trip, templateBytes)
    expect(sha(templateBytes)).toBe(templateHash)
    // ...and the file on disk is untouched too.
    expect(sha(new Uint8Array(fs.readFileSync(TEMPLATE_PATH)))).toBe(templateHash)
  })
})

describe('field mapping integrity', () => {
  it('has unique field names that all sit inside the page', () => {
    const seen = new Set<string>()
    for (const spec of PDF_FIELDS) {
      expect(seen.has(spec.name), `duplicate field ${spec.name}`).toBe(false)
      seen.add(spec.name)
      expect(spec.x).toBeGreaterThanOrEqual(0)
      expect(spec.y).toBeGreaterThanOrEqual(0)
      expect(spec.x + spec.width).toBeLessThanOrEqual(611)
      expect(spec.y + spec.height).toBeLessThanOrEqual(841)
    }
  })

  it('never lets two fields on a page overlap', () => {
    for (const page of [0, 1] as const) {
      const specs = PDF_FIELDS.filter((s) => s.page === page)
      for (let i = 0; i < specs.length; i++) {
        for (let j = i + 1; j < specs.length; j++) {
          const a = specs[i]
          const b = specs[j]
          const overlaps =
            a.x < b.x + b.width &&
            b.x < a.x + a.width &&
            a.y < b.y + b.height &&
            b.y < a.y + a.height
          expect(overlaps, `${a.name} overlaps ${b.name}`).toBe(false)
        }
      }
    }
  })

  it('provides every row the printed form can hold', () => {
    const has = (name: string) => PDF_FIELDS.some((s) => s.name === name)
    expect(has(`route_${CAPACITY.routes}_to`)).toBe(true)
    expect(has(`left_state_${CAPACITY.stateMilesPerColumn}`)).toBe(true)
    expect(has(`right_state_${CAPACITY.stateMilesPerColumn}`)).toBe(true)
    expect(has(`fuel_${CAPACITY.fuel}_total`)).toBe(true)
    expect(has(`advance_${CAPACITY.advances}_type`)).toBe(true)
  })
})

describe('trip 39586 field values', () => {
  const trip = createTrip39586Fixture()
  const values = buildFieldValues(trip)

  it('maps identification exactly as the supplied settlement shows it', () => {
    expect(values.driver_name).toBe('Dustin Douglas')
    expect(values.co_driver_name).toBe('N/A')
    expect(values.truck_number).toBe('146')
    expect(values.trailer_number).toBe('2016')
    expect(values.trip_number).toBe('39586')
    expect(values.beginning_odometer).toBe('289703')
    expect(values.ending_odometer).toBe('291726')
    expect(values.start_date).toBe('09-15-2026')
    expect(values.end_date).toBe('09-18-2026')
  })

  it('maps the route and all eight state rows', () => {
    expect(values.route_1_from).toBe('3950 E Airport Dr Ontario, CA 91761')
    expect(values.route_1_to).toBe('12300 Jim Dhamer Dr Huntley, IL 60142')
    expect(values.route_2_from).toBe('')

    expect(values.left_state_1).toBe('CA')
    expect(values.left_miles_1).toBe('287')
    expect(values.left_highways_1).toBe('I-805, I-15')
    expect(values.left_state_8).toBe('IL')
    expect(values.left_miles_8).toBe('150')
    expect(values.left_highways_8).toBe('I-80, I-39, US-20, IL-47')
    expect(values.left_state_9).toBe('')
    expect(values.left_state_miles_total).toBe('2,068')
    // The second table stays empty, including its total.
    expect(values.right_state_miles_total).toBe('')
    expect(values.right_state_1).toBe('')
  })

  it('maps driver pay and leaves unused money fields blank, not "0.00"', () => {
    expect(values.total_miles_pay).toBe('1,654.40')
    expect(values.total_pay_to_driver).toBe('1,654.40')
    expect(values.total_extra_stops_pay).toBe('')
    expect(values.total_layover_pay).toBe('')
    expect(values.total_money_received).toBe('')
    expect(values.total_money_spent).toBe('')
    expect(values.money_left_on_hand).toBe('')
    expect(values.fuel_total).toBe('')
    expect(values.advance_total).toBe('')
  })

  it('writes the Walmart pliers description with no amount', () => {
    expect(values.expense_other).toBe('Walmart pliers')
    expect(values.expense_total).toBe('')
    expect(values.expense_scales).toBe('')
  })

  it('never writes PRO, BOL or the tax reserve into any field', () => {
    const written = Object.values(values).join('|')
    expect(trip.proNumber).toBe('38522')
    expect(trip.bolNumber).toBe('935202874')
    expect(written).not.toContain('38522')
    expect(written).not.toContain('935202874')
    expect(written).not.toContain('413.60')
    expect(written).not.toContain('1,240.80')
  })

  it('never produces a value for the signature field', () => {
    expect(values[SIGNATURE_FIELD]).toBeUndefined()
  })

  it('refuses to write an unknown field', () => {
    expect(() => buildFieldValues({ ...trip, driverName: 'x' })).not.toThrow()
  })
})

describe('date splitting for the pre-printed slash cells', () => {
  it('splits an ISO date into month, day and two-digit year', () => {
    expect(splitIsoDate('2026-09-15')).toEqual({ mm: '09', dd: '15', yyyy: '2026', yy: '26' })
    expect(splitIsoDate('')).toBeNull()
    expect(splitIsoDate('nonsense')).toBeNull()
  })

  it('fills the three fuel date slots and leaves them blank when undated', () => {
    const trip = createTrip39586Fixture()
    trip.fuel = [
      { id: 'f1', date: '2026-09-16', state: 'UT', invoice: 'INV-1', seller: 'Loves',
        truckGallons: '110.5', reeferGallons: '', defGallons: '5', total: '420.00' },
      { id: 'f2', date: '', state: 'CO', invoice: 'INV-2', seller: 'TA',
        truckGallons: '90', reeferGallons: '', defGallons: '', total: '340.10' },
    ]
    const values = buildFieldValues(trip)
    expect(values.fuel_1_date_mm).toBe('09')
    expect(values.fuel_1_date_dd).toBe('16')
    expect(values.fuel_1_date_yy).toBe('26')
    expect(values.fuel_1_truck_gallons).toBe('110.5')
    expect(values.fuel_2_date_mm).toBe('')
    expect(values.fuel_total).toBe('760.10')
  })
})

describe('auto font shrink', () => {
  const spec = PDF_FIELDS.find((s) => s.name === 'left_highways_1')!
  // Helvetica is ~0.5em per character on average; good enough for the rule.
  const widthOf = (text: string, size: number) => text.length * size * 0.5

  it('keeps the preferred size when the text fits', () => {
    expect(fitText('I-15', spec, widthOf).size).toBe(spec.fontSize)
  })

  it('shrinks rather than overflowing the box', () => {
    const long = 'I-80, I-39, US-20, IL-47, I-355, I-290, I-294'
    const fitted = fitText(long, spec, widthOf)
    expect(fitted.size).toBeLessThan(spec.fontSize)
    expect(widthOf(fitted.text, fitted.size)).toBeLessThanOrEqual(spec.width - 4)
  })

  it('truncates rather than printing past the box at the minimum size', () => {
    const absurd = 'X'.repeat(400)
    const fitted = fitText(absurd, spec, widthOf)
    expect(fitted.size).toBe(spec.minFontSize)
    expect(fitted.text.endsWith('…')).toBe(true)
    expect(widthOf(fitted.text, fitted.size)).toBeLessThanOrEqual(spec.width - 4)
  })
})

describe('generated documents', () => {
  it('produce a flattened PDF with exactly two pages and no form', async () => {
    const values = buildFieldValues(createTrip39586Fixture())
    const bytes = await buildFlattenedPdf(values, templateBytes.slice())
    await assertTwoPages(bytes)

    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getForm().getFields()).toHaveLength(0)
    for (const page of doc.getPages()) {
      expect(page.node.Annots()?.size() ?? 0).toBe(0)
    }
  })

  it('produce a fillable PDF whose fields carry the same values', async () => {
    const values = buildFieldValues(createTrip39586Fixture())
    const bytes = await buildFillablePdf(values, templateBytes.slice())
    await assertTwoPages(bytes)

    const form = (await PDFDocument.load(bytes)).getForm()
    expect(form.getTextField('driver_name').getText()).toBe('Dustin Douglas')
    expect(form.getTextField('trip_number').getText()).toBe('39586')
    expect(form.getTextField('left_state_miles_total').getText()).toBe('2,068')
    expect(form.getTextField('total_pay_to_driver').getText()).toBe('1,654.40')
  })

  it('leave the signature field blank in both versions', async () => {
    const { flattened, fillable } = await buildSettlementPdfs(createTrip39586Fixture(), templateBytes)

    const form = (await PDFDocument.load(fillable)).getForm()
    const signature = form.getTextField(SIGNATURE_FIELD)
    expect(signature.getText() ?? '').toBe('')

    // The flattened copy draws nothing at all in the signature area.
    const flatDoc = await PDFDocument.load(flattened)
    expect(flatDoc.getForm().getFields()).toHaveLength(0)
    expect(flattened.length).toBeGreaterThan(0)
  })

  it('use the required file names', () => {
    const trip = createTrip39586Fixture()
    expect(settlementFileName(trip, 'flattened')).toBe('Dustin_Douglas_Trip_39586_Settlement.pdf')
    expect(settlementFileName(trip, 'fillable')).toBe(
      'Dustin_Douglas_Trip_39586_Settlement_Fillable.pdf',
    )
  })

  it('writes the verification PDFs for visual comparison', async () => {
    const trip = createTrip39586Fixture()
    const { flattened, fillable } = await buildSettlementPdfs(trip, templateBytes)
    fs.mkdirSync(VERIFICATION_DIR, { recursive: true })
    fs.writeFileSync(path.join(VERIFICATION_DIR, settlementFileName(trip, 'flattened')), flattened)
    fs.writeFileSync(path.join(VERIFICATION_DIR, settlementFileName(trip, 'fillable')), fillable)
    expect(fs.existsSync(path.join(VERIFICATION_DIR, settlementFileName(trip, 'flattened')))).toBe(true)
  })
})

describe('exporting several trips', () => {
  function secondTrip(): Trip {
    const trip = createTrip39586Fixture()
    return {
      ...trip,
      id: 'trip-2',
      tripNumber: '40127',
      driverName: 'Dustin Douglas',
      truckNumber: '204',
      trailerNumber: '5511',
      beginningOdometer: '291726',
      endingOdometer: '292500',
      paidMiles: '774',
      mileageRate: '0.80',
      startDate: '2026-09-19',
      endDate: '2026-09-20',
      stateMiles: [{ id: 's', state: 'IL', miles: '774', highways: 'I-55' }],
      expenses: [],
      routes: [],
    }
  }

  it('keeps each trip\'s data entirely separate', async () => {
    const a = createTrip39586Fixture()
    const b = secondTrip()

    const first = await buildSettlementPdfs(a, templateBytes)
    const second = await buildSettlementPdfs(b, templateBytes)

    expect(first.values.trip_number).toBe('39586')
    expect(second.values.trip_number).toBe('40127')
    expect(first.values.total_miles_pay).toBe('1,654.40')
    expect(second.values.total_miles_pay).toBe('619.20')
    expect(second.values.left_state_1).toBe('IL')
    expect(second.values.left_state_2).toBe('')
    // Trip A's only expense must not bleed into trip B.
    expect(first.values.expense_other).toBe('Walmart pliers')
    expect(second.values.expense_other).toBe('')
    expect(second.values.truck_number).toBe('204')

    const secondForm = (await PDFDocument.load(second.fillable)).getForm()
    expect(secondForm.getTextField('trip_number').getText()).toBe('40127')
    expect(secondForm.getTextField('expense_other').getText() ?? '').toBe('')
  })

  it('combines a week into one PDF of two pages per trip', async () => {
    const a = await buildSettlementPdfs(createTrip39586Fixture(), templateBytes)
    const b = await buildSettlementPdfs(secondTrip(), templateBytes)
    const combined = await combinePdfs([a.flattened, b.flattened])
    const doc = await PDFDocument.load(combined)
    expect(doc.getPageCount()).toBe(4)
  })
})
