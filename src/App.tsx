import { useState } from 'react'
import { useAppData } from './useAppData'
import { Dashboard } from './screens/Dashboard'
import { WeeklyPay } from './screens/WeeklyPay'
import { TripDetails } from './screens/TripDetails'
import { Routes } from './screens/Routes'
import { StateMiles } from './screens/StateMiles'
import { Fuel } from './screens/Fuel'
import { Expenses } from './screens/Expenses'
import { Advances } from './screens/Advances'
import { ExportScreen } from './screens/ExportScreen'
import { SettingsScreen } from './screens/Settings'

export type ScreenId =
  | 'dashboard'
  | 'weekly'
  | 'trip'
  | 'routes'
  | 'states'
  | 'fuel'
  | 'expenses'
  | 'advances'
  | 'export'
  | 'settings'

const SCREENS: Array<{ id: ScreenId; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'weekly', label: 'Weekly Pay' },
  { id: 'trip', label: 'Trip Details' },
  { id: 'routes', label: 'Routes & Stops' },
  { id: 'states', label: 'State Miles' },
  { id: 'fuel', label: 'Fuel & DEF' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'advances', label: 'Advances' },
  { id: 'export', label: 'PDF Export' },
  { id: 'settings', label: 'Settings & Backup' },
]

export default function App() {
  const store = useAppData()
  const [screen, setScreen] = useState<ScreenId>('dashboard')

  const openTrip = (id: string) => {
    store.selectTrip(id)
    setScreen('trip')
  }

  const exportTrip = (id: string) => {
    store.selectTrip(id)
    setScreen('export')
  }

  if (!store.ready) {
    return (
      <div className="app">
        <main>
          <p className="empty">Loading your trips...</p>
        </main>
      </div>
    )
  }

  const selected = store.selectedTrip

  return (
    <div className="app">
      <header className="masthead">
        <h1>Trip Settlement Exporter</h1>
        <span className="selected">
          {selected ? (
            <>
              Selected trip: <strong>{selected.tripNumber || '(no number)'}</strong>
              {selected.complete ? ' - complete' : ''}
            </>
          ) : (
            'No trip selected'
          )}
        </span>
      </header>

      <nav className="tabs" aria-label="Sections">
        {SCREENS.map((item) => (
          <button
            key={item.id}
            onClick={() => setScreen(item.id)}
            aria-current={screen === item.id ? 'page' : undefined}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main>
        {screen === 'dashboard' && <Dashboard store={store} go={setScreen} />}
        {screen === 'weekly' && (
          <WeeklyPay
            store={store}
            onEdit={openTrip}
            onExport={exportTrip}
            onExportAll={() => setScreen('export')}
          />
        )}
        {screen === 'trip' && <TripDetails store={store} />}
        {screen === 'routes' && <Routes store={store} />}
        {screen === 'states' && <StateMiles store={store} />}
        {screen === 'fuel' && <Fuel store={store} />}
        {screen === 'expenses' && <Expenses store={store} />}
        {screen === 'advances' && <Advances store={store} />}
        {screen === 'export' && <ExportScreen store={store} />}
        {screen === 'settings' && <SettingsScreen store={store} />}
      </main>
    </div>
  )
}
