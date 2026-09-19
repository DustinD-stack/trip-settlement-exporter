/**
 * CENTRAL PDF FIELD MAPPING - the single source of truth for settlement PDF
 * geometry. Nothing else in the app may contain PDF coordinates.
 *
 * THE TEMPLATE
 * ------------
 * `public/settlement-template.pdf` is built by `tools/build-template.mjs` from
 * the two-page United Freight PDF supplied with the project. Each page is a
 * scan of the paper form, over which the source file paints white rectangles
 * and redraws part of the form - the header, the route rules, both STATE MILES
 * tables, the fuel grid and the expense rules - as crisp vector artwork.
 *
 * That has two consequences this file has to respect:
 *
 *   1. Redrawn areas have EXACT coordinates, taken straight from the page's
 *      content stream. They are marked "vector" below.
 *   2. Everything else is the raw scan, which is slightly skewed and whose
 *      rules are not evenly spaced. Those coordinates were measured off the
 *      page raster with `tools/measure-template.mjs` and are marked "scanned".
 *
 * This is exactly why the field geometry that shipped with the supplied PDF was
 * wrong in places: it assumed both halves of the page shared one tidy grid.
 * The right-hand route column and the DRIVER PAY block are scanned, and they do
 * not line up with their vector counterparts.
 *
 * COORDINATES
 * -----------
 * PDF user space, origin bottom-left, points. `y` is the BOTTOM of the box.
 * Page size is 611 x 841.
 */

export type Align = 'left' | 'right' | 'center'

export interface FieldSpec {
  /** AcroForm field name, also used as the key in the value map. */
  name: string
  /** 0-based page index. */
  page: 0 | 1
  x: number
  y: number
  width: number
  height: number
  /** Preferred font size. Shrinks automatically if the value is too wide. */
  fontSize: number
  align: Align
  /** Smallest size auto-shrink may use before the value is truncated. */
  minFontSize: number
  /** Where the value comes from, and any geometry caveat. */
  note?: string
}

export const PAGE_WIDTH = 611
export const PAGE_HEIGHT = 841
export const PAGE_COUNT = 2

/** Row capacities imposed by the printed form. */
export const CAPACITY = {
  routes: 10,
  stateMiles: 40,
  stateMilesPerColumn: 20,
  fuel: 20,
  advances: 7,
  /** Characters that fit on the single printed "OTHER $:" rule. */
  otherExpenseChars: 60,
} as const

const DEFAULTS = { fontSize: 9, align: 'left' as Align, minFontSize: 5.5 }

function f(
  name: string,
  page: 0 | 1,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<FieldSpec> = {},
): FieldSpec {
  return { name, page, x, y, width, height, ...DEFAULTS, ...extra }
}

/**
 * A value written on a printed rule rests just above it.
 *
 * The box height is 11.5pt because some DRIVER PAY rules are only 12.5pt apart
 * on the scan; a taller box would overlap its neighbour and, in the fillable
 * export, steal the neighbouring field's click target. With a 9pt value this
 * puts the baseline about 1.8pt above the rule.
 */
const RULE_BOX_H = 11.5
const RULE_TO_BOX_Y = -0.7

/** Centres a box of `height` inside a table cell spanning `bottom`..`top`. */
function cell(bottom: number, top: number, height: number): number {
  return bottom + (top - bottom - height) / 2
}

/* ------------------------------------------------------------------ *
 * PAGE 1 - identification                                     [vector]
 *
 * The boxes below are the exact rectangles the page draws:
 *   truck    292 768 65x17      trailer 410 768 65x17    trip 522 768 58x17
 *   begin    337 750 79x17      end     499 750 81x17
 *   start    305 732 111x17     end     468 732 112x17
 * and the two rules at y=809 (x 324-580) and y=791 (x 330-580).
 * Each field is inset 3pt so a value never touches the printed border.
 * ------------------------------------------------------------------ */

const boxField = (
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  note: string,
): FieldSpec => f(name, 0, x + 3, cell(y, y + h, 13), w - 6, 13, { note })

