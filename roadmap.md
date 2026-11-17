# Roadmap — مستشفى الرحمة التخصصي

- [x] App shell, RTL sidebar, Arabic fonts, design system
- [x] Payroll & tax, treasury ledger, patient billing, supplier invoices, inventory, closing PDFs
- [x] System reset, full org structure, editable lists, edit invoices, usability
- [x] Cloud storage + staff sign-in (username/password), live sync between devices
- [x] Reception: billing + own drawer shift only; receipt edit/delete after print needs manager approval
- [x] Shifts page: open/close drawers, counted vs expected per method, shortage/surplus, PDF
- [x] Pharmacy & consumables stock page: batches, expiry, reorder alerts
- [x] Section permissions per user, set by the hospital director (none / view / full) + auditor role
- [x] Review: transaction review (approve / flag / changed after review), pending approvals, audit log
- [x] Petty cash (النثريات): separate box, top-ups, categorized small expenses
- [x] Expense management: every money-out from any box is registered as a categorized expense
- [x] Orders: payment orders (request → approve → pay), purchase orders + receiving to stock, store issue orders
- [x] Receipts by section: clinics, emergency, lab, radiology, ICU (stay days) with ready price lists
- [x] Invoice export management: filters, Excel, combined PDF report, bulk receipts PDF, export log
- [x] Receipt printer (thermal 80/58 mm): print button per receipt, auto-print after save, copies, test print
- [x] Department services page: add / edit / copy / delete services and prices per department
- [x] Doctors page (dues + payouts UI) — screen built
- [x] Insurance receivables page — screen built
- [x] Cost centers report page — screen built
- [x] Supplier statement page — screen built

## Request 2026-11-15 (run, improve, departments, services, permissions, approvals, store)
- [x] Run the system on Lovable Cloud (code + database + sign-in)
- [x] Organize hospital departments (surgical / critical-care groups, missing departments)
- [x] Organized service picking on receipts (group chips, clinic services, prices for every department)
- [x] Permissions list: 4 levels (none / view / add / full) + what each level allows, enforced on the server
- [x] Every payment order, purchase order, store request and receipt change needs the finance manager's approval
- [x] General store with every consumable of every department (catalog + per-department view + consumption)

## Request 2026-11-15 (petty cash approval + improvements)
- [x] Petty cash spends go through finance-manager approval (request → approve → pay); top-ups by finance/director only
- [x] Approvals counter in the side menu + alert/notice for the finance manager when requests wait
- [x] Doctor payouts, supplier payments, payroll posting and cash supplier invoices limited to finance/director
- [x] Cost centers count registered expenses, petty cash and payment orders
- [x] Built doctors, insurance, cost centers and supplier statement screens

## Request 2026-11-15 (finish untested parts)
- [x] Insurer collection tested with real receipts; double collection blocked
- [x] Supplier payment tested; deleting a supplier payment limited to finance/director
- [x] PDF export checked on insurance, supplier statement, doctors and cost centers
- [x] Weak-password and other account errors shown in Arabic
- [x] Wide tables no longer push pages off screen (supplier statement, services, petty cash, permissions, receipt form)

## Request 2026-11-15 (move to new project + advanced accounting)
- [x] Move the whole system into this project on Lovable Cloud (pages, logic, sign-in, database)
- [x] Analytic accounting: cost-center profitability with shared-cost allocation + drill-down to entries
- [x] E-invoicing (Egyptian Tax Authority format): VAT 14% / exempt + withholding, ready-to-sign documents, status tracking
- [x] AI reading of supplier invoices (photo / PDF) → draft supplier invoices for review
- [x] Treasury & bank reconciliation: bank accounts, statement import (CSV / AI from PDF), auto-matching, reconciliation report, daily cash flow
- [x] Live financial statements: balance sheet, income statement, trial balance, general ledger — click any number to reach its entry
- [ ] Live ETA submission — waits on ETA client ID/secret + signing token from the hospital

## Request 2026-11-16 (grow-ready hospital system)
- [x] Manual journal entries for the accountant (adjustments, corrections, year-end accruals) + extra accounts
- [x] Credit accounts: patients on installments + contracted companies — statements, collections, overdue follow-up
- [x] Budget vs actual per department
- [ ] Branches + foreign currencies (exchange rate → EGP)
- [x] Staff section: employee file, national ID card (photos), employment contract — print, sign (screen or scanned), stored
- [ ] Medical: patient files, appointments, lab results
- [x] Ready for large volume: medical/HR data in their own tables

