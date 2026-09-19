/** Small shared building blocks. */
import type { ReactNode } from 'react'
import { formatSignedMiles } from '../lib/money'
import type { Issue } from '../lib/validation'

export function Panel({
  title,
  hint,
  children,
}: {
  title?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="panel">
      {title && <h2>{title}</h2>}
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  )
}

export function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  inputMode,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  inputMode?: 'text' | 'numeric' | 'decimal'
}) {
  return (
    <Field label={label}>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

export function Tile({
  label,
  value,
  sub,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
}) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub !== undefined && <div className="sub">{sub}</div>}
    </div>
  )
}

/** Renders a mileage difference with its sign and a clear colour. */
export function Difference({ value }: { value: number | null }) {
  if (value === null) return <span className="zero">--</span>
  if (value === 0) return <span className="zero">0</span>
  return <span className={value > 0 ? 'neg' : 'neg'}>{formatSignedMiles(value)}</span>
}

export function IssueList({ issues, kind }: { issues: Issue[]; kind: 'error' | 'warning' }) {
  if (issues.length === 0) return null
  return (
    <div className={kind === 'error' ? 'error' : 'warning'}>
      <strong>
        {kind === 'error'
          ? `${issues.length} problem${issues.length === 1 ? '' : 's'} must be fixed before exporting`
          : `${issues.length} thing${issues.length === 1 ? '' : 's'} to confirm`}
      </strong>
      <ul className="issue-list">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${index}`}>
            {issue.message}
            {issue.detail && <span className="detail">{issue.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}
