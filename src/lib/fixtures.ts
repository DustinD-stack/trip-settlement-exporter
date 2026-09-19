/**
 * Trip 39586 - the verification fixture from the original workbook.
 *
 * This is TEST DATA ONLY. It is not part of the app's default state: the
 * dashboard starts empty, and this trip is only loaded when someone explicitly
 * asks for it from Settings, or by the test suite. Nothing in the application
 * logic branches on this trip number or on the driver's name.
 */
import type { Trip } from '../types'

let counter = 0
const id = (prefix: string) => `${prefix}-${++counter}`

export function createTrip39586Fixture(): Trip {
  counter = 0
  const now = new Date('2026-09-19T00:00:00.000Z').toISOString()
  return {
    id: 'fixture-39586',
    driverName: 'Dustin Douglas',
    coDriver: 'N/A',
    truckNumber: '146',
    trailerNumber: '2016',
    tripNumber: '39586',
    proNumber: '38522',
    bolNumber: '935202874',
    startDate: '2026-09-15',
    endDate: '2026-09-18',
    origin: '3950 E Airport Dr Ontario, CA 91761',
    destination: '12300 Jim Dhamer Dr Huntley, IL 60142',
    beginningOdometer: '289703',
    endingOdometer: '291726',
    paidMiles: '2068',
    mileageRate: '0.80',
    extraStopPay: '',
    layoverPay: '',
    otherPay: '',
    taxReserveRate: '0.25',
    notes: 'State miles exceed odometer by 45 miles',
    complete: true,
    routes: [
      {
        id: id('route'),
        order: 1,
        type: 'Pickup to delivery',
        from: '3950 E Airport Dr Ontario, CA 91761',
        to: '12300 Jim Dhamer Dr Huntley, IL 60142',
        isPickup: true,
        isDelivery: true,
        notes: '',
      },
    ],
    stateMiles: [
      { state: 'CA', miles: '287', highways: 'I-805, I-15' },
      { state: 'NV', miles: '124', highways: 'I-15' },
      { state: 'AZ', miles: '29', highways: 'I-15' },
      { state: 'UT', miles: '364', highways: 'I-15, I-70' },
      { state: 'CO', miles: '455', highways: 'I-70, I-76' },
      { state: 'NE', miles: '353', highways: 'I-76, I-80' },
      { state: 'IA', miles: '306', highways: 'I-80' },
      { state: 'IL', miles: '150', highways: 'I-80, I-39, US-20, IL-47' },
    ].map((row) => ({ id: id('state'), ...row })),
    fuel: [],
    expenses: [
      {
        id: id('expense'),
        date: '',
        category: 'Supplies',
        description: 'Walmart pliers',
        state: '',
        receipt: '',
        // Deliberately blank: the app must warn that the amount is missing and
        // leave the monetary value blank on the PDF.
        amount: '',
        reimbursement: '',
      },
    ],
    advances: [],
    createdAt: now,
    updatedAt: now,
  }
}
