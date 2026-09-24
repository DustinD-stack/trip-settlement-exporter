/** Domain model. Everything is stored locally; nothing leaves the browser. */

export const EXPENSE_CATEGORIES = [
  'Scales',
  'Tolls',
  'Repairs',
  'Lumpers',
  'Parking',
  'Supplies',
  'Other',
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

/** Categories the printed form has a dedicated rule for. */
export const PRINTED_EXPENSE_CATEGORIES = ['Scales', 'Tolls', 'Repairs', 'Lumpers'] as const

export const STOP_TYPES = [
  'Pickup',
  'Delivery',
  'Pickup to delivery',
  'Fuel stop',
  'Relay',
  'Other',
] as const

export type StopType = (typeof STOP_TYPES)[number]

/**
 * Money and mileage are held as strings exactly as typed, so an empty field
 * stays empty (and is reported as missing) instead of silently becoming 0.
 */
export type NumericInput = string

export interface RouteStop {
  id: string
  order: number
  type: StopType | ''
  from: string
  to: string
  isPickup: boolean
  isDelivery: boolean
  notes: string
}

export interface StateMileRow {
  id: string
  state: string
  miles: NumericInput
  highways: string
}

export interface FuelRow {
  id: string
  /** ISO yyyy-mm-dd, or '' */
  date: string
  state: string
  invoice: string
  seller: string
  truckGallons: NumericInput
  reeferGallons: NumericInput
  defGallons: NumericInput
  total: NumericInput
}

export interface ExpenseRow {
  id: string
  date: string
  category: ExpenseCategory | ''
  description: string
  state: string
  receipt: string
  amount: NumericInput
  reimbursement: NumericInput
}

export interface AdvanceRow {
  id: string
  date: string
  amount: NumericInput
  type: string
  notes: string
}

export interface Trip {
  id: string
  driverName: string
  coDriver: string
  truckNumber: string
  trailerNumber: string
  tripNumber: string
  proNumber: string
  bolNumber: string
  /** ISO yyyy-mm-dd */
  startDate: string
  endDate: string
  origin: string
  destination: string
  beginningOdometer: NumericInput
  endingOdometer: NumericInput
  paidMiles: NumericInput
  mileageRate: NumericInput
  extraStopPay: NumericInput
  layoverPay: NumericInput
  otherPay: NumericInput
  taxReserveRate: NumericInput
  notes: string
  complete: boolean
  routes: RouteStop[]
  stateMiles: StateMileRow[]
  fuel: FuelRow[]
  expenses: ExpenseRow[]
  advances: AdvanceRow[]
  createdAt: string
  updatedAt: string
}

export interface Settings {
  defaultDriverName: string
  defaultCoDriver: string
  defaultTruckNumber: string
  defaultTrailerNumber: string
  defaultMileageRate: NumericInput
  defaultTaxReserveRate: NumericInput
  weekStarting: string
}

export interface ExportRecord {
  id: string
  tripId: string
  tripNumber: string
  /** ISO timestamp */
  exportedAt: string
  kind: 'flattened' | 'fillable'
  fileName: string
  /** Set when the trip went out as part of a combined Monday envelope. */
  envelopeDate?: string
}

export interface AppData {
  version: 1
  settings: Settings
  trips: Trip[]
  exportHistory: ExportRecord[]
  selectedTripId: string | null
}
