# expense-tracker

Personal expense tracker: collects the user's spending and organizes it into a Google Sheet in their own Google Drive.

## Key documents

- Design spec: `docs/superpowers/specs/2026-09-01-expense-tracker-design.md` — why manual entry was chosen over automated collection (CODEF/SMS/app-notification paths were all investigated and rejected or deferred — see spec §2 before re-proposing any of them), MVP feature scope, tech stack rationale.
- Implementation plan: `docs/superpowers/plans/2026-09-01-expense-tracker-mvp.md` — the 8-task MVP build, task-by-task.
- Future plans/specs follow the same `docs/superpowers/{specs,plans}/YYYY-MM-DD-<topic>.md` convention.

## Tech stack

- Next.js (App Router, TypeScript), deployed to Vercel
- No server-side database — Google Sheets (via the signed-in user's own OAuth token) is the only persistent store
- NextAuth (Auth.js) v5, Google provider, `drive.file` + `spreadsheets` scopes only
- Vercel AI SDK + AI Gateway for Gemini-based receipt OCR
- Vitest + Testing Library for tests

## Development workflow: Claude Code + Codex

This project is built with Claude Code supervising and Codex doing the actual implementation:

1. Claude Code turns the current task into a self-contained spec (files, interfaces, steps, definition of done) — see the plan doc for the format.
2. Codex implements it via `codex:rescue`, running tests/build itself, and returns a self-review (what changed, assumptions, deviations, remaining risks).
3. Claude Code checks the self-review against the task's definition of done and reports a summary to the user.
4. If issues surface, Claude Code sends them back to Codex for a follow-up pass before moving on.

Do not have Claude Code write application code directly under this workflow — that's Codex's job. Claude Code writes/updates specs, plans, and this file.

**Known environment gap:** Codex's sandbox has no network access and can't bind local ports — it cannot run `npm install`, hit the AI Gateway, reach any external API, or run `next build`/`next dev` with Turbopack (Turbopack binds a local port even for a one-shot build; fails with `Operation not permitted`). Codex can fall back to `next build --webpack` to type-check/compile without hitting that wall. For anything that genuinely needs network or a bound port, the supervising Claude Code session runs it after Codex writes the code, then reports results back into the loop. Don't send Codex back to retry a network or Turbopack build — it will hit the same wall every time.

**Polling a Codex background job:** `node <codex-companion.mjs path> status <jobId> --json`, condensed via `python3 -c "import json,sys; d=json.load(sys.stdin); print(d['job']['status'], d['job']['phase'], d['job']['elapsed']); [print(p) for p in d['job']['progressPreview']]"`. Fetch the final report with `... result <jobId>` once `status` is `completed`.

**Importing a Claude Design (claude.ai/design) mockup:** the `DesignSync` MCP needs `/design-login`, which requires an interactive terminal this session doesn't have — it'll error out. Ask the user to export a handoff `.zip` from the design and upload it instead. Extract with `python3 -c "import zipfile; ..."`, not `unzip` — Korean filenames get mangled by macOS `unzip`'s default codepage. Keep the relevant `.dc.html` file(s) as committed reference under `docs/superpowers/specs/design/`.

## Project memory

- After finishing a task (or a work session), run `claude-md-management:revise-claude-md` to fold in what changed — new decisions, new constraints discovered, anything that would surprise a future session.
- Keep a **Recent decisions** log below, newest first. Prune entries once they're fully superseded by the spec/plan docs rather than letting this section grow unbounded.
- Full research history (what was tried and rejected, and why) lives in the spec, not here — link to it rather than duplicating it.

## Architecture notes

- `app/page.tsx` is an async server component — it cannot hold `useState` or event handlers. Any UI that needs client state (folder picker, expense form, list refetch, OCR draft values) lives in a dedicated client component (`'use client'`) that owns its own state, e.g. `FolderPickerSection`, `ExpenseDashboard`. Don't try to lift state into `page.tsx` itself.
- No shared "app state" object — components that need to know things like the picked Drive folder just read it themselves (e.g. `getSavedFolderId()` from `lib/folderStorage.ts`, which wraps `localStorage`) rather than receiving it threaded down through props from a common ancestor.

## Constraints (do not relax without updating the spec)

- No database. Sheets is the store.
- OAuth scope stays at `drive.file` + `spreadsheets` — never request broader Drive access.
- OCR is auto-draft + human-confirm, never auto-save.
- Automated collection (CODEF, SMS, email parsing) is deferred, not cancelled — see spec §2/§7 before re-investigating.

## Status

Tasks 1–5 and 8 fully done. Task 8's manual iPhone install check (Step 4) still needs a real device. Task 6 (receipt OCR) is code-complete and unit-tested but **on hold pending a user billing decision** — see below. Task 7 (OCR-to-form integration) is blocked on that same decision since it wires into Task 6's output. See the plan doc's checkboxes for exact step-level status.

## Recent decisions

- 2026-09-04: Task 8 (PWA installability) done — `app/manifest.ts` (Korean name/short_name, standalone display, `#111827` theme) and a `viewport` export in `app/layout.tsx` (this Next.js version — 16.3.4 — deprecates `metadata.themeColor` in favor of a separate `viewport` export; Codex confirmed this against the bundled Next.js docs/types before using it). Icons (`public/icons/icon-{192,512}.png`) were generated by the supervising Claude Code session, not Codex — no local image tool (PIL/ImageMagick) was available, so they were rendered by opening an HTML/CSS page (dark square + white ₩) in Playwright at exact pixel dimensions and screenshotting it, then downsampling to 192px with macOS `sips`. Build confirms `/manifest.webmanifest` is generated as a static route. Manual "Add to Home Screen" verification on a real iPhone (plan Step 4) is still outstanding.
- 2026-09-03: Task 6 (receipt OCR) implemented and unit-tested (`npm test`, `npx next build --webpack` both pass), but **live use is on hold** — the user chose "OCR 보류" (hold off) rather than resolve AI Gateway billing right now. Root cause of the 500 the user hit while testing: not a code bug — Vercel AI Gateway returns `403 customer_verification_required` until a payment card is on file (needed to unlock the $5/month free credit; confirmed live by reproducing `extractReceiptData` directly with the user's real key, bypassing the browser). Also confirmed via Vercel's docs (`/docs/ai-gateway/pricing`, `/docs/ai-gateway/faq`) and the live `v1/models` catalog: adding a card alone never charges anything — charges only happen on an explicit "top up" purchase or if auto top-up is turned on (off by default) — but `google/gemini-3.5-flash-lite` is NOT in Vercel's free-tier model list, so the $5/month free credit likely can't be spent on it; using it for real would need a small explicit credit purchase (though at $0.30/$2.50 per 1M input/output tokens, real-world cost for personal receipt-photo use is negligible). Revisit this decision — and whether to switch to an actual free-tier model instead — before resuming Task 6/7. `app/api/ocr/route.ts` also has no try/catch around `extractReceiptData`, so any provider-side error currently surfaces as a bare 500 — worth fixing whenever OCR work resumes.
- 2026-09-03: Task 6 (receipt OCR) done. Re-verifying the plan's `ai` SDK snippets against the installed `ai@7.0.87` surfaced two deprecations since the plan was written: `generateObject` → `generateText` + `Output.object({ schema })` (`{ object }` result becomes `{ output }`), and the `{ type: 'image', image }` message content part → `{ type: 'file', mediaType, data }` (bare base64 string accepted directly as `data`, no data-URL prefix needed). Plan doc's Task 6 snippets were corrected in place before handoff to Codex. Model `google/gemini-3.5-flash-lite` confirmed still current on the AI Gateway.
- 2026-09-02: Task 5 done — recent list, monthly summary, `ExpenseDashboard`, and the "minimal" visual design from the user's Claude Design handoff applied across the whole screen (restyled `FolderPicker`/`ExpenseForm` too, since the design covers the composition as a whole). Design source: `docs/superpowers/specs/design/ExpenseScreen.dc.html`. Payment method changed from free text to a fixed select; category presets expanded to 9.
- 2026-09-02: Fixed a real save-failing bug found via manual testing — Google names a new spreadsheet's first tab per account locale ("시트1" for Korean, not "Sheet1"), but the hardcoded `SHEET_RANGE = 'Sheet1!A:E'` assumed English. `findOrCreateSpreadsheet` force-renames the first tab (sheetId 0) to "Sheet1" on both the create AND found-existing paths (idempotent, self-heals). Fully-mocked tests couldn't have caught this — reminder that this class of bug only shows up in real API testing.
- 2026-09-02: Task 3b (Drive folder picker) added mid-build at user request, fully verified end to end. Revealed `app/page.tsx`'s server-component state limitation (see Architecture notes); also revealed that Drive/Sheets/Picker APIs need explicit enabling in Google Cloud Console — OAuth client creation alone doesn't do it.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
