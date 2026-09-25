/**
 * "Combine trips into one Monday envelope".
 *
 * Produces ONE two-page settlement holding the combined figures for two or
 * more completed trips. The source trips stay exactly as they are: this only
 * builds a temporary record to export from.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { combineTrips, envelopeFileName, nextMonday } from '../lib/envelope'
import { buildSettlementPdfs, type SettlementPdfs } from '../lib/pdfExport'
import { validateTripForExport } from '../lib/validation'
import { calculateTrip } from '../lib/calc'
import { downloadBytes, PDF_MIME } from '../lib/download'
import { formatCurrency, formatMiles, formatSignedMiles } from '../lib/money'
import { newId } from '../lib/trips'
import { Empty, IssueList, Panel, Tile } from '../components/ui'
import type { AppStore } from '../useAppData'

export function MondayEnvelopePanel({ store }: { store: AppStore }) {
  const { data, recordExport } = store
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [mondayDate, setMondayDate] = useState(() => nextMonday())
  const [acknowledged, setAcknowledged] = useState(false)
  const [built, setBuilt] = useState<SettlementPdfs | null>(null)
  const [builtKey, setBuiltKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const objectUrl = useRef<string | null>(null)

  const completed = useMemo(() => data.trips.filter((trip) => trip.complete), [data.trips])
  const selected = useMemo(
    () => completed.filter((trip) => selectedIds.includes(trip.id)),
    [completed, selectedIds],
  )

  // Drop selections whose trip was deleted or reopened.
  useEffect(() => {
    const live = new Set(completed.map((trip) => trip.id))
    setSelectedIds((current) => {
      const kept = current.filter((id) => live.has(id))
      return kept.length === current.length ? current : kept
    })
  }, [completed])

  const envelope = useMemo(() => {
    if (selected.length < 2) return null
    try {
      return combineTrips({ trips: selected, mondayDate })
    } catch {
      return null
    }
  }, [selected, mondayDate])

  const check = useMemo(
    () => (envelope ? validateTripForExport(envelope.trip) : null),
    [envelope],
  )

  /** Anything that changes the envelope must invalidate the preview. */
  const key = useMemo(
    () =>
      `${mondayDate}|${selected
        .map((trip) => `${trip.id}@${trip.updatedAt}`)
        .sort()
        .join(',')}`,
    [mondayDate, selected],
  )
  const stale = built !== null && builtKey !== key

  const releasePreview = useCallback(() => {
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = null
    }
    setPreviewUrl(null)
  }, [])

  useEffect(() => releasePreview, [releasePreview])

  const toggle = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    )
    setAcknowledged(false)
  }

  const previouslyExported = useMemo(() => {
    const byTrip = new Map<string, number>()
    for (const record of data.exportHistory) {
      byTrip.set(record.tripId, (byTrip.get(record.tripId) ?? 0) + 1)
    }
    return byTrip
  }, [data.exportHistory])

  const alreadyExported = selected.filter((trip) => previouslyExported.has(trip.id))

  const totals = check?.totals ?? null
  const needsConfirmation = (check?.warnings.length ?? 0) > 0 && !acknowledged
  const canPreview = Boolean(check?.canExport) && !needsConfirmation && selected.length >= 2
  const canDownload = canPreview && built !== null && !stale

  const preview = async () => {
    if (!envelope) return
    setBusy(true)
    setError(null)
    try {
      const result = await buildSettlementPdfs(envelope.trip)
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
      setBuiltKey(key)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const download = (kind: 'flattened' | 'fillable') => {
    if (!envelope || !built) return
    const fileName = envelopeFileName(envelope, kind)
    downloadBytes(built[kind], fileName, PDF_MIME)
    // One history entry per source trip, so each trip shows as exported.
    const exportedAt = new Date().toISOString()
    for (const trip of envelope.sourceTrips) {
      recordExport({
        id: newId(),
        tripId: trip.id,
        tripNumber: trip.tripNumber,
        exportedAt,
        kind,
        fileName,
        envelopeDate: envelope.mondayDate,
      })
    }
  }

  return (
    <Panel
      title="Combine trips into one Monday envelope"
      hint="Puts two or more completed trips on a single two-page settlement, for handing in on Monday."
    >
      <div className="notice">
        Your trips stay separate. This builds one combined settlement to print; nothing is merged,
        renumbered or deleted, and each trip can still be exported on its own.
      </div>
      <div className="notice">
        State-mile rows stay in travel order from the first selected trip through the last.
        Revisited states remain separate rows; the combined total adds every row.
      </div>

      {completed.length < 2 ? (
        <Empty>
          Mark at least two trips complete on Weekly Pay to build a Monday envelope.
          {completed.length === 1 && ' One trip is complete so far.'}
        </Empty>
      ) : (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 44 }}>Use</th>
                  <th>Trip #</th>
                  <th>Dates</th>
                  <th className="num">Paid miles</th>
                  <th className="num">Mileage pay</th>
                  <th>Previously exported</th>
                </tr>
              </thead>
              <tbody>
                {completed.map((trip) => {
                  const tripTotals = calculateTrip(trip)
                  const exports = previouslyExported.get(trip.id) ?? 0
                  return (
                    <tr key={trip.id} aria-selected={selectedIds.includes(trip.id)}>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          aria-label={`Include trip ${trip.tripNumber || '(no number)'} in the Monday envelope`}
                          checked={selectedIds.includes(trip.id)}
                          onChange={() => toggle(trip.id)}
                        />
                      </td>
                      <td>{trip.tripNumber || '(no number)'}</td>
                      <td>
                        {trip.startDate || '--'} to {trip.endDate || '--'}
                      </td>
                      <td className="num">{formatMiles(tripTotals.paidMiles) || '--'}</td>
                      <td className="num">{formatCurrency(tripTotals.mileagePay)}</td>
                      <td>
                        {exports > 0 ? (
                          <span className="pill exported">
                            {exports === 1 ? 'Exported' : `Exported x${exports}`}
                          </span>
                        ) : (
                          <span className="zero">Not yet</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="panel-actions">
            <button
              className="small"
              onClick={() => {
                setSelectedIds(completed.map((trip) => trip.id))
                setAcknowledged(false)
              }}
              disabled={selectedIds.length === completed.length}
            >
              Select all completed trips
            </button>
            <button
              className="small"
              onClick={() => {
                setSelectedIds([])
                setAcknowledged(false)
              }}
              disabled={selectedIds.length === 0}
            >
              Clear selection
            </button>
          </div>

          <div className="field-grid" style={{ marginTop: 12, maxWidth: 320 }}>
            <label className="field">
              <span>Monday submission date</span>
              <input
                type="date"
                value={mondayDate}
                onChange={(event) => {
                  setMondayDate(event.target.value)
                  setAcknowledged(false)
                }}
              />
            </label>
          </div>
          <p className="footnote">
            Defaults to the next Monday. It names the file; the printed form has no field for it, so
            it is not written onto the page.
          </p>

          {selected.length > 0 && selected.length < 2 && (
            <div className="warning">Select at least two trips to build an envelope.</div>
          )}

          {envelope && totals && (
            <>
              <p className="hint" style={{ marginTop: 14 }}>
                Combining <strong>{envelope.tripNumbers.join(', ')}</strong> ({envelope.trip.startDate || '--'} to{' '}
                {envelope.trip.endDate || '--'}) onto one settlement for Monday {mondayDate}.
              </p>

              <div className="tiles">
                <Tile
                  label="Combined odometer miles"
                  value={formatMiles(totals.actualMiles) || '--'}
                  sub={`${formatMiles(totals.beginningOdometer) || '--'} to ${formatMiles(totals.endingOdometer) || '--'}`}
                />
                <Tile
                  label="Combined paid miles"
                  value={formatMiles(totals.paidMiles) || '--'}
                  sub={
                    totals.paidMilesDifference === null || totals.paidMilesDifference === 0
                      ? 'Matches the odometer'
                      : `${formatSignedMiles(totals.paidMilesDifference)} vs odometer`
                  }
                />
                <Tile
                  label="Combined state miles"
                  value={formatMiles(totals.stateMilesTotal)}
                  sub={
                    totals.stateMilesDifference === null || totals.stateMilesDifference === 0
                      ? 'Matches the odometer'
                      : `${formatSignedMiles(totals.stateMilesDifference)} vs odometer`
                  }
                />
                <Tile
                  label="Combined mileage pay"
                  value={formatCurrency(totals.mileagePay)}
                  sub={envelope.mixedRates ? 'Exact sum of each trip' : undefined}
                />
                <Tile label="Combined gross pay" value={formatCurrency(totals.grossPay)} />
                <Tile
                  label="Total pay on the form"
                  value={formatCurrency(totals.settlementPay)}
                  sub="Gross + reimbursements - advances"
                />
                <Tile
                  label="Combined tax reserve"
                  value={formatCurrency(totals.taxReserve)}
                  sub="Kept in the app; the form has no field for it"
                />
                <Tile
                  label="Estimated net"
                  value={formatCurrency(totals.estimatedNetPay)}
                />
              </div>

              {envelope.mixedRates && (
                <div className="notice">
                  These trips used different mileage rates. The combined mileage pay is the exact sum
                  of each trip's own pay ({formatCurrency(envelope.exactMileagePay)}); the form shows
                  a single blended rate because it has only one rate line.
                </div>
              )}

              {alreadyExported.length > 0 && (
                <div className="warning">
                  {alreadyExported.length === 1
                    ? `Trip ${alreadyExported[0].tripNumber} has`
                    : `Trips ${alreadyExported.map((t) => t.tripNumber).join(', ')} have`}{' '}
                  already been exported from this device. Including them again is fine, but check you
                  are not submitting the same pay twice.
                </div>
              )}

              <IssueList issues={check?.errors ?? []} kind="error" />

              {(check?.warnings.length ?? 0) > 0 && (
                <>
                  <IssueList issues={check?.warnings ?? []} kind="warning" />
                  <label className="field checkbox">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(event) => setAcknowledged(event.target.checked)}
                    />
                    <span>
                      I have read the combined numbers above and they are correct. Build the envelope
                      without changing them.
                    </span>
                  </label>
                </>
              )}

              {error && <div className="error">{error}</div>}
              {stale && (
                <div className="warning">
                  The selection or date changed after the preview was built. Preview again so the
                  download matches what you see.
                </div>
              )}

              <div className="panel-actions">
                <button className="primary" onClick={preview} disabled={!canPreview || busy}>
                  {busy ? 'Working...' : 'Preview Monday envelope'}
                </button>
                <button onClick={() => download('flattened')} disabled={!canDownload || busy}>
                  Download ready-to-email envelope
                </button>
                <button onClick={() => download('fillable')} disabled={!canDownload || busy}>
                  Download fillable envelope
                </button>
              </div>

              {!check?.canExport && (
                <p className="footnote">Fix the problems above to enable the preview.</p>
              )}
              {check?.canExport && needsConfirmation && (
                <p className="footnote">Tick the confirmation above to enable the preview.</p>
              )}
              {canDownload && (
                <p className="footnote">
                  Saves as <code>{envelopeFileName(envelope, 'flattened')}</code>
                </p>
              )}

              {previewUrl && (
                <>
                  <p className="hint" style={{ marginTop: 14 }}>
                    One settlement, two pages, holding every selected trip.
                  </p>
                  <object
                    className="preview-frame"
                    data={previewUrl}
                    type={PDF_MIME}
                    aria-label="Monday envelope preview"
                  >
                    <p>
                      Your browser cannot display the PDF inline.{' '}
                      <a href={previewUrl} target="_blank" rel="noreferrer">
                        Open the preview in a new tab
                      </a>
                      .
                    </p>
                  </object>
                  <ul className="checklist">
                    <li>Both pages are there.</li>
                    <li>Every selected trip number appears.</li>
                    <li>Nothing is cut off or overlapping.</li>
                    <li>The driver-signature line is blank.</li>
                  </ul>
                </>
              )}
            </>
          )}
        </>
      )}
    </Panel>
  )
}
