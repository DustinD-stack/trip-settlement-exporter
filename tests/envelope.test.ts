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

describe('every selected trip contributes a From/To pair', () => {
  /** A trip with no Routes & Stops rows, carrying only Origin/Destination. */
  const noRouteRows = (overrides: Partial<Trip> = {}): Trip => ({
    ...laterTrip(),
    routes: [],
    origin: '12300 Jim Dhamer Dr Huntley, IL 60142',
    destination: '4000 N Kedzie Ave Chicago, IL 60618',
    ...overrides,
  })

  it('falls back to a trip Origin and Destination when it has no route rows', () => {
    const envelope = envelopeOf([createTrip39586Fixture(), noRouteRows()])
    expect(envelope.trip.routes).toHaveLength(2)

    const [first, second] = envelope.trip.routes
    expect(first.from).toContain('Ontario') // trip A's explicit row
    expect(first.to).toContain('Huntley')
    expect(second.from).toBe('12300 Jim Dhamer Dr Huntley, IL 60142') // trip B's fallback
    expect(second.to).toBe('4000 N Kedzie Ave Chicago, IL 60618')
  })

  it('prints both pairs on the settlement rather than losing one', () => {
    const values = buildFieldValues(envelopeOf([createTrip39586Fixture(), noRouteRows()]).trip)
    expect(values.route_1_from).toContain('Ontario')
    expect(values.route_1_to).toContain('Huntley')
    expect(values.route_2_from).toContain('Huntley')
    expect(values.route_2_to).toContain('Kedzie')
    expect(values.route_3_from).toBe('')
  })

  it('gives explicit route rows priority and never duplicates the leg', () => {
    // Trip B has BOTH route rows and an Origin/Destination. Only the rows count.
    const withBoth = {
      ...laterTrip(),
      origin: 'SHOULD NOT APPEAR',
      destination: 'SHOULD NOT APPEAR EITHER',
    }
    const envelope = envelopeOf([createTrip39586Fixture(), withBoth])

    expect(envelope.trip.routes).toHaveLength(2) // one row each, not three
    const printed = Object.values(buildFieldValues(envelope.trip)).join('|')
    expect(printed).not.toContain('SHOULD NOT APPEAR')
  })

  it('keeps one pair per trip when neither trip has route rows', () => {
    const a = { ...createTrip39586Fixture(), routes: [], origin: 'Ontario, CA', destination: 'Huntley, IL' }
    const b = noRouteRows({ origin: 'Huntley, IL', destination: 'Chicago, IL' })
    const envelope = envelopeOf([a, b])

    expect(envelope.trip.routes.map((r) => [r.from, r.to])).toEqual([
      ['Ontario, CA', 'Huntley, IL'],
      ['Huntley, IL', 'Chicago, IL'],
    ])
  })

  it('contributes nothing for a trip with neither rows nor addresses', () => {
    const blank = noRouteRows({ origin: '', destination: '' })
    const envelope = envelopeOf([createTrip39586Fixture(), blank])
    expect(envelope.trip.routes).toHaveLength(1)
    expect(envelope.trip.routes[0].from).toContain('Ontario')
  })

  it('ignores blank route rows and still falls back', () => {
    const blankRow = noRouteRows({
      routes: [
        { id: 'empty', order: 1, type: '', from: '  ', to: '', isPickup: false, isDelivery: false, notes: 'note only' },
      ],
    })
    const envelope = envelopeOf([createTrip39586Fixture(), blankRow])
    expect(envelope.trip.routes).toHaveLength(2)
    expect(envelope.trip.routes[1].from).toContain('Huntley')
  })

  it('numbers the combined stops from 1 without gaps', () => {
    const envelope = envelopeOf([
      createTrip39586Fixture(),
      noRouteRows(),
      { ...noRouteRows(), id: 'trip-c', tripNumber: '40200', startDate: '2026-09-22', endDate: '2026-09-23', origin: 'C1', destination: 'C2' },
    ])
    expect(envelope.trip.routes.map((r) => r.order)).toEqual([1, 2, 3])
  })

  it('leaves the source trips untouched by the fallback', () => {
    const b = noRouteRows()
    const before = JSON.stringify(b)
    envelopeOf([createTrip39586Fixture(), b])
    expect(JSON.stringify(b)).toBe(before)
    expect(b.routes).toHaveLength(0)
  })
})

