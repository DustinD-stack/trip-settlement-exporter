/**
 * Export validation.
 *
 * Errors block the export outright. Warnings require an explicit confirmation
 * that shows the original numbers and the exact differences - the app never
 * "fixes" a discrepancy on the driver's behalf.
 */
import { CAPACITY } from '../config/pdfFieldMapping'
import { calculateTrip, type TripTotals } from './calc'
import { formatMiles, formatMoney, formatSignedMiles, isBlank, parseNumber } from './money'
import type { Trip } from '../types'

export interface Issue {
  code: string
  message: string
  /** Shown on the confirmation screen so the driver sees the raw numbers. */
  detail?: string
}

export interface ValidationResult {
  errors: Issue[]
  warnings: Issue[]
  canExport: boolean
  totals: TripTotals
}

export function validateTripForExport(trip: Trip): ValidationResult {
  const totals = calculateTrip(trip)
  const errors: Issue[] = []
  const warnings: Issue[] = []

  /* ---------------- blocking errors ---------------- */

  if (!trip.tripNumber.trim()) {
    errors.push({ code: 'trip-number-missing', message: 'Trip number is required.' })
  }
  if (isBlank(trip.beginningOdometer)) {
    errors.push({ code: 'begin-odo-missing', message: 'Beginning odometer is required.' })
  }
  if (isBlank(trip.endingOdometer)) {
    errors.push({ code: 'end-odo-missing', message: 'Ending odometer is required.' })
  }
  if (
    totals.beginningOdometer !== null &&
    totals.endingOdometer !== null &&
    totals.endingOdometer < totals.beginningOdometer
  ) {
    errors.push({
      code: 'odometer-reversed',
      message: 'Ending odometer is lower than the beginning odometer.',
      detail: `Beginning ${formatMiles(totals.beginningOdometer)}, ending ${formatMiles(
        totals.endingOdometer,
      )}.`,
    })
  }
  if (isBlank(trip.paidMiles)) {
    errors.push({ code: 'paid-miles-missing', message: 'Paid miles are required.' })
  }
  if (isBlank(trip.mileageRate)) {
    errors.push({ code: 'rate-missing', message: 'Mileage rate is required.' })
  } else if ((totals.mileageRate ?? 0) <= 0) {
    errors.push({
      code: 'rate-invalid',
      message: 'Mileage rate must be greater than zero.',
      detail: `Entered rate: ${trip.mileageRate}.`,
    })
  }
  if (trip.stateMiles.filter((row) => row.state.trim()).length === 0) {
    errors.push({
      code: 'state-miles-missing',
      message: 'At least one state-mile row is required.',
    })
  }

  /* ---------------- warnings requiring confirmation ---------------- */

  if (totals.stateMilesDifference !== null && totals.stateMilesDifference !== 0) {
    warnings.push({
      code: 'state-miles-differ',
      message: `State miles differ from actual odometer miles by ${formatSignedMiles(
        totals.stateMilesDifference,
      )}.`,
      detail: `State miles ${formatMiles(totals.stateMilesTotal)} vs actual odometer miles ${formatMiles(
        totals.actualMiles,
      )} (ending ${formatMiles(totals.endingOdometer)} - beginning ${formatMiles(
        totals.beginningOdometer,
      )}). Neither number will be changed.`,
    })
  }

  if (totals.paidMilesDifference !== null && totals.paidMilesDifference !== 0) {
    warnings.push({
      code: 'paid-miles-differ',
      message: `Paid miles differ from actual odometer miles by ${formatSignedMiles(
        totals.paidMilesDifference,
      )}.`,
      detail: `Paid miles ${formatMiles(totals.paidMiles)} vs actual odometer miles ${formatMiles(
        totals.actualMiles,
      )}. Neither number will be changed.`,
    })
  }

  for (const row of trip.expenses) {
    const label = row.description.trim() || row.category || 'expense'
    if (row.description.trim() && isBlank(row.amount)) {
      warnings.push({
        code: 'expense-amount-missing',
        message: `Expense amount is missing: ${label}.`,
        detail: 'The amount will be left blank on the settlement PDF.',
      })
    }
    if ((parseNumber(row.amount) ?? 0) > 0 && !row.receipt.trim()) {
      warnings.push({
        code: 'expense-receipt-missing',
        message: `Receipt number is missing for: ${label}.`,
        detail: `Amount ${formatMoney(parseNumber(row.amount))}.`,
      })
    }
  }

  for (const row of trip.fuel) {
    if ((parseNumber(row.total) ?? 0) > 0 && !row.invoice.trim()) {
      warnings.push({
        code: 'fuel-invoice-missing',
        message: `Invoice number is missing for fuel from ${row.seller.trim() || 'an unnamed seller'}.`,
        detail: `Amount ${formatMoney(parseNumber(row.total))}.`,
      })
    }
  }

  /* ---------------- capacity warnings ---------------- */

  const overflow = (count: number, limit: number, label: string, code: string) => {
    if (count > limit) {
      warnings.push({
        code,
        message: `${count} ${label} entered, but the printed form has room for ${limit}.`,
        detail: `Entries ${limit + 1}-${count} will not appear on the PDF. They stay in the app and in the Excel export; nothing is deleted.`,
      })
    }
  }
  overflow(trip.routes.filter((r) => r.from.trim() || r.to.trim()).length, CAPACITY.routes, 'route stops', 'routes-overflow')
  overflow(trip.stateMiles.filter((r) => r.state.trim()).length, CAPACITY.stateMiles, 'state-mile rows', 'state-miles-overflow')
  overflow(trip.fuel.filter((r) => r.seller.trim() || !isBlank(r.total)).length, CAPACITY.fuel, 'fuel entries', 'fuel-overflow')
  overflow(trip.advances.filter((r) => !isBlank(r.amount) || r.type.trim()).length, CAPACITY.advances, 'advance rows', 'advances-overflow')

  const otherText = buildOtherExpenseText(trip)
  if (otherText.length > CAPACITY.otherExpenseChars) {
    warnings.push({
      code: 'other-expense-too-long',
      message: 'The combined "Other" expense description is too long for the printed rule.',
      detail: `"${otherText}" is ${otherText.length} characters; about ${CAPACITY.otherExpenseChars} fit. It will be shortened on the PDF only - the full text stays in the app and the Excel export.`,
    })
  }

  return { errors, warnings, canExport: errors.length === 0, totals }
}

/**
 * Parking, Supplies, Other and uncategorised expenses share the form's single
 * "OTHER $:" rule. Each is rendered as "description amount".
 */
export function buildOtherExpenseText(trip: Trip): string {
  const printed = new Set(['Scales', 'Tolls', 'Repairs', 'Lumpers'])
  return trip.expenses
    .filter((row) => !printed.has(row.category || 'Other'))
    .filter((row) => row.description.trim() || !isBlank(row.amount))
    .map((row) => {
      const label = row.description.trim() || row.category || 'Other'
      const amount = formatMoney(parseNumber(row.amount))
      return amount ? `${label} ${amount}` : label
    })
    .join('; ')
}
