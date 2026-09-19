import { describe, expect, it } from 'vitest'
import { calculateTrip, calculateWeek, categoryTotal } from '../src/lib/calc'
import { createTrip39586Fixture } from '../src/lib/fixtures'
import { sumMoney, multiplyMoney, roundMoney } from '../src/lib/money'
import type { Trip } from '../src/types'

function blankTrip(overrides: Partial<Trip> = {}): Trip {
  const trip = createTrip39586Fixture()
  return {
    ...trip,
    routes: [],
    stateMiles: [],
    fuel: [],
    expenses: [],
    advances: [],
    ...overrides,
  }
}

describe('actual mileage', () => {
  it('is ending odometer minus beginning odometer', () => {
    const totals = calculateTrip(createTrip39586Fixture())
    expect(totals.beginningOdometer).toBe(289703)
    expect(totals.endingOdometer).toBe(291726)
    expect(totals.actualMiles).toBe(2023)
  })

  it('is null while either odometer reading is missing', () => {
    expect(calculateTrip(blankTrip({ endingOdometer: '' })).actualMiles).toBeNull()
    expect(calculateTrip(blankTrip({ beginningOdometer: '' })).actualMiles).toBeNull()
  })

  it('reports a negative value rather than clamping a reversed odometer', () => {
    const totals = calculateTrip(
      blankTrip({ beginningOdometer: '291726', endingOdometer: '289703' }),
    )
    expect(totals.actualMiles).toBe(-2023)
  })
})

describe('mileage pay', () => {
  it('is paid miles times the rate, not actual miles', () => {
    const totals = calculateTrip(createTrip39586Fixture())
    expect(totals.mileagePay).toBe(1654.4)
    // 2023 actual miles must NOT be used for pay.
    expect(totals.mileagePay).not.toBe(roundMoney(2023 * 0.8))
  })

  it('is null when paid miles or the rate are missing', () => {
    expect(calculateTrip(blankTrip({ paidMiles: '' })).mileagePay).toBeNull()
    expect(calculateTrip(blankTrip({ mileageRate: '' })).mileagePay).toBeNull()
  })

  it('rounds to cents exactly once', () => {
    // 1333 x 0.455 = 606.515 -> 606.52, not 606.51 from float drift.
    expect(multiplyMoney(1333, 0.455)).toBe(606.52)
  })
})

describe('gross pay', () => {
  it('adds mileage, extra-stop, layover and other pay', () => {
    const totals = calculateTrip(
      blankTrip({
        paidMiles: '2068',
        mileageRate: '0.80',
        extraStopPay: '50',
        layoverPay: '125.50',
        otherPay: '20.25',
      }),
    )
    expect(totals.grossPay).toBe(1850.15)
  })

  it('equals mileage pay when there is no additional pay', () => {
    expect(calculateTrip(createTrip39586Fixture()).grossPay).toBe(1654.4)
  })
})

describe('tax reserve and estimated net', () => {
  it('matches the workbook for trip 39586', () => {
    const totals = calculateTrip(createTrip39586Fixture())
    expect(totals.taxReserveRate).toBe(0.25)
    expect(totals.taxReserve).toBe(413.6)
    expect(totals.estimatedNetPay).toBe(1240.8)
  })

  it('subtracts advances and adds reimbursements', () => {
    const trip = createTrip39586Fixture()
    trip.expenses = [
      {
        id: 'e1',
        date: '',
        category: 'Tolls',
        description: 'Toll',
        state: 'IL',
        receipt: 'R-1',
        amount: '40.00',
        reimbursement: '40.00',
      },
    ]
    trip.advances = [{ id: 'a1', date: '', amount: '100.00', type: 'Cash', notes: '' }]
    const totals = calculateTrip(trip)
    expect(totals.expenseTotal).toBe(40)
    expect(totals.reimbursementTotal).toBe(40)
    expect(totals.advanceTotal).toBe(100)
    // 1654.40 + 40 - 100 - 413.60
    expect(totals.estimatedNetPay).toBe(1180.8)
    // settlement pay excludes the tax reserve (the form has no such field)
    expect(totals.settlementPay).toBe(1594.4)
  })

  it('keeps expenses and reimbursements as separate totals', () => {
    const trip = createTrip39586Fixture()
    trip.expenses = [
      {
        id: 'e1', date: '', category: 'Repairs', description: 'Hose', state: '',
        receipt: 'R-9', amount: '250.00', reimbursement: '100.00',
      },
    ]
    const totals = calculateTrip(trip)
    expect(totals.expenseTotal).toBe(250)
    expect(totals.reimbursementTotal).toBe(100)
  })
})

describe('state-mile totals', () => {
  it('sums every entered row without adjusting anything', () => {
    const totals = calculateTrip(createTrip39586Fixture())
    expect(totals.stateMilesTotal).toBe(2068)
    expect(totals.actualMiles).toBe(2023)
    expect(totals.stateMilesDifference).toBe(45)
    expect(totals.paidMilesDifference).toBe(45)
  })

  it('reports a negative difference when state miles fall short', () => {
    const trip = createTrip39586Fixture()
    trip.stateMiles = [{ id: 's1', state: 'CA', miles: '2000', highways: 'I-15' }]
    const totals = calculateTrip(trip)
    expect(totals.stateMilesTotal).toBe(2000)
    expect(totals.stateMilesDifference).toBe(-23)
  })
})

describe('expense categories', () => {
  it('routes parking, supplies and other into one "other" bucket', () => {
    const trip = createTrip39586Fixture()
    trip.expenses = [
      { id: '1', date: '', category: 'Scales', description: 'Scale', state: '', receipt: 'A', amount: '12.50', reimbursement: '' },
      { id: '2', date: '', category: 'Parking', description: 'Lot', state: '', receipt: 'B', amount: '20.00', reimbursement: '' },
      { id: '3', date: '', category: 'Supplies', description: 'Gloves', state: '', receipt: 'C', amount: '7.25', reimbursement: '' },
      { id: '4', date: '', category: 'Other', description: 'Misc', state: '', receipt: 'D', amount: '1.00', reimbursement: '' },
    ]
    const totals = calculateTrip(trip)
    expect(categoryTotal(totals, 'Scales')).toBe(12.5)
    expect(totals.otherExpenseTotal).toBe(28.25)
    expect(totals.expenseTotal).toBe(40.75)
  })
})

describe('decimal safety', () => {
  it('sums repeated cents without drift', () => {
    expect(sumMoney(Array.from({ length: 10 }, () => 0.1))).toBe(1)
    expect(sumMoney([0.1, 0.2])).toBe(0.3)
    expect(sumMoney([1654.4, 40, -100])).toBe(1594.4)
  })
})

describe('weekly roll-up', () => {
  it('adds each trip without mixing their figures', () => {
    const a = createTrip39586Fixture()
    const b = { ...createTrip39586Fixture(), id: 'b', tripNumber: '40001', paidMiles: '1000' }
    const week = calculateWeek([a, b])
    expect(week.trips).toBe(2)
    expect(week.paidMiles).toBe(3068)
    expect(week.grossPay).toBe(roundMoney(1654.4 + 800))
  })
})
