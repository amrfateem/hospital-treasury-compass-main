<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules
- Hospital data is one logical document stored in chunks (`hospital_chunks`: one per small collection, one per month for dated ones, hashed buckets for big undated ones; `chunks.ts`) with a CAS version in `hospital_state_meta`; saves write only changed chunks + `audit_log` rows (`save_hospital_chunks`), the server caches the doc by version (`state.server.ts`) and devices pull only changed chunks (`getHospitalChanges`). Keeps saves/sync small as years accumulate. Covered by `patients-staff.test.ts`.
- Every change is a named pure op in `src/lib/hospital/ops.ts`, run optimistically in the browser (`store.ts`) and re-run server-side with role checks (`sync.functions.ts`); add mutations as ops, never direct writes. `viewFor` redacts per section (reception: billing + own shifts on the one main treasury).
- Patient files, visits, lab orders and stored files live in SQL tables (`medical.functions.ts`, `files.functions.ts`, private bucket via signed URLs) because they grow without bound and need search indexes.
- Patient money: a receipt's unpaid remainder is credit on the patient's own account `pt-<patientId>`, collected via `collectPatientRemaining`; balances are computed server-side (`patient-money.ts`). Patient-file deletion is only request → finance-manager approval (`decidePatientDelete`, `afterOp` deletes the SQL row + files); receipts are kept.
- Staff accounts: username + password (internal email, `staff.ts`), roles in `user_roles`, managed only by admin server fns (`users.functions.ts`); first owner via `/auth` setup.
- Access per section in `permissions.ts` (levels none/view/add/edit); `runOp` checks `requiredLevel`; `NAV` in `AppShell.tsx` maps pages to sections. Every op appends to `auditLog` with a deterministic id.
- Money math is pure (`finance.ts`, `payroll-tax.ts`, `bank.ts`, `invoice-export.ts`, `thermal-receipt.ts`) and test-covered; the general ledger is never stored — `ledger.ts` derives double-entry journals so every number drills to its source.
- Expenses are derived (`kind: "out"` transactions with a `category`); money between boxes moves only as `transfers`.
- Departments, price lists and editable lists live in the DB, never code constants (`findDepartment`, `<DeptSelect>`); catalog defaults merge once via settings versions. A fresh system starts empty.
- App pages live under `src/routes/_authenticated/`; UI is RTL-only.
- PDFs (contracts, reports) render an off-screen document with html2canvas-pro + jsPDF so Arabic shapes correctly; mark rows `data-pdf-break`.
- AI document reading runs only server-side and produces drafts a person must review.
- Fiscal years are calendar years; closing one (`closeFiscalYear`, rules in `fiscal.ts`) freezes a summary and `runOp` refuses any op that adds/edits/removes a money record dated in a closed year (`lockedChange`), so archived statements never change while balances carry forward by derivation. Covered by `fiscal.test.ts`.
- Each device keeps its last view in IndexedDB (`device-cache.ts`, cleared on sign-out) and starts from it, syncing only changes, so archived years download once per device.
- Every dispatched op is written to a durable device outbox (`device-cache.ts` outbox store) before sending and removed only on a server answer; network failures retry in order, and `applyHospitalOp` skips an op whose audit id (`log-<now>-<userId>-<op>`) is already recorded — so offline entries are never lost or doubled. The outbox survives sign-out. Covered by `outbox.test.ts`.
- DB triggers keep a start-of-day copy of each changed chunk in `hospital_restore_points` (one year); only the director restores via `restore.functions.ts` → `restore_hospital_to_day`, which bumps the version so caches and devices refresh.
- Look and feel come only from tokens/utilities in `src/styles.css` (palette, gradients, `hero-banner`, `stat-icon`, `sync-badge`); printed documents use the `--doc-*` variables.
