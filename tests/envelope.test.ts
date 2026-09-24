import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  combineTrips,
  envelopeFileName,
  nextMonday,
  sortTripsChronologically,
} from '../src/lib/envelope'
import { calculateTrip } from '../src/lib/calc'
import { validateTripForExport } from '../src/lib/validation'
import { buildSettlementPdfs } from '../src/lib/pdfExport'
import { buildFieldValues } from '../src/lib/pdfValues'
import { sanitizePdfText, sanitizePdfValues, isWinAnsiEncodable } from '../src/lib/pdfText'
import { createTrip39586Fixture } from '../src/lib/fixtures'
import type { Trip } from '../src/types'

const TEMPLATE = path.resolve(__dirname, '..', 'public', 'settlement-template.pdf')
let templateBytes: Uint8Array
beforeAll(() => {
  templateBytes = new Uint8Array(fs.readFileSync(TEMPLATE))
})

/** A second, later trip that pairs with the 39586 fixture. */
function laterTrip(overrides: Partial<Trip> = {}): Trip {
  const base = createTrip39586Fixture()
  return {
    ...base,
    id: 'trip-b',
    tripNumber: '40127',
    proNumber: '38999',
    bolNumber: '935209999',
    startDate: '2026-09-19',
    endDate: '2026-09-21',
    origin: '12300 Jim Dhamer Dr Huntley, IL 60142',
    destination: '4000 N Kedzie Ave Chicago, IL 60618',
    beginningOdometer: '291726',
    endingOdometer: '292500',
    paidMiles: '780',
    mileageRate: '0.80',
    extraStopPay: '',
    layoverPay: '',
    otherPay: '',
    notes: '',
    routes: [
      {
        id: 'r-b', order: 1, type: 'Pickup to delivery',
        from: '12300 Jim Dhamer Dr Huntley, IL 60142',
        to: '4000 N Kedzie Ave Chicago, IL 60618',
        isPickup: true, isDelivery: true, notes: '',
      },
    ],
    stateMiles: [
      { id: 'sb1', state: 'IL', miles: '700', highways: 'I-90, I-294' },
      { id: 'sb2', state: 'WI', miles: '80', highways: 'I-43' },
    ],
    fuel: [],
    expenses: [],
    advances: [],
    ...overrides,
  }
}

const envelopeOf = (trips: Trip[], mondayDate = '2026-09-28') =>
  combineTrips({ trips, mondayDate })

describe('the Monday submission date', () => {
  it('is today when today is a Monday', () => {
    expect(nextMonday(new Date(2026, 8, 28))).toBe('2026-09-28') // a Monday
  })

  it('is the next Monday on any other day', () => {
    expect(nextMonday(new Date(2026, 8, 29))).toBe('2026-10-05') // Tuesday
    expect(nextMonday(new Date(2026, 8, 24))).toBe('2026-09-28') // Thursday
    expect(nextMonday(new Date(2026, 8, 27))).toBe('2026-09-28') // Sunday
  })

  it('always lands on a Monday', () => {
    for (let offset = 0; offset < 21; offset++) {
      const day = new Date(2026, 8, 1 + offset)
      const [y, m, d] = nextMonday(day).split('-').map(Number)
      expect(new Date(y, m - 1, d).getDay()).toBe(1)
    }
  })
})

describe('selecting trips', () => {
  it('requires at least two trips', () => {
    expect(() => envelopeOf([])).toThrow(/at least two trips/i)
    expect(() => envelopeOf([createTrip39586Fixture()])).toThrow(/at least two trips/i)
    expect(() => envelopeOf([createTrip39586Fixture(), laterTrip()])).not.toThrow()
  })

  it('orders trips chronologically whatever order they are given in', () => {
    const a = createTrip39586Fixture()
    const b = laterTrip()
    expect(sortTripsChronologically([b, a]).map((t) => t.tripNumber)).toEqual(['39586', '40127'])
    expect(envelopeOf([b, a]).tripNumbers).toEqual(['39586', '40127'])
  })

  it('takes the odometer span from the first and last trip', () => {
    const envelope = envelopeOf([laterTrip(), createTrip39586Fixture()])
    expect(envelope.trip.beginningOdometer).toBe('289703') // first trip's start
    expect(envelope.trip.endingOdometer).toBe('292500') // last trip's end
    expect(envelope.trip.startDate).toBe('2026-09-15')
    expect(envelope.trip.endDate).toBe('2026-09-21')
    expect(calculateTrip(envelope.trip).actualMiles).toBe(2797)
  })
})