describe('the combined state-mile total', () => {
  it('prints the calculated total on the settlement', () => {
    const values = buildFieldValues(envelopeOf([createTrip39586Fixture(), laterTrip()]).trip)
    expect(values.left_state_miles_total).toBe('2,848') // 2,068 + 780
    expect(values.right_state_miles_total).toBe('')
  })

  it('prints every state row in travel order, Illinois twice', () => {
    const values = buildFieldValues(envelopeOf([createTrip39586Fixture(), laterTrip()]).trip)
    const states = Array.from({ length: 20 }, (_, i) => values[`left_state_${i + 1}`]).filter(Boolean)
    // 39586 covers CA NV AZ UT CO NE IA IL; the later trip adds IL again, then WI.
    expect(states).toEqual(['CA', 'NV', 'AZ', 'UT', 'CO', 'NE', 'IA', 'IL', 'IL', 'WI'])

    // The two Illinois rows keep their own mileage and their own highways.
    expect(values.left_miles_8).toBe('150')
    expect(values.left_highways_8).toBe('I-80, I-39, US-20, IL-47')
    expect(values.left_miles_9).toBe('700')
    expect(values.left_highways_9).toBe('I-90, I-294')
  })
})

/* ------------------------------------------------------------------ *
 * State rows stay in travel order and are never merged.
 * ------------------------------------------------------------------ */

