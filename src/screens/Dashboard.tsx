/** Dashboard: what needs attention, and the quickest way to get there. */
import { calculateTrip, calculateWeek } from '../lib/calc'
import { validateTripForExport } from '../lib/validation'
import { formatCurrency, formatMiles, formatSignedMiles } from '../lib/money'
import { createTrip } from '../lib/trips'
import { Empty, Panel, Tile } from '../components/ui'
import type { AppStore } from '../useAppData'
import type { ScreenId } from '../App'

export function Dashboard({ store, go }: { store: AppStore; go: (screen: ScreenId) => void }) {
  const { data, selectedTrip, addTrip } = store
  const week = calculateWeek(data.trips)

  const attention = data.trips
    .map((trip) => ({ trip, check: validateTripForExport(trip) }))
    .filter(({ check }) => check.errors.length > 0 || check.warnings.length > 0)

  const totals = selectedTrip ? calculateTrip(selectedTrip) : null

  return (
    <>
      <Panel title="This week">
        <div className="tiles">
          <Tile label="Trips" value={week.trips} sub={`${week.completeTrips} complete`} />
          <Tile label="Paid miles" value={formatMiles(week.paidMiles)} />
          <Tile label="Gross pay" value={formatCurrency(week.grossPay)} />
          <Tile label="Tax reserve" value={formatCurrency(week.taxReserve)} />
          <Tile label="Estimated net" value={formatCurrency(week.estimatedNetPay)} />
        </div>
        <div className="panel-actions">
          <button className="primary" onClick={() => addTrip(createTrip(data.settings))}>
            Add a trip
          </button>
          <button onClick={() => go('weekly')}>Open Weekly Pay</button>
          <button onClick={() => go('settings')}>Import a workbook</button>
        </div>
      </Panel>

      {selectedTrip && totals ? (
        <Panel title={`Selected: trip ${selectedTrip.tripNumber || '(no number)'}`}>
          <div className="tiles">
            <Tile label="Actual miles" value={formatMiles(totals.actualMiles) || '--'} />
            <Tile
              label="Paid miles"
              value={formatMiles(totals.paidMiles) || '--'}
              sub={
                totals.paidMilesDifference === null || totals.paidMilesDifference === 0
                  ? 'Matches the odometer'
                  : `${formatSignedMiles(totals.paidMilesDifference)} vs odometer`
              }
            />
            <Tile
              label="State miles"
              value={formatMiles(totals.stateMilesTotal)}
              sub={
                totals.stateMilesDifference === null || totals.stateMilesDifference === 0
                  ? 'Matches the odometer'
                  : `${formatSignedMiles(totals.stateMilesDifference)} vs odometer`
              }
            />
            <Tile label="Gross pay" value={formatCurrency(totals.grossPay)} />
            <Tile label="Estimated net" value={formatCurrency(totals.estimatedNetPay)} />
          </div>
          <div className="panel-actions">
            <button onClick={() => go('trip')}>Trip details</button>
            <button onClick={() => go('routes')}>Routes</button>
            <button onClick={() => go('states')}>State miles</button>
            <button onClick={() => go('fuel')}>Fuel</button>
            <button onClick={() => go('expenses')}>Expenses</button>
            <button onClick={() => go('advances')}>Advances</button>
            <button className="primary" onClick={() => go('export')}>
              Preview and export
            </button>
          </div>
        </Panel>
      ) : (
        <Panel title="No trip selected">
          <Empty>
            {data.trips.length === 0
              ? 'Add a trip, or import your existing workbook from Settings and Data Backup.'
              : 'Choose a trip on Weekly Pay to start working on it.'}
          </Empty>
        </Panel>
      )}

      <Panel title="Needs attention" hint="Problems that block an export, and differences that need your confirmation.">
        {attention.length === 0 ? (
          <Empty>Nothing outstanding.</Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Trip</th>
                  <th className="num">Blocking</th>
                  <th className="num">To confirm</th>
                  <th>First item</th>
                </tr>
              </thead>
              <tbody>
                {attention.map(({ trip, check }) => (
                  <tr key={trip.id}>
                    <td>
                      <button className="link" onClick={() => { store.selectTrip(trip.id); go('trip') }}>
                        {trip.tripNumber || '(no number)'}
                      </button>
                    </td>
                    <td className="num">{check.errors.length > 0 ? <span className="neg">{check.errors.length}</span> : '0'}</td>
                    <td className="num">{check.warnings.length || '0'}</td>
                    <td style={{ whiteSpace: 'normal' }}>
                      {(check.errors[0] ?? check.warnings[0])?.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}
