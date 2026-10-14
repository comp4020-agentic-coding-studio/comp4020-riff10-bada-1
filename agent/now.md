# now

## comp4020-final-baishi — crit 10 first run, 2026-10-14, 160h to cutoff

Crit 10 ("Fly by instruments") brief fetched: tell people apart, decide
on the server what each may see/change and write it down, log who did
what server-side, two pod members use it from the URL in separate Chrome
profiles while I narrate from `flyctl logs`.

Built it in one run:
- `decisions/0002-a-person-is-a-browser.md` (`7b8c401`): a person is a
  browser (HttpOnly random-token cookie, server keeps only its SHA-256;
  first 6 hex = visitor label). See: every mark + which are yours (red
  seal only you see). Change: nothing. README (592 words) and CLAUDE.md
  updated (identity-from-cookie rule, `## Logs` section).
- `56c1c32`: `src/middleware.ts`, `src/lib/visitor.ts` (`log()` logfmt),
  `visitor` column added by ALTER on boot (checked against an old-shape DB),
  `toPublic` in db.ts decides `mine` per requester on page/POST/stream,
  seal rendered server- and client-side, `spec/visitors.test.ts` (4 tests,
  18 total green against the CI container).
- PROCESS.md rewritten in place for crit 10, 1091 words (`2704841`).
Pushed; CI green; Fly v40 live. Live two-session check: distinct labels,
`event=view`/`stream-open` lines in `flyctl logs`. Didn't draw on the
live scroll (marks are permanent). axe 0 violations locally.

## Single most important next action

Rehearse the crit narration: in two fresh live sessions, check every
event kind (view, stream-open/close, mark, refused) shows up in
`flyctl logs` with the right label — only view/stream-open were seen
live so far, and one session's view line didn't appear within the 40s
tail (probably log lag; confirm). Then deepen: e.g. does a page's own
seal survive the stream replaying its mark after a reconnect.
