UNITED FREIGHT SETTLEMENT PDF EXPORTER

FILES
- Dustin_Weekly_Trip_Pay_Calculator.xlsx: Trip entry and calculations.
- Settlement_Template.pdf: Clean, fillable working copy of the original two-page form.
- export_settlement.py: PDF export program.
- Export_Settlement.bat: Exports the trip selected in Weekly Pay cell N4.
- Export_All_Trips.bat: Exports every completed trip and creates a combined weekly PDF.
- requirements.txt: Python packages required by the exporter.

FIRST-TIME SETUP ON WINDOWS
1. Install Python 3 from https://www.python.org/downloads/ and select Add Python to PATH.
2. Open Command Prompt in this folder.
3. Run: py -3 -m pip install -r requirements.txt

EXPORT ONE TRIP
1. Open the Excel workbook.
2. Enter the trip on Weekly Pay and the matching detail sheets.
3. Select the trip number in Weekly Pay cell N4.
4. Save and close Excel.
5. Double-click Export_Settlement.bat.
6. Review the mileage and receipt warnings. Enter Y only if the values are correct.
7. Open the Exports folder.

EXPORT THE WEEK
1. Save and close Excel.
2. Double-click Export_All_Trips.bat.
3. The Exports folder will contain one fillable and one ready-to-email PDF per trip.
4. A combined weekly PDF is also created.

IMPORTANT
- The exporter never changes state miles, odometer miles, or paid miles.
- The exporter requires confirmation when mileage differs or receipt information is incomplete.
- The flattened PDF is the ready-to-email copy. The Fillable PDF remains editable.
- The emailed source PDF remains unchanged; exports use the separate working template.
- Existing exports are never overwritten without confirmation.
- Tax reserve stays in Excel because the original PDF has no matching field.
- PRO/BOL stays in Excel because the original PDF has no matching field.
- The exporter leaves the driver-signature field blank and never creates or copies a signature.

TRIP 39586 TEST VALUES
- Actual odometer miles: 2,023
- Paid miles: 2,068
- State miles: 2,068
- Mileage difference requiring confirmation: 45
- Mileage pay: $1,654.40
- Tax reserve in Excel: $413.60
- Estimated after-tax amount in Excel: $1,240.80 before expenses or deductions
