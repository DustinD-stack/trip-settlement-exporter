/**
 * Monday envelope: several completed trips combined into ONE two-page
 * settlement form.
 *
 * Payroll asks for trip envelopes on Mondays with the trip information written
 * on a single envelope. This builds a TEMPORARY trip record that represents the
 * selected trips together, purely so the existing exporter can render it. The
 * source trips are never merged, modified or deleted - `combineTrips` treats
 * them as read-only and returns a new object.
 *
 * This is deliberately NOT the weekly export. The weekly export stacks a
 * separate two-page settlement per trip (4+ pages); this produces one
 * two-page settlement whose fields hold the combined figures.
 */
import { calculateTrip } from './calc'
import { parseNumber, parseWhole, roundMoney, sumMoney } from './money'
import type { Trip } from '../types'

/* ------------------------------------------------------------------ *
 * Monday submission date
 * ------------------------------------------------------------------ */

/**
 * The Monday the envelope is handed in: today when today is Monday, otherwise
 * the next one. Uses local date parts, so it does not drift across timezones.
 */
export function nextMonday(from: Date = new Date()): string {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  // getDay(): 0 = Sunday, 1 = Monday. (8 - day) % 7 gives 0 on a Monday.
  date.setDate(date.getDate() + ((8 - date.getDay()) % 7))
  return toIso(date)
}

function toIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/* ------------------------------------------------------------------ *
 * Ordering and small helpers
 * ------------------------------------------------------------------ */

/**
 * Chronological order: start date, then end date, then trip number. Trips with
 * no start date sort last so they cannot silently become the odometer anchors.
 */
export function sortTripsChronologically(trips: Trip[]): Trip[] {
  return [...trips].sort((a, b) => {
    const aStart = a.startDate || ''
    const bStart = b.startDate || ''
    if (aStart !== bStart) {
      if (!aStart) return 1
      if (!bStart) return -1
      return aStart < bStart ? -1 : 1
    }
    const aEnd = a.endDate || ''
    const bEnd = b.endDate || ''
    if (aEnd !== bEnd) return aEnd < bEnd ? -1 : 1
    return a.tripNumber.localeCompare(b.tripNumber, undefined, { numeric: true })
  })
}

/** Unique, order-preserving list of the non-empty values. */
function uniqueJoin(values: string[], separator = ', '): string {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    kept.push(trimmed)
  }
  return kept.join(separator)
}

