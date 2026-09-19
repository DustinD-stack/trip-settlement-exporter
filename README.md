# Trip Settlement Exporter

A weekly trucking trip-pay calculator and United Freight settlement PDF exporter that runs
entirely in the browser.

Enter a trip, review the calculated pay and the mileage differences, then export the completed
settlement as a ready-to-email PDF and, if you want it, an editable fillable PDF.

**Everything stays on your device.** No server, no database, no account, no API keys, no
analytics. Trips are stored in your browser (IndexedDB, mirrored to localStorage) and PDFs are
generated locally with [pdf-lib](https://pdf-lib.js.org/).

---

## What it does

| Screen | What it is for |
| --- | --- |
| Dashboard | Week totals, the selected trip, and anything that needs attention |
| Weekly Pay | One row per trip with every figure; add, edit, duplicate, complete, select, delete, export |
| Trip Details | Driver, truck, trailer, trip/PRO/BOL, dates, odometer, paid miles, rate and pay |
| Routes & Stops | Ordered stops with From/To, pickup and delivery flags, and notes |
| State Miles | Per-state miles and highways, with the differences against the odometer |
| Fuel & DEF | Purchases with invoice numbers, gallons and totals |
| Expenses | Categorised expenses and reimbursements, kept as separate totals |
| Advances | Advances and deductions, which reduce the estimated net pay |
| PDF Export | Validation, confirmation, a preview of both pages, and the downloads |
| Settings & Backup | Defaults, Excel import/export, JSON backup and restore, export history |

### Calculations

```
Actual miles       = Ending odometer - Beginning odometer
Mileage pay        = Paid miles x Mileage rate
Gross pay          = Mileage pay + Extra-stop pay + Detention/layover pay + Other pay
Estimated tax res. = Gross pay x Tax-reserve rate
Estimated net pay  = Gross pay + Reimbursements - Advances - Estimated tax reserve
```

Money is accumulated in integer cents and rounded to two decimals once, at the point it becomes
a result, so repeated addition cannot drift.

### What the app will never do

- Adjust odometer miles, state miles, paid miles, expenses, reimbursements, advances or pay.
  Discrepancies are reported, with both original numbers and the exact difference, and you have
  to confirm them before exporting.
- Treat a blank as zero. A missing amount stays missing, is warned about, and prints blank.
- Write a value into an unrelated PDF field. The printed form has no place for the PRO number,
  the BOL number or the tax reserve, so those stay in the app and the Excel export.
- Generate, copy or simulate a driver's signature. That field is always blank.
- Upload anything, anywhere.

---

## The settlement PDF

`public/settlement-template.pdf` is the original two-page United Freight form: 611 x 841 pt per
page, artwork untouched. Exports load it, copy it in memory, and write values into the copy. The
template file itself is never modified — there is a test that proves it.

`src/config/pdfFieldMapping.ts` is the **only** place PDF coordinates appear. Every field records
its page, rectangle, font size, alignment, and where its value comes from.

### About the supplied PDF

The PDF supplied with this project turned out not to be a blank form. Each page is a scan of a
**filled-in sample sheet** — another driver's settlement on page 1, handwritten instructions on
page 2 — with white rectangles painted over the writing and parts of the form redrawn as vector
artwork on top. It looks blank, but the sample data was still in the file and recoverable by
anyone who extracted the image.

`tools/build-template.mjs` builds the shipped template from it, and:

1. removes the AcroForm and all 348 widget annotations, so no stale values or field geometry
   survive;
2. **burns the white rectangles into the scan permanently**, deleting the hidden sample data;
3. re-encodes the scans losslessly, which took the file from 6.9 MB to 1.6 MB without changing a
   pixel.

That mixed construction also explains why the field geometry that shipped with the supplied PDF
was wrong in several places. The redrawn (vector) parts of the page sit on a tidy grid; the
untouched (scanned) parts are skewed and unevenly spaced, and the two do not line up. The
corrected geometry was measured against the artwork and is documented field by field:

| What was wrong | Effect |
| --- | --- |
| Route stops 6-10 reused the left column's rectangles | Every right-hand route printed a full row too low |
| Driver pay assumed an even 15pt row pitch | Up to 10pt of drift; the last two rows printed below their rules, clipped and over their labels |
| Advance rows were one row too high | Advance 1 printed inside the table header |
| Fuel and advance dates were written as one string | They printed over the pre-printed `/  /` marks |
| `fuel_total` and `advance_total` started too far left | They printed over the pre-printed `$` |

### Output

| File | What it is |
| --- | --- |
| `Dustin_Douglas_Trip_[TRIP]_Settlement.pdf` | Flattened, ready to email. No form layer. |
| `Dustin_Douglas_Trip_[TRIP]_Settlement_Fillable.pdf` | Real AcroForm fields, pre-filled, still editable. |

Both are built from one set of finalised values, so the preview and the download cannot disagree.
Text shrinks automatically to fit its box, and is truncated rather than allowed to overrun a
label, a border or the next value. Every export is checked for exactly two pages at the original
page size before it is offered.

---

## Running it locally

Requires Node 20 or newer.

```bash
npm install     # install dependencies
npm run dev     # start the dev server on http://localhost:5173
npm test        # run the test suite
npm run build   # production build into dist/
npm run preview # serve the production build locally
```

### Other commands

```bash
npm run build:template   # rebuild public/settlement-template.pdf from reference/
```

The built template is committed, so nothing needs the original PDF to run. The original itself is
**not** committed: it carries the hidden sample sheet described above, and publishing it would put
another driver's details in the repository. Drop it back into `reference/` if you want to re-run
that command.

`tools/measure-template.mjs` and `tools/preview-geometry.mjs` are development aids for checking
field geometry against the artwork. Neither needs a PDF renderer or any native dependency: they
read the template's page raster directly. Run them through `vite-node`:

```bash
npx vite-node tools/measure-template.mjs -- 2 100 340 95 200
npx vite-node tools/preview-geometry.mjs -- 2 out.png --all --crop=30,95,340,220
```

---

## Deploying to GitHub Pages

`.github/workflows/deploy-pages.yml` builds and publishes on every push to `main`. It needs no
secrets and no environment variables.

Vite's `base` comes from the `BASE_PATH` environment variable, which the workflow sets to
`/<repository-name>/` — what a GitHub **project** site needs. Locally it defaults to `/`.

```bash
# from the project folder
git init
git add .
git commit -m "Trip settlement exporter"
git branch -M main

# create the repository and push (GitHub CLI)
gh repo create trip-settlement-exporter --public --source=. --remote=origin --push

# ...or, if you made the empty repository on github.com yourself:
git remote add origin https://github.com/<your-username>/trip-settlement-exporter.git
git push -u origin main
```

Then turn Pages on:

1. Open the repository on github.com.
2. **Settings** -> **Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Push to `main` (or run the workflow from the **Actions** tab).

The site appears at `https://<your-username>.github.io/trip-settlement-exporter/`.

If you use a different repository name, nothing needs changing — the workflow reads the name at
build time. For a **user** site (`<username>.github.io`), set `BASE_PATH: /` in the workflow.

---

## Using it

1. Add a trip, or import your existing `Dustin_Weekly_Trip_Pay_Calculator.xlsx` from
   **Settings & Backup**.
2. Fill in routes, state miles, fuel, expenses and advances.
3. Review the calculated money and the mileage differences.
4. Mark the trip complete.
5. Select it, and open **PDF Export**.
6. Confirm any warnings, press **Preview settlement**, and check both pages.
7. **Download ready-to-email PDF**, and the fillable one if you want it.
8. Or use **Export all completed trips** for the whole week, which also produces a combined PDF.

### Excel

Import accepts the supplied workbook and anything with the same sheets and columns. It adds trips
whose numbers are not already present and never overwrites one you have edited. Blank cells stay
blank. The single `PRO / BOL` column is split into separate PRO and BOL fields.

Export writes all eight sheets: Weekly Pay, Routes, State Miles, Fuel & DEF, Expenses, Advances,
PDF Field Mapping (generated from the mapping file) and PDF Export Instructions.

### Backups

Your data lives in this browser only. Clearing site data deletes it. Download a JSON backup from
**Settings & Backup** if it matters to you.

---

## Tests

```bash
npm test
```

72 tests covering the mileage and money calculations, the decimal handling, the validation rules
and warnings, the field mapping, both PDF outputs and the Excel round-trip. Trip 39586 from the
original workbook is the end-to-end fixture:

- 2,023 actual odometer miles, 2,068 paid miles, 2,068 state miles
- a `+45` difference on both counts, which the app reports and never corrects
- $1,654.40 mileage and gross pay, $413.60 tax reserve, $1,240.80 estimated net
- a "Walmart pliers" expense with no amount, which is warned about and printed blank

Running the tests writes the verification PDFs to `verification/`, for comparison against the
settlement supplied with the project. Among the mapping tests are checks that no two fields on a
page overlap, that long values shrink and then truncate rather than overrun, that the flattened
PDF has exactly two pages and no form layer, that the signature field is empty in both outputs,
that the template file is byte-identical afterwards, and that exporting several trips never mixes
their data.

---

## Layout

```
public/settlement-template.pdf   the United Freight form, artwork unmodified
src/config/pdfFieldMapping.ts    every PDF coordinate, and nowhere else
src/lib/                         money, calc, validation, pdfValues, pdfExport, excel, storage
src/screens/                     one file per screen
tests/                           vitest suites
tools/                           template build and geometry-checking aids
reference/                       the original workbook, README and Python exporter
verification/                    generated Trip 39586 PDFs (written by the tests)
```

`reference/export_settlement.py` is the original Python exporter, kept for reference only. No
Python runs at any point.