describe('combined totals', () => {
  const a = createTrip39586Fixture()
  const b = laterTrip()
  const envelope = envelopeOf([a, b])
  const totals = calculateTrip(envelope.trip)

  it('sums paid miles', () => {
    expect(totals.paidMiles).toBe(2068 + 780)
  })

  it('reproduces the exact sum of each trip mileage pay', () => {
    const individually = calculateTrip(a).mileagePay! + calculateTrip(b).mileagePay!
    expect(envelope.exactMileagePay).toBe(individually)
    expect(totals.mileagePay).toBe(individually) // 1654.40 + 624.00
    expect(totals.mileagePay).toBe(2278.4)
  })

  it('keeps the exact total when the trips used different rates', () => {
    const cheap = { ...createTrip39586Fixture(), paidMiles: '1000', mileageRate: '0.80' }
    const dear = { ...laterTrip(), paidMiles: '500', mileageRate: '0.90' }
    const mixed = envelopeOf([cheap, dear])
    const expected = 1000 * 0.8 + 500 * 0.9 // 1250.00

    expect(mixed.mixedRates).toBe(true)
    expect(mixed.exactMileagePay).toBe(expected)
    // The weighted rate must round back to precisely the same money.
    expect(calculateTrip(mixed.trip).mileagePay).toBe(expected)
    expect(Number(mixed.trip.mileageRate)).toBeCloseTo(1250 / 1500, 12)
  })

  it('reports a single shared rate as itself, not a weighted approximation', () => {
    expect(envelope.mixedRates).toBe(false)
    expect(Number(envelope.trip.mileageRate)).toBeCloseTo(0.8, 12)
  })

  it('sums the additional pay columns', () => {
    const withExtras = envelopeOf([
      { ...createTrip39586Fixture(), extraStopPay: '50', layoverPay: '125.50', otherPay: '10' },
      { ...laterTrip(), extraStopPay: '25', layoverPay: '', otherPay: '5.25' },
    ])
    const combined = calculateTrip(withExtras.trip)
    expect(combined.extraStopPay).toBe(75)
    expect(combined.layoverPay).toBe(125.5)
    expect(combined.otherPay).toBe(15.25)
  })

  it('combines expenses, reimbursements, advances and fuel rows', () => {
    const withMoney = envelopeOf([
      {
        ...createTrip39586Fixture(),
        expenses: [
          { id: 'e1', date: '', category: 'Tolls', description: 'Skyway', state: 'IL', receipt: 'R1', amount: '12.50', reimbursement: '12.50' },
        ],
        advances: [{ id: 'a1', date: '', amount: '100', type: 'Cash', notes: '' }],
        fuel: [
          { id: 'f1', date: '2026-09-16', state: 'UT', invoice: 'INV-1', seller: 'Loves', truckGallons: '110', reeferGallons: '', defGallons: '5', total: '420.00' },
        ],
      },
      {
        ...laterTrip(),
        expenses: [
          { id: 'e2', date: '', category: 'Scales', description: 'Scale', state: 'IL', receipt: 'R2', amount: '11.00', reimbursement: '' },
        ],
        advances: [{ id: 'a2', date: '', amount: '50', type: 'EFS', notes: '' }],
        fuel: [
          { id: 'f2', date: '2026-09-20', state: 'IL', invoice: 'INV-2', seller: 'TA', truckGallons: '90', reeferGallons: '', defGallons: '', total: '340.10' },
        ],
      },
    ])
    const combined = calculateTrip(withMoney.trip)
    expect(withMoney.trip.expenses).toHaveLength(2)
    expect(withMoney.trip.advances).toHaveLength(2)
    expect(withMoney.trip.fuel).toHaveLength(2)
    expect(combined.expenseTotal).toBe(23.5)
    expect(combined.reimbursementTotal).toBe(12.5)
    expect(combined.advanceTotal).toBe(150)
    expect(combined.fuelTotal).toBe(760.1)
  })

  it('keeps the combined tax reserve equal to the sum of each trip reserve', () => {
    const perTrip = calculateTrip(a).taxReserve! + calculateTrip(b).taxReserve!
    expect(envelope.exactTaxReserve).toBe(perTrip)
    expect(calculateTrip(envelope.trip).taxReserve).toBe(perTrip)
  })

  it('places every route in chronological order and renumbers them', () => {
    expect(envelope.trip.routes).toHaveLength(2)
    expect(envelope.trip.routes.map((r) => r.order)).toEqual([1, 2])
    expect(envelope.trip.routes[0].from).toContain('Ontario')
    expect(envelope.trip.routes[1].to).toContain('Kedzie')
  })

  it('lists every trip number', () => {
    expect(envelope.trip.tripNumber).toBe('39586, 40127')
  })
})

