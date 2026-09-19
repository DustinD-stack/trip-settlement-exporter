/**
 * Local persistence. IndexedDB is the store of record, with a localStorage
 * mirror so the app still works in private windows and when IndexedDB is
 * blocked. Nothing is ever sent anywhere.
 */
import type { AppData, Settings, Trip } from '../types'

const DB_NAME = 'trip-settlement'
const DB_VERSION = 1
const STORE = 'app'
const KEY = 'data'
const MIRROR_KEY = 'trip-settlement:data'

export const DEFAULT_SETTINGS: Settings = {
  defaultDriverName: '',
  defaultCoDriver: 'N/A',
  defaultTruckNumber: '',
  defaultTrailerNumber: '',
  defaultMileageRate: '',
  defaultTaxReserveRate: '0.25',
  weekStarting: '',
}

export function emptyData(): AppData {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    trips: [],
    exportHistory: [],
    selectedTripId: null,
  }
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      return resolve(null)
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

export async function loadData(): Promise<AppData> {
  const db = await openDb()
  if (db) {
    const stored = await new Promise<AppData | null>((resolve) => {
      try {
        const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
        request.onsuccess = () => resolve((request.result as AppData) ?? null)
        request.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
    db.close()
    if (stored) return migrate(stored)
  }
  try {
    const raw = localStorage.getItem(MIRROR_KEY)
    if (raw) return migrate(JSON.parse(raw) as AppData)
  } catch {
    /* storage unavailable */
  }
  return emptyData()
}

export async function saveData(data: AppData): Promise<void> {
  const db = await openDb()
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).put(data, KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
        tx.onabort = () => resolve()
      } catch {
        resolve()
      }
    })
    db.close()
  }
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(data))
  } catch {
    /* quota or private mode - IndexedDB copy still stands */
  }
}

export async function clearData(): Promise<void> {
  const db = await openDb()
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).delete(KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      } catch {
        resolve()
      }
    })
    db.close()
  }
  try {
    localStorage.removeItem(MIRROR_KEY)
  } catch {
    /* ignore */
  }
}

/** Fills in anything a older/partial backup is missing. */
export function migrate(data: Partial<AppData>): AppData {
  const base = emptyData()
  return {
    version: 1,
    settings: { ...base.settings, ...(data.settings ?? {}) },
    trips: (data.trips ?? []).map(normaliseTrip),
    exportHistory: data.exportHistory ?? [],
    selectedTripId: data.selectedTripId ?? null,
  }
}

function normaliseTrip(trip: Partial<Trip>): Trip {
  return {
    id: trip.id ?? crypto.randomUUID(),
    driverName: trip.driverName ?? '',
    coDriver: trip.coDriver ?? '',
    truckNumber: trip.truckNumber ?? '',
    trailerNumber: trip.trailerNumber ?? '',
    tripNumber: trip.tripNumber ?? '',
    proNumber: trip.proNumber ?? '',
    bolNumber: trip.bolNumber ?? '',
    startDate: trip.startDate ?? '',
    endDate: trip.endDate ?? '',
    origin: trip.origin ?? '',
    destination: trip.destination ?? '',
    beginningOdometer: trip.beginningOdometer ?? '',
    endingOdometer: trip.endingOdometer ?? '',
    paidMiles: trip.paidMiles ?? '',
    mileageRate: trip.mileageRate ?? '',
    extraStopPay: trip.extraStopPay ?? '',
    layoverPay: trip.layoverPay ?? '',
    otherPay: trip.otherPay ?? '',
    taxReserveRate: trip.taxReserveRate ?? '',
    notes: trip.notes ?? '',
    complete: trip.complete ?? false,
    routes: trip.routes ?? [],
    stateMiles: trip.stateMiles ?? [],
    fuel: trip.fuel ?? [],
    expenses: trip.expenses ?? [],
    advances: trip.advances ?? [],
    createdAt: trip.createdAt ?? new Date().toISOString(),
    updatedAt: trip.updatedAt ?? new Date().toISOString(),
  }
}

/* ---------------- JSON backup and restore ---------------- */

export function toBackupJson(data: AppData): string {
  return JSON.stringify(
    { format: 'trip-settlement-backup', version: 1, exportedAt: new Date().toISOString(), data },
    null,
    2,
  )
}

export function fromBackupJson(text: string): AppData {
  const parsed = JSON.parse(text) as { data?: Partial<AppData> } & Partial<AppData>
  const payload = parsed.data ?? parsed
  if (!payload || !Array.isArray(payload.trips)) {
    throw new Error('That file is not a trip-settlement backup.')
  }
  return migrate(payload)
}