describe('state miles in trip order', () => {
  /** The worked example from the specification. */
  const exampleTrips = (): [Trip, Trip] => [
    {
      ...createTrip39586Fixture(),
      id: 'ex-1', tripNumber: 'EX-1', startDate: '2026-09-15', endDate: '2026-09-16',
      beginningOdometer: '1000', endingOdometer: '1750', paidMiles: '750',
      stateMiles: [
        { id: 'a', state: 'CA', miles: '100', highways: 'I-15' },
        { id: 'b', state: 'NV', miles: '200', highways: 'I-15' },
        { id: 'c', state: 'IA', miles: '300', highways: 'I-80' },
        { id: 'd', state: 'IL', miles: '150', highways: 'I-80, I-39' },
      ],
    },
    {
      ...laterTrip(),
      id: 'ex-2', tripNumber: 'EX-2', startDate: '2026-09-18', endDate: '2026-09-19',
      beginningOdometer: '1750', endingOdometer: '2530', paidMiles: '780',
      stateMiles: [
        { id: 'e', state: 'IL', miles: '700', highways: 'I-90, I-294' },
        { id: 'f', state: 'WI', miles: '80', highways: 'I-43' },
      ],
    },
  ]

  const asText = (trip: Trip) =>
    trip.stateMiles.map((row) => `${row.state} - ${row.miles} - ${row.highways}`)

  it('reproduces the specified order exactly', () => {
    expect(asText(combineTrips({ trips: exampleTrips(), mondayDate: '2026-09-28' }).trip)).toEqual([
      'CA - 100 - I-15',
      'NV - 200 - I-15',
      'IA - 300 - I-80',
      'IL - 150 - I-80, I-39',
      'IL - 700 - I-90, I-294',
      'WI - 80 - I-43',
    ])
  })

  it('keeps matching states from different trips as separate rows', () => {
    const rows = combineTrips({ trips: exampleTrips(), mondayDate: '2026-09-28' }).trip.stateMiles
    const illinois = rows.filter((row) => row.state === 'IL')
    expect(illinois).toHaveLength(2)
    expect(illinois.map((row) => row.miles)).toEqual(['150', '700'])
    // Explicitly NOT one 850-mile row.
    expect(rows.some((row) => row.miles === '850')).toBe(false)
  })

  it('keeps adjacent matching states separate', () => {
    // The last row of trip 1 and the first row of trip 2 are both Illinois,
    // so they end up next to each other. They must still be two rows.
    const rows = combineTrips({ trips: exampleTrips(), mondayDate: '2026-09-28' }).trip.stateMiles
    expect(rows[3].state).toBe('IL')
    expect(rows[4].state).toBe('IL')
    expect(rows[3].miles).not.toBe(rows[4].miles)
  })

  it('does not deduplicate highways across separate rows', () => {
    const [a, b] = exampleTrips()
    a.stateMiles = [{ id: 'x', state: 'IA', miles: '100', highways: 'I-80, US-30' }]
    b.stateMiles = [{ id: 'y', state: 'IA', miles: '60', highways: 'US-30, I-380' }]
    const rows = combineTrips({ trips: [a, b], mondayDate: '2026-09-28' }).trip.stateMiles
    expect(rows.map((row) => row.highways)).toEqual(['I-80, US-30', 'US-30, I-380'])
  })

  it('shows a state revisited later as another row', () => {
    const [a, b] = exampleTrips()
    a.stateMiles = [{ id: 'x', state: 'CA', miles: '100', highways: 'I-5' }]
    b.stateMiles = [
      { id: 'y', state: 'NV', miles: '50', highways: 'I-15' },
      { id: 'z', state: 'CA', miles: '90', highways: 'I-15' }, // back into CA
    ]
    const rows = combineTrips({ trips: [a, b], mondayDate: '2026-09-28' }).trip.stateMiles
    expect(rows.map((row) => row.state)).toEqual(['CA', 'NV', 'CA'])
    expect(rows.map((row) => row.miles)).toEqual(['100', '50', '90'])
  })

  it('preserves each trip internal row order', () => {
    const rows = combineTrips({ trips: exampleTrips(), mondayDate: '2026-09-28' }).trip.stateMiles
    expect(rows.slice(0, 4).map((row) => row.state)).toEqual(['CA', 'NV', 'IA', 'IL'])
    expect(rows.slice(4).map((row) => row.state)).toEqual(['IL', 'WI'])
  })

  it('orders chronologically however the trips were selected', () => {
    const [a, b] = exampleTrips()
    const forwards = combineTrips({ trips: [a, b], mondayDate: '2026-09-28' })
    const backwards = combineTrips({ trips: [b, a], mondayDate: '2026-09-28' })
    expect(asText(backwards.trip)).toEqual(asText(forwards.trip))
    expect(backwards.trip.stateMiles[0].state).toBe('CA') // earliest trip first
  })

  it('gives every copied row a unique temporary id', () => {
    const rows = combineTrips({ trips: exampleTrips(), mondayDate: '2026-09-28' }).trip.stateMiles
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
  })

  it('adds every row into the combined total, including both Illinois rows', () => {
    const envelope = combineTrips({ trips: exampleTrips(), mondayDate: '2026-09-28' })
    const totals = calculateTrip(envelope.trip)
    expect(totals.stateMilesTotal).toBe(100 + 200 + 300 + 150 + 700 + 80) // 1,530
    expect(totals.paidMiles).toBe(750 + 780) // 1,530
    expect(totals.beginningOdometer).toBe(1000)
    expect(totals.endingOdometer).toBe(2530)
    expect(totals.actualMiles).toBe(1530)
    // All three agree here, so the differences are zero and nothing is adjusted.
    expect(totals.stateMilesDifference).toBe(0)
    expect(totals.paidMilesDifference).toBe(0)
  })

  it('reports the exact differences without adjusting any mileage', () => {
    const envelope = envelopeOf([createTrip39586Fixture(), laterTrip()])
    const totals = calculateTrip(envelope.trip)
    expect(totals.stateMilesTotal).toBe(2068 + 780) // 2,848
    expect(totals.actualMiles).toBe(2797)
    expect(totals.stateMilesDifference).toBe(51) // reported, never corrected
    expect(envelope.trip.stateMiles.reduce((n, r) => n + Number(r.miles), 0)).toBe(2848)
  })

  it('leaves the source trips untouched', () => {
    const [a, b] = exampleTrips()
    const before = JSON.stringify([a, b])
    const envelope = combineTrips({ trips: [a, b], mondayDate: '2026-09-28' })
    envelope.trip.stateMiles[0].miles = '999999'
    envelope.trip.stateMiles[4].state = 'ZZ'
    expect(JSON.stringify([a, b])).toBe(before)
    expect(a.stateMiles[0].miles).toBe('100')
    expect(b.stateMiles[0].state).toBe('IL')
  })

  it('warns rather than merging when the rows overflow the printed form', () => {
    const rowsFor = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `${prefix}${i}`, state: 'IA', miles: '10', highways: 'I-80',
      }))
    const [a, b] = exampleTrips()
    a.stateMiles = rowsFor('a', 25)
    b.stateMiles = rowsFor('b', 20) // 45 rows against a 40-row form
    const envelope = combineTrips({ trips: [a, b], mondayDate: '2026-09-28' })

    expect(envelope.trip.stateMiles).toHaveLength(45) // nothing discarded or merged
    const warning = validateTripForExport(envelope.trip).warnings.find(
      (w) => w.code === 'state-miles-overflow',
    )!
    expect(warning).toBeDefined()
    expect(warning.message).toContain('45')
    expect(warning.message).toContain('40')
    expect(warning.detail).toContain('41-45') // says which rows will not fit
    expect(warning.detail).toContain('nothing is deleted')
    // Every row still counts towards the total the app reports.
    expect(calculateTrip(envelope.trip).stateMilesTotal).toBe(450)
  })

  it('fills the printed rows in order and spills into the second column', () => {
    const rowsFor = (prefix: string, count: number, state: string) =>
      Array.from({ length: count }, (_, i) => ({
        id: `${prefix}${i}`, state, miles: String(i + 1), highways: `${state}-${i + 1}`,
      }))
    const [a, b] = exampleTrips()
    a.stateMiles = rowsFor('a', 20, 'IA')
    b.stateMiles = rowsFor('b', 5, 'WI')
    const values = buildFieldValues(combineTrips({ trips: [a, b], mondayDate: '2026-09-28' }).trip)

    expect(values.left_state_1).toBe('IA')
    expect(values.left_miles_1).toBe('1')
    expect(values.left_state_20).toBe('IA')
    expect(values.left_miles_20).toBe('20')
    // Row 21 onwards continues in the right-hand table.
    expect(values.right_state_1).toBe('WI')
    expect(values.right_miles_1).toBe('1')
    expect(values.right_state_5).toBe('WI')
    expect(values.right_state_6).toBe('')
    // The left table still carries the whole total.
    expect(values.left_state_miles_total).toBe('225') // 210 + 15
    expect(values.right_state_miles_total).toBe('')
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