const identification: FieldSpec[] = [
  f('driver_name', 0, 326, 809 + RULE_TO_BOX_Y, 252, RULE_BOX_H, {
    note: 'Trip driver name. Printed rule y=809, x 324-580. [vector]',
  }),
  f('co_driver_name', 0, 332, 791 + RULE_TO_BOX_Y, 246, RULE_BOX_H, {
    note: 'Trip co-driver. Printed rule y=791, x 330-580. [vector]',
  }),
  boxField('truck_number', 292, 768, 65, 17, 'Trip truck number. [vector]'),
  boxField('trailer_number', 410, 768, 65, 17, 'Trip trailer number. [vector]'),
  boxField('trip_number', 522, 768, 58, 17, 'Trip number. [vector]'),
  boxField('beginning_odometer', 337, 750, 79, 17, 'Beginning odometer, whole miles. [vector]'),
  boxField('ending_odometer', 499, 750, 81, 17, 'Ending odometer, whole miles. [vector]'),
  boxField('start_date', 305, 732, 111, 17, 'Trip start date, mm-dd-yyyy. [vector]'),
  boxField('end_date', 468, 732, 112, 17, 'Trip end date, mm-dd-yyyy. [vector]'),
  // PRO, BOL and the tax reserve have no field on this form - see
  // FIELDS_WITHOUT_PDF_EQUIVALENT. They are never written anywhere on the page.
]

/* ------------------------------------------------------------------ *
 * PAGE 1 - routes, 10 From/To pairs
 *
 * LEFT column (stops 1-5)  [vector] rules at 697/681, 659/643, 621/605,
 *                          583/567, 545/529, each spanning x 62-290.
 * RIGHT column (stops 6-10) [scanned] the source file does not redraw this
 *                          half, so its rules sit at different heights and
 *                          are slightly skewed: 712.5/697.5, 673.5/658.5,
 *                          635/620, 597/582, 558.5/543.5.
 *
 * The field geometry supplied with the original PDF reused the LEFT column's
 * rects for stops 6-10, so every right-hand value printed a full row too low.
 * ------------------------------------------------------------------ */

const ROUTE_COLUMNS = [
  {
    x: 64,
    width: 224,
    source: 'vector',
    rules: [
      { from: 697, to: 681 },
      { from: 659, to: 643 },
      { from: 621, to: 605 },
      { from: 583, to: 567 },
      { from: 545, to: 529 },
    ],
  },
  {
    x: 346,
    width: 224,
    source: 'scanned',
    rules: [
      { from: 712.5, to: 697.5 },
      { from: 673.5, to: 658.5 },
      { from: 635.0, to: 620.0 },
      { from: 597.0, to: 582.0 },
      { from: 558.5, to: 543.5 },
    ],
  },
] as const

const routes: FieldSpec[] = ROUTE_COLUMNS.flatMap((column, columnIndex) =>
  column.rules.flatMap((rule, rowIndex) => {
    const stop = columnIndex * 5 + rowIndex + 1
    return (['from', 'to'] as const).map((which) =>
      f(
        `route_${stop}_${which}`,
        0,
        column.x,
        rule[which] + RULE_TO_BOX_Y,
        column.width,
        RULE_BOX_H,
        {
          fontSize: 8,
          note: `Route stop ${stop} "${which}". Rule y=${rule[which]}. [${column.source}]`,
        },
      ),
    )
  }),
)

/* ------------------------------------------------------------------ *
 * PAGE 1 - state miles, two 20-row tables                      [vector]
 *
 * Left table:  outer 27 48 275x470, header bottom y=478, row pitch 20.6,
 *              column dividers at x = 27 | 77 | 125 | 302.
 * Right table: the same, shifted +282pt.
 * The bottom band (48-66) is the TOTAL row.
 * ------------------------------------------------------------------ */

const STATE_HEADER_BOTTOM = 478
const STATE_ROW_PITCH = 20.6
const STATE_ROW_H = 16

const STATE_TABLES = [
  { side: 'left' as const, state: 27, miles: 77, highways: 125, end: 302 },
  { side: 'right' as const, state: 309, miles: 359, highways: 407, end: 584 },
]

