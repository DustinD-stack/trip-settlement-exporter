import { describe, expect, it } from 'vitest'
import { buildOtherExpenseText, validateTripForExport } from '../src/lib/validation'
import { createTrip39586Fixture } from '../src/lib/fixtures'
import type { Trip } from '../src/types'

const codes = (issues: { code: string }[]) => issues.map((i) => i.code)

function withExpense(overrides: Partial<Trip['expenses'][number]>): Trip {
  const trip = createTrip39586Fixture()
  trip.expenses = [
    {
      id: 'e1', date: '', category: 'Other', description: 'Thing',
      state: '', receipt: 'R-1', amount: '10.00', reimbursement: '', ...overrides,
    },
  ]
  return trip
}

describe('blocking errors', () => {
  it('accepts the trip 39586 fixture', () => {
    const result = validateTripForExport(createTrip39586Fixture())
    expect(result.errors).toEqual([])
    expect(result.canExport).toBe(true)
  })

  it.each([
    ['tripNumber', '', 'trip-number-missing'],
    ['beginningOdometer', '', 'begin-odo-missing'],
    ['endingOdometer', '', 'end-odo-missing'],
    ['paidMiles', '', 'paid-miles-missing'],
    ['mileageRate', '', 'rate-missing'],
    ['mileageRate', '0', 'rate-invalid'],
    ['mileageRate', '-0.5', 'rate-invalid'],
  ])('blocks export when %s is "%s"', (field, value, code) => {
    const trip = { ...createTrip39586Fixture(), [field]: value } as Trip
    const result = validateTripForExport(trip)
    expect(codes(result.errors)).toContain(code)
    expect(result.canExport).toBe(false)
  })

  it('blocks export when the ending odometer is lower than the beginning', () => {
    const trip = createTrip39586Fixture()
    trip.beginningOdometer = '291726'
    trip.endingOdometer = '289703'
    const result = validateTripForExport(trip)
    expect(codes(result.errors)).toContain('odometer-reversed')
    expect(result.errors.find((e) => e.code === 'odometer-reversed')?.detail).toContain('291,726')
    expect(result.canExport).toBe(false)
  })

  it('blocks export when there are no state-mile rows', () => {
    const trip = createTrip39586Fixture()
    trip.stateMiles = []
    expect(codes(validateTripForExport(trip).errors)).toContain('state-miles-missing')
  })
})

describe('mileage-difference warnings', () => {
  it('warns about the 45-mile differences on trip 39586 and shows both numbers', () => {
    const result = validateTripForExport(createTrip39586Fixture())
    expect(codes(result.warnings)).toContain('state-miles-differ')
    expect(codes(result.warnings)).toContain('paid-miles-differ')

    const stateWarning = result.warnings.find((w) => w.code === 'state-miles-differ')!
    expect(stateWarning.message).toContain('+45')
    expect(stateWarning.detail).toContain('2,068')
    expect(stateWarning.detail).toContain('2,023')

    // The numbers themselves are untouched.
    expect(result.totals.stateMilesTotal).toBe(2068)
    expect(result.totals.actualMiles).toBe(2023)
    expect(result.totals.paidMiles).toBe(2068)
  })

  it('does not warn when the miles agree', () => {
    const trip = createTrip39586Fixture()
    trip.paidMiles = '2023'
    trip.stateMiles = [{ id: 's', state: 'CA', miles: '2023', highways: 'I-15' }]
    const result = validateTripForExport(trip)
    expect(codes(result.warnings)).not.toContain('state-miles-differ')
    expect(codes(result.warnings)).not.toContain('paid-miles-differ')
  })

  it('shows a negative difference with its sign', () => {
    const trip = createTrip39586Fixture()
    trip.stateMiles = [{ id: 's', state: 'CA', miles: '2000', highways: 'I-15' }]
    const warning = validateTripForExport(trip).warnings.find((w) => w.code === 'state-miles-differ')!
    expect(warning.message).toContain('-23')
  })
})

describe('missing expense amount and receipt warnings', () => {
  it('warns that the Walmart pliers amount is missing', () => {
    const result = validateTripForExport(createTrip39586Fixture())
    const warning = result.warnings.find((w) => w.code === 'expense-amount-missing')!
    expect(warning).toBeDefined()
    expect(warning.message).toContain('Walmart pliers')
    // A missing amount must not become a receipt warning as well.
    expect(codes(result.warnings)).not.toContain('expense-receipt-missing')
  })

  it('warns when an amount has no receipt number', () => {
    const result = validateTripForExport(withExpense({ receipt: '', amount: '25.00' }))
    expect(codes(result.warnings)).toContain('expense-receipt-missing')
  })

  it('warns when a fuel purchase has an amount but no invoice', () => {
    const trip = createTrip39586Fixture()
    trip.fuel = [
      { id: 'f1', date: '2026-09-16', state: 'UT', invoice: '', seller: 'Loves',
        truckGallons: '110', reeferGallons: '', defGallons: '5', total: '420.00' },
    ]
    const warning = validateTripForExport(trip).warnings.find((w) => w.code === 'fuel-invoice-missing')!
    expect(warning.message).toContain('Loves')
  })

  it('does not warn when receipts are present', () => {
    const result = validateTripForExport(withExpense({ receipt: 'R-77', amount: '25.00' }))
    expect(codes(result.warnings)).not.toContain('expense-receipt-missing')
    expect(codes(result.warnings)).not.toContain('expense-amount-missing')
  })
})

describe('capacity warnings', () => {
  it('warns when more routes exist than the PDF can show, and keeps them all', () => {
    const trip = createTrip39586Fixture()
    trip.routes = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`, order: i + 1, type: 'Pickup' as const,
      from: `From ${i}`, to: `To ${i}`, isPickup: true, isDelivery: false, notes: '',
    }))
    const warning = validateTripForExport(trip).warnings.find((w) => w.code === 'routes-overflow')!
    expect(warning.message).toContain('12')
    expect(warning.message).toContain('10')
    expect(warning.detail).toContain('nothing is deleted')
    expect(trip.routes).toHaveLength(12)
  })

  it('warns when more than 7 advances are entered', () => {
    const trip = createTrip39586Fixture()
    trip.advances = Array.from({ length: 9 }, (_, i) => ({
      id: `a${i}`, date: '', amount: '10', type: 'Cash', notes: '',
    }))
    expect(codes(validateTripForExport(trip).warnings)).toContain('advances-overflow')
  })

  it('warns when the combined Other description will not fit', () => {
    const trip = createTrip39586Fixture()
    trip.expenses = Array.from({ length: 6 }, (_, i) => ({
      id: `e${i}`, date: '', category: 'Supplies' as const,
      description: `Long supply description number ${i}`, state: '',
      receipt: `R${i}`, amount: '10.00', reimbursement: '',
    }))
    const warning = validateTripForExport(trip).warnings.find((w) => w.code === 'other-expense-too-long')!
    expect(warning).toBeDefined()
    expect(warning.detail).toContain('stays in the app')
  })
})

describe('other-expense text', () => {
  it('combines description and amount, and omits the amount when blank', () => {
    expect(buildOtherExpenseText(createTrip39586Fixture())).toBe('Walmart pliers')
  })

  it('includes the amount when it is present', () => {
    expect(buildOtherExpenseText(withExpense({ description: 'Gloves', amount: '7.25' })))
      .toBe('Gloves 7.25')
  })

  it('excludes categories that have their own printed rule', () => {
    const trip = withExpense({ category: 'Tolls', description: 'Skyway', amount: '9.00' })
    expect(buildOtherExpenseText(trip)).toBe('')
  })
})
