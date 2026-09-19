/**
 * PDF preview and export.
 *
 * The preview and both downloads are produced from one build, so what is shown
 * is exactly what is downloaded.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildSettlementPdfs,
  combinePdfs,
  loadTemplateBytes,
  type SettlementPdfs,
} from '../lib/pdfExport'
import { settlementFileName } from '../lib/pdfValues'
import { validateTripForExport } from '../lib/validation'
import { downloadBytes, PDF_MIME } from '../lib/download'
import { formatCurrency, formatMiles, formatSignedMiles } from '../lib/money'
import { newId } from '../lib/trips'
import { Empty, IssueList, Panel, Tile } from '../components/ui'
import type { AppStore } from '../useAppData'


export function ExportScreen({ store }: { store: AppStore }) {
  const { data, selectedTrip, recordExport } = store
  const [built, setBuilt] = useState<SettlementPdfs | null>(null)
  const [builtFor, setBuiltFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [weekMessage, setWeekMessage] = useState<string | null>(null)
  const objectUrl = useRef<string | null>(null)

  const trip = selectedTrip
  const check = useMemo(() => (trip ? validateTripForExport(trip) : null), [trip])

  // A trip edited after a preview must be previewed again before downloading.
  const stale = built !== null && builtFor !== null && trip !== null && builtFor !== trip.updatedAt

  const releasePreview = useCallback(() => {
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = null
    }
    setPreviewUrl(null)
  }, [])

  useEffect(() => {
    // Any change of trip invalidates the current preview.
    releasePreview()
    setBuilt(null)
    setBuiltFor(null)
    setAcknowledged(false)
    setError(null)
  }, [trip?.id, releasePreview])

  useEffect(() => releasePreview, [releasePreview])

  const previousExports = data.exportHistory.filter((record) => record.tripId === trip?.id)

  const preview = async () => {
    if (!trip || !check) return
    setBusy(true)
    setError(null)
    try {
      const result = await buildSettlementPdfs(trip)
      releasePreview()
      const view = new Uint8Array(result.flattened)
      const blob = new Blob(
        [view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)],
        { type: PDF_MIME },
      )
      const url = URL.createObjectURL(blob)
      objectUrl.current = url
      setPreviewUrl(url)
      setBuilt(result)
      setBuiltFor(trip.updatedAt)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const download = (kind: 'flattened' | 'fillable') => {
    if (!trip || !built) return
    const fileName = settlementFileName(trip, kind)
    if (previousExports.some((record) => record.kind === kind)) {
      const last = previousExports.find((record) => record.kind === kind)!
      const proceed = window.confirm(
        `You already exported ${kind === 'fillable' ? 'the fillable' : 'the ready-to-email'} PDF for trip ` +
          `${trip.tripNumber} on this device (${new Date(last.exportedAt).toLocaleString()}).\n\n` +
          `Download it again as "${fileName}"?\n\n` +
          'Your browser decides what to do with a repeated file name; this app cannot see or replace files ' +
          'already on your computer.',
      )
      if (!proceed) return
    }
    downloadBytes(built[kind], fileName, PDF_MIME)
    recordExport({
      id: newId(),
      tripId: trip.id,
      tripNumber: trip.tripNumber,
      exportedAt: new Date().toISOString(),
      kind,
      fileName,
    })
  }

  const exportWeek = async () => {
    const completed = data.trips.filter((candidate) => candidate.complete)
    if (completed.length === 0) return
    setBusy(true)
    setError(null)
    setWeekMessage(null)
    try {
      const blocked: string[] = []
      const flattened: Uint8Array[] = []
      const templateBytes = await loadTemplateBytes()
      for (const candidate of completed) {
        const result = validateTripForExport(candidate)
        if (!result.canExport) {
          blocked.push(`${candidate.tripNumber || '(no number)'}: ${result.errors[0].message}`)
          continue
        }
        // Each trip is built from its own copy of the template, so no data can
        // carry from one settlement into the next.
        const pdfs = await buildSettlementPdfs(candidate, templateBytes)
        flattened.push(pdfs.flattened)
        downloadBytes(pdfs.flattened, settlementFileName(candidate, 'flattened'), PDF_MIME)
        recordExport({
          id: newId(),
          tripId: candidate.id,
          tripNumber: candidate.tripNumber,
          exportedAt: new Date().toISOString(),
          kind: 'flattened',
          fileName: settlementFileName(candidate, 'flattened'),
        })
      }
      if (flattened.length > 1) {
        const combined = await combinePdfs(flattened)
        const week = data.settings.weekStarting || new Date().toISOString().slice(0, 10)
        downloadBytes(combined, `Week_${week}_Settlements.pdf`, PDF_MIME)
      }
      const parts = [`Exported ${flattened.length} settlement${flattened.length === 1 ? '' : 's'}.`]
      if (flattened.length > 1) parts.push('A combined weekly PDF was downloaded too.')
      if (blocked.length > 0) parts.push(`Skipped: ${blocked.join('; ')}`)
      setWeekMessage(parts.join(' '))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  if (!trip || !check) {
    return (
      <>
        <Panel title="PDF preview and export">
          <Empty>Select a trip on Weekly Pay first.</Empty>
        </Panel>
        <WeekPanel onExport={exportWeek} busy={busy} count={data.trips.filter((t) => t.complete).length} message={weekMessage} />
      </>
    )
  }

  const totals = check.totals
  const needsConfirmation = check.warnings.length > 0 && !acknowledged
  const canPreview = check.canExport && !needsConfirmation
  const canDownload = canPreview && built !== null && !stale

  return (
    <>
      <Panel title={`Trip ${trip.tripNumber || '(no number)'}`} hint="Check these figures before exporting.">
        <div className="tiles">
          <Tile label="Actual odometer miles" value={formatMiles(totals.actualMiles) || '--'} />
          <Tile
            label="Paid miles"
            value={formatMiles(totals.paidMiles) || '--'}
            sub={totals.paidMilesDifference === null ? '' : `${formatSignedMiles(totals.paidMilesDifference)} vs odometer`}
          />
          <Tile
            label="State miles"
            value={formatMiles(totals.stateMilesTotal)}
            sub={totals.stateMilesDifference === null ? '' : `${formatSignedMiles(totals.stateMilesDifference)} vs odometer`}
          />
          <Tile label="Mileage pay" value={formatCurrency(totals.mileagePay)} />
          <Tile label="Gross pay" value={formatCurrency(totals.grossPay)} />
          <Tile label="Total pay on the form" value={formatCurrency(totals.settlementPay)} sub="Gross + reimbursements - advances" />
        </div>
      </Panel>

      <IssueList issues={check.errors} kind="error" />

      {check.warnings.length > 0 && (
        <Panel title="Confirm before exporting">
          <IssueList issues={check.warnings} kind="warning" />
          <label className="field checkbox">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              I have read the numbers above and they are correct. Export the settlement without changing them.
            </span>
          </label>
        </Panel>
      )}

      <Panel title="Preview and download">
        {error && <div className="error">{error}</div>}
        {stale && (
          <div className="warning">
            This trip changed after the preview was built. Preview it again so the download matches what you see.
          </div>
        )}
        {previousExports.length > 0 && (
          <div className="notice">
            This trip has already been exported on this device{' '}
            {previousExports.length === 1 ? 'once' : `${previousExports.length} times`}. Most recently{' '}
            {new Date(previousExports[0].exportedAt).toLocaleString()}.
          </div>
        )}

        <div className="panel-actions">
          <button className="primary" onClick={preview} disabled={!canPreview || busy}>
            {busy ? 'Working...' : 'Preview settlement'}
          </button>
          <button onClick={() => download('flattened')} disabled={!canDownload || busy}>
            Download ready-to-email PDF
          </button>
          <button onClick={() => download('fillable')} disabled={!canDownload || busy}>
            Download fillable PDF
          </button>
        </div>

        {!check.canExport && <p className="footnote">Fix the problems above to enable the preview.</p>}
        {check.canExport && needsConfirmation && (
          <p className="footnote">Tick the confirmation above to enable the preview.</p>
        )}

        {previewUrl && (
          <>
            <p className="hint" style={{ marginTop: 14 }}>
              Both pages, exactly as they will download. Scroll inside the preview to reach page 2.
            </p>
            <object className="preview-frame" data={previewUrl} type={PDF_MIME} aria-label="Settlement preview">
              <p>
                Your browser cannot display the PDF inline.{' '}
                <a href={previewUrl} target="_blank" rel="noreferrer">
                  Open the preview in a new tab
                </a>
                .
              </p>
            </object>
            <p className="hint" style={{ marginTop: 10 }}>
              Check that:
            </p>
            <ul className="checklist">
              <li>Both pages are there.</li>
              <li>Every value sits on its line and inside its box.</li>
              <li>Nothing is cut off, overlapping or covered by a black box.</li>
              <li>No values from another trip appear.</li>
              <li>The driver-signature line is blank.</li>
            </ul>
          </>
        )}
      </Panel>

      <WeekPanel onExport={exportWeek} busy={busy} count={data.trips.filter((t) => t.complete).length} message={weekMessage} />
    </>
  )
}

function WeekPanel({
  onExport,
  busy,
  count,
  message,
}: {
  onExport: () => void
  busy: boolean
  count: number
  message: string | null
}) {
  return (
    <Panel
      title="Export the week"
      hint="Exports a ready-to-email PDF for every trip marked complete, plus one combined PDF."
    >
      {message && <div className="notice">{message}</div>}
      <div className="panel-actions">
        <button onClick={onExport} disabled={busy || count === 0}>
          Export all completed trips ({count})
        </button>
      </div>
      <p className="footnote">
        A trip that fails validation is skipped and named, rather than exported with missing values.
      </p>
    </Panel>
  )
}