/** Splits a highway list on commas/slashes and returns the individual names. */
function splitHighways(value: string): string[] {
  return value
    .split(/[,;/]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/* ------------------------------------------------------------------ *
 * Combining
 * ------------------------------------------------------------------ */

export interface EnvelopeInput {
  trips: Trip[]
  /** ISO yyyy-mm-dd Monday the envelope is submitted. */
  mondayDate: string
}

export interface CombinedEnvelope {
  /** The temporary record handed to the existing exporter and validator. */
  trip: Trip
  /** The source trips, in the order they were combined. Never modified. */
  sourceTrips: Trip[]
  mondayDate: string
  tripNumbers: string[]
  /** Exact sum of each trip's own mileage pay, before any weighted rate. */
  exactMileagePay: number
  /** Exact sum of each trip's own tax reserve. */
  exactTaxReserve: number
  /** True when the trips did not all share one mileage rate. */
  mixedRates: boolean
}

/**
 * Builds the temporary combined record.
 *
 * Money is summed from each trip's own calculated figures, so the envelope
 * always agrees with the individual settlements. Where the printed form only
 * has room for a single rate, an effective (weighted) rate is derived that
 * reproduces the exact combined mileage pay - the totals are never rounded a
 * second time or nudged to fit.
 */
export function combineTrips({ trips, mondayDate }: EnvelopeInput): CombinedEnvelope {
  if (trips.length < 2) {
    throw new Error('A Monday envelope needs at least two trips.')
  }

  const ordered = sortTripsChronologically(trips)
  const totals = ordered.map((trip) => calculateTrip(trip))
  const first = ordered[0]
  const last = ordered[ordered.length - 1]

  const paidMiles = ordered.reduce((sum, trip) => sum + (parseWhole(trip.paidMiles) ?? 0), 0)
  const exactMileagePay = sumMoney(totals.map((t) => t.mileagePay))
  const exactTaxReserve = sumMoney(totals.map((t) => t.taxReserve))

  const rates = new Set(
    ordered.map((trip) => parseNumber(trip.mileageRate)).filter((rate) => rate !== null),
  )
  const mixedRates = rates.size > 1

  // paidMiles x effectiveRate must round back to exactly exactMileagePay.
  // Dividing gives a rate that does precisely that, and collapses to the shared
  // rate when every trip used the same one.
  const effectiveRate =
    paidMiles > 0 ? exactMileagePay / paidMiles : (parseNumber(first.mileageRate) ?? 0)

  const grossPay = sumMoney(totals.map((t) => t.grossPay))
  const effectiveTaxRate = grossPay > 0 ? exactTaxReserve / grossPay : 0

  const tripNumbers = ordered.map((trip) => trip.tripNumber.trim()).filter(Boolean)

  const combined: Trip = {
    id: `envelope-${mondayDate}-${ordered.map((trip) => trip.id).join('+')}`,
    driverName: ordered.find((trip) => trip.driverName.trim())?.driverName ?? '',
    coDriver: uniqueJoin(ordered.map((trip) => trip.coDriver)),
    // A truck or trailer swap mid-week is normal; list each one used.
    truckNumber: uniqueJoin(ordered.map((trip) => trip.truckNumber)),
    trailerNumber: uniqueJoin(ordered.map((trip) => trip.trailerNumber)),
    tripNumber: tripNumbers.join(', '),
    // PRO and BOL are kept so the app and the Excel export still show them.
    // The printed form has no field for either, and buildFieldValues never
    // writes them anywhere.
    proNumber: uniqueJoin(ordered.map((trip) => trip.proNumber)),
    bolNumber: uniqueJoin(ordered.map((trip) => trip.bolNumber)),
    startDate: first.startDate,
    endDate: last.endDate,
    origin: first.origin,
    destination: last.destination,
    // The envelope spans from the first trip's starting odometer to the last
    // trip's ending odometer, exactly as written.
    beginningOdometer: first.beginningOdometer,
    endingOdometer: last.endingOdometer,
    paidMiles: paidMiles > 0 ? String(paidMiles) : '',
    mileageRate: effectiveRate > 0 ? String(effectiveRate) : '',
    extraStopPay: moneyField(totals.map((t) => t.extraStopPay)),
    layoverPay: moneyField(totals.map((t) => t.layoverPay)),
    otherPay: moneyField(totals.map((t) => t.otherPay)),
    taxReserveRate: String(effectiveTaxRate),
    notes: `Monday envelope for ${mondayDate}: trips ${tripNumbers.join(', ')}.`,
    complete: true,
    routes: combineRoutes(ordered),
    stateMiles: combineStateMiles(ordered),
    fuel: ordered.flatMap((trip) =>
      trip.fuel.map((row) => ({ ...row, id: `${trip.id}:${row.id}` })),
    ),
    expenses: ordered.flatMap((trip) =>
      trip.expenses.map((row) => ({ ...row, id: `${trip.id}:${row.id}` })),
    ),
    advances: ordered.flatMap((trip) =>
      trip.advances.map((row) => ({ ...row, id: `${trip.id}:${row.id}` })),
    ),
    createdAt: first.createdAt,
    updatedAt: new Date().toISOString(),
  }

  return {
    trip: combined,
    sourceTrips: ordered,
    mondayDate,
    tripNumbers,
    exactMileagePay,
    exactTaxReserve,
    mixedRates,
  }
}

/** Sums a money column, returning '' when it is entirely zero. */
function moneyField(values: number[]): string {
  const total = sumMoney(values)
  return Math.abs(total) < 0.005 ? '' : String(roundMoney(total))
}

/** All stops, in trip order then stop order, renumbered from 1. */
function combineRoutes(ordered: Trip[]): Trip['routes'] {
  const stops = ordered.flatMap((trip) =>
    [...trip.routes]
      .sort((a, b) => a.order - b.order)
      .map((stop) => ({ ...stop, id: `${trip.id}:${stop.id}` })),
  )
  return stops.map((stop, index) => ({ ...stop, order: index + 1 }))
}

/**
 * Merges state rows: one row per state, miles summed, highways combined
 * without repeats. Miles are only ever added together - never adjusted to
 * reconcile with the odometer.
 */
function combineStateMiles(ordered: Trip[]): Trip['stateMiles'] {
  const byState = new Map<string, { miles: number; highways: string[]; id: string }>()

  for (const trip of ordered) {
    for (const row of trip.stateMiles) {
      const state = row.state.trim().toUpperCase()
      if (!state) continue
      const existing = byState.get(state)
      const miles = parseWhole(row.miles) ?? 0
      if (existing) {
        existing.miles += miles
        existing.highways.push(...splitHighways(row.highways))
      } else {
        byState.set(state, {
          miles,
          highways: splitHighways(row.highways),
          id: `${trip.id}:${row.id}`,
        })
      }
    }
  }

  return [...byState.entries()].map(([state, row]) => ({
    id: row.id,
    state,
    miles: String(row.miles),
    highways: uniqueJoin(row.highways),
  }))
}

/* ------------------------------------------------------------------ *
 * File naming
 * ------------------------------------------------------------------ */

function sanitise(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
}

/**
 * `<Driver>_Monday_Envelope_<yyyy-mm-dd>_Trips_<a>-<b>.pdf`,
 * with `_Fillable` before the extension for the editable copy.
 *
 * The driver's name comes from the combined record, so renaming the driver in
 * Settings renames the file too.
 */
export function envelopeFileName(
  envelope: CombinedEnvelope,
  kind: 'flattened' | 'fillable',
): string {
  const driver = sanitise(envelope.trip.driverName) || 'Driver'
  const date = sanitise(envelope.mondayDate) || 'Monday'
  const numbers = envelope.tripNumbers.map(sanitise).filter(Boolean).join('-') || 'Trips'
  const suffix = kind === 'fillable' ? '_Fillable' : ''
  return `${driver}_Monday_Envelope_${date}_Trips_${numbers}${suffix}.pdf`
}
