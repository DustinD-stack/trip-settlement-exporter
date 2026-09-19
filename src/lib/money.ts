/**
 * Decimal-safe money helpers.
 *
 * Amounts are handled in integer cents so that repeated addition cannot drift
 * (0.1 + 0.2 problems), and every monetary result is rounded to two decimals
 * exactly once, at the point it becomes a result.
 */

/** Parses a user-entered value. Returns null for blank / unparseable input. */
export function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = String(value).replace(/[$,\s]/g, '').replace(/[()]/g, (m) => (m === '(' ? '-' : ''))
  if (text === '' || text === '-') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

/** Parses a value that must be a whole number of miles. */
export function parseWhole(value: unknown): number | null {
  const n = parseNumber(value)
  return n === null ? null : Math.round(n)
}

export function isBlank(value: unknown): boolean {
  return parseNumber(value) === null
}

/** Rounds to cents using half-away-from-zero, avoiding binary float surprises. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0
  const cents = Math.round(Math.abs(value) * 100 + Number.EPSILON * 100)
  return (value < 0 ? -cents : cents) / 100
}

/** Converts to integer cents for exact accumulation. */
export function toCents(value: number): number {
  if (!Number.isFinite(value)) return 0
  const cents = Math.round(Math.abs(value) * 100 + Number.EPSILON * 100)
  return value < 0 ? -cents : cents
}

export function fromCents(cents: number): number {
  return cents / 100
}

/** Exact sum of money values: accumulate in cents, convert once. */
export function sumMoney(values: Array<number | null | undefined>): number {
  let cents = 0
  for (const v of values) {
    if (v === null || v === undefined || !Number.isFinite(v)) continue
    cents += toCents(v)
  }
  return fromCents(cents)
}

/** Exact product of an amount and a rate, rounded once to cents. */
export function multiplyMoney(amount: number, rate: number): number {
  return roundMoney(amount * rate)
}

/** "1,654.40". Returns '' for null so blanks stay blank on the PDF. */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  return roundMoney(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** "$1,654.40" for on-screen display. */
export function formatCurrency(value: number | null | undefined): string {
  const text = formatMoney(value)
  if (text === '') return '--'
  return text.startsWith('-') ? `-$${text.slice(1)}` : `$${text}`
}

/** "2,068" for on-screen and PDF mileage. */
export function formatMiles(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  return Math.round(value).toLocaleString('en-US')
}

/** "+45" / "-45" / "0" - differences must always show their sign. */
export function formatSignedMiles(value: number): string {
  const rounded = Math.round(value)
  if (rounded === 0) return '0'
  return `${rounded > 0 ? '+' : '-'}${Math.abs(rounded).toLocaleString('en-US')}`
}

/** Trims trailing zeros: 12.50 -> "12.5", 12.00 -> "12". */
export function formatGallons(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  return String(Number(value.toFixed(2)))
}

/** 0.25 -> "25%" */
export function formatPercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '--'
  return `${Number((rate * 100).toFixed(4))}%`
}
