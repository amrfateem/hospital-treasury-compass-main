# Al-Rahma Specialized Hospital — portable treasury system

Standalone Windows build of the hospital accounting, treasury, payroll, patient and stock
system. It runs from a USB drive on the hospital LAN as `http://alrahma.local` (no port).

## What is inside

- **Server PC**: `release/AlRahmaHospital` — Tauri shell, bundled Node runtime, bundled
  WebView2, SQLite data, daily backups, local accounts.
- **Client PCs**: `release/AlRahmaHospital-client` — the same Tauri shell with
  `client.json` pointing at `http://alrahma.local`; no database or Node sidecar.
- **Slim build**: uses the Windows Edge WebView2 that ships with Windows 10/11
  (server ~115 MB, client ~5 MB). If a PC lacks WebView2, install the official
  Microsoft Edge WebView2 Runtime once.
- **Updates**: `release/updates/<version>` — a signed offline update package that also
  replaces `AlRahmaHospital.exe` (printing/download fixes live in the desktop shell). Client
  PCs get the same exe from `release/client-<version>`.
- **Exports**: PDF/Excel/JSON downloads are saved to
  `C:\Users\<user>\Documents\AlRahmaHospital\Exports` (tray item «مجلد التصدير»).
- **POS printing**: the receipt printer is chosen per device; silent ESC/POS printing sends
  the slip at exact 80/58 mm widths without the Windows print dialog. Old clients fall back
  to a correctly-sized browser print page.

Data lives in `<app>\data`; backups are written daily to `<app>\Backups` and to
`C:\Users\Public\Documents\AlRahmaHospitalBackups\<PC-NAME>`.

## Build

Requirements for the build PC only: Node.js, a Rust toolchain (MSVC or GNU), and the Edge
WebView2 runtime. End-user PCs need none of these.

```powershell
npm install
npm run test
npm run app:build           # Vite server build + Tauri release build
npm run app:package         # assemble release/AlRahmaHospital and the client folder
powershell -File scripts/sign-release.ps1   # sign the exes first
node scripts/make-update.mjs                # payload includes the signed exe
powershell -File scripts/sign-release.ps1   # sign the generated update script
```

`app:package` copies the installed WebView2 runtime (about 880 MB) into both packages so the
target PCs do not depend on a host runtime. Set `NO_WEBVIEW2=1` to skip it during development.

## First run

1. Copy `release/AlRahmaHospital` to the USB drive.
2. Run `AlRahmaHospital.exe` on the server PC; create the first director account.
3. Open `http://alrahma.local` from a client PC. After signing in, the top bar shows this
   address with a copy button, plus the server's LAN IP to use when multicast is blocked.
4. Optional unattended mode: right-click `install-service.ps1` → *Run as administrator*.
   This installs the headless server as a Windows service, adds the firewall rules, trusts
   the internal signing root, and registers the nightly update task.

## Signing

The build uses an internal root CA and a rotating code-signing leaf in the current user's
certificate store. Only the public root is shipped (`trust/AlRahmaRoot.cer`). New PCs trust
it once with `Trust-AlRahma.ps1` (or automatically through `install-service.ps1`).

- Root CA: 20 years, installed once.
- Leaf: 2 years, reissued from the root without re-trusting the PCs.
- Timestamped SHA-256 Authenticode signatures.
- No public certificate authority is involved; Windows SmartScreen reputation is not
  granted outside the PCs that trust the root.

## Treasuries, service prices and owner funding

- Two cash treasuries: **Main** and **ICU**. ICU receipts go to the ICU treasury; every other
  department goes to Main. ICU staff shifts select the ICU treasury automatically.
- A service price is fixed from **Department Services** unless the service is flagged
  **Variable Price**; only then can the price be typed on a receipt.
- The owner can fund the ICU (or main) treasury from **Treasury → تمويل من صاحب المستشفى**.
  It is owner current-account money, not revenue, and is not attributed to any collector.
- Expenses and petty cash choose their treasury and cannot exceed its balance.
- Daily closing is independent per treasury; a closed ICU day does not lock Main.

## Updates

Bump the version in `package.json` and `src-tauri/Cargo.toml`, rebuild, then run
`node scripts/make-update.mjs` (or set `UPDATE_VERSION`). It builds a signed package
containing the server and public assets plus SHA-256 hashes. Copy the package contents into
`<app>\Updates`:

- **Service mode**: the SYSTEM task applies it at 3 AM or on next boot, backs up the
  database first, switches `server`/`public` atomically, and rolls back if the health check
  fails.
- **Tray mode**: close the tray app, run `Updates\apply-update.ps1` as administrator, then
  start the app again.

The update script verifies every payload hash and its Authenticode signature before touching
the data. Previous folders stay as `server.old-<version>` and `public.old-<version>`.

## Password recovery

On the server PC, without stopping the service:

```powershell
cd <app>
.\node.exe tools\reset-password.mjs --list
.\node.exe tools\reset-password.mjs --user director --password "new-password"
```

The tool updates the same scrypt hash and clears that user's sessions. The Windows shortcut
`tools\reset-password.cmd` prompts for both values.

## Notes

- The server PC must keep the USB plugged in while staff are working.
- Port 80 must be free on the server PC.
- The client URL is `http://alrahma.local`; if multicast is blocked, use the server hostname
  or IP (also without a port) and update `client.json`.
- AI invoice reading needs an internet connection and a Lovable/OpenAI key; it is disabled
  in this offline build.
- Database at rest is not encrypted; use BitLocker/VeraCrypt on the USB if required.
