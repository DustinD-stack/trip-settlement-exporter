/** Advances and deductions for the selected trip. */
import { CAPACITY } from '../config/pdfFieldMapping'
import { calculateTrip } from '../lib/calc'
import { formatCurrency, isBlank } from '../lib/money'
import { emptyAdvance } from '../lib/trips'
import { Empty, Panel, Tile } from '../components/ui'
import type { AdvanceRow } from '../types'
import type { AppStore } from '../useAppData'

const TYPES = ['Cash', 'EFS', 'COM Check', 'T-Check', 'Payroll deduction', 'Other']

export function Advances({ store }: { store: AppStore }) {
  const { selectedTrip, updateTrip } = store
  if (!selectedTrip) {
    return (
      <Panel title="Advances and deductions">
        <Empty>Select a trip on Weekly Pay first.</Empty>
      </Panel>
    )
  }

  const trip = selectedTrip
  const totals = calculateTrip(trip)
  const rows = trip.advances
  const used = rows.filter((row) => !isBlank(row.amount) || row.type.trim()).length
  const overflow = used > CAPACITY.advances

  const setRows = (next: AdvanceRow[]) => updateTrip(trip.id, (current) => ({ ...current, advances: next }))
  const patch = (id: string, change: Partial<AdvanceRow>) =>
    setRows(rows.map((row) => (row.id === id ? { ...row, ...change } : row)))

  return (
    <Panel
      title="Advances and deductions"
      hint={`The printed form has ${CAPACITY.advances} rows. Advances reduce your estimated net pay.`}
    >
      <div className="tiles">
        <Tile label="Total advances" value={formatCurrency(totals.advanceTotal)} sub={`${rows.length} entries`} />
        <Tile
          label="Money left on hand"
          value={formatCurrency(totals.moneyLeftOnHand)}
          sub="Advances received minus expenses paid"
        />
        <Tile
          label="Estimated net pay"
          value={formatCurrency(totals.estimatedNetPay)}
          sub="After reimbursements, advances and the tax reserve"
        />
      </div>

      {overflow && (
        <div className="warning">
          {used} advance rows entered, but the printed form has room for {CAPACITY.advances}. The extra rows
          stay in the app and the Excel export, but will not fit on the PDF.
        </div>
      )}

      {rows.length === 0 ? (
        <Empty>No advances or deductions.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="row-table">
            <thead>
              <tr>
                <th style={{ width: 140 }}>Date</th>
                <th style={{ width: 115 }}>Amount</th>
                <th style={{ width: 175 }}>Type</th>
                <th>Notes</th>
                <th style={{ width: 92 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id} style={index >= CAPACITY.advances ? { opacity: 0.6 } : undefined}>
                  <td>
                    <input type="date" value={row.date} aria-label={`Advance date ${index + 1}`} onChange={(e) => patch(row.id, { date: e.target.value })} />
                  </td>
                  <td>
                    <input value={row.amount} inputMode="decimal" aria-label={`Advance amount ${index + 1}`} onChange={(e) => patch(row.id, { amount: e.target.value })} />
                  </td>
                  <td>
                    <input
                      value={row.type}
                      list="advance-types"
                      aria-label={`Advance type ${index + 1}`}
                      onChange={(e) => patch(row.id, { type: e.target.value })}
                    />
                  </td>
                  <td>
                    <input value={row.notes} aria-label={`Advance notes ${index + 1}`} onChange={(e) => patch(row.id, { notes: e.target.value })} />
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
                <th className="num">{formatCurrency(totals.advanceTotal)}</th>
                <th colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <datalist id="advance-types">
        {TYPES.map((type) => (
          <option key={type} value={type} />
        ))}
      </datalist>

      <div className="panel-actions">
        <button onClick={() => setRows([...rows, emptyAdvance()])}>Add an advance</button>
      </div>
      <p className="footnote">
        Notes stay in the app and the Excel export. The printed advances table has only Date, Amount and Type.
      </p>
    </Panel>
  )
}
