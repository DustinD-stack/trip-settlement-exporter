/** Routes and stops for the selected trip. */
import { CAPACITY } from '../config/pdfFieldMapping'
import { emptyRoute, reorderStops } from '../lib/trips'
import { Empty, Panel } from '../components/ui'
import { STOP_TYPES, type RouteStop } from '../types'
import type { AppStore } from '../useAppData'

export function Routes({ store }: { store: AppStore }) {
  const { selectedTrip, updateTrip } = store
  if (!selectedTrip) {
    return (
      <Panel title="Routes and stops">
        <Empty>Select a trip on Weekly Pay first.</Empty>
      </Panel>
    )
  }

  const trip = selectedTrip
  const stops = [...trip.routes].sort((a, b) => a.order - b.order)
  const used = stops.filter((stop) => stop.from.trim() || stop.to.trim()).length
  const overflow = used > CAPACITY.routes

  const setStops = (next: RouteStop[]) => updateTrip(trip.id, (current) => ({ ...current, routes: next }))
  const patch = (id: string, change: Partial<RouteStop>) =>
    setStops(stops.map((stop) => (stop.id === id ? { ...stop, ...change } : stop)))

  return (
    <Panel
      title="Routes and stops"
      hint={`Up to ${CAPACITY.routes} From/To pairs fit on the printed form. Extra stops stay in the app and the Excel export.`}
    >
      {overflow && (
        <div className="warning">
          {used} stops entered, but the printed form has room for {CAPACITY.routes}. Stops{' '}
          {CAPACITY.routes + 1}-{used} will not appear on the PDF. Nothing is deleted.
        </div>
      )}

      {stops.length === 0 ? (
        <Empty>No stops yet.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="row-table">
            <thead>
              <tr>
                <th style={{ width: 54 }}>Order</th>
                <th style={{ width: 150 }}>Type</th>
                <th>From</th>
                <th>To</th>
                <th style={{ width: 70 }}>Pickup</th>
                <th style={{ width: 78 }}>Delivery</th>
                <th>Notes</th>
                <th style={{ width: 150 }}>Move</th>
              </tr>
            </thead>
            <tbody>
              {stops.map((stop, index) => (
                <tr key={stop.id} style={index >= CAPACITY.routes ? { opacity: 0.6 } : undefined}>
                  <td className="num">{stop.order}</td>
                  <td>
                    <select value={stop.type} onChange={(event) => patch(stop.id, { type: event.target.value as RouteStop['type'] })}>
                      <option value="">--</option>
                      {STOP_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input value={stop.from} onChange={(event) => patch(stop.id, { from: event.target.value })} />
                  </td>
                  <td>
                    <input value={stop.to} onChange={(event) => patch(stop.id, { to: event.target.value })} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      aria-label={`Stop ${stop.order} is a pickup`}
                      checked={stop.isPickup}
                      onChange={(event) => patch(stop.id, { isPickup: event.target.checked })}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      aria-label={`Stop ${stop.order} is a delivery`}
                      checked={stop.isDelivery}
                      onChange={(event) => patch(stop.id, { isDelivery: event.target.checked })}
                    />
                  </td>
                  <td>
                    <input value={stop.notes} onChange={(event) => patch(stop.id, { notes: event.target.value })} />
                  </td>
                  <td>
                    <div className="inline-actions">
                      <button className="small" onClick={() => setStops(reorderStops(stops, stop.id, -1))} disabled={index === 0}>
                        Up
                      </button>
                      <button
                        className="small"
                        onClick={() => setStops(reorderStops(stops, stop.id, 1))}
                        disabled={index === stops.length - 1}
                      >
                        Down
                      </button>
                      <button
                        className="small danger"
                        onClick={() =>
                          setStops(
                            stops
                              .filter((candidate) => candidate.id !== stop.id)
                              .map((candidate, position) => ({ ...candidate, order: position + 1 })),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel-actions">
        <button onClick={() => setStops([...stops, emptyRoute(stops.length + 1)])}>Add a stop</button>
        {stops.length === 0 && (trip.origin || trip.destination) && (
          <button
            onClick={() =>
              setStops([{ ...emptyRoute(1), type: 'Pickup to delivery', from: trip.origin, to: trip.destination, isPickup: true, isDelivery: true }])
            }
          >
            Use the trip origin and destination
          </button>
        )}
      </div>
      <p className="footnote">
        If no stops are entered, the PDF falls back to the trip's origin and destination.
      </p>
    </Panel>
  )
}
