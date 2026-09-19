/** Expenses and reimbursements for the selected trip. */
import { CAPACITY } from '../config/pdfFieldMapping'
import { calculateTrip, categoryTotal } from '../lib/calc'
import { formatCurrency, isBlank, parseNumber } from '../lib/money'
import { buildOtherExpenseText } from '../lib/validation'
import { emptyExpense } from '../lib/trips'
import { Empty, Panel, Tile } from '../components/ui'
import { EXPENSE_CATEGORIES, type ExpenseCategory, type ExpenseRow } from '../types'
import type { AppStore } from '../useAppData'

export function Expenses({ store }: { store: AppStore }) {
  const { selectedTrip, updateTrip } = store
  if (!selectedTrip) {
    return (
      <Panel title="Expenses and reimbursements">
        <Empty>Select a trip on Weekly Pay first.</Empty>
      </Panel>
    )
  }

  const trip = selectedTrip
  const totals = calculateTrip(trip)
  const rows = trip.expenses

  const missingAmount = rows.filter((row) => row.description.trim() && isBlank(row.amount))
  const missingReceipt = rows.filter((row) => (parseNumber(row.amount) ?? 0) > 0 && !row.receipt.trim())
  const otherText = buildOtherExpenseText(trip)
  const otherTooLong = otherText.length > CAPACITY.otherExpenseChars

  const setRows = (next: ExpenseRow[]) => updateTrip(trip.id, (current) => ({ ...current, expenses: next }))
  const patch = (id: string, change: Partial<ExpenseRow>) =>
    setRows(rows.map((row) => (row.id === id ? { ...row, ...change } : row)))

  return (
    <>
      <Panel title="Totals" hint="Expenses and reimbursements are kept apart. Paying for something does not mean it was repaid.">
        <div className="tiles">
          <Tile label="Total expenses" value={formatCurrency(totals.expenseTotal)} sub="Money you paid" />
          <Tile label="Total reimbursements" value={formatCurrency(totals.reimbursementTotal)} sub="Money repaid to you" />
          <Tile label="Scales" value={formatCurrency(categoryTotal(totals, 'Scales'))} />
          <Tile label="Tolls" value={formatCurrency(categoryTotal(totals, 'Tolls'))} />
          <Tile label="Repairs" value={formatCurrency(categoryTotal(totals, 'Repairs'))} />
          <Tile label="Lumpers" value={formatCurrency(categoryTotal(totals, 'Lumpers'))} />
          <Tile
            label="Other on the PDF"
            value={formatCurrency(totals.otherExpenseTotal)}
            sub="Parking, Supplies, Other and uncategorised"
          />
        </div>
      </Panel>

      <Panel
        title="What goes on the printed form"
        hint='The form has one rule each for Scales, Tolls, Repairs and Lumpers, plus a single "OTHER $:" rule.'
      >
        <div className="notice">
          <strong>OTHER $: </strong>
          {otherText || <span className="zero">(nothing yet)</span>}
          <span className="detail" style={{ display: 'block', color: 'var(--muted)', fontSize: 13 }}>
            {otherText.length} of about {CAPACITY.otherExpenseChars} characters that fit.
          </span>
        </div>
        {otherTooLong && (
          <div className="warning">
            That text is too long for the printed rule and will be shortened on the PDF. The full text stays
            in the app and the Excel export. Shorten a description to control what appears.
          </div>
        )}
      </Panel>

      <Panel title="Expenses">
        {missingAmount.length > 0 && (
          <div className="warning">
            {missingAmount.length} expense{missingAmount.length === 1 ? '' : 's'} have a description but no
            amount ({missingAmount.map((row) => row.description).join(', ')}). The amount will be left blank
            on the PDF.
          </div>
        )}
        {missingReceipt.length > 0 && (
          <div className="warning">
            {missingReceipt.length} expense{missingReceipt.length === 1 ? '' : 's'} have an amount but no
            receipt number. You will be asked to confirm this before exporting.
          </div>
        )}

        {rows.length === 0 ? (
          <Empty>No expenses.</Empty>
        ) : (
          <div className="table-scroll">
            <table className="row-table" style={{ minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={{ width: 135 }}>Date</th>
                  <th style={{ width: 118 }}>Category</th>
                  <th>Description</th>
                  <th style={{ width: 70 }}>State</th>
                  <th style={{ width: 130 }}>Receipt number</th>
                  <th style={{ width: 105 }}>Amount</th>
                  <th style={{ width: 125 }}>Reimbursed</th>
                  <th style={{ width: 92 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id}>
                    <td>
                      <input type="date" value={row.date} aria-label={`Expense date ${index + 1}`} onChange={(e) => patch(row.id, { date: e.target.value })} />
                    </td>
                    <td>
                      <select
                        value={row.category}
                        aria-label={`Expense category ${index + 1}`}
                        onChange={(e) => patch(row.id, { category: e.target.value as ExpenseCategory | '' })}
                      >
                        <option value="">--</option>
                        {EXPENSE_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input value={row.description} aria-label={`Expense description ${index + 1}`} onChange={(e) => patch(row.id, { description: e.target.value })} />
                    </td>
                    <td>
                      <input value={row.state} maxLength={2} aria-label={`Expense state ${index + 1}`} onChange={(e) => patch(row.id, { state: e.target.value.toUpperCase() })} />
                    </td>
                    <td>
                      <input value={row.receipt} aria-label={`Expense receipt ${index + 1}`} onChange={(e) => patch(row.id, { receipt: e.target.value })} />
                    </td>
                    <td>
                      <input
                        value={row.amount}
                        inputMode="decimal"
                        aria-label={`Expense amount ${index + 1}`}
                        placeholder="blank = missing"
                        onChange={(e) => patch(row.id, { amount: e.target.value })}
                      />
                    </td>
                    <td>
                      <input value={row.reimbursement} inputMode="decimal" aria-label={`Reimbursement ${index + 1}`} onChange={(e) => patch(row.id, { reimbursement: e.target.value })} />
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
                  <th colSpan={5}>Totals</th>
                  <th className="num">{formatCurrency(totals.expenseTotal)}</th>
                  <th className="num">{formatCurrency(totals.reimbursementTotal)}</th>
                  <th />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="panel-actions">
          <button onClick={() => setRows([...rows, emptyExpense()])}>Add an expense</button>
        </div>
        <p className="footnote">
          Leaving an amount blank is allowed. The app warns about it and leaves the money blank on the PDF
          rather than guessing a number.
        </p>
      </Panel>
    </>
  )
}