const stateMiles: FieldSpec[] = STATE_TABLES.flatMap((table) => {
  const fields: FieldSpec[] = []
  for (let i = 1; i <= CAPACITY.stateMilesPerColumn; i++) {
    const top = STATE_HEADER_BOTTOM - (i - 1) * STATE_ROW_PITCH
    const y = cell(top - STATE_ROW_PITCH, top, STATE_ROW_H)
    fields.push(
      f(`${table.side}_state_${i}`, 0, table.state + 3, y, table.miles - table.state - 6, STATE_ROW_H, {
        align: 'center',
        note: 'State code. [vector]',
      }),
      f(`${table.side}_miles_${i}`, 0, table.miles + 3, y, table.highways - table.miles - 6, STATE_ROW_H, {
        align: 'right',
        note: 'Miles driven in that state, exactly as entered. [vector]',
      }),
      f(`${table.side}_highways_${i}`, 0, table.highways + 3, y, table.end - table.highways - 6, STATE_ROW_H, {
        fontSize: 8,
        note: 'Highways used. [vector]',
      }),
    )
  }
  fields.push(
    f(
      `${table.side}_state_miles_total`,
      0,
      table.miles + 3,
      cell(48, 66, 14),
      table.highways - table.miles - 6,
      14,
      {
        align: 'right',
        note:
          table.side === 'left'
            ? 'Sum of every state-mile row. Never adjusted to match the odometer. [vector]'
            : 'The left table carries the total; this one stays blank. [vector]',
      },
    ),
  )
  return fields
})

/* ------------------------------------------------------------------ *
 * PAGE 2 - fuel purchases, 20 rows                             [vector]
 *
 * Grid: outer 49 319 549x352, header bottom y=671, row pitch 17.6,
 * column dividers at x = 49 | 126 | 168 | 281 | 392 | 438 | 479 | 525 | 598.
 *
 * The DATE cell has a pre-printed "/     /" drawn at x=70 in 8pt Helvetica,
 * putting slashes at x 70-72 and x 83-86. A single date string would print on
 * top of them, so the date is split into three slots that sit around them.
 * ------------------------------------------------------------------ */

const FUEL_HEADER_BOTTOM = 671
const FUEL_ROW_PITCH = 17.6
const FUEL_ROW_H = 14

const FUEL_COLUMNS = {
  dateMonth: { x: 51, w: 18 },
  dateDay: { x: 73, w: 9.5 },
  dateYear: { x: 87, w: 36 },
  state: { x: 129, w: 36 },
  invoice: { x: 171, w: 107 },
  seller: { x: 284, w: 105 },
  truckGallons: { x: 395, w: 40 },
  reeferGallons: { x: 441, w: 35 },
  defGallons: { x: 482, w: 40 },
  total: { x: 528, w: 67 },
}

const fuel: FieldSpec[] = []
for (let i = 1; i <= CAPACITY.fuel; i++) {
  const top = FUEL_HEADER_BOTTOM - (i - 1) * FUEL_ROW_PITCH
  const y = cell(top - FUEL_ROW_PITCH, top, FUEL_ROW_H)
  const add = (key: keyof typeof FUEL_COLUMNS, suffix: string, extra: Partial<FieldSpec> = {}) => {
    const column = FUEL_COLUMNS[key]
    fuel.push(f(`fuel_${i}_${suffix}`, 1, column.x, y, column.w, FUEL_ROW_H, { fontSize: 8, ...extra }))
  }
  add('dateMonth', 'date_mm', { align: 'center', note: 'Fuel date month, left of the printed "/". [vector]' })
  add('dateDay', 'date_dd', { align: 'center', note: 'Fuel date day, between the printed "/" marks. [vector]' })
  add('dateYear', 'date_yy', { align: 'left', note: 'Fuel date year, right of the printed "/". [vector]' })
  add('state', 'state', { align: 'center', note: 'Purchase state. [vector]' })
  add('invoice', 'invoice', { note: 'Invoice or receipt number. [vector]' })
  add('seller', 'seller', { note: 'Seller. [vector]' })
  add('truckGallons', 'truck_gallons', { align: 'right', note: 'Truck gallons. [vector]' })
  add('reeferGallons', 'reefer_gallons', { align: 'right', note: 'Reefer gallons. [vector]' })
  add('defGallons', 'def', { align: 'right', note: 'DEF gallons. [vector]' })
  add('total', 'total', { align: 'right', note: 'Purchase total. [vector]' })
}