describe('merging state miles', () => {
  const envelope = envelopeOf([createTrip39586Fixture(), laterTrip()])
  const rows = envelope.trip.stateMiles
  const row = (state: string) => rows.find((r) => r.state === state)!

  it('merges rows for the same state and sums their miles', () => {
    // 39586 has IL 150 (I-80, I-39, US-20, IL-47); the later trip has IL 700.
    expect(rows.filter((r) => r.state === 'IL')).toHaveLength(1)
    expect(row('IL').miles).toBe('850')
  })

  it('keeps unrepeated states as they were', () => {
    expect(row('CA').miles).toBe('287')
    expect(row('WI').miles).toBe('80')
  })

  it('combines highways without repeating any', () => {
    const highways = row('IL').highways.split(', ')
    expect(highways).toEqual(['I-80', 'I-39', 'US-20', 'IL-47', 'I-90', 'I-294'])
    expect(new Set(highways).size).toBe(highways.length)
  })

  it('does not repeat a highway that both trips listed', () => {
    const overlapping = envelopeOf([
      { ...createTrip39586Fixture(), stateMiles: [{ id: 's1', state: 'IA', miles: '100', highways: 'I-80, US-30' }] },
      { ...laterTrip(), stateMiles: [{ id: 's2', state: 'IA', miles: '60', highways: 'US-30, I-380' }] },
    ])
    const ia = overlapping.trip.stateMiles.find((r) => r.state === 'IA')!
    expect(ia.miles).toBe('160')
    expect(ia.highways).toBe('I-80, US-30, I-380')
  })

  it('totals the merged rows without adjusting anything', () => {
    const totals = calculateTrip(envelope.trip)
    expect(totals.stateMilesTotal).toBe(2068 + 780)
    // Odometer span is 2,797 miles, so the state total is 51 over. It stays over.
    expect(totals.actualMiles).toBe(2797)
    expect(totals.stateMilesDifference).toBe(51)
  })
})

describe('the source trips', () => {
  it('are never modified by combining them', () => {
    const a = createTrip39586Fixture()
    const b = laterTrip()
    const before = JSON.stringify([a, b])

    const envelope = envelopeOf([a, b])
    // Mutate the combined record hard.
    envelope.trip.stateMiles[0].miles = '999999'
    envelope.trip.routes[0].from = 'changed'
    envelope.trip.tripNumber = 'changed'
    envelope.trip.paidMiles = '1'

    expect(JSON.stringify([a, b])).toBe(before)
    expect(a.tripNumber).toBe('39586')
    expect(a.stateMiles[0].miles).toBe('287')
    expect(b.stateMiles[0].miles).toBe('700')
  })

  it('are returned in order alongside the combined record', () => {
    const envelope = envelopeOf([laterTrip(), createTrip39586Fixture()])
    expect(envelope.sourceTrips.map((t) => t.tripNumber)).toEqual(['39586', '40127'])
  })
})

describe('the envelope file name', () => {
  it('uses the required Monday envelope format', () => {
    const envelope = envelopeOf([createTrip39586Fixture(), laterTrip()], '2026-09-28')
    expect(envelopeFileName(envelope, 'flattened')).toBe(
      'Dustin_Douglas_Monday_Envelope_2026-09-28_Trips_39586-40127.pdf',
    )
    expect(envelopeFileName(envelope, 'fillable')).toBe(
      'Dustin_Douglas_Monday_Envelope_2026-09-28_Trips_39586-40127_Fillable.pdf',
    )
  })

  it('follows the driver name rather than hardcoding one', () => {
    const envelope = envelopeOf([
      { ...createTrip39586Fixture(), driverName: 'Casey Rivera' },
      { ...laterTrip(), driverName: 'Casey Rivera' },
    ])
    expect(envelopeFileName(envelope, 'flattened')).toMatch(/^Casey_Rivera_Monday_Envelope_/)
  })
})

