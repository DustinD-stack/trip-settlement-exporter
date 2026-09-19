/**
 * Excel import and export, entirely in the browser via SheetJS.
 *
 * The workbook layout matches `Dustin_Weekly_Trip_Pay_Calculator.xlsx`, so the
 * existing workbook imports directly and the export can be opened by the same
 * spreadsheet. Sheets: Weekly Pay, Routes, State Miles, Fuel & DEF, Expenses,
 * Advances, PDF Field Mapping, PDF Export Instructions.
 *
 * Import never invents values. A blank cell stays blank, so the app reports it
 * as missing rather than treating it as zero.
 */
import * as XLSX from 'xlsx'
import { CAPACITY, FIELDS_WITHOUT_PDF_EQUIVALENT, PDF_FIELDS } from '../config/pdfFieldMapping'
import { calculateTrip } from './calc'
import { formatPercent } from './money'
import { EXPENSE_CATEGORIES, type AppData, type ExpenseCategory, type Trip } from '../types'
import { emptyData } from './storage'

const SHEETS = {
  weekly: 'Weekly Pay',
  routes: 'Routes',
  stateMiles: 'State Miles',
  fuel: 'Fuel & DEF',
  expenses: 'Expenses',
  advances: 'Advances',
  mapping: 'PDF Field Mapping',
  instructions: 'PDF Export Instructions',
} as const

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`

/* ------------------------------------------------------------------ *
 * shared cell helpers
 * ------------------------------------------------------------------ */

type Row = unknown[]

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return String(value)
  return String(value).trim()
}

/** Keeps a numeric cell as the text the user would have typed, or ''. */
function numericText(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  const cleaned = String(value).replace(/[$,\s]/g, '')
  return cleaned === '' ? '' : cleaned
}

/** Excel serial date, Date, or text -> ISO yyyy-mm-dd, or ''. */
export function toIsoDate(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (value instanceof Date) return dateToIso(value)
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (!parsed) return ''
    return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(
      parsed.d,
    ).padStart(2, '0')}`
  }
  const raw = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(raw)
  if (slash) {
    const [, m, d, y] = slash
    const year = y.length === 2 ? `20${y}` : y
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? '' : dateToIso(parsed)
}

function dateToIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`
}

/** Matches trip numbers the way the original exporter did (ignoring padding). */
function sameTrip(a: unknown, b: unknown): boolean {
  const left = text(a).replace(/^0+/, '')
  const right = text(b).replace(/^0+/, '')
  return left !== '' && left === right
}

function sheetRows(workbook: XLSX.WorkBook, name: string): Row[] {
  const sheet = workbook.Sheets[name]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json<Row>(sheet, { header: 1, raw: true, blankrows: true, defval: null })
}

/** Finds the header row by looking for a known column name. */
function findHeader(rows: Row[], marker: string): number {
  const wanted = marker.toLowerCase()
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    if ((rows[i] ?? []).some((cell) => text(cell).toLowerCase() === wanted)) return i
  }
  return -1
}

function columnIndex(header: Row, ...names: string[]): number {
  const wanted = names.map((n) => n.toLowerCase())
  for (let i = 0; i < header.length; i++) {
    if (wanted.includes(text(header[i]).toLowerCase())) return i
  }
  return -1
}

/* ------------------------------------------------------------------ *
 * import
 * ------------------------------------------------------------------ */

export interface ImportResult {
  data: AppData
  messages: string[]
}

export function importWorkbook(buffer: ArrayBuffer, existing?: AppData): ImportResult {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const messages: string[] = []
  const base = existing ?? emptyData()
  const data: AppData = { ...base, trips: [...base.trips] }

  const weekly = sheetRows(workbook, SHEETS.weekly)
  if (weekly.length === 0) {
    throw new Error(`The workbook has no "${SHEETS.weekly}" sheet.`)
  }

  // Driver, week, default rate and tax reserve live above the trip table.
  const settings = { ...data.settings }
  for (const row of weekly.slice(0, 6)) {
    for (let i = 0; i < (row ?? []).length; i++) {
      const label = text(row[i]).toLowerCase()
      if (label === 'driver' && text(row[i + 1])) settings.defaultDriverName = text(row[i + 1])
      if (label === 'week starting' && row[i + 1] != null) settings.weekStarting = toIsoDate(row[i + 1])
      if (label === 'default cpm' && row[i + 1] != null) settings.defaultMileageRate = numericText(row[i + 1])
      if (label === 'tax reserve' && typeof row[i + 1] === 'number') {
        settings.defaultTaxReserveRate = numericText(row[i + 1])
      }
    }
  }
  data.settings = settings

  const headerRow = findHeader(weekly, 'Trip #')
  if (headerRow < 0) throw new Error(`Could not find the trip table on "${SHEETS.weekly}".`)
  const header = weekly[headerRow]

  const col = {
    pickup: columnIndex(header, 'Pickup', 'Start date'),
    delivery: columnIndex(header, 'Delivery', 'End date'),
    trip: columnIndex(header, 'Trip #'),
    proBol: columnIndex(header, 'PRO / BOL'),
    pro: columnIndex(header, 'PRO', 'PRO #'),
    bol: columnIndex(header, 'BOL', 'BOL #'),
    truck: columnIndex(header, 'Truck'),
    trailer: columnIndex(header, 'Trailer'),
    from: columnIndex(header, 'From', 'Origin'),
    to: columnIndex(header, 'To', 'Destination'),
    beginOdo: columnIndex(header, 'Begin odo', 'Beginning odometer'),
    endOdo: columnIndex(header, 'End odo', 'Ending odometer'),
    paidMiles: columnIndex(header, 'Paid miles'),
    rate: columnIndex(header, 'Rate', 'CPM'),
    extra: columnIndex(header, 'Extra-stop pay', 'Extra stop pay'),
    layover: columnIndex(header, 'Detention / layover', 'Layover pay'),
    other: columnIndex(header, 'Other pay'),
    taxRate: columnIndex(header, 'Tax reserve rate'),
    notes: columnIndex(header, 'Notes'),
  }

  const imported: Trip[] = []
  for (const row of weekly.slice(headerRow + 1)) {
    if (!row) continue
    const tripNumber = text(row[col.trip])
    if (!tripNumber) continue

    // "38522 / 935202874" in the original workbook's single PRO / BOL column.
    let proNumber = col.pro >= 0 ? text(row[col.pro]) : ''
    let bolNumber = col.bol >= 0 ? text(row[col.bol]) : ''
    if (!proNumber && !bolNumber && col.proBol >= 0) {
      const combined = text(row[col.proBol])
      const parts = combined.split('/').map((part) => part.trim())
      proNumber = parts[0] ?? ''
      bolNumber = parts[1] ?? ''
    }

    imported.push({
      id: newId(),
      driverName: settings.defaultDriverName,
      coDriver: settings.defaultCoDriver,
      truckNumber: text(row[col.truck]),
      trailerNumber: text(row[col.trailer]),
      tripNumber,
      proNumber,
      bolNumber,
      startDate: toIsoDate(row[col.pickup]),
      endDate: toIsoDate(row[col.delivery]),
      origin: text(row[col.from]),
      destination: text(row[col.to]),
      beginningOdometer: numericText(row[col.beginOdo]),
      endingOdometer: numericText(row[col.endOdo]),
      paidMiles: numericText(row[col.paidMiles]),
      mileageRate: numericText(row[col.rate]),
      extraStopPay: col.extra >= 0 ? numericText(row[col.extra]) : '',
      layoverPay: col.layover >= 0 ? numericText(row[col.layover]) : '',
      otherPay: col.other >= 0 ? numericText(row[col.other]) : '',
      taxReserveRate:
        col.taxRate >= 0 && numericText(row[col.taxRate])
          ? numericText(row[col.taxRate])
          : settings.defaultTaxReserveRate,
      notes: col.notes >= 0 ? text(row[col.notes]) : '',
      complete: false,
      routes: [],
      stateMiles: [],
      fuel: [],
      expenses: [],
      advances: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }

  if (imported.length === 0) throw new Error('No trips were found in the workbook.')

  attachRoutes(workbook, imported)
  attachStateMiles(workbook, imported)
  attachFuel(workbook, imported)
  attachExpenses(workbook, imported)
  attachAdvances(workbook, imported)

  for (const trip of imported) {
    const totals = calculateTrip(trip)
    // A trip is only pre-marked complete when it would actually pass export
    // validation; otherwise the driver has to look at it first.
    trip.complete =
      totals.actualMiles !== null &&
      totals.paidMiles !== null &&
      (totals.mileageRate ?? 0) > 0 &&
      trip.stateMiles.length > 0
  }

  const existingNumbers = new Set(data.trips.map((trip) => trip.tripNumber))
  const fresh = imported.filter((trip) => !existingNumbers.has(trip.tripNumber))
  const skipped = imported.length - fresh.length
  data.trips = [...data.trips, ...fresh]
  if (!data.selectedTripId && data.trips.length > 0) data.selectedTripId = data.trips[0].id

  messages.push(`Imported ${fresh.length} trip${fresh.length === 1 ? '' : 's'}.`)
  if (skipped > 0) {
    messages.push(`Skipped ${skipped} trip number${skipped === 1 ? '' : 's'} already in the app.`)
  }
  return { data, messages }
}

function forEachDetailRow(
  workbook: XLSX.WorkBook,
  sheet: string,
  marker: string,
  handler: (row: Row, header: Row, tripColumn: number) => void,
): void {
  const rows = sheetRows(workbook, sheet)
  if (rows.length === 0) return
  const headerRow = findHeader(rows, marker)
  if (headerRow < 0) return
  const header = rows[headerRow]
  const tripColumn = columnIndex(header, 'Trip #')
  if (tripColumn < 0) return
  for (const row of rows.slice(headerRow + 1)) {
    if (row) handler(row, header, tripColumn)
  }
}

function attachRoutes(workbook: XLSX.WorkBook, trips: Trip[]): void {
  forEachDetailRow(workbook, SHEETS.routes, 'Trip #', (row, header, tripColumn) => {
    const trip = trips.find((candidate) => sameTrip(candidate.tripNumber, row[tripColumn]))
    if (!trip) return
    const from = text(row[columnIndex(header, 'From')])
    const to = text(row[columnIndex(header, 'To')])
    if (!from && !to) return
    const type = text(row[columnIndex(header, 'Type')])
    trip.routes.push({
      id: newId(),
      order: Number(numericText(row[columnIndex(header, 'Stop order')])) || trip.routes.length + 1,
      type: (type as Trip['routes'][number]['type']) || '',
      from,
      to,
      isPickup: /pick/i.test(type),
      isDelivery: /deliver|drop/i.test(type),
      notes: text(row[columnIndex(header, 'Notes')]),
    })
  })
  for (const trip of trips) trip.routes.sort((a, b) => a.order - b.order)
}

function attachStateMiles(workbook: XLSX.WorkBook, trips: Trip[]): void {
  forEachDetailRow(workbook, SHEETS.stateMiles, 'Trip #', (row, header, tripColumn) => {
    const trip = trips.find((candidate) => sameTrip(candidate.tripNumber, row[tripColumn]))
    if (!trip) return
    const state = text(row[columnIndex(header, 'State')]).toUpperCase()
    if (!state) return
    trip.stateMiles.push({
      id: newId(),
      state,
      miles: numericText(row[columnIndex(header, 'Miles')]),
      highways: text(row[columnIndex(header, 'Highways used')]),
    })
  })
}

function attachFuel(workbook: XLSX.WorkBook, trips: Trip[]): void {
  forEachDetailRow(workbook, SHEETS.fuel, 'Trip #', (row, header, tripColumn) => {
    const trip = trips.find((candidate) => sameTrip(candidate.tripNumber, row[tripColumn]))
    if (!trip) return
    const seller = text(row[columnIndex(header, 'Seller')])
    const invoice = text(row[columnIndex(header, 'Invoice number')])
    const total = numericText(row[columnIndex(header, 'Total amount')])
    if (!seller && !invoice && !total) return
    trip.fuel.push({
      id: newId(),
      date: toIsoDate(row[columnIndex(header, 'Date')]),
      state: text(row[columnIndex(header, 'State')]).toUpperCase(),
      invoice,
      seller,
      truckGallons: numericText(row[columnIndex(header, 'Truck gallons')]),
      reeferGallons: numericText(row[columnIndex(header, 'Reefer gallons')]),
      defGallons: numericText(row[columnIndex(header, 'DEF gallons')]),
      total,
    })
  })
}

function attachExpenses(workbook: XLSX.WorkBook, trips: Trip[]): void {
  forEachDetailRow(workbook, SHEETS.expenses, 'Trip #', (row, header, tripColumn) => {
    const trip = trips.find((candidate) => sameTrip(candidate.tripNumber, row[tripColumn]))
    if (!trip) return
    const description = text(row[columnIndex(header, 'Vendor / description', 'Description')])
    const rawCategory = text(row[columnIndex(header, 'Category')])
    const amount = numericText(row[columnIndex(header, 'Amount paid', 'Amount')])
    if (!description && !rawCategory && !amount) return
    const category = EXPENSE_CATEGORIES.find(
      (known) => known.toLowerCase() === rawCategory.toLowerCase(),
    )
    trip.expenses.push({
      id: newId(),
      date: toIsoDate(row[columnIndex(header, 'Date')]),
      category: (category ?? (rawCategory ? 'Other' : '')) as ExpenseCategory | '',
      description,
      state: text(row[columnIndex(header, 'State')]).toUpperCase(),
      receipt: text(row[columnIndex(header, 'Receipt / invoice', 'Receipt')]),
      // Blank stays blank: the app must warn, not assume zero.
      amount,
      reimbursement: numericText(row[columnIndex(header, 'Reimbursement received', 'Reimbursement')]),
    })
  })
}

function attachAdvances(workbook: XLSX.WorkBook, trips: Trip[]): void {
  forEachDetailRow(workbook, SHEETS.advances, 'Trip #', (row, header, tripColumn) => {
    const trip = trips.find((candidate) => sameTrip(candidate.tripNumber, row[tripColumn]))
    if (!trip) return
    const amount = numericText(row[columnIndex(header, 'Amount')])
    const type = text(row[columnIndex(header, 'Type')])
    if (!amount && !type) return
    trip.advances.push({
      id: newId(),
      date: toIsoDate(row[columnIndex(header, 'Date')]),
      amount,
      type,
      notes: text(row[columnIndex(header, 'Notes')]),
    })
  })
}

/* ------------------------------------------------------------------ *
 * export
 * ------------------------------------------------------------------ */

const num = (value: string): number | string => {
  if (value === '') return ''
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : value
}

export function exportWorkbook(data: AppData): Uint8Array {
  const workbook = XLSX.utils.book_new()
  const add = (name: string, rows: unknown[][], widths: number[]) => {
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    sheet['!cols'] = widths.map((width) => ({ wch: width }))
    XLSX.utils.book_append_sheet(workbook, sheet, name)
  }

  /* Weekly Pay */
  const weekly: unknown[][] = [
    ['Weekly Trip Pay Calculator'],
    [
      'Driver',
      data.settings.defaultDriverName,
      '',
      'Week starting',
      data.settings.weekStarting,
      '',
      'Default CPM',
      num(data.settings.defaultMileageRate),
      '',
      'Tax reserve',
      num(data.settings.defaultTaxReserveRate),
    ],
    [],
    [
      'Start date', 'End date', 'Trip #', 'PRO', 'BOL', 'Truck', 'Trailer', 'Origin', 'Destination',
      'Begin odo', 'End odo', 'Actual miles', 'Paid miles', 'Rate', 'Mileage pay', 'Extra-stop pay',
      'Detention / layover', 'Other pay', 'Gross pay', 'Reimbursements', 'Expenses',
      'Advances / deductions', 'Tax reserve rate', 'Tax reserve', 'Estimated net', 'Complete', 'Notes',
    ],
  ]
  for (const trip of data.trips) {
    const totals = calculateTrip(trip)
    weekly.push([
      trip.startDate, trip.endDate, trip.tripNumber, trip.proNumber, trip.bolNumber,
      trip.truckNumber, trip.trailerNumber, trip.origin, trip.destination,
      num(trip.beginningOdometer), num(trip.endingOdometer), totals.actualMiles ?? '',
      num(trip.paidMiles), num(trip.mileageRate), totals.mileagePay ?? '',
      totals.extraStopPay, totals.layoverPay, totals.otherPay, totals.grossPay ?? '',
      totals.reimbursementTotal, totals.expenseTotal, totals.advanceTotal,
      totals.taxReserveRate, totals.taxReserve ?? '', totals.estimatedNetPay ?? '',
      trip.complete ? 'Yes' : 'No', trip.notes,
    ])
  }
  add(SHEETS.weekly, weekly, [11, 11, 10, 12, 13, 8, 9, 30, 30, 11, 11, 11, 11, 8, 12, 13, 17, 10, 12, 14, 11, 19, 15, 12, 13, 9, 34])

  /* Routes */
  const routes: unknown[][] = [
    ['Trip Routes and Stops'],
    [`Enter routes in stop order. Up to ${CAPACITY.routes} From/To pairs export to the settlement PDF.`],
    ['Trip #', 'Stop order', 'Type', 'From', 'To', 'Pickup', 'Delivery', 'Notes'],
  ]
  for (const trip of data.trips) {
    for (const stop of trip.routes) {
      routes.push([
        trip.tripNumber, stop.order, stop.type, stop.from, stop.to,
        stop.isPickup ? 'Yes' : '', stop.isDelivery ? 'Yes' : '', stop.notes,
      ])
    }
  }
  add(SHEETS.routes, routes, [10, 11, 20, 36, 36, 9, 10, 30])

  /* State Miles */
  const stateMiles: unknown[][] = [
    ['State Miles by Trip'],
    ['Miles are recorded exactly as entered. Differences against the odometer are reported, never corrected.'],
    ['Trip #', 'State', 'Miles', 'Highways used', 'Trip state total', 'Difference vs odometer'],
  ]
  for (const trip of data.trips) {
    const totals = calculateTrip(trip)
    for (const row of trip.stateMiles) {
      stateMiles.push([
        trip.tripNumber, row.state, num(row.miles), row.highways,
        totals.stateMilesTotal, totals.stateMilesDifference ?? '',
      ])
    }
  }
  add(SHEETS.stateMiles, stateMiles, [10, 8, 9, 34, 17, 22])

  /* Fuel & DEF */
  const fuel: unknown[][] = [
    ['Fuel and DEF Purchases'],
    [`The exporter uses up to ${CAPACITY.fuel} purchase rows.`],
    ['Date', 'Trip #', 'State', 'Invoice number', 'Seller', 'Truck gallons', 'Reefer gallons', 'DEF gallons', 'Total amount'],
  ]
  for (const trip of data.trips) {
    for (const row of trip.fuel) {
      fuel.push([
        row.date, trip.tripNumber, row.state, row.invoice, row.seller,
        num(row.truckGallons), num(row.reeferGallons), num(row.defGallons), num(row.total),
      ])
    }
  }
  add(SHEETS.fuel, fuel, [12, 10, 8, 18, 20, 14, 15, 13, 13])

  /* Expenses */
  const expenses: unknown[][] = [
    ['Trip Expenses and Reimbursements'],
    ['Enter only money you personally paid. Put company repayment in "Reimbursement received".'],
    ['Date', 'Trip #', 'Category', 'Vendor / description', 'State', 'Receipt / invoice', 'Amount paid', 'Reimbursement received'],
  ]
  for (const trip of data.trips) {
    for (const row of trip.expenses) {
      expenses.push([
        row.date, trip.tripNumber, row.category, row.description, row.state,
        row.receipt, num(row.amount), num(row.reimbursement),
      ])
    }
  }
  add(SHEETS.expenses, expenses, [12, 10, 12, 30, 8, 18, 13, 22])

  /* Advances */
  const advances: unknown[][] = [
    ['Advances and Deductions'],
    [`The printed settlement has room for ${CAPACITY.advances} rows.`],
    ['Date', 'Trip #', 'Amount', 'Type', 'Notes'],
  ]
  for (const trip of data.trips) {
    for (const row of trip.advances) {
      advances.push([row.date, trip.tripNumber, num(row.amount), row.type, row.notes])
    }
  }
  add(SHEETS.advances, advances, [12, 10, 11, 20, 30])

  /* PDF Field Mapping */
  const mapping: unknown[][] = [
    ['PDF Field Mapping'],
    ['Generated from src/config/pdfFieldMapping.ts, the single source of truth for the settlement PDF.'],
    ['PDF field', 'Page', 'x', 'y', 'Width', 'Height', 'Font size', 'Alignment', 'Notes'],
  ]
  for (const spec of PDF_FIELDS) {
    mapping.push([
      spec.name, spec.page + 1, spec.x, spec.y, spec.width, spec.height,
      spec.fontSize, spec.align, spec.note ?? '',
    ])
  }
  mapping.push([], ['Values with no field on the printed form'], ['Property', 'Kept in', 'Why'])
  for (const item of FIELDS_WITHOUT_PDF_EQUIVALENT) {
    mapping.push([item.property, item.excel, item.reason])
  }
  add(SHEETS.mapping, mapping, [26, 6, 8, 8, 8, 8, 10, 10, 72])

  /* PDF Export Instructions */
  const taxRate = formatPercent(Number(data.settings.defaultTaxReserveRate) || 0)
  add(
    SHEETS.instructions,
    [
      ['Export a Settlement PDF'],
      ['Step', 'Action'],
      ['1', 'Open the web app and add or edit the trip.'],
      ['2', 'Enter route stops, state miles, fuel and DEF, expenses and advances.'],
      ['3', 'Review the calculated money and the mileage differences.'],
      ['4', 'Mark the trip complete, then select it.'],
      ['5', 'Open PDF Preview and Export, and press Preview Settlement.'],
      ['6', 'Check both pages, then download the ready-to-email PDF.'],
      ['7', 'Optionally download the fillable PDF as well.'],
      [],
      ['Notes'],
      ['The app never adjusts odometer miles, state miles, paid miles, expenses, reimbursements or advances.'],
      ['Mileage differences and missing receipts require an explicit confirmation before export.'],
      [`The tax reserve (currently ${taxRate}) stays in the app and this workbook: the printed form has no such field.`],
      ['PRO and BOL numbers stay in the app and this workbook for the same reason.'],
      ['The driver-signature area is always left blank.'],
      ['All data stays in your browser. Nothing is uploaded.'],
    ],
    [8, 100],
  )

  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }))
}
