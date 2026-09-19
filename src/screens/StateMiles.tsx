/** State mileage for the selected trip, with the differences shown plainly. */
import { CAPACITY } from '../config/pdfFieldMapping'
import { calculateTrip } from '../lib/calc'
import { formatMiles, formatSignedMiles } from '../lib/money'
import { emptyStateMile } from '../lib/trips'
import { Empty, Panel, Tile } from '../components/ui'
import type { StateMileRow } from '../types'
import type { AppStore } from '../useAppData'

export function StateMiles({ store }: { store: AppStore }) {
  const { selectedTrip, updateTrip } = store
  if (!selectedTrip) {
    return (
      <Panel title="State miles">
        <Empty>Select a trip on Weekly Pay first.</Empty>
      </Panel>
    )
  }

  const trip = selectedTrip
  const totals = calculateTrip(trip)
  const rows = trip.stateMiles
  const overflow = rows.filter((row) => row.state.trim()).length > CAPACITY.stateMiles

  const setRows = (next: StateMileRow[]) => updateTrip(trip.id, (current) => ({ ...current, stateMiles: next }))
  const patch = (id: string, change: Partial<StateMileRow>) =>
    setRows(rows.map((row) => (row.id === id ? { ...row, ...change } : row)))

  const difference = (value: number | null) => {
    if (value === null) return <span className="zero">--</span>
    if (value === 0) return <span className="pos">0 - they agree</span>
    return <span className="neg">{formatSignedMiles(value)}</span>
  }

  return (
    <>
      <Panel title="Mileage check" hint="These differences are reported, never corrected.">
        <div className="tiles">
          <Tile label="Total state miles" value={formatMiles(totals.stateMilesTotal)} sub={`${rows.length} rows`} />
          <Tile
            label="Actual odometer miles"
            value={formatMiles(totals.actualMiles) || '--'}
            sub={`${formatMiles(totals.endingOdometer) || '--'} - ${formatMiles(totals.beginningOdometer) || '--'}`}
          />
          <Tile
            label="State miles vs actual"
            value={difference(totals.stateMilesDifference)}
            sub="State total minus odometer"
          />
          <Tile
            label="Paid miles vs actual"
            value={difference(totals.paidMilesDifference)}
            sub={`Paid ${formatMiles(totals.paidMiles) || '--'}`}
          />
        </div>
      </Panel>

      <Panel
        title="State rows"
        hint={`The printed form holds ${CAPACITY.stateMiles} rows across its two tables.`}
      >
        {overflow && (
          <div className="warning">
            More than {CAPACITY.stateMiles} state rows have been entered. The extra rows stay in the app
            and the Excel export, but will not fit on the PDF.
          </div>
        )}
        {rows.length === 0 ? (
          <Empty>No state rows yet. At least one is required before exporting.</Empty>
        ) : (
          <div className="table-scroll">
            <table className="row-table">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>State</th>
                  <th style={{ width: 110 }}>Miles</th>
                  <th>Highways used</th>
                  <th style={{ width: 100 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id} style={index >= CAPACITY.stateMiles ? { opacity: 0.6 } : undefined}>
                    <td>
                      <input
                        value={row.state}
                        maxLength={2}
                        aria-label={`State for row ${index + 1}`}
                        onChange={(event) => patch(row.id, { state: event.target.value.toUpperCase() })}
                      />
                    </td>
                    <td>
                      <input
                        value={row.miles}
                        inputMode="numeric"
                        aria-label={`Miles for row ${index + 1}`}
                        onChange={(event) => patch(row.id, { miles: event.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        value={row.highways}
                        aria-label={`Highways for row ${index + 1}`}
                        onChange={(event) => patch(row.id, { highways: event.target.value })}
                      />
                    </td>
                    <td>
                      <button className="small danger" onClick={() => setRows(rows.filter((r) => r.id !== row.id))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th className="num">{formatMiles(totals.stateMilesTotal)}</th>
                  <th colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <div className="panel-actions">
          <button onClick={() => setRows([...rows, emptyStateMile()])}>Add a state row</button>
        </div>
      </Panel>
    </>
  )
}