/* ------------------------------------------------------------------ *
 * PAGE 2 - fuel total and expense summary
 *
 * fuel_total  [scanned] cell x 530.8-605.3, y 295.3-312.8, with a pre-printed
 *             "$" at x 536.5-541. The field starts at 545 to clear it; the
 *             geometry supplied with the original PDF started at 527 and
 *             printed straight over the "$".
 * expenses    [vector] six rules at y = 292, 276, 260, 244, 228, 212, each
 *             spanning x 91-330. The printed labels end by x=90.
 * ------------------------------------------------------------------ */

const EXPENSE_RULE_X = 94
const EXPENSE_RULE_W = 232

const expenseRule = (name: string, ruleY: number, note: string, extra: Partial<FieldSpec> = {}) =>
  f(name, 1, EXPENSE_RULE_X, ruleY + RULE_TO_BOX_Y, EXPENSE_RULE_W, RULE_BOX_H, {
    note: `${note} Rule y=${ruleY}, x 91-330. [vector]`,
    ...extra,
  })

const expenses: FieldSpec[] = [
  f('fuel_total', 1, 545, cell(295.3, 312.8, 14), 55, 14, {
    align: 'right',
    note: 'Sum of the fuel row totals. x clears the pre-printed "$". [scanned]',
  }),
  expenseRule('expense_scales', 292, 'Expenses in the Scales category.'),
  expenseRule('expense_tolls', 276, 'Expenses in the Tolls category.'),
  expenseRule('expense_repairs', 260, 'Expenses in the Repairs category.'),
  expenseRule('expense_lumpers', 244, 'Expenses in the Lumpers category.'),
  expenseRule(
    'expense_other',
    228,
    'Parking, Supplies, Other and uncategorised expenses combined onto the one printed rule. The app warns when the combined text will not fit.',
    { fontSize: 8 },
  ),
  expenseRule('expense_total', 212, 'Total of every expense amount. Reimbursements are NOT netted off.'),
]

/* ------------------------------------------------------------------ *
 * PAGE 2 - advances, 7 rows                                   [scanned]
 *
 * The source file does not redraw this table, so the grid was measured off the
 * raster: header bottom y=253.5, row pitch 15.5, last row bottom y=145,
 * column dividers at x = 352.8 | 422 | 519.3 | 596, TOTAL row y 126.5-145
 * with a pre-printed "$" ending at x=529.
 *
 * The geometry supplied with the original PDF put every row one line too high,
 * so advance 1 printed inside the table's header. Its DATE cell also has
 * pre-printed "/" marks (x 371-375 and x 397-402), so the date is split.
 * ------------------------------------------------------------------ */

const ADVANCE_HEADER_BOTTOM = 253.5
const ADVANCE_ROW_PITCH = 15.5
const ADVANCE_ROW_H = 13

const ADVANCE_COLUMNS = {
  dateMonth: { x: 356, w: 14 },
  dateDay: { x: 377, w: 19 },
  dateYear: { x: 403, w: 16 },
  amount: { x: 425, w: 90 },
  type: { x: 522, w: 71 },
}

const advances: FieldSpec[] = []
for (let i = 1; i <= CAPACITY.advances; i++) {
  const top = ADVANCE_HEADER_BOTTOM - (i - 1) * ADVANCE_ROW_PITCH
  const y = cell(top - ADVANCE_ROW_PITCH, top, ADVANCE_ROW_H)
  const add = (key: keyof typeof ADVANCE_COLUMNS, suffix: string, extra: Partial<FieldSpec> = {}) => {
    const column = ADVANCE_COLUMNS[key]
    advances.push(
      f(`advance_${i}_${suffix}`, 1, column.x, y, column.w, ADVANCE_ROW_H, { fontSize: 8, ...extra }),
    )
  }
  add('dateMonth', 'date_mm', { align: 'center', note: 'Advance date month. [scanned]' })
  add('dateDay', 'date_dd', { align: 'center', note: 'Advance date day. [scanned]' })
  add('dateYear', 'date_yy', { align: 'center', note: 'Advance date year. [scanned]' })
  add('amount', 'amount', { align: 'right', note: 'Advance amount. [scanned]' })
  add('type', 'type', { note: 'Cash / EFS / COM check / T-check. [scanned]' })
}
advances.push(
  f('advance_total', 1, 534, cell(126.5, 145, 14), 57, 14, {
    align: 'right',
    note: 'Total advances and deductions. x clears the pre-printed "$". [scanned]',
  }),
)

