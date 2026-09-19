import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { exportWorkbook, importWorkbook, toIsoDate } from '../src/lib/excel'
import { calculateTrip } from '../src/lib/calc'
import { createTrip39586Fixture } from '../src/lib/fixtures'
import { emptyData } from '../src/lib/storage'
import type { AppData } from '../src/types'

const WORKBOOK = path.resolve(__dirname, '..', 'reference', 'Dustin_Weekly_Trip_Pay_Calculator.xlsx')

function importOriginal(): AppData {
  const file = fs.readFileSync(WORKBOOK)
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  return importWorkbook(buffer as ArrayBuffer).data
}

describe('date conversion', () => {
  it('handles Excel serials, ISO text and slashed dates', () => {
    expect(toIsoDate(46280)).toBe('2026-09-15')
    expect(toIsoDate('2026-09-15')).toBe('2026-09-15')
    expect(toIsoDate('9/15/2026')).toBe('2026-09-15')
    expect(toIsoDate('9/15/26')).toBe('2026-09-15')
    expect(toIsoDate('')).toBe('')
    expect(toIsoDate(null)).toBe('')
  })
})

describe('importing the supplied workbook', () => {
  const data = importOriginal()

  it('reads the driver and defaults from the header', () => {
    expect(data.settings.defaultDriverName).toBe('Dustin Douglas')
    expect(data.settings.defaultMileageRate).toBe('0.8')
    expect(data.settings.defaultTaxReserveRate).toBe('0.25')
  })

  it('reads trip 39586 with its PRO and BOL split apart', () => {
    expect(data.trips).toHaveLength(1)
    const trip = data.trips[0]
    expect(trip.tripNumber).toBe('39586')
    expect(trip.proNumber).toBe('38522')
    expect(trip.bolNumber).toBe('935202874')
    expect(trip.truckNumber).toBe('146')
    expect(trip.trailerNumber).toBe('2016')
    expect(trip.startDate).toBe('2026-09-15')
    expect(trip.endDate).toBe('2026-09-18')
    expect(trip.beginningOdometer).toBe('289703')
    expect(trip.endingOdometer).toBe('291726')
    expect(trip.paidMiles).toBe('2068')
    expect(trip.mileageRate).toBe('0.8')
  })

  it('reproduces the workbook figures after import', () => {
    const totals = calculateTrip(data.trips[0])
    expect(totals.actualMiles).toBe(2023)
    expect(totals.mileagePay).toBe(1654.4)
    expect(totals.grossPay).toBe(1654.4)
    expect(totals.taxReserve).toBe(413.6)
    expect(totals.estimatedNetPay).toBe(1240.8)
    expect(totals.stateMilesTotal).toBe(2068)
    expect(totals.stateMilesDifference).toBe(45)
  })

  it('reads the route, all eight state rows and the expense', () => {
    const trip = data.trips[0]
    expect(trip.routes).toHaveLength(1)
    expect(trip.routes[0].from).toBe('3950 E Airport Dr Ontario, CA 91761')

    expect(trip.stateMiles.map((row) => row.state)).toEqual(['CA', 'NV', 'AZ', 'UT', 'CO', 'NE', 'IA', 'IL'])
    expect(trip.stateMiles[0].miles).toBe('287')
    expect(trip.stateMiles[7].highways).toBe('I-80, I-39, US-20, IL-47')

    expect(trip.expenses).toHaveLength(1)
    expect(trip.expenses[0].description).toBe('Walmart pliers')
    expect(trip.expenses[0].category).toBe('Supplies')
    // The blank amount must stay blank, not become zero.
    expect(trip.expenses[0].amount).toBe('')
  })

  it('does not import the same trip number twice', () => {
    const file = fs.readFileSync(WORKBOOK)
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
    const second = importWorkbook(buffer as ArrayBuffer, data)
    expect(second.data.trips).toHaveLength(1)
    expect(second.messages.join(' ')).toContain('Skipped 1')
  })
})

describe('exporting a workbook', () => {
  function dataWithFixture(): AppData {
    const base = emptyData()
    base.settings.defaultDriverName = 'Dustin Douglas'
    base.trips = [createTrip39586Fixture()]
    return base
  }

  it('produces every required sheet', () => {
    const bytes = exportWorkbook(dataWithFixture())
    const reimported = importWorkbook(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    )
    expect(reimported.data.trips).toHaveLength(1)
  })

  it('round-trips a trip without losing or inventing values', () => {
    const bytes = exportWorkbook(dataWithFixture())
    const round = importWorkbook(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    ).data.trips[0]

    expect(round.tripNumber).toBe('39586')
    expect(round.proNumber).toBe('38522')
    expect(round.bolNumber).toBe('935202874')
    expect(round.beginningOdometer).toBe('289703')
    expect(round.endingOdometer).toBe('291726')
    expect(round.paidMiles).toBe('2068')
    expect(round.stateMiles).toHaveLength(8)
    expect(round.routes).toHaveLength(1)
    expect(round.expenses[0].description).toBe('Walmart pliers')
    expect(round.expenses[0].amount).toBe('')

    const totals = calculateTrip(round)
    expect(totals.mileagePay).toBe(1654.4)
    expect(totals.stateMilesDifference).toBe(45)
  })

  it('documents the PDF field mapping and the fields the form lacks', async () => {
    const XLSX = await import('xlsx')
    const bytes = exportWorkbook(dataWithFixture())
    const workbook = XLSX.read(bytes, { type: 'array' })
    expect(workbook.SheetNames).toEqual([
      'Weekly Pay', 'Routes', 'State Miles', 'Fuel & DEF',
      'Expenses', 'Advances', 'PDF Field Mapping', 'PDF Export Instructions',
    ])
    const mapping = XLSX.utils.sheet_to_csv(workbook.Sheets['PDF Field Mapping'])
    expect(mapping).toContain('total_pay_to_driver')
    expect(mapping).toContain('left_state_miles_total')
    expect(mapping).toContain('proNumber')
    expect(mapping).toContain('taxReserve')
  })
})