describe('validating the envelope', () => {
  it('passes the existing validation when the trips are sound', () => {
    const result = validateTripForExport(envelopeOf([createTrip39586Fixture(), laterTrip()]).trip)
    expect(result.errors).toEqual([])
    expect(result.canExport).toBe(true)
  })

  it('blocks export when the combined odometer runs backwards', () => {
    const backwards = envelopeOf([
      { ...createTrip39586Fixture(), beginningOdometer: '500000' },
      { ...laterTrip(), endingOdometer: '100' },
    ])
    const result = validateTripForExport(backwards.trip)
    expect(result.errors.map((e) => e.code)).toContain('odometer-reversed')
    expect(result.canExport).toBe(false)
  })

  it('blocks export when no trip carried state miles', () => {
    const noStates = envelopeOf([
      { ...createTrip39586Fixture(), stateMiles: [] },
      { ...laterTrip(), stateMiles: [] },
    ])
    expect(validateTripForExport(noStates.trip).errors.map((e) => e.code)).toContain(
      'state-miles-missing',
    )
  })

  it('warns, rather than corrects, when the combined miles disagree', () => {
    const result = validateTripForExport(envelopeOf([createTrip39586Fixture(), laterTrip()]).trip)
    const codes = result.warnings.map((w) => w.code)
    expect(codes).toContain('state-miles-differ')
    expect(result.totals.stateMilesTotal).toBe(2848)
    expect(result.totals.actualMiles).toBe(2797)
  })

  it('warns when the merged rows overflow what the form can print', () => {
    const many = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `${prefix}${i}`, date: '', amount: '10', type: 'Cash', notes: '',
      }))
    const crowded = envelopeOf([
      { ...createTrip39586Fixture(), advances: many('a', 5) },
      { ...laterTrip(), advances: many('b', 5) },
    ])
    expect(validateTripForExport(crowded.trip).warnings.map((w) => w.code)).toContain(
      'advances-overflow',
    )
  })
})

describe('the combined PDF', () => {
  it('is ONE two-page settlement, not a stack of them', async () => {
    const envelope = envelopeOf([createTrip39586Fixture(), laterTrip()])
    const { flattened, fillable } = await buildSettlementPdfs(envelope.trip, templateBytes)

    expect((await PDFDocument.load(flattened)).getPageCount()).toBe(2)
    expect((await PDFDocument.load(fillable)).getPageCount()).toBe(2)
    expect((await PDFDocument.load(flattened)).getForm().getFields()).toHaveLength(0)
  })

  it('carries both trip numbers and the combined mileage pay', async () => {
    const envelope = envelopeOf([createTrip39586Fixture(), laterTrip()])
    const { fillable, values } = await buildSettlementPdfs(envelope.trip, templateBytes)

    expect(values.trip_number).toBe('39586, 40127')
    expect(values.total_miles_pay).toBe('2,278.40')
    expect(values.beginning_odometer).toBe('289703')
    expect(values.ending_odometer).toBe('291726' === values.ending_odometer ? '291726' : '292500')
    expect(values.ending_odometer).toBe('292500')
    expect(values.left_state_miles_total).toBe('2,848')

    const form = (await PDFDocument.load(fillable)).getForm()
    expect(form.getTextField('trip_number').getText()).toBe('39586, 40127')
    expect(form.getTextField('total_miles_pay').getText()).toBe('2,278.40')
  })

  it('never writes the PRO or BOL numbers onto the form', () => {
    const envelope = envelopeOf([createTrip39586Fixture(), laterTrip()])
    expect(envelope.trip.proNumber).toBe('38522, 38999')
    const written = Object.values(buildFieldValues(envelope.trip)).join('|')
    expect(written).not.toContain('38522')
    expect(written).not.toContain('935202874')
    expect(written).not.toContain('38999')
  })

  it('leaves the signature blank', async () => {
    const envelope = envelopeOf([createTrip39586Fixture(), laterTrip()])
    const { fillable } = await buildSettlementPdfs(envelope.trip, templateBytes)
    const form = (await PDFDocument.load(fillable)).getForm()
    expect(form.getTextField('driver_signature').getText() ?? '').toBe('')
  })
})

