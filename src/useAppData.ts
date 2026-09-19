/** Loads, holds and persists all app state. One store, no context gymnastics. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { emptyData, loadData, saveData } from './lib/storage'
import { touch } from './lib/trips'
import type { AppData, ExportRecord, Settings, Trip } from './types'

export function useAppData() {
  const [data, setData] = useState<AppData>(emptyData)
  const [ready, setReady] = useState(false)
  const loaded = useRef(false)

  useEffect(() => {
    let cancelled = false
    loadData().then((stored) => {
      if (cancelled) return
      setData(stored)
      loaded.current = true
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Persist after every change, but never before the initial load has landed
  // (that would write an empty store over real data).
  useEffect(() => {
    if (!loaded.current) return
    const timer = setTimeout(() => {
      void saveData(data)
    }, 150)
    return () => clearTimeout(timer)
  }, [data])

  const updateTrip = useCallback((id: string, change: (trip: Trip) => Trip) => {
    setData((current) => ({
      ...current,
      trips: current.trips.map((trip) => (trip.id === id ? touch(change(trip)) : trip)),
    }))
  }, [])

  const addTrip = useCallback((trip: Trip) => {
    setData((current) => ({ ...current, trips: [...current.trips, trip], selectedTripId: trip.id }))
  }, [])

  const deleteTrip = useCallback((id: string) => {
    setData((current) => {
      const trips = current.trips.filter((trip) => trip.id !== id)
      return {
        ...current,
        trips,
        selectedTripId: current.selectedTripId === id ? (trips[0]?.id ?? null) : current.selectedTripId,
        exportHistory: current.exportHistory.filter((record) => record.tripId !== id),
      }
    })
  }, [])

  const selectTrip = useCallback((id: string | null) => {
    setData((current) => ({ ...current, selectedTripId: id }))
  }, [])

  const updateSettings = useCallback((change: Partial<Settings>) => {
    setData((current) => ({ ...current, settings: { ...current.settings, ...change } }))
  }, [])

  const recordExport = useCallback((record: ExportRecord) => {
    setData((current) => ({
      ...current,
      exportHistory: [record, ...current.exportHistory].slice(0, 200),
    }))
  }, [])

  const replaceAll = useCallback((next: AppData) => {
    setData(next)
  }, [])

  const selectedTrip = useMemo(
    () => data.trips.find((trip) => trip.id === data.selectedTripId) ?? null,
    [data.trips, data.selectedTripId],
  )

  return {
    data,
    ready,
    selectedTrip,
    addTrip,
    updateTrip,
    deleteTrip,
    selectTrip,
    updateSettings,
    recordExport,
    replaceAll,
  }
}

export type AppStore = ReturnType<typeof useAppData>
