// @vitest-environment jsdom
/**
 * Mounts the real UI in jsdom and drives the whole flow: create a trip, fill
 * it in, hit the mileage warning, confirm it, preview, and download both PDFs.
 *
 * This is the wiring test - it catches anything the unit tests cannot, such as
 * a screen failing to render or the export button staying disabled.
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PDFDocument } from 'pdf-lib'
import App from '../src/App'
import { resetTemplateCache } from '../src/lib/pdfExport'

const TEMPLATE = path.resolve(__dirname, '..', 'public', 'settlement-template.pdf')

/** Every Blob the app hands to a download, in order. */
const downloads: Array<{ fileName: string; bytes: Uint8Array }> = []

beforeAll(() => {
  const templateBytes = new Uint8Array(fs.readFileSync(TEMPLATE))

  // The app fetches its template from the site root; serve it from disk.
  vi.stubGlobal('fetch', async (input: unknown) => {
    if (String(input).includes('settlement-template.pdf')) {
      return new Response(templateBytes, { status: 200 })
    }
    throw new Error(`Unexpected fetch: ${String(input)}`)
  })

  // jsdom has no PDF viewer and no real downloads; capture them instead.
  const blobs = new Map<string, Blob>()
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (blob: Blob) => {
      const url = `blob:mock/${blobs.size}`
      blobs.set(url, blob)
      return url
    },
    revokeObjectURL: () => {},
  })

  const realClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
    if (this.download && blobs.has(this.href)) {
      const blob = blobs.get(this.href)!
      // Capture the slot now: several downloads can be clicked back to back,
      // and their arrayBuffer() promises settle later and out of order.
      const slot = downloads.push({ fileName: this.download, bytes: new Uint8Array() }) - 1
      void blob.arrayBuffer().then((buffer) => {
        downloads[slot].bytes = new Uint8Array(buffer)
      })
      return
    }
    realClick.call(this)
  }

  vi.stubGlobal('confirm', () => true)
})

beforeEach(() => {
  downloads.length = 0
  resetTemplateCache()
  localStorage.clear()
})

afterEach(cleanup)

const type = (label: RegExp | string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}


