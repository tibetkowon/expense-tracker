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

**Known environment gap:** Codex's sandbox has no network access, so it cannot run `npm install`, hit the AI Gateway, or reach any external API — only the supervising Claude Code session can. For any task step that needs network (installing deps, live API verification), Claude Code runs that step itself after Codex writes the code, then reports results back into the loop. Don't send Codex back to retry a network call — it will hit the same wall every time.

## Project memory

- After finishing a task (or a work session), run `claude-md-management:revise-claude-md` to fold in what changed — new decisions, new constraints discovered, anything that would surprise a future session.
- Keep a **Recent decisions** log below, newest first. Prune entries once they're fully superseded by the spec/plan docs rather than letting this section grow unbounded.
- Full research history (what was tried and rejected, and why) lives in the spec, not here — link to it rather than duplicating it.

## Constraints (do not relax without updating the spec)

- No database. Sheets is the store.
- OAuth scope stays at `drive.file` + `spreadsheets` — never request broader Drive access.
- OCR is auto-draft + human-confirm, never auto-save.
- Automated collection (CODEF, SMS, email parsing) is deferred, not cancelled — see spec §2/§7 before re-investigating.

## Recent decisions

- 2026-09-01: Task 1 (scaffolding) done. Discovered Codex's sandbox has no network access — `npm install`/build verification now run from the Claude Code session, not Codex. Documented above.
- 2026-09-01: Design spec and MVP implementation plan written and approved.