/* ------------------------------------------------------------------ *
 * PAGE 2 - driver pay                                         [scanned]
 *
 * Not redrawn, and the scan's rules are NOT evenly spaced: 189.5, 176.5,
 * 162.5, 150, 136, 122, 109.3 - gaps of 13, 14, 12.5, 14, 14 and 12.7pt.
 * The geometry supplied with the original PDF assumed a flat 15pt pitch, so by
 * the last rows the error reached ~10pt and "MONEY LEFT ON HAND" and "TOTAL PAY
 * TO DRIVER" printed below their rules, clipped and over their own labels.
 *
 * The printed labels run out to x=150 (the longest is "TOTAL PAY TO DRIVER $:"),
 * and the rules end at x=330, so values start at x=154.
 * ------------------------------------------------------------------ */

const PAY_TEXT_X = 154
const PAY_TEXT_W = 172

const payField = (name: string, ruleY: number, note: string) =>
  f(name, 1, PAY_TEXT_X, ruleY + RULE_TO_BOX_Y, PAY_TEXT_W, RULE_BOX_H, {
    note: `${note} Rule y=${ruleY}. [scanned]`,
  })

const driverPay: FieldSpec[] = [
  payField('total_miles_pay', 189.5, 'Paid miles x mileage rate.'),
  payField('total_extra_stops_pay', 176.5, 'Extra-stop pay.'),
  payField('total_layover_pay', 162.5, 'Detention / layover pay.'),
  payField('total_money_received', 150.0, 'Total advances received.'),
  payField('total_money_spent', 136.0, 'Total expenses paid by the driver.'),
  payField('money_left_on_hand', 122.0, 'Advances received minus expenses paid.'),
  payField('total_pay_to_driver', 109.3, 'Gross pay + reimbursements - advances.'),
]

/* ------------------------------------------------------------------ *
 * PAGE 2 - signature
 * Declared so the fillable export offers the driver somewhere to sign, and so
 * the export code can assert it stays empty. The app never draws, copies or
 * simulates a signature.
 * ------------------------------------------------------------------ */

export const SIGNATURE_FIELD = 'driver_signature'

const signature: FieldSpec[] = [
  f(SIGNATURE_FIELD, 1, 360, 62, 232, 16, {
    note: 'Left blank by design, in both exports. [scanned]',
  }),
]

export const PDF_FIELDS: FieldSpec[] = [
  ...identification,
  ...routes,
  ...stateMiles,
  ...fuel,
  ...expenses,
  ...advances,
  ...driverPay,
  ...signature,
]

export const PDF_FIELD_BY_NAME: ReadonlyMap<string, FieldSpec> = new Map(
  PDF_FIELDS.map((spec) => [spec.name, spec]),
)

/**
 * Application values that deliberately have NO field on the United Freight
 * form. They stay in the app and in the Excel export; writing them into an
 * unrelated PDF field is not allowed.
 */
export const FIELDS_WITHOUT_PDF_EQUIVALENT = [
  { property: 'proNumber', excel: 'Weekly Pay "PRO / BOL"', reason: 'The printed form has no PRO field.' },
  { property: 'bolNumber', excel: 'Weekly Pay "PRO / BOL"', reason: 'The printed form has no BOL field.' },
  { property: 'taxReserveRate', excel: 'Weekly Pay "Tax reserve" rate', reason: 'The printed form has no tax-reserve field.' },
  { property: 'taxReserve', excel: 'Weekly Pay "Tax reserve"', reason: 'The printed form has no tax-reserve field.' },
  { property: 'estimatedNetPay', excel: 'Weekly Pay "Estimated net"', reason: 'The printed form has no net-pay field.' },
  { property: 'reimbursements', excel: 'Expenses "Reimbursement received"', reason: 'The printed form tracks money spent, not money repaid.' },
  { property: 'routeStopType', excel: 'Routes "Type"', reason: 'The printed form has only From/To rules.' },
  { property: 'routeNotes', excel: 'Routes "Notes"', reason: 'The printed form has no notes rule.' },
  { property: 'expenseDate / state / receipt', excel: 'Expenses sheet', reason: 'The printed form summarises expenses by category only.' },
  { property: 'advanceNotes', excel: 'Advances "Notes"', reason: 'The printed advances table has Date, Amount and Type only.' },
] as const
