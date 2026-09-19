/** Weekly Pay: one row per trip, with every figure the settlement needs. */
import { calculateTrip, calculateWeek } from '../lib/calc'
import { formatCurrency, formatMiles, formatPercent, formatSignedMiles } from '../lib/money'
import { validateTripForExport } from '../lib/validation'
import { createTrip, duplicateTrip } from '../lib/trips'
import { Empty, Panel, Tile } from '../components/ui'
import type { AppStore } from '../useAppData'
import type { Trip } from '../types'

export function WeeklyPay({
  store,
  onEdit,
  onExport,
  onExportAll,
}: {
  store: AppStore
  onEdit: (id: string) => void
  onExport: (id: string) => void
  onExportAll: () => void
}) {
  const { data, addTrip, updateTrip, deleteTrip, selectTrip } = store
  const week = calculateWeek(data.trips)
  const completeTrips = data.trips.filter((trip) => trip.complete)

  const exportedTripNumbers = new Set(data.exportHistory.map((record) => record.tripId))

  const remove = (trip: Trip) => {
    const label = trip.tripNumber ? `trip ${trip.tripNumber}` : 'this trip'
    const message =
      `Delete ${label} and everything recorded against it ` +
      `(${trip.routes.length} stops, ${trip.stateMiles.length} state rows, ` +
      `${trip.fuel.length} fuel entries, ${trip.expenses.length} expenses, ` +
      `${trip.advances.length} advances)?\n\nThis cannot be undone.`
    if (window.confirm(message)) deleteTrip(trip.id)
  }

  return (
    <>
      <Panel title="Week summary">
        <div className="tiles">
          <Tile label="Trips" value={week.trips} sub={`${week.completeTrips} marked complete`} />
          <Tile label="Paid miles" value={formatMiles(week.paidMiles)} sub={`${formatMiles(week.actualMiles)} odometer`} />
          <Tile label="Gross pay" value={formatCurrency(week.grossPay)} />
          <Tile label="Reimbursements" value={formatCurrency(week.reimbursements)} />
          <Tile label="Expenses" value={formatCurrency(week.expenses)} />
          <Tile label="Advances" value={formatCurrency(week.advances)} />
          <Tile label="Tax reserve" value={formatCurrency(week.taxReserve)} />
          <Tile label="Estimated net" value={formatCurrency(week.estimatedNetPay)} />
        </div>
        <div className="panel-actions">
          <button className="primary" onClick={() => addTrip(createTrip(data.settings))}>
            Add a trip
          </button>
          <button onClick={onExportAll} disabled={completeTrips.length === 0}>
            Export all completed trips ({completeTrips.length})
          </button>
        </div>
      </Panel>

      <Panel
        title="Trips"
        hint="Select a trip to work on it, then use PDF Preview and Export. Nothing here is ever adjusted automatically."
      >
        {data.trips.length === 0 ? (
          <Empty>No trips yet. Add one, or import your workbook from Settings and Data Backup.</Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Start</th>
                  <th>End</th>
                  <th>Trip #</th>
                  <th>PRO</th>
                  <th>BOL</th>
                  <th>Truck</th>
                  <th>Trailer</th>
                  <th>Origin</th>
                  <th>Destination</th>
                  <th className="num">Begin odo</th>
                  <th className="num">End odo</th>
                  <th className="num">Actual</th>
                  <th className="num">Paid</th>
                  <th className="num">Rate</th>
                  <th className="num">Mileage pay</th>
                  <th className="num">Extra stop</th>
                  <th className="num">Layover</th>
                  <th className="num">Other</th>
                  <th className="num">Gross</th>
                  <th className="num">Reimb.</th>
                  <th className="num">Expenses</th>
                  <th className="num">Advances</th>
                  <th className="num">Tax rate</th>
                  <th className="num">Tax reserve</th>
                  <th className="num">Est. net</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.trips.map((trip) => {
                  const totals = calculateTrip(trip)
                  const check = validateTripForExport(trip)
                  const selected = trip.id === data.selectedTripId
                  return (
                    <tr key={trip.id} aria-selected={selected}>
                      <td>{trip.startDate || '--'}</td>
                      <td>{trip.endDate || '--'}</td>
                      <td>
                        <button className="link" onClick={() => onEdit(trip.id)}>
                          {trip.tripNumber || '(no number)'}
                        </button>
                      </td>
                      <td>{trip.proNumber || '--'}</td>
                      <td>{trip.bolNumber || '--'}</td>
                      <td>{trip.truckNumber || '--'}</td>
                      <td>{trip.trailerNumber || '--'}</td>
                      <td title={trip.origin}>{trip.origin || '--'}</td>
                      <td title={trip.destination}>{trip.destination || '--'}</td>
                      <td className="num">{formatMiles(totals.beginningOdometer) || '--'}</td>
                      <td className="num">{formatMiles(totals.endingOdometer) || '--'}</td>
                      <td className="num">{formatMiles(totals.actualMiles) || '--'}</td>
                      <td className="num">
                        {formatMiles(totals.paidMiles) || '--'}
                        {totals.paidMilesDifference !== null && totals.paidMilesDifference !== 0 && (
                          <span className="neg"> ({formatSignedMiles(totals.paidMilesDifference)})</span>
                        )}
                      </td>
                      <td className="num">{totals.mileageRate ?? '--'}</td>
                      <td className="num">{formatCurrency(totals.mileagePay)}</td>
                      <td className="num">{formatCurrency(totals.extraStopPay)}</td>
                      <td className="num">{formatCurrency(totals.layoverPay)}</td>
                      <td className="num">{formatCurrency(totals.otherPay)}</td>
                      <td className="num">{formatCurrency(totals.grossPay)}</td>
                      <td className="num">{formatCurrency(totals.reimbursementTotal)}</td>
                      <td className="num">{formatCurrency(totals.expenseTotal)}</td>
                      <td className="num">{formatCurrency(totals.advanceTotal)}</td>
                      <td className="num">{formatPercent(totals.taxReserveRate)}</td>
                      <td className="num">{formatCurrency(totals.taxReserve)}</td>
                      <td className="num">{formatCurrency(totals.estimatedNetPay)}</td>
                      <td>
                        {trip.complete && <span className="pill done">Complete</span>}{' '}
                        {exportedTripNumbers.has(trip.id) && <span className="pill exported">Exported</span>}
                        {!trip.complete && !exportedTripNumbers.has(trip.id) && (
                          <span className="pill">{check.canExport ? 'Ready' : 'In progress'}</span>
                        )}
                      </td>
                      <td>
                        <div className="inline-actions">
                          <button className="small" onClick={() => onEdit(trip.id)}>
                            Edit
                          </button>
                          <button className="small" onClick={() => selectTrip(trip.id)} disabled={selected}>
                            {selected ? 'Selected' : 'Select'}
                          </button>
                          <button className="small" onClick={() => addTrip(duplicateTrip(trip))}>
                            Duplicate
                          </button>
                          <button
                            className="small"
                            onClick={() => updateTrip(trip.id, (current) => ({ ...current, complete: !current.complete }))}
                          >
                            {trip.complete ? 'Reopen' : 'Mark complete'}
                          </button>
                          <button className="small" onClick={() => onExport(trip.id)}>
                            Export
                          </button>
                          <button className="small danger" onClick={() => remove(trip)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="footnote">
          A difference in brackets next to Paid shows how paid miles compare with the odometer. It is a
          warning only; no number is changed.
        </p>
      </Panel>
    </>
  )
}