## Request 2026-11-16 (staff contracts, remaining amount, delete approval, speed)
- [x] Staff page: employee file, national ID photos, employment contract — print/PDF, sign on screen or upload signed scan
- [x] Receipt field "remaining on patient" → shown on the patients page, collectable later into the box
- [x] Deleting a patient file only after finance-manager approval
- [x] Storage split into small monthly pieces + server cache + changed-only device sync + permanent operations log + fast patient search
- [x] Yearly archive: calendar year 1/1–31/12, close after it ends (finance manager/director), locked afterwards, balances carried forward, reopen by director only
- [ ] Old records from the previous system — waits on a backup file from the hospital

## Request 2026-11-16 (notifications, paper contracts, automatic remaining, receipts list)
- [x] Notifications menu: finance manager sees requests waiting for approval and approves / rejects from it; requesters see the decision
- [x] Employment contract: no on-screen signature — save data → print → employee signs with pen → mark signed (scan optional)
- [x] Receipt: type the amount paid now; remaining on the patient is calculated automatically
- [x] Receipts list organized: grouped by day, paid / remaining columns, filters (today, has remaining), tidy actions

## Request 2026-11-16 (ICU basics and consumables)
- [x] ICU receipt price list: devices, procedures, bedside checks and itemized consumables (approximate prices, editable)
- [x] ICU store: respiratory, nursing supplies, ICU drugs and fluids

## Request 2026-11-16 (organized system, services per department)
- [x] Move the system into this project with its own Lovable Cloud (pages, logic, sign-in, database, file storage)
- [x] Receipt shows only the chosen department's services (lab → lab only); general services in a separate button
- [x] "Other departments" receipt: pick the department first, then its services appear
- [x] Switching department removes services picked from the previous department
- [x] New service must be given a department (or explicitly "general for all")
- [ ] Old records — waits on a backup file from the previous project (Settings → backup)

## Request 2026-11-16 (complete hospital accounting: 5 additions)
- [x] Inpatient account: deposit on admission, charges (services, drugs, stay days) added during the stay, one final bill on discharge
- [x] Operating theatre receipts: surgeon, anaesthesia, room fees + fixed-price surgery packages
- [x] Patient refunds: request → finance approval → pay back from the drawer, reverses revenue (and returns drugs to stock)
- [x] Pharmacy sales on receipts: drugs sold from stock automatically, profit per item report
- [x] Staff advances: request → approval → pay, deducted from salary in monthly installments

## Request 2026-11-16 (complete system, modern look, receipt, safe database)
- [x] Move the uploaded system into this project with its own Lovable Cloud (database, sign-in, file storage)
- [x] Inpatient account, patient refunds and staff advances reachable from the side menu
- [x] Modern colors and fonts across every page, new dashboard welcome banner with today's numbers and shortcuts
- [x] New printed receipt design (thermal 80/58 mm and A4/A5 PDF)
- [x] No lost entries: every change is kept on the device until the cloud confirms it, resent automatically after the internet returns, never saved twice
- [x] Daily restore points (one year) with director-only "return to start of a day" in Settings → backup
- [x] Live save status in the top bar (saved / saving / waiting for internet)
- [ ] Old records from the previous system — waits on a backup file from the hospital (Settings → backup)
- [ ] Live ETA submission — waits on ETA client ID/secret + signing token from the hospital

## Request 2026-11-16 (department drawers combined)
- [x] All department drawers shown as one combined drawer, with each drawer's own detail (treasury page)
- [x] Only accountant, finance manager and director see all drawers; department staff see only their own

## Request 2026-11-17 (one main treasury everywhere + revenue/expense/petty management + accountant-ready)
- [x] Move the uploaded system into this project with its own Lovable Cloud (database, sign-in, file storage)
- [x] Treasury page: replace the old combined-drawer card with a main-treasury summary + who collected how much
- [x] Petty cash page: no separate petty box or "top up" button — petty is paid from the main treasury
- [x] New staff account: no drawer choice
- [x] Remove leftover drawer wording (shifts, settings, refunds, control, receipts, bank)
- [x] New page "Revenues, expenses & petty cash" with full detail, reconciled with the financial statements
- [x] Update the automatic checks to the new rules + checks for the new summaries
- [x] Try the system end-to-end (sign in, shift, receipt, petty, reports)

## Request 2026-11-17 (daily closing report)
- [x] Printed daily closing for the main treasury: opening + in − out = closing, cash counted vs expected, who collected what, signatures (cashier, accountant, finance manager)
- [x] Closed day cannot be changed; reopening only after the finance manager approves (director reopens directly)
