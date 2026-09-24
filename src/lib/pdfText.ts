/**
 * Centralised PDF text sanitiser.
 *
 * The settlement PDF is drawn with Helvetica, a standard PDF font that uses
 * WinAnsi encoding. WinAnsi cannot represent most of the punctuation that
 * arrives when text is copied out of a web page, a PDF or a word processor,
 * and pdf-lib throws rather than substituting:
 *
 *     WinAnsi cannot encode "‑" (0x2011)
 *
 * A non-breaking hyphen pasted into a highway list was enough to fail an
 * export. This module converts that punctuation to its plain ASCII equivalent
 * and guarantees that whatever is left can actually be encoded.
 *
 * It runs on the values on their way into a PDF - both the flattened drawing
 * and the AcroForm fields - and never on the values stored in a trip. What the
 * driver typed stays exactly as they typed it.
 */

/**
 * Code points WinAnsi can encode, determined by probing pdf-lib's Helvetica:
 * printable ASCII, the Latin-1 supplement, and 27 characters that WinAnsi
 * places in the 0x80-0x9F range (curly quotes, dashes, the euro sign and so on).
 */
const WIN_ANSI_SPECIALS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
])

export function isWinAnsiEncodable(codePoint: number): boolean {
  if (codePoint >= 0x20 && codePoint <= 0x7e) return true
  if (codePoint >= 0xa0 && codePoint <= 0xff) return true
  return WIN_ANSI_SPECIALS.has(codePoint)
}

/**
 * Characters replaced before the encodability backstop runs.
 *
 * Several of these (en dash, curly quotes, non-breaking space) *are* encodable,
 * but they are still folded to ASCII: a settlement is read off paper, and a
 * plain hyphen in "I-355" is clearer than whatever dash the source used.
 */
const REPLACEMENTS: Array<[RegExp, string]> = [
  // Hyphen, dash and minus variants -> "-"
  [/[‐‑‒–—―⁃−➖﹘﹣－]/g, '-'],
  // Curly, angled and prime single quotes -> "'"
  [/[‘’‚‛′‵ʹʼˈ́＇]/g, "'"],
  // Curly and prime double quotes -> '"'
  [/[“”„‟″‶ʺ〃＂]/g, '"'],
  // Non-breaking and other fixed-width spaces -> " "
  [/[   -   　]/g, ' '],
  // Zero-width and directional marks -> removed
  [/[​‌‍⁠﻿‎‏؜‪-‮⁦-⁩]/g, ''],
  // Soft hyphen: invisible on screen, a stray "-" on paper -> removed
  [/­/g, ''],
  // Bullets and middots used as separators -> "-"
  [/[∙⋅]/g, '-'],
  // Ellipsis is encodable, but spell it out so it is never confused with the
  // ellipsis this app appends when it truncates an over-long value.
  [/…/g, '...'],
  // Control characters, including tabs and newlines, which have no meaning in
  // a single-line form field.
  [/[\u0000-\u001f\u007f-\u009f]/g, ' '],
]

/** Last resort for a character no replacement covered. */
function foldUnencodable(character: string): string {
  // Many Latin letters outside Latin-1 are a plain letter plus a combining
  // accent: "ā" -> "a". Strip the accent and keep the letter where possible.
  const stripped = character.normalize('NFD').replace(/\p{M}+/gu, '')
  if (stripped && [...stripped].every((c) => isWinAnsiEncodable(c.codePointAt(0)!))) {
    return stripped
  }
  return '?'
}

/**
 * Makes a single value safe to draw into the settlement PDF.
 *
 * Returns '' for null/undefined so a missing value stays blank rather than
 * printing "undefined".
 */
export function sanitizePdfText(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''

  let text = String(value).normalize('NFC')
  for (const [pattern, replacement] of REPLACEMENTS) {
    text = text.replace(pattern, replacement)
  }

  // Backstop: anything still unencodable would make pdf-lib throw.
  let safe = ''
  for (const character of text) {
    safe += isWinAnsiEncodable(character.codePointAt(0)!)
      ? character
      : foldUnencodable(character)
  }

  // Collapse the runs of whitespace the replacements above can leave behind.
  return safe.replace(/ {2,}/g, ' ').trim()
}

/** Sanitises a whole field-name -> value map on its way into a PDF. */
export function sanitizePdfValues(values: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {}
  for (const [name, value] of Object.entries(values)) {
    safe[name] = sanitizePdfText(value)
  }
  return safe
}
