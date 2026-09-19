/** Trip identification and pay inputs for the selected trip. */
import { calculateTrip } from '../lib/calc'
import { formatCurrency, formatMiles, formatPercent } from '../lib/money'
import { Empty, Panel, TextField, Tile } from '../components/ui'
import type { AppStore } from '../useAppData'
import type { Trip } from '../types'

export function TripDetails({ store }: { store: AppStore }) {
  const { selectedTrip, updateTrip } = store
  if (!selectedTrip) {
    return (
      <Panel title="Trip details">
        <Empty>Select a trip on Weekly Pay first.</Empty>
      </Panel>
    )
  }

  const trip = selectedTrip
  const totals = calculateTrip(trip)
  const set = (key: keyof Trip) => (value: string) =>
    updateTrip(trip.id, (current) => ({ ...current, [key]: value }))

  return (
    <>
      <Panel title="Identification" hint="Every field stays editable, including the driver's name.">
        <div className="field-grid">
          <TextField label="Driver name" value={trip.driverName} onChange={set('driverName')} />
          <TextField label="Co-driver" value={trip.coDriver} onChange={set('coDriver')} placeholder="N/A" />
          <TextField label="Truck number" value={trip.truckNumber} onChange={set('truckNumber')} />
          <TextField label="Trailer number" value={trip.trailerNumber} onChange={set('trailerNumber')} />
          <TextField label="Trip number" value={trip.tripNumber} onChange={set('tripNumber')} />
          <TextField label="PRO number" value={trip.proNumber} onChange={set('proNumber')} />
          <TextField label="BOL number" value={trip.bolNumber} onChange={set('bolNumber')} />
          <TextField label="Start date" type="date" value={trip.startDate} onChange={set('startDate')} />
          <TextField label="End date" type="date" value={trip.endDate} onChange={set('endDate')} />
          <TextField label="Origin" value={trip.origin} onChange={set('origin')} />
          <TextField label="Destination" value={trip.destination} onChange={set('destination')} />
        </div>
        <p className="footnote">
          PRO and BOL are kept here and in the Excel export. The printed United Freight form has no field
          for them, and they are never written into an unrelated one.
        </p>
      </Panel>

      <Panel title="Odometer and miles" hint="Nothing here is ever adjusted to make the totals agree.">
        <div className="field-grid">
          <TextField
            label="Beginning odometer"
            value={trip.beginningOdometer}
            onChange={set('beginningOdometer')}
            inputMode="numeric"
          />
          <TextField
            label="Ending odometer"
            value={trip.endingOdometer}
            onChange={set('endingOdometer')}
            inputMode="numeric"
          />
          <TextField label="Paid miles" value={trip.paidMiles} onChange={set('paidMiles')} inputMode="numeric" />
          <TextField
            label="Mileage rate ($/mile)"
            value={trip.mileageRate}
            onChange={set('mileageRate')}
            inputMode="decimal"
            placeholder="0.80"
          />
        </div>
        <div className="tiles" style={{ marginTop: 12 }}>
          <Tile label="Actual miles" value={formatMiles(totals.actualMiles) || '--'} sub="Ending minus beginning" />
          <Tile label="Paid miles" value={formatMiles(totals.paidMiles) || '--'} />
          <Tile label="State miles" value={formatMiles(totals.stateMilesTotal)} sub={`${trip.stateMiles.length} rows`} />
        </div>
      </Panel>

      <Panel title="Pay" hint="Extra-stop, layover and other pay are added to the mileage pay.">
        <div className="field-grid">
          <TextField label="Extra-stop pay" value={trip.extraStopPay} onChange={set('extraStopPay')} inputMode="decimal" />
          <TextField
            label="Detention / layover pay"
            value={trip.layoverPay}
            onChange={set('layoverPay')}
            inputMode="decimal"
          />
          <TextField label="Other pay" value={trip.otherPay} onChange={set('otherPay')} inputMode="decimal" />
          <TextField
            label="Tax-reserve rate (0.25 = 25%)"
            value={trip.taxReserveRate}
            onChange={set('taxReserveRate')}
            inputMode="decimal"
          />
        </div>
        <div className="tiles" style={{ marginTop: 12 }}>
          <Tile label="Mileage pay" value={formatCurrency(totals.mileagePay)} sub="Paid miles x rate" />
          <Tile label="Gross pay" value={formatCurrency(totals.grossPay)} />
          <Tile
            label="Tax reserve"
            value={formatCurrency(totals.taxReserve)}
            sub={`${formatPercent(totals.taxReserveRate)} of gross`}
          />
          <Tile
            label="Estimated net pay"
            value={formatCurrency(totals.estimatedNetPay)}
            sub="Gross + reimbursements - advances - tax reserve"
          />
        </div>
        <p className="footnote">
          The tax reserve stays in the app and the Excel export. The printed form has no tax-reserve field,
          so it is never placed on the PDF.
        </p>
      </Panel>

      <Panel title="Notes and status">
        <div className="field-grid">
          <label className="field">
            <span>Notes</span>
            <textarea
              value={trip.notes}
              onChange={(event) => updateTrip(trip.id, (current) => ({ ...current, notes: event.target.value }))}
            />
          </label>
        </div>
        <label className="field checkbox" style={{ marginTop: 10 }}>
          <input
            type="checkbox"
            checked={trip.complete}
            onChange={(event) => updateTrip(trip.id, (current) => ({ ...current, complete: event.target.checked }))}
          />
          <span>This trip is complete and ready to export</span>
        </label>
      </Panel>
    </>
  )
}
