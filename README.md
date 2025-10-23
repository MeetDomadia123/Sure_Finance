# Sure Finance

Lightweight PDF statement parser and viewer. Extracts key fields from credit card statements and shows them in a simple UI.

## UI
![Bank Statement Parser UI](./assets/ui-screenshot.png)

<!-- Alternate: If you prefer to control display size, use this HTML tag instead:
<img src="./assets/ui-screenshot.png" alt="Bank Statement Parser UI" width="1000" />
-->

## Features
- PDF parsing in-browser (no upload to server)
- Bank-specific parsers:
  - HDFC: name, card ending, statement period, payment due date, total amount due,basic transactions
  - ICICI: name, card ending, statement date/period, payment due date, total amount due, basic transactions
  - SBI: name, card ending, statement period, payment due date, total amount due,basic transactions
  - Axis: name, card ending, statement period, payment due date, total amount due,basic transactions
  - American Express: name, card ending, statement period, payment due date, total amount due,basic transactions
- Raw JSON view for debugging

## Getting started
- Node 18+ recommended

Install and run
- npm install
- npm run serve
- Open http://localhost:5173 or http://localhost:3000(or the printed URL)



## Project structure (short)
- src/
  - parsers/
    - hdfc.js, icici.js, sbi.js (bank-specific logic)
  - generic.js (shared helpers)
- public/ (static assets)
- outputs/ (local debug dumps; ignored by Git)

## Using the app
- Choose Bank
- Drop a PDF
- Click Parse
- Optionally toggle “Show raw JSON” to inspect extracted data

## Parser notes
- HDFC
  - Owner name prioritized from header block near Email/PIN
  - Statement/Billing Period, Due Date, Total Amount Due extracted via labels
- ICICI
  - Owner name from header; avoids transaction/merchant lines
  - Supports Month dd, yyyy dates (e.g., March 8, 2025)
  - Total due prefers the label’s line; filters tiny/huge noise
  - Transactions parsed from lines that start with a date
- SBI
  - Owner name from “My Name/Account Holder Name” labels or above “My Address”
  - Savings/summary PDFs may not contain due-date/total fields

## Add a new bank (quick guide)
1. Create src/parsers/<bank>.js
2. Export parse<Bank>(text) that calls parseGeneric(text) then overrides fields
3. Register the bank in the UI selector and router (if applicable)
4. Keep all bank samples in a local, ignored folder (samples/, statements/)


## Privacy
- Did not commit personal PDFs or dumps
- .gitignore excludes outputs/, samples/, statements/, data/, private/, and all .pdf/.txt inside them
- Use .env.example for placeholders only

## Scripts (common)
- npm run dev — start dev server
- npm run build — production build
- npm test — run tests (if present)