describe('the PDF text sanitiser', () => {
  it('converts hyphen, dash and minus variants to a plain hyphen', () => {
    expect(sanitizePdfText('I‑355')).toBe('I-355') // non-breaking hyphen
    expect(sanitizePdfText('I– 80')).toBe('I- 80') // en dash
    expect(sanitizePdfText('I—80')).toBe('I-80') // em dash
    expect(sanitizePdfText('−5')).toBe('-5') // minus sign
    expect(sanitizePdfText('US‐30')).toBe('US-30') // hyphen
  })

  it('converts curly quotes to straight ones', () => {
    expect(sanitizePdfText('O’Hare')).toBe("O'Hare")
    expect(sanitizePdfText('“Dock A”')).toBe('"Dock A"')
  })

  it('converts non-breaking spaces to normal spaces', () => {
    expect(sanitizePdfText('I-80 West')).toBe('I-80 West')
    expect(sanitizePdfText('a b')).toBe('a b')
  })

  it('leaves ordinary text alone', () => {
    expect(sanitizePdfText('I-80, I-39, US-20, IL-47')).toBe('I-80, I-39, US-20, IL-47')
    expect(sanitizePdfText('3950 E Airport Dr Ontario, CA 91761')).toBe(
      '3950 E Airport Dr Ontario, CA 91761',
    )
  })

  it('folds accented letters the font cannot encode instead of failing', () => {
    expect(sanitizePdfText('Kāhului')).toBe('Kahului') // a-macron
  })

  it('never leaves a character the font cannot encode', () => {
    const nasty = 'I‑355 — O’Hare “dock” 😀 中'
    for (const character of sanitizePdfText(nasty)) {
      expect(isWinAnsiEncodable(character.codePointAt(0)!)).toBe(true)
    }
  })

  it('sanitises a whole value map', () => {
    expect(sanitizePdfValues({ a: 'I‑355', b: 'O’Hare' })).toEqual({
      a: 'I-355',
      b: "O'Hare",
    })
  })

  it('does not change the values stored on the trip', async () => {
    const trip = createTrip39586Fixture()
    trip.stateMiles[0].highways = 'I‑805, I‑15'
    const before = trip.stateMiles[0].highways

    await buildSettlementPdfs(trip, templateBytes)
    expect(trip.stateMiles[0].highways).toBe(before)
    expect(trip.stateMiles[0].highways).toContain('‑')
  })
})

describe('copied punctuation in a real export', () => {
  it('exports without the WinAnsi error that used to crash it', async () => {
    const a = createTrip39586Fixture()
    // Exactly the shape of the reported failure: a pasted non-breaking hyphen.
    a.stateMiles[0].highways = 'I‑805, I‑15'
    a.origin = '3950 E Airport Dr – Ontario, CA 91761'
    const b = laterTrip()
    b.stateMiles[0].highways = 'I‑90, I‑294'
    b.destination = 'O’Hare “Dock 12”'

    const envelope = envelopeOf([a, b])
    const { flattened, fillable, values } = await buildSettlementPdfs(envelope.trip, templateBytes)

    expect((await PDFDocument.load(flattened)).getPageCount()).toBe(2)
    expect((await PDFDocument.load(fillable)).getPageCount()).toBe(2)

    // The reported values keep what the driver stored; only the PDF is folded.
    expect(values.left_highways_1).toContain('‑')

    const form = (await PDFDocument.load(fillable)).getForm()
    const printed = form
      .getFields()
      .map((field) => ('getText' in field ? ((field as never as { getText(): string }).getText() ?? '') : ''))
      .join('|')
    expect(printed).toContain('I-805, I-15')
    expect(printed).not.toContain('‑')
    expect(printed).not.toContain('’')
    expect(printed).not.toContain(' ')
  })

  it('also fixes a single-trip export', async () => {
    const trip = createTrip39586Fixture()
    trip.stateMiles[0].highways = 'I‑805, I‑15'
    await expect(buildSettlementPdfs(trip, templateBytes)).resolves.toBeTruthy()
  })
})
