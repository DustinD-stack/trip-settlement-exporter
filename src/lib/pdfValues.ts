/**
 * Turns a trip into the exact set of PDF field values.
 *
 * Kept separate from the PDF writer so it can be unit-tested without a PDF,
 * and so there is exactly one place that decides what text lands where.
 *
 * Rules honoured here:
 *   - Values with no matching field on the printed form are never written into
 *     an unrelated field (PRO, BOL, tax reserve, reimbursements, notes...).
 *   - A missing value stays blank rather than becoming "0.00".
 *   - The signature field is never populated.
 */
import {
  CAPACITY,
  PDF_FIELD_BY_NAME,
  SIGNATURE_FIELD,
} from '../config/pdfFieldMapping'
import { calculateTrip, categoryTotal, type TripTotals } from './calc'
import { buildOtherExpenseText } from './validation'
import {
  formatGallons,
  formatMiles,
  formatMoney,
  isBlank,
  parseNumber,
  parseWhole,
} from './money'
import type { Trip } from '../types'

export type FieldValues = Record<string, string>

/** "2026-09-15" -> "09-15-2026". Blank in, blank out. */
export function formatPdfDate(iso: string): string {
  const parts = splitIsoDate(iso)
  return parts ? `${parts.mm}-${parts.dd}-${parts.yyyy}` : ''
}

export function splitIsoDate(
  iso: string,
): { mm: string; dd: string; yyyy: string; yy: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? '').trim())
  if (!match) return null
  const [, yyyy, mm, dd] = match
  return { mm, dd, yyyy, yy: yyyy.slice(2) }
}

/** Money that must stay blank when it is zero or unset (printed-form convention). */
function optionalMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return Math.abs(value) < 0.005 ? '' : formatMoney(value)
}

