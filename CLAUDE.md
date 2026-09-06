# expense-tracker

Personal expense tracker: collects the user's spending and organizes it into a Google Sheet in their own Google Drive.

## Key documents

- Design spec: `docs/superpowers/specs/2026-09-01-expense-tracker-design.md`
  - Why manual entry was chosen over automated collection.
  - CODEF/SMS/app-notification paths were investigated and rejected or deferred.
  - See spec §2 before re-proposing any of them.
  - Contains MVP scope and tech-stack rationale.
- Implementation plan: `docs/superpowers/plans/2026-09-01-expense-tracker-mvp.md`
  - The 8-task MVP build and exact step-level status.
- Future plans/specs follow:
  - `docs/superpowers/specs/YYYY-MM-DD-<topic>.md`
  - `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`

## Tech stack

- Next.js App Router + TypeScript, deployed to Vercel.
- No server-side database.
- Google Sheets, accessed with the signed-in user's OAuth token, is the only persistent store.
- NextAuth (Auth.js) v5 with Google provider.
- OAuth scopes are limited to `drive.file` + `spreadsheets`.
- Vercel AI SDK + AI Gateway for Gemini-based receipt OCR.
- Vitest + Testing Library for tests.

## Development workflow: Claude Code + Codex

This project uses Claude Code as the supervisor and Codex as the implementation owner.

For substantial implementation, bug fixing, refactoring, or test-writing work:

1. Claude Code converts the current task into a clear, self-contained request with requirements and definition of done.
2. Claude Code delegates the implementation through the global `codex-auto` skill.
3. `codex-auto` owns the implementation → review → fix → re-review → test loop internally.
4. Claude Code receives only the compact final result.
5. If the result is `PASS`, Claude Code reports completion without independently repeating the review, re-reading the full diff, or rerunning the same tests.
6. Claude Code directly investigates only when the result is `NEEDS_DECISION` or `FAIL`.

Do not have Claude Code write application code directly under this workflow. Application code is Codex's responsibility.

Claude Code may directly write or update:
- specs
- plans
- project documentation
- this `CLAUDE.md`

Do not automatically invoke `/codex:rescue` or `/codex:review` after `codex-auto`.

Do not request or reproduce:
- raw Codex responses
- full diffs
- full command logs
- full test logs
- intermediate Codex progress

unless they are specifically needed to troubleshoot a failed or blocked run.

### Codex environment constraints

Codex's sandbox has no network access and cannot bind local ports.

Therefore Codex cannot reliably:

- run `npm install`
- reach AI Gateway or external APIs
- run network-dependent integration checks
- run `next dev`
- run Turbopack-based commands that require binding a local port

For Next.js compilation/type verification, prefer:

`next build --webpack`

when the normal Turbopack path is blocked by sandbox restrictions.

If verification genuinely requires network access or a bound local port, the supervising Claude Code session may perform that specific verification after Codex finishes.

Do not send Codex back to retry an operation already known to be impossible because of its sandbox restrictions.

## Importing Claude Design mockups

The `DesignSync` MCP requires `/design-login`, which needs an interactive terminal that may not be available in the current session.

If interactive login is unavailable:

1. Ask the user to export a handoff `.zip` from `claude.ai/design`.
2. Ask the user to upload the zip.
3. Extract it with Python's `zipfile`, not macOS `unzip`, because Korean filenames may be mangled by the default codepage.
4. Keep relevant `.dc.html` files as committed references under:

`docs/superpowers/specs/design/`

## Project memory

Keep this file focused on durable information required by future sessions.

Update `CLAUDE.md` only when durable project knowledge changes, such as:

- architecture decisions
- persistent constraints
- environment limitations
- important workflow changes
- information that would surprise a future session

Do not run CLAUDE.md maintenance automatically after every implementation task or work session.

Routine implementation progress belongs in the relevant plan/status document rather than here.

Keep the **Recent decisions** section:
- short
- newest first
- focused on conclusions rather than investigation history

Prune entries once they are fully represented by the spec or plan.

Full research history, rejected approaches, detailed debugging history, and implementation details belong in the relevant spec/plan document. Link to those documents instead of duplicating the content here.