describe('the application', () => {
  it('starts with no trips and offers the main screens', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Trip Settlement Exporter')).toBeTruthy())

    for (const label of [
      'Dashboard', 'Weekly Pay', 'Trip Details', 'Routes & Stops', 'State Miles',
      'Fuel & DEF', 'Expenses', 'Advances', 'PDF Export', 'Settings & Backup',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(screen.getAllByText('No trip selected').length).toBeGreaterThan(0)
  })

  it('carries a trip all the way to two downloaded PDFs', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Trip Settlement Exporter')).toBeTruthy())

    // --- create the trip -------------------------------------------------
    fireEvent.click(screen.getAllByRole('button', { name: 'Add a trip' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Trip Details' }))

    type('Driver name', 'Casey Rivera')
    type('Trip number', '41022')
    type('PRO number', '55501')
    type('BOL number', '900112233')
    type('Truck number', '146')
    type('Trailer number', '2016')
    type('Start date', '2026-10-01')
    type('End date', '2026-10-03')
    type('Beginning odometer', '100000')
    type('Ending odometer', '101000')
    type('Paid miles', '1050')
    type(/Mileage rate/, '0.80')
    type(/Tax-reserve rate/, '0.25')

    expect(screen.getAllByText('$840.00').length).toBeGreaterThan(0) // 1050 x 0.80

    // --- state miles ------------------------------------------------------
    fireEvent.click(screen.getByRole('button', { name: 'State Miles' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add a state row' }))
    type('State for row 1', 'IL')
    type('Miles for row 1', '1000')
    type('Highways for row 1', 'I-80')

    // --- an expense with no amount, which must warn and print blank --------
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add an expense' }))
    type('Expense description 1', 'Load bar')
    fireEvent.change(screen.getByLabelText('Expense category 1'), { target: { value: 'Supplies' } })
    expect(screen.getByText(/have a description but no/)).toBeTruthy()

    // --- export ------------------------------------------------------------
    fireEvent.click(screen.getByRole('button', { name: 'PDF Export' }))

    // Paid miles (1050) differ from odometer miles (1000): the app must say so,
    // show both numbers, and refuse to preview until it is confirmed.
    expect(screen.getByText(/Paid miles differ from actual odometer miles by \+50/)).toBeTruthy()
    const previewButton = screen.getByRole('button', { name: 'Preview settlement' })
    expect((previewButton as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('checkbox', { name: /they are correct/ }))
    expect((screen.getByRole('button', { name: 'Preview settlement' }) as HTMLButtonElement).disabled).toBe(false)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Preview settlement' }))
    })
    // The preview appears with its checklist once both pages have been built.
    await waitFor(() => expect(screen.getByText('Both pages are there.')).toBeTruthy(), {
      timeout: 20_000,
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Download ready-to-email PDF' }))
      fireEvent.click(screen.getByRole('button', { name: 'Download fillable PDF' }))
    })

    await waitFor(() => expect(downloads.length).toBe(2), { timeout: 20_000 })
    await waitFor(() => expect(downloads.every((d) => d.bytes.length > 0)).toBe(true), {
      timeout: 20_000,
    })

    expect(downloads[0].fileName).toBe('Casey_Rivera_Trip_41022_Settlement.pdf')
    expect(downloads[1].fileName).toBe('Casey_Rivera_Trip_41022_Settlement_Fillable.pdf')

    // --- what actually landed in the PDFs ----------------------------------
    const flat = await PDFDocument.load(downloads[0].bytes)
    expect(flat.getPageCount()).toBe(2)
    expect(flat.getForm().getFields()).toHaveLength(0)

    const fillable = await PDFDocument.load(downloads[1].bytes)
    expect(fillable.getPageCount()).toBe(2)
    const form = fillable.getForm()
    expect(form.getTextField('trip_number').getText()).toBe('41022')
    expect(form.getTextField('driver_name').getText()).toBe('Casey Rivera')
    expect(form.getTextField('left_miles_1').getText()).toBe('1,000')
    expect(form.getTextField('total_miles_pay').getText()).toBe('840.00')
    // The expense had no amount, so its money stays blank while the name shows.
    expect(form.getTextField('expense_other').getText()).toBe('Load bar')
    expect(form.getTextField('expense_total').getText() ?? '').toBe('')
    // No signature, and nothing anywhere for PRO or BOL.
    expect(form.getTextField('driver_signature').getText() ?? '').toBe('')
    const everyValue = form
      .getFields()
      .map((field) => ('getText' in field ? ((field as never as { getText(): string }).getText() ?? '') : ''))
      .join('|')
    expect(everyValue).not.toContain('55501')
    expect(everyValue).not.toContain('900112233')
  })

  it('keeps the data of two trips apart when exporting the week', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Trip Settlement Exporter')).toBeTruthy())

    const addTrip = (tripNumber: string, driver: string, miles: string) => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Add a trip' })[0])
      fireEvent.click(screen.getByRole('button', { name: 'Trip Details' }))
      type('Driver name', driver)
      type('Trip number', tripNumber)
      type('Beginning odometer', '0')
      type('Ending odometer', miles)
      type('Paid miles', miles)
      type(/Mileage rate/, '1')
      fireEvent.click(screen.getByRole('button', { name: 'State Miles' }))
      fireEvent.click(screen.getByRole('button', { name: 'Add a state row' }))
      type('State for row 1', 'IA')
      type('Miles for row 1', miles)
      fireEvent.click(screen.getByRole('button', { name: 'Trip Details' }))
      fireEvent.click(screen.getByRole('checkbox', { name: /ready to export/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }))
    }

    addTrip('7001', 'Driver One', '500')
    addTrip('7002', 'Driver Two', '600')

    fireEvent.click(screen.getByRole('button', { name: 'PDF Export' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Export all completed trips \(2\)/ }))
    })

    // Two settlements plus one combined weekly PDF.
    await waitFor(() => expect(downloads.length).toBe(3), { timeout: 15_000 })
    await waitFor(() => expect(downloads.every((d) => d.bytes.length > 0)).toBe(true))

    expect(downloads.map((d) => d.fileName)).toEqual([
      'Driver_One_Trip_7001_Settlement.pdf',
      'Driver_Two_Trip_7002_Settlement.pdf',
      expect.stringMatching(/^Week_.*_Settlements\.pdf$/),
    ])

    const combined = await PDFDocument.load(downloads[2].bytes)
    expect(combined.getPageCount()).toBe(4)

    for (const download of downloads.slice(0, 2)) {
      const doc = await PDFDocument.load(download.bytes)
      expect(doc.getPageCount()).toBe(2)
    }
  })

  it('combines two completed trips into one two-page Monday envelope', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Trip Settlement Exporter')).toBeTruthy())

    const addTrip = (
      tripNumber: string,
      start: string,
      end: string,
      beginOdo: string,
      endOdo: string,
      miles: string,
      state: string,
      highways: string,
      origin: string,
      destination: string,
    ) => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Add a trip' })[0])
      fireEvent.click(screen.getByRole('button', { name: 'Trip Details' }))
      type('Driver name', 'Dustin Douglas')
      type('Trip number', tripNumber)
      type('Start date', start)
      type('End date', end)
      type('Beginning odometer', beginOdo)
      type('Ending odometer', endOdo)
      type('Paid miles', miles)
      type(/Mileage rate/, '1')
      // Neither trip gets Routes & Stops rows, so the envelope has to fall
      // back to these addresses for each trip.
      type('Origin', origin)
      type('Destination', destination)
      fireEvent.click(screen.getByRole('button', { name: 'State Miles' }))
      fireEvent.click(screen.getByRole('button', { name: 'Add a state row' }))
      type('State for row 1', state)
      type('Miles for row 1', miles)
      // A pasted non-breaking hyphen, the exact input that used to crash export.
      type('Highways for row 1', highways)
      fireEvent.click(screen.getByRole('button', { name: 'Trip Details' }))
      fireEvent.click(screen.getByRole('checkbox', { name: /ready to export/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }))
    }

    addTrip('9001', '2026-09-15', '2026-09-16', '1000', '1500', '500', 'IA', 'I‑080', 'Ontario, CA', 'Huntley, IL')
    addTrip('9002', '2026-09-18', '2026-09-19', '1500', '2100', '600', 'IA', 'US‑30', 'Huntley, IL', 'Chicago, IL')

    fireEvent.click(screen.getByRole('button', { name: 'PDF Export' }))
    expect(screen.getByText('Combine trips into one Monday envelope')).toBeTruthy()

    // Preview stays disabled until two trips are chosen.
    const previewButton = () =>
      screen.getByRole('button', { name: 'Preview Monday envelope' }) as HTMLButtonElement
    fireEvent.click(screen.getByLabelText(/Include trip 9001/))
    expect(screen.queryByRole('button', { name: 'Preview Monday envelope' })).toBeNull()

    fireEvent.click(screen.getByLabelText(/Include trip 9002/))
    expect(previewButton().disabled).toBe(false)

    // The combined figures are shown before anything is exported.
    const shown = screen.getAllByText(/1,100/)
    expect(shown.length).toBeGreaterThan(0) // 500 + 600 paid miles
    expect(screen.getAllByText('$1,100.00').length).toBeGreaterThan(0)

    const mondayInput = screen.getByLabelText('Monday submission date') as HTMLInputElement
    expect(mondayInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const [y, m, d] = mondayInput.value.split('-').map(Number)
    expect(new Date(y, m - 1, d).getDay()).toBe(1) // a Monday
    fireEvent.change(mondayInput, { target: { value: '2026-09-28' } })

    await act(async () => {
      fireEvent.click(previewButton())
    })
    await waitFor(() => expect(screen.getByLabelText('Monday envelope preview')).toBeTruthy(), {
      timeout: 20_000,
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Download ready-to-email envelope' }))
      fireEvent.click(screen.getByRole('button', { name: 'Download fillable envelope' }))
    })
    await waitFor(() => expect(downloads.length).toBe(2), { timeout: 20_000 })
    await waitFor(() => expect(downloads.every((f) => f.bytes.length > 0)).toBe(true), {
      timeout: 20_000,
    })

    expect(downloads[0].fileName).toBe(
      'Dustin_Douglas_Monday_Envelope_2026-09-28_Trips_9001-9002.pdf',
    )
    expect(downloads[1].fileName).toBe(
      'Dustin_Douglas_Monday_Envelope_2026-09-28_Trips_9001-9002_Fillable.pdf',
    )

    // ONE settlement of two pages - not a four-page stack.
    const flat = await PDFDocument.load(downloads[0].bytes)
    expect(flat.getPageCount()).toBe(2)
    expect(flat.getForm().getFields()).toHaveLength(0)

    const fillable = await PDFDocument.load(downloads[1].bytes)
    expect(fillable.getPageCount()).toBe(2)
    const form = fillable.getForm()
    expect(form.getTextField('trip_number').getText()).toBe('9001, 9002')
    expect(form.getTextField('beginning_odometer').getText()).toBe('1000')
    expect(form.getTextField('ending_odometer').getText()).toBe('2100')
    expect(form.getTextField('total_miles_pay').getText()).toBe('1,100.00')
    // The two IA rows merged, with both highways and no non-breaking hyphen.
    expect(form.getTextField('left_state_1').getText()).toBe('IA')
    expect(form.getTextField('left_miles_1').getText()).toBe('1,100')
    expect(form.getTextField('left_highways_1').getText()).toBe('I-080, US-30')
    expect(form.getTextField('left_state_2').getText() ?? '').toBe('')
    expect(form.getTextField('left_state_miles_total').getText()).toBe('1,100')
    // Each trip keeps its own From/To pair even though neither had route rows.
    expect(form.getTextField('route_1_from').getText()).toBe('Ontario, CA')
    expect(form.getTextField('route_1_to').getText()).toBe('Huntley, IL')
    expect(form.getTextField('route_2_from').getText()).toBe('Huntley, IL')
    expect(form.getTextField('route_2_to').getText()).toBe('Chicago, IL')
    expect(form.getTextField('route_3_from').getText() ?? '').toBe('')
    expect(form.getTextField('driver_signature').getText() ?? '').toBe('')

    // Both source trips are still there, separate and unchanged.
    fireEvent.click(screen.getByRole('button', { name: 'Weekly Pay' }))
    const body = document.body.innerText ?? document.body.textContent ?? ''
    expect(body).toContain('9001')
    expect(body).toContain('9002')
  })

  it('blocks an export when the ending odometer is below the beginning', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Trip Settlement Exporter')).toBeTruthy())

    fireEvent.click(screen.getAllByRole('button', { name: 'Add a trip' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Trip Details' }))
    type('Trip number', '8000')
    type('Beginning odometer', '5000')
    type('Ending odometer', '4000')
    type('Paid miles', '100')
    type(/Mileage rate/, '0.8')

    fireEvent.click(screen.getByRole('button', { name: 'State Miles' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add a state row' }))
    type('State for row 1', 'NE')
    type('Miles for row 1', '100')

    fireEvent.click(screen.getByRole('button', { name: 'PDF Export' }))
    expect(screen.getByText('Ending odometer is lower than the beginning odometer.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Preview settlement' }) as HTMLButtonElement).disabled).toBe(true)
    expect(downloads).toHaveLength(0)
  })
})