export function buildFieldValues(trip: Trip, totals: TripTotals = calculateTrip(trip)): FieldValues {
  const values: FieldValues = {}
  const set = (name: string, value: string) => {
    if (!PDF_FIELD_BY_NAME.has(name)) {
      throw new Error(`Refusing to write unknown PDF field "${name}".`)
    }
    if (name === SIGNATURE_FIELD) {
      throw new Error('The driver signature field must never be populated.')
    }
    values[name] = value
  }

  /* ---- identification (page 1) ---- */
  set('driver_name', trip.driverName.trim())
  set('co_driver_name', trip.coDriver.trim())
  set('truck_number', trip.truckNumber.trim())
  set('trailer_number', trip.trailerNumber.trim())
  set('trip_number', trip.tripNumber.trim())
  set('beginning_odometer', totals.beginningOdometer === null ? '' : String(totals.beginningOdometer))
  set('ending_odometer', totals.endingOdometer === null ? '' : String(totals.endingOdometer))
  set('start_date', formatPdfDate(trip.startDate))
  set('end_date', formatPdfDate(trip.endDate))
  // PRO / BOL / tax reserve have no field on this form - deliberately omitted.

  /* ---- routes (page 1) ---- */
  const stops = [...trip.routes]
    .filter((row) => row.from.trim() || row.to.trim())
    .sort((a, b) => a.order - b.order)
  const routeSource =
    stops.length > 0
      ? stops
      : trip.origin.trim() || trip.destination.trim()
        ? [{ from: trip.origin, to: trip.destination }]
        : []
  for (let i = 1; i <= CAPACITY.routes; i++) {
    const stop = routeSource[i - 1]
    set(`route_${i}_from`, stop ? stop.from.trim() : '')
    set(`route_${i}_to`, stop ? stop.to.trim() : '')
  }

  /* ---- state miles (page 1) ---- */
  const states = trip.stateMiles.filter((row) => row.state.trim())
  for (let i = 1; i <= CAPACITY.stateMiles; i++) {
    const side = i <= CAPACITY.stateMilesPerColumn ? 'left' : 'right'
    const slot = i <= CAPACITY.stateMilesPerColumn ? i : i - CAPACITY.stateMilesPerColumn
    const row = states[i - 1]
    set(`${side}_state_${slot}`, row ? row.state.trim().toUpperCase() : '')
    set(`${side}_miles_${slot}`, row ? formatMiles(parseWhole(row.miles)) : '')
    set(`${side}_highways_${slot}`, row ? row.highways.trim() : '')
  }
  // The total is the sum of what was entered. It is never adjusted to agree
  // with the odometer; the difference is reported as a warning instead.
  set('left_state_miles_total', states.length > 0 ? formatMiles(totals.stateMilesTotal) : '')
  set('right_state_miles_total', '')

  /* ---- fuel (page 2) ---- */
  const fuelRows = trip.fuel.filter(
    (row) => row.seller.trim() || row.invoice.trim() || !isBlank(row.total),
  )
  for (let i = 1; i <= CAPACITY.fuel; i++) {
    const row = fuelRows[i - 1]
    const date = row ? splitIsoDate(row.date) : null
    set(`fuel_${i}_date_mm`, date?.mm ?? '')
    set(`fuel_${i}_date_dd`, date?.dd ?? '')
    set(`fuel_${i}_date_yy`, date?.yy ?? '')
    set(`fuel_${i}_state`, row ? row.state.trim().toUpperCase() : '')
    set(`fuel_${i}_invoice`, row ? row.invoice.trim() : '')
    set(`fuel_${i}_seller`, row ? row.seller.trim() : '')
    set(`fuel_${i}_truck_gallons`, row ? formatGallons(parseNumber(row.truckGallons)) : '')
    set(`fuel_${i}_reefer_gallons`, row ? formatGallons(parseNumber(row.reeferGallons)) : '')
    set(`fuel_${i}_def`, row ? formatGallons(parseNumber(row.defGallons)) : '')
    set(`fuel_${i}_total`, row ? optionalMoney(parseNumber(row.total)) : '')
  }
  set('fuel_total', optionalMoney(totals.fuelTotal))

  /* ---- expense summary (page 2) ---- */
  set('expense_scales', optionalMoney(categoryTotal(totals, 'Scales')))
  set('expense_tolls', optionalMoney(categoryTotal(totals, 'Tolls')))
  set('expense_repairs', optionalMoney(categoryTotal(totals, 'Repairs')))
  set('expense_lumpers', optionalMoney(categoryTotal(totals, 'Lumpers')))
  set('expense_other', buildOtherExpenseText(trip))
  set('expense_total', optionalMoney(totals.expenseTotal))

  /* ---- advances (page 2) ---- */
  const advanceRows = trip.advances.filter((row) => !isBlank(row.amount) || row.type.trim())
  for (let i = 1; i <= CAPACITY.advances; i++) {
    const row = advanceRows[i - 1]
    const date = row ? splitIsoDate(row.date) : null
    set(`advance_${i}_date_mm`, date?.mm ?? '')
    set(`advance_${i}_date_dd`, date?.dd ?? '')
    set(`advance_${i}_date_yy`, date?.yy ?? '')
    set(`advance_${i}_amount`, row ? optionalMoney(parseNumber(row.amount)) : '')
    set(`advance_${i}_type`, row ? row.type.trim() : '')
  }
  set('advance_total', optionalMoney(totals.advanceTotal))

  /* ---- driver pay (page 2) ---- */
  // Mileage pay and total pay print even when zero, matching the paper form.
  set('total_miles_pay', totals.mileagePay === null ? '' : formatMoney(totals.mileagePay))
  set('total_extra_stops_pay', optionalMoney(totals.extraStopPay))
  set('total_layover_pay', optionalMoney(totals.layoverPay))
  set('total_money_received', optionalMoney(totals.advanceTotal))
  set('total_money_spent', optionalMoney(totals.expenseTotal))
  set('money_left_on_hand', optionalMoney(totals.moneyLeftOnHand))
  set('total_pay_to_driver', totals.settlementPay === null ? '' : formatMoney(totals.settlementPay))

  // The signature field exists on the form but is never given a value.
  return values
}

export function settlementFileName(trip: Trip, kind: 'flattened' | 'fillable'): string {
  const driver = sanitise(trip.driverName) || 'Driver'
  const number = sanitise(trip.tripNumber) || 'Trip'
  const suffix = kind === 'fillable' ? '_Settlement_Fillable' : '_Settlement'
  return `${driver}_Trip_${number}${suffix}.pdf`
}

function sanitise(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
}