## Architecture notes

- `app/page.tsx` is an async server component and cannot hold `useState` or event handlers.
- UI requiring client-side state must live in dedicated `'use client'` components.
- Examples include:
  - folder picker
  - expense form
  - list refetch
  - OCR draft values
- Existing examples include `FolderPickerSection` and `ExpenseDashboard`.
- Do not try to lift client state into `app/page.tsx`.
- There is no shared global "app state" object.
- Components that need information such as the selected Drive folder should read it themselves where appropriate.
- Example: `getSavedFolderId()` from `lib/folderStorage.ts`, which wraps `localStorage`.

## Constraints

Do not relax these without updating the design spec.

- No database. Google Sheets is the persistent store.
- OAuth scope remains `drive.file` + `spreadsheets`.
- Never request broader Google Drive access without an explicit architecture/spec change.
- OCR is auto-draft + human-confirm.
- OCR must never auto-save extracted expense data.
- Automated collection via CODEF, SMS, email parsing, or similar mechanisms is deferred, not cancelled.
- Review the design spec §2/§7 before re-investigating automated collection.

## Status

- Tasks 1–5: complete.
- Task 8: code-complete.
  - Manual iPhone "Add to Home Screen" verification still requires a real device.
- Task 6 (receipt OCR):
  - implementation complete
  - unit-tested
  - currently on hold pending a user billing/model decision
- Task 7 (OCR-to-form integration):
  - blocked on the same Task 6 billing/model decision

See the implementation plan for exact step-level status.

## Recent decisions

- 2026-09-06: Monthly sheet management shipped (user feedback item 4: file name management). One spreadsheet file now holds per-month sheet tabs (`YYYY-MM`, header row `날짜|금액|카테고리|메모|결제수단`), the file name is user-editable via rename (not search-and-create, to avoid duplicate files), and legacy flat `Sheet1` data auto-migrates once. See `docs/superpowers/specs/2026-09-06-monthly-sheet-management-design.md` and its plan. Implemented by Codex via `codex-auto`; Codex's own review pass caught 4 real correctness gaps (non-idempotent migration retry, a header-write race in month-sheet creation, unescaped file names breaking the Drive search query, and a stale-response race in the dashboard's month fetch) — all fixed directly, see the plan's "Hardening fixes" section. Real-device/live-account end-to-end verification (actual Google sign-in) still hasn't been done — only unit tests + `next build --webpack` have run. `npm run lint` is separately broken (no `eslint.config.js` exists in the repo at all) — pre-existing, unrelated to this feature.
- 2026-09-04: Task 8 PWA implementation completed. `app/manifest.ts`, viewport configuration, and PWA icons are in place. Build verification passed. Real-device iPhone installation verification remains.
- 2026-09-03: Task 6 receipt OCR is implemented and unit-tested but paused pending the user's AI Gateway billing/model decision. Task 7 is blocked by the same decision. Provider-side OCR errors currently surface as bare 500 responses; improve API error handling when OCR work resumes.
- 2026-09-03: Task 6 implementation was updated for the installed `ai@7.0.87` API: `generateText` + `Output.object({ schema })` replaces the older `generateObject` approach, and receipt images use file content parts. The implementation plan was corrected accordingly.
- 2026-09-02: Task 5 completed, including the recent list, monthly summary, `ExpenseDashboard`, and integration of the selected Claude Design handoff.
- 2026-09-02: Fixed a locale-dependent Google Sheets bug by normalizing the first spreadsheet tab to `Sheet1` on both newly created and existing spreadsheets.
- 2026-09-02: Task 3b Drive folder picker completed. Drive, Sheets, and Picker APIs must be explicitly enabled in Google Cloud; OAuth client creation alone is insufficient.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data.

Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/`, resolved from this file's directory. In monorepos, the `next` package may not be visible from the repository root.

Heed deprecation notices.

This block is written and re-added by `next dev`.

Verify its behavior at:

`node_modules/next/dist/server/lib/generate-agent-files.js`

Removing this block from a diff only causes the uncommitted change to be re-created. Committing it with the project keeps the working tree clean.

<!-- END:nextjs-agent-rules -->