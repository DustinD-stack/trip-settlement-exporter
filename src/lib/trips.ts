/** Trip creation, duplication and row helpers shared by the screens. */
import type {
  AdvanceRow,
  ExpenseRow,
  FuelRow,
  RouteStop,
  Settings,
  StateMileRow,
  Trip,
} from '../types'

export const newId = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`

export function createTrip(settings: Settings): Trip {
  const now = new Date().toISOString()
  return {
    id: newId(),
    driverName: settings.defaultDriverName,
    coDriver: settings.defaultCoDriver,
    truckNumber: settings.defaultTruckNumber,
    trailerNumber: settings.defaultTrailerNumber,
    tripNumber: '',
    proNumber: '',
    bolNumber: '',
    startDate: '',
    endDate: '',
    origin: '',
    destination: '',
    beginningOdometer: '',
    endingOdometer: '',
    paidMiles: '',
    mileageRate: settings.defaultMileageRate,
    extraStopPay: '',
    layoverPay: '',
    otherPay: '',
    taxReserveRate: settings.defaultTaxReserveRate,
    notes: '',
    complete: false,
    routes: [],
    stateMiles: [],
    fuel: [],
    expenses: [],
    advances: [],
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Copies a trip as a starting point. Everything that identifies the trip or
 * measures it is cleared: only the reusable setup carries over, so a duplicate
 * can never quietly inherit the previous trip's odometer or miles.
 */
export function duplicateTrip(trip: Trip): Trip {
  const now = new Date().toISOString()
  return {
    ...trip,
    id: newId(),
    tripNumber: '',
    proNumber: '',
    bolNumber: '',
    startDate: '',
    endDate: '',
    beginningOdometer: '',
    endingOdometer: '',
    paidMiles: '',
    extraStopPay: '',
    layoverPay: '',
    otherPay: '',
    notes: '',
    complete: false,
    routes: trip.routes.map((row) => ({ ...row, id: newId() })),
    stateMiles: trip.stateMiles.map((row) => ({ ...row, id: newId(), miles: '' })),
    fuel: [],
    expenses: [],
    advances: [],
    createdAt: now,
    updatedAt: now,
  }
}

export const emptyRoute = (order: number): RouteStop => ({
  id: newId(),
  order,
  type: '',
  from: '',
  to: '',
  isPickup: false,
  isDelivery: false,
  notes: '',
})

export const emptyStateMile = (): StateMileRow => ({
  id: newId(),
  state: '',
  miles: '',
  highways: '',
})

export const emptyFuel = (): FuelRow => ({
  id: newId(),
  date: '',
  state: '',
  invoice: '',
  seller: '',
  truckGallons: '',
  reeferGallons: '',
  defGallons: '',
  total: '',
})

export const emptyExpense = (): ExpenseRow => ({
  id: newId(),
  date: '',
  category: '',
  description: '',
  state: '',
  receipt: '',
  amount: '',
  reimbursement: '',
})

export const emptyAdvance = (): AdvanceRow => ({
  id: newId(),
  date: '',
  amount: '',
  type: '',
  notes: '',
})

/** Moves a stop up or down and renumbers the whole list. */
export function reorderStops(stops: RouteStop[], id: string, direction: -1 | 1): RouteStop[] {
  const sorted = [...stops].sort((a, b) => a.order - b.order)
  const index = sorted.findIndex((stop) => stop.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= sorted.length) return stops
  ;[sorted[index], sorted[target]] = [sorted[target], sorted[index]]
  return sorted.map((stop, position) => ({ ...stop, order: position + 1 }))
}

export function touch(trip: Trip): Trip {
  return { ...trip, updatedAt: new Date().toISOString() }
}
