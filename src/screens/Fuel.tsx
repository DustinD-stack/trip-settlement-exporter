/** Fuel and DEF purchases for the selected trip. */
import { CAPACITY } from '../config/pdfFieldMapping'
import { calculateTrip } from '../lib/calc'
import { formatCurrency, isBlank, parseNumber } from '../lib/money'
import { emptyFuel } from '../lib/trips'
import { Empty, Panel, Tile } from '../components/ui'
import type { FuelRow } from '../types'
import type { AppStore } from '../useAppData'

export function Fuel({ store }: { store: AppStore }) {
  const { selectedTrip, updateTrip } = store
  if (!selectedTrip) {
    return (
      <Panel title="Fuel and DEF">
        <Empty>Select a trip on Weekly Pay first.</Empty>
      </Panel>
    )
  }

  const trip = selectedTrip
  const totals = calculateTrip(trip)
  const rows = trip.fuel
  const missingInvoice = rows.filter((row) => (parseNumber(row.total) ?? 0) > 0 && !row.invoice.trim())
  const overflow = rows.filter((row) => row.seller.trim() || !isBlank(row.total)).length > CAPACITY.fuel

  const setRows = (next: FuelRow[]) => updateTrip(trip.id, (current) => ({ ...current, fuel: next }))
  const patch = (id: string, change: Partial<FuelRow>) =>
    setRows(rows.map((row) => (row.id === id ? { ...row, ...change } : row)))

  return (
    <Panel
      title="Fuel and DEF purchases"
      hint={`The printed form holds ${CAPACITY.fuel} rows. Record purchases you paid for yourself.`}
    >
      <div className="tiles">
        <Tile label="Fuel total" value={formatCurrency(totals.fuelTotal)} sub={`${rows.length} entries`} />
        <Tile label="Missing invoices" value={missingInvoice.length} sub="Amount entered, no invoice number" />
      </div>

      {missingInvoice.length > 0 && (
        <div className="warning">
          {missingInvoice.length} fuel purchase{missingInvoice.length === 1 ? ' has' : 's have'} an amount
          but no invoice or receipt number. You will be asked to confirm this before exporting.
        </div>
      )}
      {overflow && (
        <div className="warning">
          More than {CAPACITY.fuel} fuel entries. The extra rows stay in the app and the Excel export, but
          will not fit on the PDF.
        </div>
      )}

      {rows.length === 0 ? (
        <Empty>No fuel entries.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="row-table" style={{ minWidth: 960 }}>
            <thead>
              <tr>
                <th style={{ width: 135 }}>Date</th>
                <th style={{ width: 72 }}>State</th>
                <th>Invoice / receipt</th>
                <th>Seller</th>
                <th style={{ width: 95 }}>Truck gal</th>
                <th style={{ width: 98 }}>Reefer gal</th>
                <th style={{ width: 88 }}>DEF gal</th>
                <th style={{ width: 105 }}>Total $</th>
                <th style={{ width: 92 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id} style={index >= CAPACITY.fuel ? { opacity: 0.6 } : undefined}>
                  <td>
                    <input type="date" value={row.date} aria-label={`Fuel date ${index + 1}`} onChange={(e) => patch(row.id, { date: e.target.value })} />
                  </td>
                  <td>
                    <input value={row.state} maxLength={2} aria-label={`Fuel state ${index + 1}`} onChange={(e) => patch(row.id, { state: e.target.value.toUpperCase() })} />
                  </td>
                  <td>
                    <input value={row.invoice} aria-label={`Fuel invoice ${index + 1}`} onChange={(e) => patch(row.id, { invoice: e.target.value })} />
                  </td>
                  <td>
                    <input value={row.seller} aria-label={`Fuel seller ${index + 1}`} onChange={(e) => patch(row.id, { seller: e.target.value })} />
                  </td>
                  <td>
                    <input value={row.truckGallons} inputMode="decimal" aria-label={`Truck gallons ${index + 1}`} onChange={(e) => patch(row.id, { truckGallons: e.target.value })} />
                  </td>
                  <td>
                    <input value={row.reeferGallons} inputMode="decimal" aria-label={`Reefer gallons ${index + 1}`} onChange={(e) => patch(row.id, { reeferGallons: e.target.value })} />
                  </td>
                  <td>
                    <input value={row.defGallons} inputMode="decimal" aria-label={`DEF gallons ${index + 1}`} onChange={(e) => patch(row.id, { defGallons: e.target.value })} />
                  </td>
                  <td>
                    <input value={row.total} inputMode="decimal" aria-label={`Fuel total ${index + 1}`} onChange={(e) => patch(row.id, { total: e.target.value })} />
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
                <th colSpan={7}>Total</th>
                <th className="num">{formatCurrency(totals.fuelTotal)}</th>
                <th />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="panel-actions">
        <button onClick={() => setRows([...rows, emptyFuel()])}>Add a fuel entry</button>
      </div>
    </Panel>
  )
}
