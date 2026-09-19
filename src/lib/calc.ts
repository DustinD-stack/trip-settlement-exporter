/**
 * Trip calculations.
 *
 * Rules (from the original workbook and exporter):
 *   actual miles       = ending odometer - beginning odometer
 *   mileage pay        = paid miles x mileage rate
 *   gross pay          = mileage pay + extra-stop + layover + other
 *   tax reserve        = gross pay x tax-reserve rate
 *   estimated net pay  = gross pay + reimbursements - advances - tax reserve
 *
 * Nothing here ever adjusts a number the driver entered. Odometer miles, state
 * miles, paid miles, expenses, reimbursements and advances are reported exactly
 * as entered; discrepancies surface as warnings, never as corrections.
 */
import {
  multiplyMoney,
  parseNumber,
  parseWhole,
  roundMoney,
  sumMoney,
} from './money'
import { PRINTED_EXPENSE_CATEGORIES, type ExpenseCategory, type Trip } from '../types'

export interface TripTotals {
  /** null means the driver has not entered the value yet. */
  beginningOdometer: number | null
  endingOdometer: number | null
  actualMiles: number | null
  paidMiles: number | null
  mileageRate: number | null
  mileagePay: number | null

  extraStopPay: number
  layoverPay: number
  otherPay: number
  grossPay: number | null

  stateMilesTotal: number
  /** state miles - actual miles. null while the odometer is incomplete. */
  stateMilesDifference: number | null
  /** paid miles - actual miles. */
  paidMilesDifference: number | null

  fuelTotal: number
  expenseTotal: number
  reimbursementTotal: number
  advanceTotal: number
  expensesByCategory: Record<string, number>
  /** Parking + Supplies + Other + uncategorised, which share the printed "OTHER" rule. */
  otherExpenseTotal: number
  moneyLeftOnHand: number

  taxReserveRate: number
  taxReserve: number | null
  estimatedNetPay: number | null

  /** Gross + reimbursements - advances. What the printed form calls total pay. */
  settlementPay: number | null
}

export function calculateTrip(trip: Trip): TripTotals {
  const beginningOdometer = parseWhole(trip.beginningOdometer)
  const endingOdometer = parseWhole(trip.endingOdometer)
  const actualMiles =
    beginningOdometer !== null && endingOdometer !== null
      ? endingOdometer - beginningOdometer
      : null

  const paidMiles = parseWhole(trip.paidMiles)
  const mileageRate = parseNumber(trip.mileageRate)
  const mileagePay =
    paidMiles !== null && mileageRate !== null ? multiplyMoney(paidMiles, mileageRate) : null

  const extraStopPay = roundMoney(parseNumber(trip.extraStopPay) ?? 0)
  const layoverPay = roundMoney(parseNumber(trip.layoverPay) ?? 0)
  const otherPay = roundMoney(parseNumber(trip.otherPay) ?? 0)
  const grossPay =
    mileagePay === null ? null : sumMoney([mileagePay, extraStopPay, layoverPay, otherPay])

  const stateMilesTotal = trip.stateMiles.reduce(
    (sum, row) => sum + (parseWhole(row.miles) ?? 0),
    0,
  )
  const stateMilesDifference = actualMiles === null ? null : stateMilesTotal - actualMiles
  const paidMilesDifference =
    actualMiles === null || paidMiles === null ? null : paidMiles - actualMiles

  const fuelTotal = sumMoney(trip.fuel.map((row) => parseNumber(row.total)))
  const expenseTotal = sumMoney(trip.expenses.map((row) => parseNumber(row.amount)))
  const reimbursementTotal = sumMoney(trip.expenses.map((row) => parseNumber(row.reimbursement)))
  const advanceTotal = sumMoney(trip.advances.map((row) => parseNumber(row.amount)))

  const expensesByCategory: Record<string, number> = {}
  for (const row of trip.expenses) {
    const amount = parseNumber(row.amount)
    if (amount === null) continue
    const key = row.category || 'Other'
    expensesByCategory[key] = sumMoney([expensesByCategory[key], amount])
  }
  const printed = new Set<string>(PRINTED_EXPENSE_CATEGORIES)
  const otherExpenseTotal = sumMoney(
    Object.entries(expensesByCategory)
      .filter(([category]) => !printed.has(category))
      .map(([, amount]) => amount),
  )

  const moneyLeftOnHand = sumMoney([advanceTotal, -expenseTotal])

  const taxReserveRate = parseNumber(trip.taxReserveRate) ?? 0
  const taxReserve = grossPay === null ? null : multiplyMoney(grossPay, taxReserveRate)
  const estimatedNetPay =
    grossPay === null || taxReserve === null
      ? null
      : sumMoney([grossPay, reimbursementTotal, -advanceTotal, -taxReserve])

  const settlementPay =
    grossPay === null ? null : sumMoney([grossPay, reimbursementTotal, -advanceTotal])

  return {
    beginningOdometer,
    endingOdometer,
    actualMiles,
    paidMiles,
    mileageRate,
    mileagePay,
    extraStopPay,
    layoverPay,
    otherPay,
    grossPay,
    stateMilesTotal,
    stateMilesDifference,
    paidMilesDifference,
    fuelTotal,
    expenseTotal,
    reimbursementTotal,
    advanceTotal,
    expensesByCategory,
    otherExpenseTotal,
    moneyLeftOnHand,
    taxReserveRate,
    taxReserve,
    estimatedNetPay,
    settlementPay,
  }
}

/** Amount for one printed expense rule, or 0. */
export function categoryTotal(totals: TripTotals, category: ExpenseCategory): number {
  return totals.expensesByCategory[category] ?? 0
}

/** Weekly roll-up across a set of trips. */
export interface WeekTotals {
  trips: number
  completeTrips: number
  paidMiles: number
  actualMiles: number
  stateMiles: number
  grossPay: number
  reimbursements: number
  expenses: number
  advances: number
  taxReserve: number
  estimatedNetPay: number
}

export function calculateWeek(trips: Trip[]): WeekTotals {
  const all = trips.map(calculateTrip)
  return {
    trips: trips.length,
    completeTrips: trips.filter((t) => t.complete).length,
    paidMiles: all.reduce((s, t) => s + (t.paidMiles ?? 0), 0),
    actualMiles: all.reduce((s, t) => s + (t.actualMiles ?? 0), 0),
    stateMiles: all.reduce((s, t) => s + t.stateMilesTotal, 0),
    grossPay: sumMoney(all.map((t) => t.grossPay)),
    reimbursements: sumMoney(all.map((t) => t.reimbursementTotal)),
    expenses: sumMoney(all.map((t) => t.expenseTotal)),
    advances: sumMoney(all.map((t) => t.advanceTotal)),
    taxReserve: sumMoney(all.map((t) => t.taxReserve)),
    estimatedNetPay: sumMoney(all.map((t) => t.estimatedNetPay)),
  }
}
