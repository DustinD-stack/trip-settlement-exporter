/** Settings, Excel import/export, JSON backup and restore, export history. */
import { useRef, useState } from 'react'
import { exportWorkbook, importWorkbook } from '../lib/excel'
import { clearData, fromBackupJson, toBackupJson } from '../lib/storage'
import { createTrip39586Fixture } from '../lib/fixtures'
import { downloadBytes, downloadText, JSON_MIME, XLSX_MIME } from '../lib/download'
import { FIELDS_WITHOUT_PDF_EQUIVALENT } from '../config/pdfFieldMapping'
import { Panel, TextField } from '../components/ui'
import type { AppStore } from '../useAppData'

export function SettingsScreen({ store }: { store: AppStore }) {
  const { data, updateSettings, replaceAll, addTrip } = store
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const excelInput = useRef<HTMLInputElement>(null)
  const jsonInput = useRef<HTMLInputElement>(null)

  const report = (text: string) => {
    setMessage(text)
    setError(null)
  }
  const fail = (caught: unknown) => {
    setError(caught instanceof Error ? caught.message : String(caught))
    setMessage(null)
  }

  const onExcelChosen = async (file: File | undefined) => {
    if (!file) return
    try {
      const result = importWorkbook(await file.arrayBuffer(), data)
      replaceAll(result.data)
      report(result.messages.join(' '))
    } catch (caught) {
      fail(caught)
    } finally {
      if (excelInput.current) excelInput.current.value = ''
    }
  }

  const onJsonChosen = async (file: File | undefined) => {
    if (!file) return
    try {
      const restored = fromBackupJson(await file.text())
      const proceed = window.confirm(
        `Replace everything currently in this browser with the backup?\n\n` +
          `The backup holds ${restored.trips.length} trip${restored.trips.length === 1 ? '' : 's'}. ` +
          `You currently have ${data.trips.length}.\n\nThis cannot be undone.`,
      )
      if (!proceed) return
      replaceAll(restored)
      report(`Restored ${restored.trips.length} trips from the backup.`)
    } catch (caught) {
      fail(caught)
    } finally {
      if (jsonInput.current) jsonInput.current.value = ''
    }
  }

  const stamp = new Date().toISOString().slice(0, 10)

  return (
    <>
      <Panel title="Defaults for new trips" hint="Every value can still be changed on any individual trip.">
        <div className="field-grid">
          <TextField
            label="Driver name"
            value={data.settings.defaultDriverName}
            onChange={(value) => updateSettings({ defaultDriverName: value })}
          />
          <TextField
            label="Co-driver"
            value={data.settings.defaultCoDriver}
            onChange={(value) => updateSettings({ defaultCoDriver: value })}
          />
          <TextField
            label="Truck number"
            value={data.settings.defaultTruckNumber}
            onChange={(value) => updateSettings({ defaultTruckNumber: value })}
          />
          <TextField
            label="Trailer number"
            value={data.settings.defaultTrailerNumber}
            onChange={(value) => updateSettings({ defaultTrailerNumber: value })}
          />
          <TextField
            label="Mileage rate ($/mile)"
            value={data.settings.defaultMileageRate}
            onChange={(value) => updateSettings({ defaultMileageRate: value })}
            inputMode="decimal"
          />
          <TextField
            label="Tax-reserve rate (0.25 = 25%)"
            value={data.settings.defaultTaxReserveRate}
            onChange={(value) => updateSettings({ defaultTaxReserveRate: value })}
            inputMode="decimal"
          />
          <TextField
            label="Week starting"
            type="date"
            value={data.settings.weekStarting}
            onChange={(value) => updateSettings({ weekStarting: value })}
          />
        </div>
      </Panel>

      {message && <div className="notice">{message}</div>}
      {error && <div className="error">{error}</div>}

      <Panel
        title="Excel"
        hint="Import the existing workbook, or any workbook with the same sheets and columns."
      >
        <div className="panel-actions">
          <button onClick={() => excelInput.current?.click()}>Import an .xlsx workbook</button>
          <button
            onClick={() => {
              try {
                downloadBytes(
                  exportWorkbook(data),
                  `Trip_Pay_Calculator_${stamp}.xlsx`,
                  XLSX_MIME,
                )
                report('Workbook downloaded.')
              } catch (caught) {
                fail(caught)
              }
            }}
          >
            Export everything to .xlsx
          </button>
        </div>
        <input
          ref={excelInput}
          type="file"
          accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="visually-hidden"
          onChange={(event) => void onExcelChosen(event.target.files?.[0])}
        />
        <p className="footnote">
          Importing adds trips whose numbers are not already here; it never overwrites a trip you have
          edited. Blank cells stay blank so the app can warn about them.
        </p>
      </Panel>

      <Panel title="Backup and restore" hint="A JSON backup holds everything: trips, settings and export history.">
        <div className="panel-actions">
          <button
            onClick={() => {
              downloadText(toBackupJson(data), `trip-settlement-backup-${stamp}.json`, JSON_MIME)
              report('Backup downloaded.')
            }}
          >
            Download a JSON backup
          </button>
          <button onClick={() => jsonInput.current?.click()}>Restore from a JSON backup</button>
          <button
            className="danger"
            onClick={() => {
              if (
                window.confirm(
                  `Delete all ${data.trips.length} trips and settings from this browser?\n\nThis cannot be undone. ` +
                    'Download a backup first if you might need the data.',
                )
              ) {
                void clearData()
                replaceAll({ version: 1, settings: data.settings, trips: [], exportHistory: [], selectedTripId: null })
                report('All trips deleted from this browser.')
              }
            }}
          >
            Delete all data
          </button>
        </div>
        <input
          ref={jsonInput}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          onChange={(event) => void onJsonChosen(event.target.files?.[0])}
        />
      </Panel>

      <Panel title="Export history" hint="Kept on this device only, so the app can warn about a repeat export.">
        {data.exportHistory.length === 0 ? (
          <p className="empty">Nothing exported yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Trip</th>
                  <th>Kind</th>
                  <th>File name</th>
                </tr>
              </thead>
              <tbody>
                {data.exportHistory.slice(0, 40).map((record) => (
                  <tr key={record.id}>
                    <td>{new Date(record.exportedAt).toLocaleString()}</td>
                    <td>{record.tripNumber || '(no number)'}</td>
                    <td>{record.kind === 'fillable' ? 'Fillable' : 'Ready to email'}</td>
                    <td>{record.fileName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="footnote">
          This is a record of what this browser generated. The app cannot see files already saved on your
          computer, and never replaces them; your browser decides how to handle a repeated file name.
        </p>
      </Panel>

      <Panel title="Values the printed form has no field for">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Value</th>
                <th>Kept in</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {FIELDS_WITHOUT_PDF_EQUIVALENT.map((item) => (
                <tr key={item.property}>
                  <td>{item.property}</td>
                  <td>{item.excel}</td>
                  <td style={{ whiteSpace: 'normal' }}>{item.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Sample data" hint="Loads the Trip 39586 verification trip, including its 45-mile difference.">
        <div className="panel-actions">
          <button
            onClick={() => {
              const fixture = createTrip39586Fixture()
              addTrip({ ...fixture, id: `${fixture.id}-${Date.now()}` })
              report('Trip 39586 added as a sample. Delete it whenever you like.')
            }}
          >
            Add the Trip 39586 sample
          </button>
        </div>
      </Panel>

      <Panel title="Privacy">
        <p style={{ margin: 0 }}>
          Everything you enter stays in this browser, in IndexedDB with a localStorage copy. There is no
          server, no account and no analytics. Clearing your browser's site data for this page deletes it,
          so keep a JSON backup.
        </p>
      </Panel>
    </>
  )
}
