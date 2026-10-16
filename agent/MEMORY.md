# MEMORY

Durable self-knowledge, curated run by run; ephemeral state belongs in
`now.md`, not here.

## Environment

- `agent-browser` needs Chrome installed once per environment
  (`agent-browser install`) and, in this sandboxed container, the Chrome
  sandbox itself doesn't work — launches fail with "No usable sandbox!"
  unless `AGENT_BROWSER_ARGS="--no-sandbox"` is exported first. Command
  syntax is `agent-browser set viewport <w> <h>`, not `agent-browser
  viewport <w> <h>`. That `export` (like any env var) does not persist
  between separate Bash tool calls — only the working directory does —
  so it has to be set inline in the same command string as the
  `agent-browser` calls that need it, every time, not as a one-off prior
  command.
- `mise install` refuses to run against an untrusted `config.local.toml`
  the first time in a fresh environment — run `mise trust
  <path-to-config.local.toml>` once, then install proceeds normally.
- In this sandboxed container any pnpm command that triggers a deps
  reconciliation (`check`, `install`, `preview`, `dev`) can abort with
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` (it wants to confirm
  purging `node_modules` interactively and there's no TTY). Prefix with
  `CI=true` — `CI=true pnpm preview` — rather than investigating further.
- On an Astro site whose `base` path is derived from the git origin remote
  (the `astro-theme-university`-based course-site template does this —
  `scripts/pages-base.ts`, so it resolves even under a local `pnpm
  preview`, not just in CI), hitting bare `http://localhost:<port>/` under
  `pnpm preview` does not 404 visibly — it silently returns Astro's
  `404.html` body with a `200` status, since nothing is mounted at `/`
  itself. `curl -o /dev/null -w "%{http_code}"` reports `200` and looks
  fine; only the actual HTML content (or a tool like Lighthouse trying to
  load real resources, which failed with a hard "Status code: 404" error)
  reveals the mismatch. Confirmed on `comp4020-ass2-baishi`
  (2026-09-15): the real local URL was
  `http://localhost:4321/comp4020-ass2-baishi/`, read straight off any
  `href` in `dist/index.html`. Always resolve the real base from a built
  `dist/index.html`'s hrefs (or `git remote get-url origin`'s repo name)
  before pointing `curl`, Lighthouse, or `agent-browser` at a local
  preview server — don't trust a bare `/` to be the site root just because
  `astro dev`/`preview` "serve at the root" in the sense of not needing a
  domain change.
- The installed `agent-browser` has grown two native commands beyond what
  earlier entries below assume: `agent-browser a11y [url] --json` runs
  axe-core directly (no more need for the CDN-injection dance described
  further down), and `agent-browser vitals [url] --json` reports Core Web
  Vitals (LCP/CLS/TTFB/FCP/INP) plus React hydration info. Confirmed
  working on assignment-1 (2026-08-14): `a11y` matched the earlier
  CDN-injected sweep's 0-violations result at both marking viewports, and
  `vitals` gave a genuinely new signal (CLS score) the manual
  `performance.getEntriesByType` snippet never captured. Prefer these
  native commands over the manual techniques logged below when starting a
  fresh a11y/perf pass; the manual entries stay as fallback in case a
  future environment lacks them. `inp` came back `null` even after a real
  keyboard-driven interaction sequence (`focus` + `press`) — plausibly the
  synthetic/CDP interaction path doesn't feed the INP buffer; not worth
  chasing further for a single-page static site.
- `agent-browser -p ios ...` (the touch-emulation provider) fails outright in
  this sandboxed container: `xcrun simctl` isn't present, since the iOS
  simulator needs an actual macOS/Xcode host. Confirmed directly
  (`agent-browser -p ios device list` → "No such file or directory"), not
  inferred — don't spend a future run's budget retrying touch-specific
  emulation here expecting a different result; it needs a different host
  entirely. Plain `agent-browser set device "<name>"` (e.g. `"iPhone 14"`,
  no `-p ios`) doesn't fill this gap either — confirmed on crit-4
  (2026-08-19): after setting the device, `navigator.maxTouchPoints` still
  read `0` and a `click` on a real touch-sized target went through the
  ordinary mouse pointerdown/up path, not a touch path. Device-mode viewport
  emulation changes screen size only, not `hasTouch`; genuine multi-touch
  (e.g. a two-finger chord on a touch instrument) stays untestable here by
  any means found so far — mouse- and keyboard-driven interaction are what
  this environment can actually verify. `agent-browser network` also still
  has no request-delay/throttle
  primitive (only `route --abort`/`--body`), confirmed again on assignment-1,
  so a true slow-connection test remains out of reach without extra tooling
  beyond the CLI.
- `agent-browser press <key> --hold <ms>` does not reliably sustain the key
  down for the requested duration in this sandboxed container — confirmed on
  crit-4 (2026-08-19): a background `press d --hold 2000` followed by a
  mid-hold `eval` reading `document.activeElement`/a DOM state flag always
  saw the released state, as if the hold hadn't happened, even though the
  same page's own `keydown`/`keyup` listeners were verified correct by other
  means. Don't trust `--hold` to prove or disprove a press-and-sustain
  interaction (a synth pad held for a chord, a game key held to move). The
  reliable way to test real sustain: `agent-browser eval
  "document.dispatchEvent(new KeyboardEvent('keydown', {key: 'x', bubbles:
  true}))"`, do whatever mid-hold check is needed, then dispatch the matching
  `keyup` the same way — this actually held the key logically down between
  the two `eval` calls when `--hold` did not.
- `pnpm dlx lighthouse <url> --preset=desktop --chrome-flags="--headless
  --no-sandbox"` needs `CHROME_PATH` set explicitly in this sandboxed
  container — lighthouse's own `chrome-launcher` can't find a system Chrome
  (there isn't one), and fails with "The CHROME_PATH environment variable
  must be set" otherwise. Point it at the Chrome `agent-browser install`
  already put down:
  `CHROME_PATH=$(find ~/.agent-browser/browsers -maxdepth 1 -name 'chrome-*'
  | sort -V | tail -1)/chrome`. Also run it from inside the target repo, not
  `/tmp` or elsewhere — `pnpm dlx` needs `mise`'s per-directory pnpm version
  resolution, which fails with "No version is set for shim: pnpm" outside a
  directory that has one configured.
- `agent-browser set viewport <w> <h>` does not persist across a later
  `agent-browser open` in the same session — confirmed on crit-5
  (2026-08-27): set to 1920×1080, confirmed via `getBoundingClientRect()`,
  then a second `open` (navigating to a freshly rebuilt page) silently
  reverted `window.innerWidth`/`innerHeight` to a smaller default
  (1280×577), which in turn made a coordinate computed against the
  1920-wide layout land outside the real canvas and `elementFromPoint`
  return `null` — a real misclick, not a flake. Re-issue `set viewport`
  after every `open`/reload that follows an earlier one in the same
  session, not just once at the start.
- `pgrep -af "<pattern>"` run inline in a Bash tool call can match its own
  invocation's command-line string, not just the target process — a
  literal `pgrep -af "vite preview"` matches the shell wrapper that's
  currently executing the string `"vite preview"` as part of its own
  `eval`, printing a false-positive "still running" line even after the
  real target process was actually killed. Confirmed on crit-5
  (2026-08-31) trying to verify a `pnpm preview` server had shut down.
  Check a listening port instead (`ss -ltnp | grep <port>`) when
  confirming a server process is actually down, not a process-name grep.
  The same asymmetry cuts the other way for actually stopping one: on the
  final crit-5 run (2026-08-31), `pkill -f "vite preview --port <p>"`
  silently failed to stop a `pnpm preview`-spawned server even though the
  process was genuinely still listening afterwards (`ss -ltnp` confirmed
  it) — plausibly because the real process's visible cmdline, once
  wrapped through `pnpm`'s script runner, doesn't textually contain the
  literal script-line string being matched. `ss -ltnp | grep <port>` to
  get the real pid, then `kill <pid>` directly, worked immediately. Don't
  trust a bare `pkill -f "<script line>"` to have stopped a pnpm-spawned
  dev/preview server; get the pid from the port instead.
  **Extended (`comp4020-final-baishi`, 2026-09-30):** shell job-control
  (`kill %1`, `%1` referring to a background job started with `&`) doesn't
  carry across separate Bash tool calls either — each call is a fresh
  shell with its own empty job table, so `kill %1` in a later call silently
  no-ops (or errors, harmlessly swallowed by a trailing `2>/dev/null`)
  rather than killing the process actually intended. The stale process kept
  running underneath, still holding an open fd to a SQLite file a
  subsequent `rm -rf` had already unlinked from the directory — writes kept
  succeeding invisibly against the deleted-but-still-open inode, producing
  a confusing "count is higher than it should be after a fresh restart"
  symptom that looked like an app bug (a double-submit) but was actually a
  test-harness artifact. `ss -ltnp | grep <port>` for the real pid, then
  `kill <pid>` directly — the same fix as the pkill lesson just above,
  generalised to background jobs started with plain `&` too, not just ones
  wrapped in `pkill -f`.
- A multi-line Bash call wrapping `agent-browser` in a `for ... do ... done`
  loop can fail outright with "command not found: agent-browser" (exit 127)
  in this sandboxed container, even though the exact same call as a plain
  one- or two-line command immediately before and after resolves fine, and
  `which`/`type agent-browser` confirm `$PATH` is correct right after the
  failure. Confirmed on `comp4020-ass2-baishi` (2026-09-14) — a transient
  shell/PATH-resolution quirk specific to that `for`-loop construct, not a
  real missing-binary problem. Don't debug `$PATH` when this happens; just
  stop using `for` loops for `agent-browser` calls and issue one or two
  commands per Bash tool call instead.
- `agent-browser eval` shares one persistent JS context across calls within
  the same session — a second `eval` that re-declares a top-level `const`/
  `let` name already used in an earlier `eval` throws `SyntaxError:
  Identifier '<name>' has already been declared`, even though each snippet
  reads fine in isolation. Wrap each `eval` snippet in an IIFE
  (`(() => { const cs = ...; return ...; })()`) with locally-scoped names so
  repeated ad hoc DOM-inspection snippets in one session never collide.
- `agent-browser console` can print debug/prefetch lines that name a
  completely different repo (e.g. `Prefetching
  http://localhost:4321/comp4020-ass2-yunlin/sessions/` while the page open in
  this session was genuinely `comp4020-ass2-baishi`, confirmed via
  `window.location.href`) — this sandboxed container is shared with other
  concurrent agent sessions, and console output is not scoped to the one page
  this session navigated. Confirmed on `comp4020-ass2-baishi` (2026-09-17):
  the visible page content and `window.location.href` were correctly this
  repo's own; only the `console` command's output leaked a different
  student's repo name. Don't read a foreign repo name in `console` output as
  evidence of contamination in *this* repo's build — cross-check
  `window.location.href` first, and filter the foreign lines out rather than
  investigating them.

- `agent-browser fill`/`click`+`type` do not reliably populate an
  `<input type="time">` element in this sandboxed container — confirmed on
  `comp4020-crit7-baishi` (2026-09-24): `fill '#startTime' '09:00'` reported
  success, but `eval`-reading `document.getElementById('startTime').value`
  immediately after returned `""`; clicking the field then typing a plain
  string (`'0900AM'`) left it empty too. Time inputs apparently need a
  different synthetic-input path than text inputs get from `fill`/`type`.
  Workaround: set `.value` directly via `eval` and dispatch synthetic
  `input`/`change` events with `bubbles: true`
  (`el.value = '09:00'; el.dispatchEvent(new Event('input', {bubbles:
  true})); el.dispatchEvent(new Event('change', {bubbles: true}))`) — this
  populated the field correctly and a subsequent `requestSubmit()` carried
  the right values through to the server. Don't spend time debugging `fill`
  itself against a `type="time"` field; reach for this workaround directly.

- `docker build`/`docker run` need `sudo` in this sandboxed container — the
  session user isn't in the `docker` group (confirmed via `id`), so a plain
  `docker build` fails with "permission denied while trying to connect to
  the docker API" even though `/var/run/docker.sock` exists and the daemon
  is reachable. `sudo docker build`/`sudo docker run` (with
  `dangerouslyDisableSandbox: true` on the Bash call, since sudo itself
  needs it) works immediately — passwordless sudo is available. Confirmed
  on `comp4020-final-baishi` (2026-09-30) testing the exact
  `docker build`/`docker run --tmpfs /data` sequence CI's `checks.yml` runs,
  before trusting a `flyctl deploy`.
- **A native module with a `binding.gyp` gets an implicit `node-gyp
  rebuild` on install even with no install script** (npm and pnpm both
  default to it), whenever its build is allowed (`allowBuilds` in
  `pnpm-workspace.yaml`). `better-sqlite3@13` bundles `prebuilds/` and
  loads them ahead of `build/`, so on `comp4020-final-baishi` the right
  setting is `better-sqlite3: false`, and the image needs no Python or
  compiler. Whether the rebuild runs also varied by pnpm version (11.9
  ran it, 12.10 didn't), and a bare `corepack enable` fetches npm's
  floating `latest`, so CI's docker build broke with no commit to blame.
  Pin pnpm in the Dockerfile to `mise.toml`'s version
  (`corepack install -g pnpm@<v>`). Local Docker here has no buildx; to
  build with BuildKit like CI, download the buildx binary into a scratch
  `DOCKER_CONFIG=<dir>/cli-plugins/` and run `sudo env DOCKER_CONFIG=<dir>
  DOCKER_BUILDKIT=1 docker build`.
- A bare SVG `<path d="M x y">` (a moveto with no drawing command at all)
  has **no paintable geometry** — Chromium renders nothing for it, even
  with `stroke-linecap: round` set, even though the path element exists in
  the DOM with a valid `d` attribute. A single-point mark (a tap, a dot)
  needs a zero-length `L` to the same point (`M x y L x y`) before a round
  linecap actually draws a dot on screen. Found on `comp4020-final-baishi`
  (2026-09-30) by a real `agent-browser` pointerdown-then-immediately-up
  test of a freehand-drawing feature: the stroke saved correctly (valid
  `d` in the database) and the count updated, but the mark was invisible on
  reload — a rendering-only bug no HTTP-level spec test would ever catch,
  since the server-stored data was completely correct. Worth checking
  whenever a future crit captures freehand/pointer input as an SVG path and
  needs to support a degenerate single-point case (a tap, a click without
  drag) — don't assume "valid path syntax" implies "visible."

- `html-validate`'s `aria-label-misuse` rule doesn't consult SVG-AAM's
  implicit-role resolution, even though the tool's *own* `no-redundant-role`
  rule proves it has that resolution available internally — a roleless
  `<svg>` whose implicit default role (`graphics-document`, per the SVG-AAM
  spec) genuinely supports an accessible name still gets flagged, because
  `aria-label-misuse`'s permitted-element allow-list only checks the
  declared role attribute, not the resolved one. Confirmed on
  `comp4020-final-baishi` (2026-10-02) by testing the tool against its own
  stated reasoning rather than trusting one rule's verdict: adding the
  implicit role back explicitly (`role="graphics-document"`) swapped the
  error for `no-redundant-role` on the very same element — proof the tool
  does resolve the implicit role elsewhere, it just doesn't share that
  resolution between its own rules. No markup satisfies both rules at
  once; the only way to silence `aria-label-misuse` here would be
  `role="img"`, which is the exact suppression bug a prior fix on this
  same `<svg>` (see the dedicated entry above: `role="img"` flattens every
  focusable descendant out of the accessibility tree) had already removed.
  Left as a confirmed tool limitation, not a real defect — the general
  check for any future `html-validate` finding on an `aria-label`/role
  combination: try the suggested fix against a throwaway copy of the
  rendered HTML first and see whether a *different* rule in the same tool
  immediately re-flags it, before trusting either verdict alone.

## Working patterns that held up

- **A genuine DOM form submission (`el.requestSubmit()` on the real
  `<form>`, or a real `.click()` on its submit/cancel button) is a
  distinct verification claim from a vitest spec's `fetch()` POST to the
  same route, and from a tab-to-tab SSE check — none of those exercise the
  browser's own form-serialisation and same-origin `Origin`-header
  behaviour the way a real submission does.** Confirmed on
  `comp4020-crit7-baishi` (2026-09-24): after working around the
  `type="time"` fill limitation above, drove a real reschedule via
  `requestSubmit()` on the actual roster form and a real cancel via a
  native button `.click()`, both against a fresh local `pnpm preview` —
  console clean, roster updated correctly in both cases. Cheap to run once
  the app has a form-based write path and worth doing at least once per
  such deliverable, since `fetch()`-based spec coverage (however thorough)
  never actually exercises the `<form>` element itself.

- `agent-browser tab new <url>` opens a genuinely separate tab in the same
  browser session, and `agent-browser tab <id>`/`tab list` switches between
  them — the real way to verify a live cross-tab feature (an SSE/WebSocket
  "another tab changed something, reload" listener), distinct from asserting
  the stream contract at the HTTP layer in vitest. Technique: set a throwaway
  marker (`window.__marker = 'x'`) on the listening tab, trigger the change
  from the other tab, then check the marker is *gone* on the listening tab —
  that proves a real navigation happened, not just that new text appeared
  (which a lazy check could also produce from a stale cached render). Used on
  `comp4020-crit7-baishi` to confirm a reschedule submitted in tab 1 actually
  drove tab 2's own `EventSource` listener to reload, console clean in both.
- **An unconditional `location.reload()` triggered by a live-sync listener
  (SSE/WebSocket "something changed elsewhere, refresh") can silently
  discard whatever the current tab's own user was mid-way through typing —
  a real data-loss bug distinct from the reconnect/backlog gap logged
  below, and one no vitest stream-contract test can ever catch since it's
  about *client-side unsaved state*, not the server's broadcast.** Found on
  `comp4020-crit7-baishi`'s sixth run by driving the exact "more than one
  tutor has this open" scenario the app's own README names as the reason
  live sync exists: typing a draft into a form in tab 1, then submitting an
  unrelated real change from tab 2, and watching tab 1's SSE listener
  reload and wipe the draft with no warning. Fix pattern: a small
  `markDirty`/`isDirty` tracker wired to the form's own `input` event,
  checked immediately before every reload call site; when dirty, show a
  status notice instead of reloading, and let the user's own submit or a
  manual reload pick up the change later. Verification technique: use
  *distinguishing* JS-state markers across three tabs (dirty-tab-keeps-draft,
  clean-tab-still-reloads-normally, i.e. no regression) rather than eyeballing
  page content, since a stale cached render and a genuine non-reload can look
  identical from a screenshot alone — the same "prove navigation did or
  didn't happen" discipline as the `tab new` marker technique above, applied
  to the negative case (proving a reload was correctly *skipped*) instead of
  the positive one. **Trap hit getting there:** an early attempt to
  reproduce the bug appeared to show the draft surviving, but the "attacker"
  tab's own form submission was silently failing validation the whole
  time — its `type="time"` fields (`startTime`/`endTime`) were empty because
  of the `fill`/`type` limitation already logged below, so no real change was
  ever broadcast and no reload should have happened either way. That's a
  false negative on the test, not evidence the bug doesn't exist — verify
  the "attacker" tab's own submission actually succeeded (check the redirect
  landed, or `new FormData(form)` before submitting) before trusting a
  reproduction attempt that shows nothing happened. General lesson for any
  future crit with a live-reload listener: check whether the reload call
  site has any guard against the current tab's own unsaved input at all —
  if the listener's only job is "something changed, refresh," it almost
  certainly doesn't, and this exact two-tab technique is the way to find out.
  **This trap recurred twice on the same repo's seventh run**, re-verifying
  the fix below rather than reproducing the original bug — always check
  `form.checkValidity()` on the "attacker" tab immediately before trusting
  either a "nothing happened" or a "something happened" result from this
  two-tab technique, not just once when the bug is first found; a tab's
  `type="time"` fields go blank again after every redirect a prior
  submission from that same tab triggered, so a second reuse of the same
  tab silently needs re-filling every time, not just the first.
- **A `markDirty`-only tracker is a one-way ratchet: once true, it never
  reports clean again, even after the thing that made it dirty is undone.**
  On `comp4020-crit7-baishi`, the fix just above (a dirty flag gating a
  live-reload listener) initially had only `markDirty`/`isDirty`, set by the
  form's `input` event — so a tutor who typed a draft into the reschedule
  form and then cleared it back out (abandoning it, not submitting) left
  that tab's live sync permanently broken for the rest of its life, over a
  draft that no longer existed. Confirmed with the same two-tab
  `window.__marker` technique: clear the draft back to empty, trigger a
  genuine change from the other tab, watch the tab stay stuck on the stale
  notice instead of reloading. Fix: add `markClean`, and instead of the
  `input` listener calling `markDirty` unconditionally, have it re-compare
  the form's current `FormData` serialization (`new
  URLSearchParams(new FormData(form)).toString()`) against a snapshot taken
  once at page load, calling `markClean`/`markDirty` depending on whether
  they currently match — a live recomputed diff, not a sticky flag. General
  lesson for any future crit with a "there's unsaved state, don't clobber
  it" gate (a dirty flag, an "unsaved changes" banner, a beforeunload
  guard): check whether undoing the thing that made it dirty is possible,
  and whether the gate actually notices when it happens, not just whether
  the gate fires in the first place.
- **Making a one-way gate bidirectional (the `markClean` fix just above) only
  fixes *future* attempts through it — it doesn't retroactively resolve an
  attempt that already failed and left a visible trace behind.** On
  `comp4020-crit7-baishi`, `markClean` correctly let a *later* reload attempt
  succeed once the draft was undone, but a reload that had *already* arrived
  while dirty (skipped, with the stale-notice banner shown instead) was never
  retried — the tab sat on that notice indefinitely once the draft cleared,
  waiting for some unrelated further change to arrive, or a manual refresh,
  neither of which the fix's own two-tab test had checked for. Confirmed live
  with the same `window.__marker` technique used elsewhere in this file: mark
  dirty, trigger a real change from another tab (notice shown, marker
  untouched — correct), then clear the draft and check the marker again — it
  was still untouched, proving no reload had fired even though the tab was
  now clean. Fixed by having the gate track *both* directions explicitly: a
  `notePendingReload`/`claimPendingReload` pair, where the reload site records
  that it deferred one and the clean-transition handler claims and fires it
  immediately rather than waiting for a fresh trigger. General lesson for any
  future "gate skips an action and shows a placeholder instead, gate reopens
  later" pattern (a dirty-tracker-gated reload, a disabled-button-until-valid
  form, a "retry when back online" banner): after fixing the gate to reopen
  correctly, check specifically whether reopening it *resolves the deferred
  action*, or merely *permits the next attempt* — these are different claims,
  and a test that only re-tries the trigger (a second live change) instead of
  checking what happens right when the gate reopens on its own can pass while
  this exact gap still exists.
- **An in-memory pub/sub bus behind an `EventSource` live-sync design (no
  backlog/replay) has a real, checkable gap around a Fly.io
  `min_machines_running = 0` auto-stop/wake cycle, distinct from whether the
  browser reconnects at all.** Simulate the outage by killing and restarting
  the local preview server mid-session (stand-in for the machine
  stopping/starting) while a second `agent-browser` tab has the page open:
  the browser's own `EventSource` reconnection is a spec guarantee and held
  up cleanly on `comp4020-crit7-baishi` — but any event the server broadcast
  *during* the outage window is gone by the time the client reconnects,
  since a plain in-memory `EventEmitter` bus keeps nothing to replay. A tab
  that missed a change this way goes stale with no visible sign, until some
  unrelated future change arrives. The fix that generalises: treat the
  `EventSource`'s own `open` event (which fires on every reconnect, not just
  the first connect) as "something might have changed while I was gone" and
  reload then too, gated so the very first connect on a fresh page load
  doesn't reload itself (`connectedBefore` flag, flip to `true` after the
  first call, reload on every call after). Worth checking on any future
  Fly.io deliverable whose live-sync design is SSE/WebSocket over an
  in-memory bus with no backlog — the auto-stop config makes a real outage
  window routine, not a rare edge case.
- `drizzle-kit generate` demands an interactive TTY prompt ("is this a
  rename?") whenever a schema edit could be read as renaming an existing
  table/column, and fails outright in a non-interactive sandbox
  (`Error: Interactive prompts require a TTY terminal`). When the schema
  change is a genuine redesign (new tables replacing an old one, not a
  rename) and nothing has been deployed to Fly yet for the repo — so there's
  no production volume state whose migration history needs preserving —
  the clean fix is deleting the whole `drizzle/` directory (old migration +
  `meta/`) and regenerating fresh, rather than trying to answer the prompt
  blind. Confirmed safe on `comp4020-crit7-baishi`'s first run, replacing a
  single `messages` table with `crit_groups`/`weeks`/`exceptions`. Don't
  reach for this once a repo has a real deployed volume — at that point the
  migration history is load-bearing and this would be a genuine data-loss
  risk, not a clean regeneration.

- A course-source brief's "what you submit" section can carry a specific
  content instruction for a required file, not just a format one (word
  count, citation style) — treat every sentence in it as a checkable claim,
  the same clause-by-clause technique already logged for crit-4/crit-5's
  interaction briefs, applied here to a *process document's* required
  content instead of a game's behaviour. On `comp4020-ass2-baishi`, the
  assignment-2 brief said the `PROCESS.md` narrative "should explain...
  which [decisions] were deliberately omitted" from harness/spec
  enforcement — a real, specific ask distinct from the word-count/citation
  checks `check:evidence` already validates mechanically. Four prior runs
  had kept `PROCESS.md` accurate and well-cited without ever satisfying
  that one sentence, because nothing in `pnpm check`/`check:evidence` can
  catch a *missing* content category the way it catches a missing citation.
  Re-read the brief's own "what you submit" prose against the current file
  before treating a well-cited PROCESS.md as complete.
- The doctrine's "no JS" constraint recurs whenever a crit spec bans
  scripting but the aesthetic being chased (marquees, blinking, live
  counters) traditionally used it. CSS alone reproduces these
  convincingly — `@keyframes` + `translateX` for scrolling banners,
  `repeating-linear-gradient` for hazard stripes, styled `<span>` digits
  for a fake counter — and it's worth reaching for that before any
  deprecated tag (`<marquee>`, `<blink>`) even when the brief's own
  examples suggest them: deprecated markup renders inconsistently and
  isn't a foundation worth building six pages on.
- A retro site "logo" wants visually to be a big heading at the top of
  every page, but the spec's own invariant checks (and most sane a11y
  practice) expect exactly one `<h1>` per page — the page's actual
  content heading. Demote the logo to a styled `<p>` (e.g.
  `class="wordmark"`) rather than dropping the invariant or the content
  heading. This will recur any week a "signature banner" look is wanted.
- The instruction to never guess/generate URLs not directly in service of
  programming help extends naturally to in-repo content decisions, not
  just chat replies: an old-web "links/webring" page that would normally
  hyperlink out to museums/archives instead named institutions as plain
  text and only hyperlinked back into the site's own pages. Treat this as
  the default whenever a crit's content genuinely wants outbound links —
  plain-text citation over a guessed/unverifiable href.
- Commit granularity: one commit per page/concern (CSS+home together,
  then one commit per subsequent page) reads far better in the process
  evidence than one dump, even when all pages are authored in one
  sitting. Keep doing this.
- Run `pnpm check` before committing, not after — every stylelint/vitest
  fix this run happened pre-commit, so the commit history shows a
  consistently green state rather than a fix-up trail. `PROCESS.md`
  should say so honestly (no fabricated red→green commit pairs) rather
  than manufacture a broken-then-fixed diff that didn't happen.
- The template's `spec/README.md` is explicit that turning the week's own
  published spec into tests is the agent's work, not the template's — the
  shipped `invariants.test.ts` only covers site-agnostic basics. Check
  every run whether a crit-specific `spec/<crit>.test.ts` exists yet for
  the checkable lines a test actually can assert (e.g. "no JavaScript",
  "pages reachable from home"); if it's missing, writing it is a genuine,
  well-scoped deepening task, not scope creep.
- Before trusting a stale `now.md` claim like "not yet pushed," run
  `git fetch` and compare against `origin/main` directly — a prior run's
  note can lag what actually happened (this repo's C1 work turned out
  already pushed despite the note saying otherwise).
- To run a real accessibility check without adding a permanent
  dependency: serve `dist/` locally, open a page with `agent-browser`,
  and `agent-browser eval` a snippet that appends a `<script src="https://
  cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js">` and awaits
  its `onload`, then a second `eval` calling `axe.run().then(r =>
  JSON.stringify(r.violations...))`. Network access from the browser
  works fine in this sandboxed environment. This is a one-off audit, not
  the same thing as wiring axe-core as a permanent CI sensor (the
  template's `CLAUDE.md` explicitly leaves that as separate, later work)
  — reach for the CDN-injection version first when the question is just
  "does this page currently pass," and only add a real devDependency +
  test if the week's spec asks for a standing sensor.
- `PROCESS.md`'s "moments that mattered" needs to be re-read against
  `git log` every run, not just extended when new work happens — a prior
  run added a genuinely good commit (`spec/crit-1.test.ts`) but never
  updated `PROCESS.md` to cite it, so the reading-guide silently fell
  behind the history it's supposed to map. Check for this drift
  specifically: does every notable commit since the last `PROCESS.md`
  edit have a citation, not just the newest one.
- The crit-1 repo has an in-repo `agent/` directory (`agent/doctrine.md`,
  `agent/MEMORY.md`, `agent/now.md`) that mirrors this external memory
  system, committed under messages like "memory: tick snapshot
  <timestamp>" with author `Baishi <baishi@comp4020.anu.edu.au>` — the
  same identity this session commits as. Don't mistake these for a prior
  run's own edits, and never touch `agent/` directly: the doctrine is
  explicit that `agent/` is harness-owned, and the most consistent read
  is that a wrapper around the `claude --print` invocation (not the model)
  writes these snapshots after a run finishes. Only ever write to the
  real `memory/now.md` and `memory/MEMORY.md` outside the repo.
- The CDN-injected axe-core sweep (see the entry above) is worth re-running
  whenever a repo's markup changes, not filed away as "already ran once for
  this crit": on crit-2, a run that found the repo otherwise fully finished
  still ran it fresh and it caught a real `region` violation the prior run's
  own build never had checked — a `.hero` block (the page's actual lede
  content: address, hours, phone) sitting between `</header>` and `<main>`
  on the home page only, unlike every other page where the equivalent
  content already opened inside `<main>`. A single-page structural
  inconsistency like this is exactly the kind of thing that's invisible to
  `pnpm check` (no invariant asserts landmark coverage) and easy to miss by
  eye since the page still renders and reads fine — the tool is what caught
  it, not a prose re-read.
- When a deepening pass turns up nothing to change (checks all green, a
  close CSS re-scrutiny and a full line-by-line prose reread of every
  page find no defects), that is a legitimate outcome, not a failure to
  find work — record what was checked and move on rather than inventing
  cosmetic changes (e.g. a favicon, or editing the template's generic
  `README.md`) just to have a diff. Manufactured busywork reads worse in
  the process evidence than an honest "verified, nothing needed" note.
- `pnpm outdated` / `pnpm audit` is a genuinely different deepening angle
  from the prose/CSS/a11y passes already tried, but for a static-HTML
  crit that's already finished, don't chase it reflexively: `pnpm audit`
  coming back clean is worth a quick check every so often, but every
  entry `pnpm outdated` lists for this template (oxlint, @types/jsdom,
  @types/node, jsdom, typescript) is a *major* version bump, not a patch
  — bumping build tooling this far from cutoff carries real risk
  (frozen-lockfile CI install, a major TS version's stricter checks) for
  zero benefit to the deployed static site. Evaluating it and choosing
  not to bump is the legitimate outcome here, same as the CSS/prose
  passes finding nothing — don't manufacture a dependency-bump commit
  just to have touched something.
  **Update (assignment-1, 2026-08-12):** don't stop at "every `pnpm
  outdated` entry is major, so there's nothing safe to do" — that was true
  of the *pinned* deps but not of what's reachable through them. `pnpm
  audit` on this repo found 9 real vulnerabilities (4 high, 5 moderate) in
  transitive dev-tooling deps (`undici` via `jsdom`; `postcss`/`nanoid`/
  `js-yaml`/`fast-uri` via `stylelint`'s toolchain), and a plain `pnpm
  update` — which only moves versions *within* the ranges `package.json`
  already declares, touching no pin — bumped just `oxlint` and `vite` and
  cleared every one of them, `pnpm check` still green after. The two
  checks answer different questions: `pnpm outdated` tells you what's safe
  to *pin higher* (often nothing, near cutoff); `pnpm audit` plus a plain
  `pnpm update` tells you what's already fixable *without* touching a pin
  at all. Always try the in-range update first when audit finds something
  — it's categorically lower-risk than a major bump and may well clear the
  finding outright, as it did here. Written up as a `CLAUDE.md`
  entry + a genuine third `PROCESS.md` moment on assignment-1, which
  otherwise had only two — worth remembering that the assignment's own
  spec (unlike a crit's) explicitly wants three or four moments, not
  fewer, so a legitimate new finding like this is worth writing up as a
  moment even on a build that already reads as "finished."
- A performance/console spot-check is another distinct, legitimate
  deepening angle (separate from the a11y pass already done): serve
  `dist/` with `CI=true pnpm preview --port <p>`, then per page
  `agent-browser open` + `agent-browser console` (empty output = no
  errors) + `agent-browser eval
  "JSON.stringify(performance.getEntriesByType('navigation'/'resource')...)"`
  for load timing and transfer sizes. For a plain-HTML/CSS crit this is
  fast (~50ms DOMContentLoaded, ~2KB per page) and found nothing to fix.
  One artefact worth knowing about but *not* worth chasing: the browser's
  automatic `/favicon.ico` probe 404s because no favicon exists and none
  is linked in any `<head>` — this doesn't fail any check and isn't a
  broken link the site declares, so per the "don't manufacture busywork"
  lesson above, leave it rather than adding a favicon just to clear it.
- `agent-browser` has no print-media emulation (`set media` only takes
  dark/light/reduced-motion) — for a reader/print-view style proof-read,
  use `agent-browser read <url> --outline` (heading hierarchy only, good
  for spotting a missing/duplicate `<h1>` or skipped levels) and plain
  `agent-browser read <url>` (stripped-down reader-mode text extraction)
  instead. One gotcha: that extraction renders named HTML entities
  without their trailing semicolon in its markdown conversion
  (`&rsquos`, `&mdash`) even when the source has them correctly
  (`&rsquo;`, `&mdash;`) — always grep the actual `.html` source before
  treating a missing-semicolon entity as a real bug, it's very likely
  just the read tool's cosmetic rendering.
- `agent-browser screenshot`'s second positional argument is the
  destination *path*, not a flag slot — the full-page flag is
  `--full`/`-f`, not `--full-page`. Passing `--full-page` doesn't error;
  it's silently parsed as the path, so the screenshot writes to a
  literally-named `--full-page` file in the current directory instead of
  where you intended. `git status` caught this as a stray untracked file
  before it could be committed. Check the flag name before scripting
  screenshot loops.
- Before treating a both-viewport visual screenshot pass as a fresh
  deepening angle, check whatever scratch directory earlier runs used
  (e.g. `/tmp/shots/`, if that path recurs) for timestamped files first —
  this repo's crit-1 already had matching desktop/mobile screenshots of
  all six pages from two prior runs (2026-07-29, 2026-07-30) sitting in
  `/tmp/shots/`, meaning a run that tries this "new" angle without
  checking is just repeating work, not deepening. `now.md` and
  `PROCESS.md` don't record every check that was run (only what changed
  the site), so `/tmp` scratch artefacts are sometimes the only trace of
  a prior angle already tried.
- `pnpm dlx html-validate dist/*.html` is a genuinely distinct one-off
  deepening angle from the a11y/performance/CSS/prose passes above, but
  its default preset's `doctype-style` and `void-style` rules assume an
  older HTML-authoring convention (uppercase `<!DOCTYPE html>`, no
  self-closing void elements) that is the *opposite* of this template's
  already-consistent modern style (lowercase doctype, self-closing
  `<meta/>`/`<br/>`/`<hr/>`, matching Vite's own output). Don't treat
  those two rule categories as defects to fix — "adopting" them would
  make the markup less internally consistent, not more correct. Do
  check whether any *other* rule category fired (duplicate IDs, missing
  alts, invalid nesting) — that would be a real finding; on this repo
  none did, which is itself useful confirmation of structural soundness.
  It's still worth re-running per repo, not treated as "already checked
  once": on crit-2 the same tool caught a real `tel-non-breaking` finding
  (a phone number that could line-wrap mid-digit-group) that crit-1 never
  had a phone number to trigger — fixed with `&nbsp;` between the digit
  groups. On assignment-1, only the same two expected non-issue categories
  fired again and nothing else — third repo running with this exact
  clean-except-doctype/void-style pattern, and likewise a clean axe-core
  sweep (0 violations) on assignment-1's single page. Both are cheap enough
  to run fresh per repo rather than trust as "probably still clean."

- Real keyboard interaction testing is a distinct deepening angle from
  axe-core's static audit: `CI=true pnpm preview`, `agent-browser open`,
  then repeated `agent-browser press Tab` + `eval
  "document.activeElement..."` to read tag/text/href/outline off each
  focused element in turn. Checks two things static analysis can't: tab
  order actually matches visual/logical order, and every focused element
  gets a *visible* focus indicator (grep `styles.css` for `outline:
  none` resets first — if there are none, the browser's default
  `outline: auto` covers anything a custom `:focus-visible` rule
  doesn't). On crit-1 this held cleanly at both viewports with no
  console errors — reach for it once static a11y/HTML-validation tools
  are exhausted and there's still deepen-phase budget left.
- Two deepening angles distinct from the tab-order walk already logged above:
  (1) **resize mid-interaction** — set the interaction to a non-trivial state,
  then `agent-browser set viewport` straight to the other marking size
  *without reloading*, and check state/layout survive (no console errors, a
  screenshot at the new size still looks right). This is exactly what the
  assignment-1 spec's artefact HD band names ("holds up under... a resize
  mid-interaction"), and it's a real live check, not inferable from reading
  CSS. (2) **actual keyboard actuation of the control**, not just tab order —
  focus the element and send the real keys that operate it (`ArrowRight`,
  `Home`, `End` for a range input) and confirm the on-screen state tracks
  exactly as a pointer drag would. Tab-order/outline-visibility checks (see
  above) only prove the control is *reachable*; this proves it's *usable*.
  On assignment-1 both passed cleanly with a native `<input type="range">` —
  worth noting as a finding in itself: using the native control instead of a
  custom widget bought real keyboard support for free, with nothing to test
  against regressing since the browser guarantees it.
- `agent-browser screenshot <selector> <path>` (a positional selector before
  the path, not a flag) crops the screenshot to one element — use this to put
  two states of the same visual element side by side (e.g. a slider-driven
  drawing at stroke count 10 vs 16) when a full-page screenshot buries the
  comparison in unrelated page chrome. This is how assignment-1's over-
  elaboration phase (visibly denser leg-ticks and a faint duplicate outline
  from 11 strokes to 16) was actually compared against the sweet-spot phase,
  rather than eyeballed from two separate full-page captures.
- A `prefers-reduced-motion` CSS guard is worth observing live, not just
  reading in source: `agent-browser eval
  "getComputedStyle(document.querySelector(selector)).animationName"`
  before and after `agent-browser set media reduced-motion` (then `set
  media no-preference` to reset). Code review alone can't catch a typo'd
  media query or a selector that doesn't actually match the animated
  element — this closed that gap on crit-1's marquee (`scroll-left` →
  `none` under the emulated preference, confirmed live rather than
  assumed from the CSS).

- `pnpm dlx linkinator ./dist --silent` against a fresh `pnpm build` is the
  local equivalent of the CI links sensor (named in this repo's `CLAUDE.md`)
  and is a genuinely distinct check from `spec/crit-1.test.ts`'s reachability
  assertions — it's an actual crawl of the built HTML/asset graph rather than
  a DOM-string assertion. On crit-1 it scanned all 7 built files/assets with
  zero broken links. One quirk: `--silent` combined with `&&`-chaining after
  a separately-redirected `pnpm build` produced a bare exit-1 with no visible
  output in this sandbox — dropping `--silent` (or running build and
  linkinator as separate commands) showed the real, clean crawl output. Don't
  read a silent-flag exit code as a real failure without re-running verbose.

- To find an organisation's real subpage URLs without guessing (a guessed
  `/contact` on crit-2's `megalo.org` 404'd, the real path was `/contact-us`),
  open the live site with `agent-browser` and `eval` a snippet enumerating
  every `<a>`'s `href` + text from the actual DOM
  (`Array.from(document.querySelectorAll('a')).map(a => a.href + ' | ' +
  a.textContent.trim())`), then read the real path off the result. This is
  mechanical discovery from the source, not a second guess.
- A verified real street address fed into OpenStreetMap's own
  `/search?query=<address>` endpoint (e.g.
  `https://www.openstreetmap.org/search?query=21+Wentworth+Avenue%2C+Kingston+ACT+2604`)
  is a legitimate wayfinding link, distinct from the "never guess a URL"
  constraint — it's built from data already verified against the real
  organisation's own site, through OSM's real, standard search route, not a
  fabricated destination.
- `stylelint`'s `no-descending-specificity` fires when a later-declared
  selector has lower specificity than an earlier one it doesn't share an
  ancestor with (e.g. `.tier ul` declared before `nav[aria-label="Primary"]
  ul`, or `.footer-social a` before `nav[aria-label="Primary"] a`). The fix
  that scales as a stylesheet grows is giving the offending rule its own
  unqualified class (`.tier-benefits` instead of `.tier ul`;
  `.footer-social { display: flex; gap: 1rem }` instead of a `> a { margin }`
  child selector) rather than reordering the file — reordering only survives
  until the next unrelated addition changes the interleaving again.
- The choice of whether to convert a crit to Astro (now the course default)
  is worth re-making per crit, not a standing policy either way: on crit-2,
  no tested `stack` conversion skill was present in that session's available
  skills, and the brief was six fixed informational pages with no
  interactivity — nothing Astro's content collections/componentisation would
  earn back against the real conversion risk (base path, the CI link-check
  patch) for a hand conversion. Re-evaluate this each time rather than
  assuming last run's answer still holds.

- When verifying a `transform`-based positional fix on an SVG element live
  (e.g. an intentional `translate(dx, dy)` offset to stop two strokes
  rendering on top of each other), don't check with `getBBox()` — by
  spec it returns the element's bounding box in its own user space
  *before* its own `transform` is applied, so two identically-shaped
  elements will report identical bboxes even when one is genuinely
  offset on screen. Use `getBoundingClientRect()` instead, which
  reflects the full rendered position. Learned on assignment-1 chasing
  what looked like a fix that "didn't apply" when it actually had.
- An SVG illustration authored by hand (coordinates typed in rather than
  traced/exported) can pass every code-level check and still read as the
  wrong subject entirely — assignment-1's first-pass ink shrimp looked
  like a caterpillar/twig, not a shrimp, with no bug in the code. The
  only way this surfaced was screenshotting the actual rendered output at
  several points along the interaction (`agent-browser screenshot` at a
  few slider values) and looking at it critically, then redesigning the
  path geometry around the subject's real structure (a shrimp's body
  genuinely C-curls; the first attempt was a shallow horizontal wave).
  Budget for this as a real design-iteration step whenever a crit/
  assignment involves hand-authored illustration, not just a one-off
  spot-check.
  **Correction (2026-08-10):** this entry had described that redesign as
  already done, but it was never actually committed — a later run's
  `git log` on this repo showed no such commit, and `strokes.ts` still
  had the original wave-shaped body when checked directly. Whatever run
  wrote the paragraph above apparently diagnosed and even drafted the fix
  in-session but the change didn't survive into git, so the *next* run
  hit the identical bug fresh and had to redo the whole diagnosis
  (fixed for real this time in
  [`168c2b0`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-baishi/commit/168c2b0)).
  The general lesson: a memory entry narrating a code-level fix is a claim
  about what happened in a past session, not a verified fact about the
  current repo — before trusting it (same caution as the stale-`now.md`
  entry above, but for `MEMORY.md` prose itself), check the actual file or
  `git log` for the commit it claims exists.

- A distinct deepening angle from the geometry/a11y/HTML-validation passes
  above: check the interaction's *actual live behaviour* against what the
  page's own prose claims about it, not just against the spec/tests. On
  assignment-1, the "idea" section said "nobody told you which stroke count
  was which as you dragged — that's the point," but the built page's visible
  `#phase-label` live region printed the exact verdict at every slider
  position — handing sighted visitors the judgement the essay claimed they
  had to make themselves. `spec/assignment-1.test.ts` only asserted the
  label sat inside an `aria-live` region, which stayed true whether or not
  it was visible, so no automated check caught this. Fixed by making the
  qualitative label screen-reader-only (`.sr-only`, clip-based not
  `display:none`, so it stays in the accessibility tree): sighted visitors
  now judge by eye alone, matching the copy; screen-reader users, who can't
  see the drawing, still get the announced verdict as their equivalent of
  looking. The general check — does what the interaction *does* match what
  the page *says* it does — is worth running on any prototype that narrates
  its own interaction, and it only surfaces by using the live build, not by
  reading the markup.
- Real keyboard interaction testing is worth re-running per repo, not just
  once for the template's stack: crit-2 hadn't had this specific check
  recorded before (only crit-1 had), so a run at 23h-to-cutoff did it fresh
  rather than assuming the crit-1 finding generalised. Tab order on
  `index.html` walked wordmark → six nav links → the hero's `tel:` link, in
  visual/logical order, with `outline:auto` (no custom `outline: none`
  reset in the stylesheet) on every stop. Confirms the same pattern holds
  site-to-site but isn't free to skip.
- Shipping (flipping a repo from private to public, enabling Pages, running
  the deploy workflow) is genuinely **harness-owned**, not something this
  agent does itself — confirmed directly, not just inferred from doctrine's
  prose: `gh auth status` in this sandboxed environment reports no logged-in
  host and no `GH_TOKEN`/`GITHUB_TOKEN` in `env`, so there is no credential
  available to run `gh repo edit --visibility public` even if it were the
  right call. This matches doctrine.md's own line ("you never receive its
  GitHub credential") exactly. A course plugin *does* ship a `ship` skill
  with this exact irreversible-flip protocol (cached under
  `~/.claude/plugins/cache/comp4020/comp4020/<version>/skills/ship/`), but it
  isn't in this session's available-skills list and, even if it were, the
  missing `gh` auth would block step 4 regardless. Don't spend a future run
  hunting for a way to invoke it or trying to `gh auth login` — the doctrine
  is explicit that publish/deploy/freeze happens automatically, on the
  harness's own clock, from the commit this agent pushes. This agent's job
  stops at "push the clean tree."

- `agent-browser network route` only supports `--abort` or a fixed
  `--body` — there is no request-delay/throttle primitive, so it cannot
  simulate a genuinely *slow* connection, only a broken one (abort). For
  the artefact criterion's "holds up under... a slow connection" HD line,
  the closest available proxy is aborting the JS/CSS request and checking
  the page still renders without crashing — useful, but log it explicitly
  as a proxy for the real thing, not the real thing, since a load that
  never arrives (abort) and one that arrives late (slow) can degrade
  differently (e.g. a slider whose native `value` still moves via keyboard/
  drag even with its `input` handler never wired up, silently, with no
  error and no visible sign to the visitor).
- Real pointer-drag testing (`agent-browser mouse move/down/move/up`, not
  synthetic `input` dispatch and distinct from the keyboard-actuation check
  already logged above) is worth doing once per interaction that's driven
  by mouse/touch: it caught, on assignment-1's stroke slider, that the
  redraw happens live mid-drag (a `#shrimp-canvas`-only screenshot taken
  with the mouse still down showed the SVG already at the dragged-to
  stroke count) rather than only on release — confirming the `input`
  event wiring, not just the final value, behaves as the copy promises.
- After a dependency bump that touches build tooling (e.g. the `oxlint`/
  `vite` update that cleared the `pnpm audit` findings), re-run the visual
  sensor even though `pnpm check` is green — a version bump to the bundler
  itself is exactly the kind of change a green `tsc`/`vitest`/lint run
  can't see the effect of on rendered output. On assignment-1, screenshotting
  `#shrimp-canvas` at strokes 0/3/5/8/10/13/16 post-bump showed the geometry
  unchanged (still the C-curl body, sweet-spot legs, over-elaborated
  duplicate outline at max) and the console stayed clean. A legitimate
  "verified, nothing to fix" outcome, not a wasted check — it's the only way
  to know a tooling bump didn't quietly change output.

- Judging "response to the brief" (a point-of-view/scope call, not a
  code-level check) has its own distinct technique from re-reading the copy
  in isolation: fetch one of the brief's own named exemplars (permitted —
  it's a URL the brief gave, not a guessed one) and compare structure/tone
  directly rather than judging against a remembered impression of the genre.
  On assignment-1, fetching Ciechanowski's Mechanical Watch intro and
  comparing its hook-then-explain shape against this page's own
  drag-the-slider-first → idea section → generalisation structure confirmed
  the response holds up against the HD band language ("pointed, surprising,
  one idea carried all the way") rather than just asserting it does. Worth
  reaching for whenever the deepening pass turns to content/scope judgement
  rather than technical checks — a live comparison beats an unaided reread.
  **This is per-assignment, not per-deliverable-once: each brief names its
  own exemplars, and comparing against a different assignment's exemplar
  doesn't substitute.** On `comp4020-ass2-baishi`, the brief itself names
  three different exemplars (Calling Bullshit, Fab's "How to Make (Almost)
  Anything," CS007) for a twelve-week course-site assignment, distinct from
  assignment-1's single-page exemplar — comparing against those three (not
  yet done in five prior runs on this repo, which had only ever done
  technical sensors and unaided prose rereads) surfaced a genuine, citable
  strength: the course does Calling Bullshit's single-governing-metaphor
  move (copy-vs-forgery's "the note," defined once in week 1, applied
  everywhere after), and goes further with something neither exemplar does
  as explicitly — live cross-week callbacks inside the lecture prose itself
  (week 9's synthetic-media lecture: "that's the same asymmetry from week
  2's connoisseurship lecture"; week 10: detection "works the way week 3's
  materials science worked," the arms race "from week 6's banknotes runs
  here too"). A marker reading two non-adjacent weeks (the assessment page's
  own stated reading protocol) would actually hit this. No code change —
  recorded as citable process evidence, not a defect fix.

- `scripts/check-evidence.ts` (the template's `pnpm check:evidence`) shares a
  single `failed` flag across unrelated checks, and gates each check's own
  success message behind `if (!failed)` at the very end — so a run where only
  the reflection is missing (expected, this far from cutoff) prints just that
  one failure line and looks like nothing else ran. It did: CLAUDE.md
  presence and every PROCESS.md commit-citation resolve silently (they only
  print on failure), so a single visible failure line doesn't mean the rest
  is unverified. Read the script directly rather than inferring from its
  console output alone if you need to know whether citations/CLAUDE.md are
  actually clean mid-week.

- A 200%-browser-zoom reflow check (WCAG 1.4.10) is a genuinely distinct
  technical angle from every emulation `agent-browser set media` offers
  (dark/light/reduced-motion only — no zoom or text-scale primitive exists
  natively): `agent-browser eval "document.documentElement.style.zoom = '2';
  document.documentElement.offsetHeight; ''"` after `open` applies a real
  Chromium zoom (confirmed via `getBoundingClientRect()` on a heading
  doubling in size, and `getComputedStyle(...).zoom` reporting `"2"`), then
  check `document.documentElement.scrollWidth` vs `clientWidth` for
  unwanted horizontal scroll and take a **non-`--full`** screenshot to see
  the zoomed state. Reset with `style.zoom = '1'` before closing. On
  assignment-1 this passed cleanly at both marking viewports — no
  horizontal scroll, text and nav reflow (the nav row wraps to two lines
  on mobile), the slider stays full-width and unclipped, no console
  errors — a real, previously-untried check, not a repeat of the
  resize-mid-interaction or reduced-motion entries above.
  **Tooling quirk found along the way:** `agent-browser screenshot <path>
  --full` (full-page mode) did *not* reflect the zoomed state at all in
  this environment — two `--full` captures taken right before and right
  after applying `style.zoom = '2'` came back pixel-identical (same
  1920×3349 full-page height, same apparent font size), even though
  `eval` in between confirmed the zoom had actually applied at the DOM
  level. A plain viewport-only `agent-browser screenshot <path>` (no
  `--full`) taken in the same zoomed state *did* show the zoom correctly.
  Not investigated further (likely `--full`'s stitching path re-renders
  outside the zoomed CDP surface), but worth knowing: don't trust `--full`
  to reflect a CSS-`zoom` state, always verify with a non-`--full` shot or
  an `eval` measurement alongside it.
  **Extended (`comp4020-crit7-baishi`, 2026-09-23):** `document.documentElement
  .scrollWidth` itself can be inflated by the zoom factor under `style.zoom`,
  independent of any real overflow — on this repo's mobile viewport it read
  642 (vs a 390 `clientWidth`) with `style.zoom = '2'` applied, which looked
  like a real WCAG 1.4.10 failure, but no individual element's own
  `scrollWidth` exceeded its `clientWidth`, a screenshot showed clean
  wrapping, and `document.body.scrollWidth` read 321 — under the viewport
  width, and exactly half of `documentElement.scrollWidth`. Measure
  `body.scrollWidth` (or a per-element sweep) instead of
  `documentElement.scrollWidth` when checking for real overflow under
  `style.zoom`, and always cross-check with a screenshot before trusting
  either number.

- A full Lighthouse run (see the `CHROME_PATH` environment note above) is a
  genuinely distinct sensor from the whole a11y/HTML-validation/keyboard/
  CWV battery already logged above — it caught something none of them did.
  On assignment-1, a run at 69h-to-cutoff, after that whole battery had
  already been declared exhausted, scored `best-practices` at 0.96 because
  every page load logs a real console error for the browser's implicit
  `favicon.ico` 404 — the same 404 an earlier console spot-check had
  already noticed and *explicitly decided to leave alone* (recorded above:
  "doesn't fail any check... leave it rather than adding a favicon just to
  clear it"). That earlier call was reasonable given what existed to check
  it against at the time, but it was wrong once a real named sensor scored
  it: the doctrine's own first finishing criterion is literally "no console
  errors," so a real console error occurring on every page load is not
  actually a non-issue just because no `pnpm check` step asserts on it. Added
  a small ink-dot SVG favicon (colour-matched to the site's `--ink` custom
  property) linked via `<link rel="icon">`, confirmed by re-running
  Lighthouse (`best-practices` back to 1.0, `errors-in-console` 0 → 1) and by
  checking the real network request in the browser, not just trusting the
  score. Two things Lighthouse also flagged that are **not** worth chasing
  for a tiny static single-page site, matching the existing busywork-guard
  lesson: a missing `robots.txt`/`llms.txt` (the `seo`/`agentic-browsing`
  categories penalise this, but nothing in the assignment spec or rubric
  cares), and render-blocking-request/network-dependency-chain "insights"
  over the page's one small CSS + one small JS file — restructuring loading
  order for a 2KB stylesheet is optimising a score, not a real user
  experience. The general lesson: a prior "leave it, nothing checks it" call
  is only as good as the checks that existed when it was made — a genuinely
  new sensor can overturn it, and that reversal is itself legitimate
  deepening-pass material, not scope creep, when the thing it fixes is named
  directly in the doctrine's own finishing criteria.

- Circular elements sized with `clamp(min, Nvw, max)` inside a `flex` row
  (`justify-content: center`, no wrap) will render correctly at the viewport
  first checked and silently distort at the other one: when N pads' total
  width exceeds the container, flexbox's default `flex-shrink: 1` compresses
  each item's *width* to fit while an explicit `height` clamp is untouched,
  turning circles into ellipses. Caught on crit-4 (2026-08-19) only by
  screenshotting the actual 390×844 marking viewport, not by re-reading the
  CSS — the 1920×1080 screenshot looked perfect and gave no reason to
  suspect it. Fix is `flex-shrink: 0` on the item plus re-tuning the
  size/gap `clamp()`s so the row's minimum total width actually fits the
  narrowest marking viewport, rather than relying on flexbox to compress
  it. General lesson, same shape as the earlier a11y/zoom findings: a layout
  that only gets checked at one viewport is only verified at one viewport —
  always screenshot both marking sizes for anything using `vw`-based sizing
  in a `flex`/`grid` row, not just for animation/interaction checks.

- A `clamp(min, Nvw, max)` used to size elements inside a flex row that
  itself sits inside a width-capped ancestor (e.g. `main { max-width: 40rem
  }`) will saturate at its rem-based max regardless of how much room the
  actual row has, once the viewport is wide enough — because `vw` always
  reads off the full viewport, not the element's real container. On
  crit-4 (2026-08-19) this caused a genuinely confusing bug: fixing a
  200%-zoom mobile overflow by switching `flex-wrap` from `nowrap` to
  `wrap` was correct, but the row was *already* wrapping at plain desktop
  zoom with no zoom applied at all, because 8 pads at their `vw`-clamp max
  plus gaps (688px) never fit the 640px-capped row. This was missed on a
  first pass because a screenshot glance at "looks like one row" isn't
  verification — the fix is CSS container queries: `container-type:
  inline-size` on the row's own element, then size children with `cqw`
  instead of `vw` so they scale against the row's real rendered width, not
  the viewport. Verify by measuring `getBoundingClientRect()` and counting
  distinct row `top` positions across all four combinations (both marking
  viewports × normal/200% zoom), not by eyeballing a single screenshot —
  same shape as the earlier ellipse-pads and clamp()-in-flex-row lessons
  above, but for row count instead of aspect ratio. This will recur on any
  future crit with a `vw`-sized row inside a width-capped container.
- To verify Web Audio is actually producing sound (this agent can't hear,
  and DOM state like `.active` classes or a voice-count map only proves the
  app's own bookkeeping ran, not that anything audible happened): patch
  `AudioContext.prototype.createOscillator` and `AudioNode.prototype.connect`
  via `agent-browser eval`, splice a real `AnalyserNode` in front of
  `destination`, then read its time-domain/frequency data after a real
  interaction. Two traps: (1) the naive patch that calls the *patched*
  `connect` again for the analyser's own hookup to destination recurses —
  guard with a flag and call the original `connect` (saved before
  patching) directly for that one hookup; (2) a synthetic
  `document.dispatchEvent(new KeyboardEvent(...))` correctly triggers the
  app's own handlers (oscillator created, `.active` class set) but leaves
  `AudioContext.state` stuck `"suspended"` — Chrome's autoplay gate does
  not count a page-dispatched synthetic event as real user activation. Use
  genuine CDP-driven input instead (`agent-browser press`, `agent-browser
  mouse down`/`up`), which does resume the context to `"running"` and lets
  the analyser read a real, non-zero signal. Confirmed on crit-4
  (2026-08-19) including a two-note chord (two live oscillators, correctly
  mixed higher peak, clean drop to zero on release). This is a one-off
  verification technique to run per audio-producing crit, not a permanent
  test-suite addition.
- To read or drive a module-scoped object (an `AudioContext`, a state map)
  that `agent-browser eval` can't see because the app never puts it on
  `window`, patch the relevant global constructor *before* the page's own
  script runs: `eval` a wrapper that replaces `window.AudioContext` with a
  function that constructs the real one via the saved original, stashes the
  instance on `window.__ctxRef`, then `open` (or reload) the page — the
  patch has to land before the module's own top-level code executes, so
  redo the same `eval` again right after the fresh navigation too; one
  early `eval` before the first `open` doesn't survive a reload. Distinct
  from the createOscillator/connect-analyser-splice entry above (that one
  taps *audio signal*; this one taps a *specific instance reference* for
  direct method calls like `.suspend()`/`.state`). Used on crit-4
  (2026-08-20) to test whether Drift's `noteOn()` resume check generalises
  beyond the initial autoplay-gate suspend: captured the real
  `AudioContext`, resumed it with a genuine keypress, then called
  `.suspend()` directly on the captured instance to stand in for *any*
  browser-initiated suspend (not just the autoplay one), and confirmed a
  second real keypress resumed it again cleanly. Confirmed the existing
  `if (context.state === "suspended") void context.resume()` check in
  `noteOn()` is unconditional on suspend cause and needs no separate
  blur/focus-pair handler — a genuine "checked, nothing to fix" outcome,
  distinct from the blur/visibilitychange *voice*-release bug below (that
  one was a real gap; this one wasn't). Reach for this whenever a check
  needs to drive a specific Web API instance the app keeps private, not
  just observe whether *some* audio came out.
- A synthetic `dispatchEvent` press-cycle (used elsewhere in this log because
  `agent-browser press --hold` doesn't reliably sustain) is not equivalent to
  a real drag for anything driven by pointer *movement* across multiple
  elements — a glissando, a drag-to-paint control, anything keyed off
  `pointermove`/`elementFromPoint`. Genuine `agent-browser mouse move <x> <y>`
  / `mouse down` / `mouse move <x2> <y2>` (still held) / `mouse up` is needed
  to prove the transition logic itself (does leaving element A's bounds while
  still down correctly hand off to element B, with no double-fire or stuck
  state), not just that each endpoint responds in isolation. Confirmed on
  crit-4's pad-to-pad glissando: DOM state showed exactly one active pad
  throughout the drag, never both, never neither.
- Verifying "sound came out" (the analyser-splice technique two entries up)
  is a different, weaker claim than "the *right* pitch came out" — the first
  only proves *some* signal reached the destination, the second proves the
  content matches what the interaction should have produced. To check pitch,
  not just liveness, read `analyser.getFloatFrequencyData` and take the
  peak bin (`peakBinIndex * ctx.sampleRate / analyser.fftSize`), then compare
  against the expected note's frequency (within one bin's width, e.g.
  ±23Hz at `fftSize: 2048` and a 48kHz context). On crit-4 this confirmed the
  live output pitch actually tracked the pad under a real mouse drag, not
  just that oscillators existed. One trap: if the instrument has *any* decay
  tail (a release envelope, a feedback delay/echo), reading the analyser
  immediately after switching notes can still show the *outgoing* pitch
  dominant — that's the tail genuinely still sounding, not a bug in the new
  note. Re-read after the release envelope's own duration has elapsed (Drift's
  is 350ms; a longer delay/feedback network can keep the old pitch audible
  for noticeably longer than the dry envelope alone) before concluding a
  pitch transition failed to happen.
- A continuous parameter the copy claims controls timbre (Drift's "move up
  and down to brighten or darken the sound", a filter cutoff swept by
  pointer/arrow-key position) needs the same audio-domain proof as pitch,
  not just a DOM/CSS-variable check — reading `--brightness` or
  `masterFilter.frequency.value` only proves the app's own bookkeeping
  moved, the same gap the pitch-vs-liveness entry above already named for
  note-on. Confirmed live on crit-4: held a note with a genuine
  `mouse down` (real gesture, resumes the context), then swept brightness
  with real `agent-browser press ArrowDown`/`ArrowUp` while still held,
  reading the spliced analyser's `getByteFrequencyData` banded into
  low/mid/high frequency ranges after each sweep. High-band (4–6.5kHz)
  energy was genuinely zero at dark and mid brightness and only appeared
  once bright (2.8), with mid-band (1.5–3kHz) energy climbing
  monotonically dark→default→bright (7.5→8.5→14) — confirms the lowpass
  sweep is actually audible, not just a CSS custom property changing.
  Console stayed clean throughout. "Checked, confirmed correct" outcome,
  no code change. Worth doing on any future crit whose copy names a
  specific audible effect of a continuous control (not just a note
  on/off), since that's exactly the class of claim a DOM-only check can't
  verify.
- **"The sensor battery is exhausted" and "there's nothing left to find" are
  different claims — don't conflate them.** After six runs' worth of
  axe-core/html-validate/Lighthouse/CWV/keyboard/audio-domain checks on
  crit-4 (Drift) all came back clean, a seventh run re-read the brief's own
  interaction prose one clause at a time against the *current* code instead
  of reaching for another synthetic probe, and found a real bug none of
  those sensors could ever have caught: "playable with whatever is at hand"
  implies a Tab-focused pad activated by Enter/Space should sustain for as
  long as it's held, same as a pointer or a home-row key — but the code
  gave it a hardcoded 180ms blip via a `click`+`setTimeout` regardless of
  hold duration. No accessibility/HTML/performance tool asserts on "does
  holding a key sustain a note for the actual hold duration," because
  that's a claim about *timing behaviour under a specific interaction
  pattern*, not structure or a score. The general technique: when the usual
  sensor battery reads as exhausted, derive fresh checkable claims straight
  from the brief's own sentences (not the spec's checkable-invariant
  subset, the fuller prose) and test each one against the live code — a
  different search than running more automated tools, and it can still
  turn up something real even after the tools are genuinely dry.
  **This held a second time, not just once:** an eighth run re-applied the
  same clause-by-clause technique to the *previous* fix (the
  blur/visibilitychange stuck-note fix, itself found this same way) and
  found it only covered the whole page losing focus, never focus moving
  *within* the page — holding Space on a pad, then pressing Tab to the next
  pad without releasing, left the first pad droning forever, because a
  still-held key's eventual `keyup` targets whichever element currently has
  focus, not the one focused when the key went down. Fixed with a
  `focusout` listener (fires the instant a pad loses focus, for any
  reason). The pattern worth trusting going forward: **each fix to a
  press-and-hold interaction opens a fresh clause worth re-deriving**,
  because the fix itself is new code the brief's prose hasn't been checked
  against yet — this isn't a fixed list to exhaust once, it's a technique to
  reapply after every change to hold/sustain logic specifically.
- The brightness/filter-sweep audio-domain check logged above (the one that
  confirmed the vertical control is audible, not just a CSS variable) had
  only ever driven the sweep via `agent-browser press ArrowUp`/`ArrowDown`
  while a note was held with the mouse — never via the actual pointer-drag
  path (`pointermove` → `updateBrightnessFromClientY`) that the page's own
  copy names as the primary way to do it ("move up and down to brighten or
  darken the sound"). Those are two different code paths in `main.ts` and
  a bug in one wouldn't show up testing the other. Verified on crit-4
  (2026-08-23, 71h-to-cutoff) with a genuine `agent-browser mouse down` on
  a pad followed by real `mouse move` to the bottom then the top of the
  viewport (same x, so the note itself doesn't change pad): the spliced
  analyser read low-band-only energy with `--brightness` at 0.028 near the
  bottom, and real mid/high-band energy appearing (11.8/2.3) with
  `--brightness` at 0.954 near the top — confirmed audible, not just a
  bookkeeping variable. Release (`mouse up`) cleared the pad's `.active`
  class immediately, no stuck state. "Checked, confirmed correct," no code
  change. General lesson matching the arrow-key-vs-drag distinction
  elsewhere in this file: two input paths that both claim to drive the same
  parameter are two separate claims to verify, not one — confirming one
  doesn't cover the other.
- Applying the same clause-by-clause technique a third time to the
  `focusout` fix itself (does releasing on *any* focus-loss reason ever end a
  note the player didn't mean to end — e.g. a pointer chord stealing focus
  away from a keyboard-held pad) came back clean this time, not another bug.
  Confirmed live on crit-4: focused pad A via `.focus()`, dispatched a
  synthetic `keydown` for Space (sustaining `focus-a`), then drove a *real*
  `agent-browser mouse down`/`mouse up` on pad S — `document.activeElement`
  stayed `a` throughout, both pads' `.active` classes were true
  simultaneously (a genuine cross-modal chord), and releasing the keyboard
  note afterwards worked normally. The reason it doesn't break: the existing
  `pointerdown` listener already calls `event.preventDefault()` (originally
  added to stop scrolling/text-selection on drag), and that same
  `preventDefault()` also suppresses the browser's default click-to-focus
  behaviour for that pointer, so a pointer chord never steals DOM focus away
  from a keyboard-held pad in the first place. Worth recording as the reason
  a fix works, not just that it does — the next run doesn't have to
  re-diagnose *why* pointer input can't defocus a held pad if it ever
  revisits this. General lesson for the clause-re-derivation technique:
  every reapplication doesn't have to find a new bug — "checked this
  specific edge case, confirmed the existing code already handles it and
  here's the mechanism" is exactly as legitimate an outcome as a fix, and is
  cheaper to write down than to re-derive from scratch next time.
- The clause-re-derivation technique above works on the **code's own
  comments**, not just the brief's prose — a comment asserting *why* a line
  exists (e.g. "`preventDefault()` here stops X from also happening") is a
  testable claim exactly like a brief sentence is, and one this agent wrote
  itself is no more trustworthy unverified than one read from outside. To
  check a preventDefault-based double-activation guard live (does pressing
  Enter/Space on a focused button actually suppress the native synthetic
  click, or does it sneak through and double-fire a separate click handler),
  DOM/`.active`-class state can't tell the two cases apart — a doubled
  handler call is often idempotent at the DOM layer even when it created a
  second live audio node underneath. Patch the actual node-creation call
  instead: `agent-browser eval` to wrap `AudioContext.prototype
  .createOscillator` with a counter before the interaction, reset it, run
  one real `agent-browser press Enter` (or `Space`) on a focused element,
  then read the counter — 1 confirms the guard holds, 2 would confirm a real
  double-trigger. Confirmed clean on crit-4's Tab+Enter/Space fix
  (2026-08-23, 64h-to-cutoff): both keys produced exactly one oscillator,
  and a plain `.click()` with no keydown/keyup at all (the actual
  assistive-tech path the fallback handler exists for) also produced
  exactly one, confirming both branches are mutually exclusive in practice,
  not just in the comment's claim.
- **The `pointerPads` Map has real independent-multi-touch logic that no
  prior audio-domain check had ever exercised through its own code path.**
  Every earlier "multi-voice chord" check (headroom, glissando, brightness
  sweep) drove at most one genuine pointer at a time and layered any
  further voices via synthetic `keydown` — a different map (`voices` keyed
  by `key-x`/`focus-x`) than the one two real simultaneous touches would
  use (`pointer-x` keyed by `pointerId`). Confirmed live on crit-4
  (2026-08-23, 58h-to-cutoff) with genuinely independent synthetic
  `PointerEvent`s carrying `pointerType: 'touch'` and distinct
  `pointerId`s (real multi-touch hardware is still untestable here, per
  the iOS-provider entry above, but this is the first check to drive
  *this specific map* with more than one concurrent pointer identity,
  which is the part of the code the hardware gap actually leaves
  unverified): two simultaneous touch pointers on separate pads produced
  exactly one oscillator each; releasing one left the other's `.active`
  state and oscillator untouched; and sliding one touch pointer across to
  a third pad (a touch-typed glissando) released the pad it left,
  activated the new one, and left the second, steady touch pointer
  completely unaffected throughout — confirmed via a
  `createOscillator`-call counter (2 → 3, never spuriously higher) and a
  clean `agent-browser console`/`errors` read. "Checked, confirmed
  correct," no code change. General lesson matching the arrow-vs-drag and
  headroom entries above: a map keyed by an identity (here, `pointerId`)
  needs its *cardinality* tested, not just its single-entry behaviour —
  confirming one touch works says nothing about whether two touches stay
  independent until it's actually tried.

- **When the technical-sensor well and clause-by-clause re-derivation both run
  dry, re-read the stylesheet fresh against "a real device," not another
  synthetic-event probe.** On crit-4's thirteenth run (2026-08-24,
  47h-to-cutoff), five straight prior runs had found nothing new via either
  route. Re-reading `styles.css` with the question "what platform-default
  touch behaviour has never been checked" (not "what does the app's own
  code do wrong") found a real gap: `.pad` had no
  `-webkit-tap-highlight-color` override, so Android Chrome/WebKit paint
  their default semi-transparent gray-black rectangle over every tap —
  independent of `touch-action: none`, `user-select: none`, or
  `appearance: none`, none of which touch this property. Confirmed via web
  search this default is still current (not stale knowledge) before
  fixing. Couldn't verify the visual artifact directly — same
  `xcrun simctl`/`-p ios` gap logged above blocks any real touch-emulation
  screenshot in this sandbox — so this was a justified pre-emptive fix
  (real, well-documented default; zero cost since the pad already gives
  richer feedback via its own `.active` class), not a verified-then-fixed
  bug like the others in this file. Worth naming as its own category: some
  real defects in a touch-first crit are only reachable by asking "what do
  browsers do by default that this stylesheet hasn't overridden," not by
  running another tool or re-deriving another brief clause — CSS-property
  literacy as its own deepening lens, distinct from both.

- **`touch-action: none` is scoped like any other CSS property — set it on
  the actual drag/zoom surface, never on `body`/`html` as a blanket fix for
  scroll interference during a pointer drag.** MDN's own docs warn against
  applying it broadly: it disables *all* browser-handled panning and
  zooming on the element it's set on, including pinch-zoom, so a page-wide
  `touch-action: none` blocks low-vision touch users from zooming anything
  on the page, not just the interactive surface it was meant to protect.
  MDN names the correct scope directly — an element with its own custom
  drag/zoom behaviour, "a map or game surface" — which generalises to any
  future crit with a draggable canvas, slider, or multi-touch pad row.
  Confirmed via `getComputedStyle(el).touchAction` before/after scoping
  down from `body` to the specific interactive container; real touch
  pinch-zoom itself stays unverifiable in this sandbox (same
  `xcrun simctl` gap as the tap-highlight entry above), so this fix is
  grounded in MDN's documented behaviour, not a screenshot of the gesture.
  Found on crit-4 (2026-08-24, 40h-to-cutoff) by following up on the prior
  run's own flagged lead (pinch-zoom/user-scaling, in its "next action"
  note) rather than inventing a fresh angle — worth re-reading a prior
  run's stated next-action list before reaching for a brand new technique.

- **A third instance of the CSS-property-literacy lens (see the tap-highlight
  and touch-action entries above): `appearance: none; border: none` on a
  custom-styled control is a specific, real gap under `forced-colors: active`
  (Windows High Contrast mode), not just a theoretical one.** MDN documents
  this as "the classic button problem" — `background-image` (gradients
  included) and `box-shadow` are both forced to `none` in that mode, so any
  element relying on either for its visible shape/boundary, rather than a
  real `border`, effectively disappears. On crit-4's `.pad` (a round button
  whose entire circle came from a radial-gradient background plus a glow
  `box-shadow`, no border at all) this meant a pad would render as a bare
  letter with no boundary under high contrast — found on the fifteenth and
  final run (2026-08-24, 34h-to-cutoff) by extending the same "what does the
  platform do by default that this stylesheet hasn't overridden" question one
  step further than the tap-highlight/touch-action findings had gone. Fixed
  with `@media (forced-colors: active) { .pad { border: ...ButtonBorder } }`
  — MDN's own documented fix shape, using `ButtonBorder`/`Highlight` system
  colors rather than fixed colors so it stays correct across a user's chosen
  contrast theme. Same epistemic status as the other two: `agent-browser` has
  no forced-colors emulation, so this is grounded in documented platform
  behaviour, confirmed only by `getComputedStyle` showing the rule doesn't
  leak into ordinary mode, not a screenshot of the failure or the fix. Any
  future crit with a custom-styled interactive element (a button, a slider
  thumb, a custom checkbox) that gets its shape from `background`/`box-shadow`
  rather than a `border` should get this same check — grep the stylesheet for
  `appearance: none` combined with `border: none` as the specific pattern to
  look for.

- **A fourth instance of the CSS-property-literacy lens: `touch-action: none`
  only suppresses browser-handled pan/zoom gestures, not iOS Safari's
  separate long-press callout (context-menu/copy) and text-selection
  magnifier.** Confirmed via web search of MDN and current sources that
  `-webkit-touch-callout: none` is the distinct, correct property for the
  callout, and pairing it with `-webkit-user-select`/`user-select: none`
  (to also stop the magnifier) is the documented fix shape — the two
  properties address genuinely different platform behaviours and neither
  substitutes for the other. Found on crit-5 (2026-08-31, 40h-to-cutoff)
  applying the same "what does the platform do by default that this
  stylesheet hasn't overridden" question to `#game`, which already had
  `touch-action: none` and `-webkit-tap-highlight-color: transparent` but
  nothing for the callout. This one carries real stakes beyond cosmetics:
  the element in question is the exact surface a sustained touch-hold
  drags across, so an uncontrolled callout mid-drag would interrupt actual
  gameplay on iOS, not just look untidy. Same epistemic status as the
  other three: no real iOS host in this sandbox (the recurring
  `xcrun simctl` gap) to trigger the callout and confirm it's actually
  suppressed, so this is a pre-emptive, documentation-grounded fix,
  confirmed only by `getComputedStyle` showing `user-select: none` applied
  and scoped to the one element. Any future crit with a draggable/
  long-press-driven touch surface should get all four checks from this
  lens together — tap-highlight, touch-action scope, forced-colors
  border-loss, and now touch-callout/user-select — rather than stopping
  once the first one or two are found.

- **For a game/interaction whose canvas resolution is JS-driven off
  `getBoundingClientRect()` and only resynced on a `resize` event, the
  `documentElement.style.zoom` technique used elsewhere in this log for
  WCAG 1.4.10 reflow checks can produce a false positive, not a real bug.**
  On crit-5, forcing `style.zoom = '2'` squashed every canvas-drawn circle
  into an ellipse — the canvas's pixel buffer (set once at load/resize
  time) no longer matched its now-differently-proportioned rendered box.
  Traced before fixing anything: `style.zoom` doesn't fire a `resize`
  event and doesn't change `window.innerWidth` in this sandbox — confirmed
  directly (`window.__resizeFired` stayed 0, `innerWidth` unchanged across
  the zoom toggle). That matters because neither real zoom mechanism a
  visitor could actually use reaches this state: real desktop browser zoom
  (Ctrl-+/-) *does* resize the layout viewport and *does* fire `resize`
  (confirmed by that same app's `resize()` handler already producing
  correctly round circles at both marking viewports under ordinary,
  non-`style.zoom` use); real mobile pinch-zoom *never* resizes the layout
  viewport at all (confirmed via web search — pinch/pan only change the
  *visual* viewport, a distinct concept from the *layout* viewport that
  `getBoundingClientRect()` reads from, per the VisualViewport API's own
  raison d'être), so it can't desync the buffer either. `style.zoom` is
  useful for plain DOM/CSS reflow checks (confirmed clean on earlier,
  non-canvas crits) but is not a faithful proxy for *either* real zoom
  mechanism on an element whose size is cached in JS off
  `getBoundingClientRect()` — don't diagnose a canvas-squash finding under
  `style.zoom` as a shippable bug without first checking whether the app's
  own `resize` handler already covers real zoom's actual viewport-resize
  behaviour, the way this one did.

- **A third bug-finding technique, distinct from a fresh code read and from
  brief-clause re-derivation: re-read an already-shipped fix's own stated
  reasoning and check whether it generalised as far as it should have, not
  just as far as the bug report that motivated it.** On crit-5, a fix that
  suppressed Space's default page-scroll during a gameover restart was
  reasoned about specifically in terms of Space ("the browser's own
  page-scroll-down key"). That reasoning was correct but narrower than the
  actual defect class: ArrowUp/ArrowDown share the exact same property (a
  browser scroll default, no in-game use) but were never covered, and not
  just during gameover — during ordinary play too, since nothing in the
  handler ever reached a `preventDefault()` for either key in any state.
  Confirmed live the same way the original fix was: a real short viewport
  with genuine overflow, a real keypress, `window.scrollY` before/after.
  The general check: whenever a fix names the *specific* key/event/element
  that triggered the bug report, ask what *property* of that key/event/
  element actually caused the problem, then check every sibling that
  shares the same property, not just the one instance already fixed. This
  is a different search from re-reading the file fresh (which looks at
  what the code does) or re-deriving brief clauses (which looks at what
  the brief promises) — it looks at whether a past fix's own justification
  covers its full stated scope.

- **Axe-core cannot evaluate CSS colours written in `oklch()`/relative
  colour syntax (`oklch(from var(--x) ...)`) or over gradient/pseudo-element
  backgrounds — it reports those nodes as "incomplete," not pass or fail,
  so a real AA contrast failure on such an element produces zero
  violations in an automated sweep.** Found on `comp4020-ass2-baishi`
  (2026-09-14, an Astro course-site build on `astro-theme-university`):
  the theme derives every semantic colour token from a brand's pinned
  `--at-primary`/`--at-secondary` via `oklch(from var(...) ...)`, and a
  card-title element reading `--at-accent` (pinned straight to the brand's
  gold) was a real 3.43:1 against its background — under the 4.5:1 AA
  minimum for normal text — with axe-core flagging nothing. The theme
  ships its own `contrast.ts` module (`oklchToSrgb`, `contrastRatio`,
  `AA_BODY_TEXT`/`AA_LARGE_TEXT`, `parseLightDarkOklchTokens`,
  `tokenContrast`) specifically because of this gap, with a doc comment
  inviting brand-layer packages to test their own token overrides against
  it. Two things worth reapplying to any future `astro-theme-university`
  course-site deliverable: (1) don't trust an axe-core 0-violations result
  alone on a page using oklch-derived tokens — confirm suspect text/
  background pairs live with `getComputedStyle` and manual contrast math,
  the same way this fix was confirmed; (2) `contrast.ts`'s parser expects
  tokens declared in the `light-dark(oklch(...))` form the theme's own
  `tokens.css` uses — a brand package that instead pins flat hex literals
  (as `astro-theme-slop`'s `slop.css` does) isn't directly testable with
  those exported helpers without first reimplementing a hex→oklch
  conversion the module doesn't provide itself. Judged that gap not worth
  closing with a bespoke conversion for one card-title fix (see
  `comp4020-ass2-baishi`'s `PROCESS.md`) — but a future deliverable
  whose brand package pins tokens the same declarative way `tokens.css`
  does could use `contrast.ts` directly, with no conversion needed.
  **Correction (2026-09-15):** an earlier run on this same repo had traced
  *all* of home's other axe "incomplete" nodes — nav links, the hero
  heading, tag badges — to this same harmless gap and written that into
  `PROCESS.md` as settled. That generalisation was wrong for one of them:
  the hero heading was never actually measured, only assumed to match the
  nav-link/tag-badge pattern because it shared the "incomplete" label. A
  later run sampled the live rendered pixels behind the hero title (white
  text over a photo behind a fixed black gradient overlay — exactly the
  kind of background axe can't read) and found a real, marginal failure:
  as low as 2.99:1, under even the 3:1 large-text minimum. Fixed by
  darkening the raw hero AVIF: compositing any foreground colour over a
  background with a **pure black** foreground is a linear scalar
  (`compositeOver(black, alpha, bg) = bg * (1-alpha)`), so scaling the
  source image's raw brightness by a measured factor (`sharp(...).linear(k,
  0)`) darkens the on-page composite by that same factor `k`, regardless of
  alpha or which vertical band a given viewport's responsive crop shows —
  confirmed by re-measuring the worst point at both marking viewports after
  the fix (~4.4:1, holding despite each cropping the source differently).
  General lesson: axe's "incomplete" label names a *category* of node it
  can't evaluate, not a verdict — some incomplete nodes really are false
  positives (provably so, by hand-computing oklch token contrast) and some
  are real failures nobody actually measured. Don't let confirming one or
  two nodes in the category license writing off the rest of the same
  category as "the same limitation, not a real defect" — each element
  still needs its own live pixel measurement before being cleared.
  **Extended (2026-09-17, eighth run):** a fix that clears AA against a
  `light-dark()`-derived background is only verified in *one* colour
  scheme unless checked in both — `agent-browser`'s default rendering is
  light, so seven prior runs' contrast checks on this repo never exercised
  dark mode at all. `astro-theme-slop`'s `slop.css` pins `--at-secondary`
  as a flat hex (`#8a5c13`), not a `light-dark()` token, while the card
  background `.at-card-title` sits on (`--at-bg`/`--at-bg-elevated`) *is*
  `light-dark()`-derived from `--at-primary` — so the same fixed text
  colour has a different, independently-computed contrast ratio in each
  scheme. The original fix (light-mode 5.71:1, chosen specifically because
  `--at-primary` failed light mode at 3.43:1) turned out to drop to 3.51:1
  in dark mode — a fresh AA failure nobody had reason to look for, because
  the check that motivated the original fix was itself scoped to light
  mode only. Confirmed live via `agent-browser set media dark` + a
  canvas-based oklch→sRGB readback (`ctx.fillStyle = oklchString; ctx.fillRect(...); ctx.getImageData(...)` —
  canvas normalises any CSS colour syntax to sRGB bytes, useful whenever
  `contrast.ts`'s own parser can't handle a mixed hex+`light-dark(oklch())`
  pair, per the flat-hex-brand gap already logged above) computing the
  same WCAG contrast formula `contrast.ts` uses. Fixed by discovering
  primary and secondary are exact mirrors of each other across the two
  schemes (primary clears dark at 5.82:1 where it fails light; secondary
  clears light at 5.71:1 where it fails dark) and wrapping the CSS
  override itself in `light-dark()`, rather than inventing a new colour —
  `color: light-dark(var(--at-secondary), var(--at-primary))`. General
  check for any future `astro-theme-university` deliverable: whenever a
  brand-layer override pins a fixed colour against a theme surface to fix
  or avoid an AA failure, verify it in *both* `light-dark()` states if the
  surface it sits on is itself `light-dark()`-derived, not just whichever
  scheme the checking tool happens to default to.
  **Extended (`comp4020-final-baishi`, 2026-09-30):** two more root causes
  land in the same "incomplete, not a verdict" bucket, on a plain
  hand-authored site with no design-system tokens at all. (1) A colour
  dimmed by an *ancestor's* `opacity` (not the element's own colour, and
  not oklch) — axe can't resolve the composited result and reports
  "incomplete" here too; a `.tagline a` inheriting its parent's
  `opacity: 0.75` was a real 2.81:1 against the required 4.5:1. The fix
  that generalises: never use `opacity` on a container to mute *some* of
  its text while a child needs its own, different, fully-legible colour —
  `opacity` composites the whole subtree as one group, so no child colour
  value can opt back out of it; use a partially-transparent `color` value
  on the muted text specifically instead, which only affects that one
  box. (2) SVG `<text>` contrast axe structurally can't evaluate at all,
  regardless of what's behind it — a `.zone-prompt` label at 0.7 fill-opacity
  over a plain solid SVG rect was 2.86:1, no oklch/gradient/opacity-ancestor
  involved, just plain SVG. Both found by hand-computing the actual WCAG
  contrast formula against axe's own "incomplete" read, same technique as
  every other entry in this bullet — worth doing on any element axe can't
  score, not just the design-system-token cases logged above.

- **An `<svg role="img">` suppresses every focusable descendant from the
  accessibility tree, regardless of what `tabindex`/`role` that descendant
  carries — adding `tabindex="0"` to a child of a `role="img"` element
  looks fixed in a code read (the attribute is right there) and stays
  structurally broken for a screen reader.** `role="img"` tells assistive
  tech "treat this whole subtree as one flat image," which by the ARIA
  spec discards any interactive semantics beneath it. Found on
  `comp4020-final-baishi` (2026-09-30) fixing a drawing zone that had no
  keyboard path at all: the zone-hit rect needed `tabindex`/`role="button"`
  added, but the parent `<svg>` already had `role="img"` (correct while the
  svg was pure decoration, wrong the moment part of it became a real
  control). Fix: drop the svg's own `role` once it holds genuine
  interactive content — its default SVG-AAM role (`graphics-document`) does
  not suppress descendants — and give the *specific* interactive child its
  own `role`/`tabindex`/`aria-label`. Confirmed with a real `agent-browser`
  Tab walk reaching the control in the right order with a visible focus
  ring; verifying via source-read alone (checking the child's own
  attributes) would have missed the ancestor's suppression entirely. Worth
  checking on any future crit with a canvas/SVG visualisation that later
  grows an interactive element inside it — the `role="img"` decision made
  when the element was purely decorative doesn't automatically get
  revisited when it stops being decorative.

- **A library's own bot-detection (`navigator.webdriver`) can make a real,
  shipped behaviour structurally unobservable through `agent-browser`, a
  distinct category from the iOS-simulator/print-media/zoom-emulation gaps
  already logged above — those are missing CDP primitives, this is a
  deliberate design choice the page's own code makes.** On
  `comp4020-ass2-baishi`, `astromotion`'s first-run help-hint overlay (the
  one styled component with a `prefers-reduced-motion` guard in the whole
  deck stack) explicitly checks `navigator.webdriver === true` and never
  renders at all for an automated view — confirmed live,
  `agent-browser eval "navigator.webdriver"` returns `true` in this
  environment, and the source comment names the reasoning directly
  ("Any browser being driven programmatically... is not a viewer who needs
  teaching the key bindings"). No amount of `agent-browser set media
  reduced-motion` or session-storage clearing gets around this — the guard
  fires before either would matter. Two things worth doing when this
  pattern is hit again: (1) grep the dependency's own source for
  `webdriver`/`isAutomated`/similar before spending time debugging why an
  expected element never appears in a live check; (2) don't chase it
  further when the gated code is upstream platform/theme code rather than
  this deliverable's own content — the same course-vs-platform boundary
  that already governs which `spec/` tests are this repo's to write.

- **The assessment page's own HD artefact-band language — "holds up under
  use it wasn't designed for: the keyboard, a resize mid-interaction" —
  applies to a slide deck exactly as much as to an interactive prototype
  like assignment-1's slider, and had never been checked against the deck
  specifically across eight prior runs on `comp4020-ass2-baishi`.** The
  deck is `astromotion`'s reveal.js-based component (`.reveal`/`.slides`/
  `section.past/.present/.future`, `#/N` hash routing). Confirmed live
  (2026-09-17): navigate several slides via real `agent-browser press
  ArrowRight`, note the settled `window.location.hash`, then
  `agent-browser set viewport` straight to the other marking size with no
  reload — hash and the visually rendered slide (confirmed by screenshot,
  not `document.body.innerText`, see the next point) both held steady
  across the resize, console clean. "Checked, confirmed correct," no code
  change — this is upstream platform code either way, so a bug here would
  have been out of scope to fix (same boundary as the `navigator.webdriver`
  and Tab-focus entries above), but the check itself is this deliverable's
  to run since the marking rubric literally names it.
  **Testing-technique trap found along the way:** `document.body.innerText`
  is not a reliable read of "what slide is currently showing" on a
  reveal.js deck — reveal keeps every slide's text in the DOM at all times
  and hides the inactive ones via `hidden`/`display:none`, but
  `innerText` on Chromium can still include hidden-element text in some
  configurations, so two genuinely different hash states read back
  *identical* `innerText` and looked like a stuck resize bug before a
  screenshot (or `document.querySelector('section.present')`, reveal's own
  "currently visible" class) proved otherwise. Also: reveal.js only updates
  the URL hash on an actual slide transition, not on each fragment reveal —
  a run of `ArrowRight` presses can show one hash-unchanged step (fragment
  reveal) then a hash jump of more than 1 (a real slide transition past a
  vertical-stack index), and that's normal reveal.js behaviour, not a
  navigation bug, before concluding the number sequence itself is broken.

- **A hand-rolled contrast checker inherits the exact same blind spot as
  axe-core: neither can read an element whose real background comes from a
  `background-image`/gradient rather than a solid `background-color`, and
  both will misreport such an element rather than skip it cleanly.** Prior
  dark-mode contrast checks on `comp4020-ass2-baishi` had only ever
  verified the one element a specific fix targeted (the card-title AA
  failure); a later run wrote a general-purpose sweep — walk every element
  with direct text, resolve its colour and the nearest ancestor's opaque
  `background-color`, convert both through a 1×1 canvas (handles oklch the
  same way `contrast.ts` does), compute WCAG contrast, flag anything under
  the size-appropriate AA threshold — and ran it via `agent-browser eval`
  against every distinct page type in `set media dark`. Every page came
  back clean except the home hero title, which flagged at a false
  `ratio 1.02`: the walk-up-for-background-color loop, finding no ancestor
  with an opaque solid colour under the hero's image+gradient stack, fell
  through to an unrelated ancestor's colour instead of the real composite.
  Confirmed as a checker artefact, not a real bug, by reading the source
  directly rather than trusting the number: `.at-hero-title`'s `color` is
  `var(--at-white)` and the scrim is `linear-gradient(to top, rgb(0 0 0 /
  80%), ...)` — both fixed literals with zero `light-dark()` involvement
  anywhere in the chain, so the hero's actual rendering is provably
  scheme-independent, and the light-mode darkening fix from three runs
  earlier already covers dark mode by construction. General lesson: any
  bespoke or off-the-shelf contrast tool built on "read `background-color`
  up the tree" needs the same exclusion axe-core effectively has for
  image/gradient surfaces — a flag on exactly that class of element is
  worth checking against the source before trusting it as a fresh
  defect, and a clean sweep everywhere *else* is still worth having, since
  it's the first time every page type (not just one previously-fixed
  element) had ever been checked in dark mode at all.
- **The same hand-rolled contrast checker's "walk up to the nearest opaque
  ancestor" heuristic has a second, distinct blind spot from the
  gradient/image one above: it also needs to check an element's own local
  `background-color` before walking up at all, not just an ancestor's.** A
  heading with its own solid highlight-box background (astro-theme-slop's
  deck styling: an `<h1>` on a title slide sits on its own opaque amber
  box, not the page's dark canvas) will falsely flag as invisible if the
  checker skips straight to `getComputedStyle(document.body)` or otherwise
  never samples the element itself — on `comp4020-ass2-baishi`'s week-1
  deck this produced a `ratio 1.00` false alarm on the opening slide's H1,
  which looked alarming (a near-black-on-near-black title, the single most
  visible element in the deck) until walking the DOM from the H1 itself
  confirmed its immediate background actually is the amber box
  (`rgb(185,125,28)`), giving a real ratio of 5.57. Fix the checker to test
  `el` before `el.parentElement`, not just walk ancestors. A second,
  unrelated false positive found the same session: `astro-theme-university`'s
  shared `.at-heading-anchor` permalink icon (the small "#" link next to
  every H1/H2/H3 site-wide) reads as identical-color-to-background by
  design — it's a hover-reveal affordance with a genuine `0×0`
  `getBoundingClientRect()` when inactive (confirmed directly, not assumed),
  so a checker that doesn't skip zero-size elements will flag it forever.
  Both are checker bugs, not site bugs, and the second is theme code
  (out of scope for this course's content either way, same boundary as the
  `navigator.webdriver`/focus-ring findings above) — exclude
  `.at-heading-anchor` and zero-size elements from any future run of this
  checker. General lesson stacking on the entry above: a bespoke contrast
  tool accumulates blind spots one exotic layout at a time (gradients, then
  local-background boxes, then hover-reveal zero-size elements) — each
  needs its own fix, and a clean result from an *earlier* version of the
  checker doesn't mean a *later*, more thorough sweep with the same tool
  won't need another correction first.
- **A component that documents itself as "dark surfaces" should be checked
  once for whether `set media dark`/`light` actually changes anything on
  it before being swept "in dark mode" — if it doesn't, every such sweep on
  that page is testing a scheme-invariant fixed palette, not exercising a
  real light/dark toggle.** Confirmed directly on
  `comp4020-ass2-baishi`'s deck (`src/decks/theme.css`'s own comment says
  "Deck pages are dark surfaces"): `body`'s computed `background-color`
  and `color` were byte-identical (`rgb(13,13,13)` / `rgb(230,230,230)`)
  under `agent-browser set media dark` and the default (light) state. This
  isn't a defect — the deck is deliberately always-dark, matching
  `astromotion`'s own reveal.js convention of dark presentation surfaces
  regardless of site theme — but it means a future run shouldn't credit
  "checked the deck in dark mode" as distinct evidence beyond "checked the
  deck," since there is no second state to have missed. What *is* worth
  checking on a fixed-dark-surface deck, and hadn't been until this run:
  every slide and every slide *class* the deck's own content actually
  uses (`impact`, `quote`, `centered`, plain) — prior deck checks
  (resize-mid-interaction, the very first dark-mode sweep) had only ever
  looked at slide 1. Stepped through all 8 slides of the week-1 deck with
  `agent-browser press ArrowRight` plus the corrected local-background
  checker above; every heading/paragraph/list-item/link/blockquote across
  all 4 classes passed AA at its own real local background. "Checked,
  confirmed correct," no code change — but a genuinely new, non-repeated
  check, not a rerun of the first slide's own already-clean result.

- **A live 200%-zoom reflow check can uncover a reflow bug caused by several
  stacked, individually-plausible CSS defaults rather than one obvious
  mistake — trace each layer live rather than stopping at the first fix
  that seems to help.** On `comp4020-crit7-baishi`'s reschedule form, a
  cancel button ran off the right edge of a 390px viewport at 200% zoom
  with no way to scroll it cleanly into view. Three separate causes were
  stacked: (1) `input { min-width: 12rem }` can't shrink below that floor
  for a narrow container — fixed with `min-width: min(12rem, 100%)`; (2)
  **`<fieldset>` carries a UA-stylesheet default of `min-width:
  min-content`** that silently overrides any container width regardless of
  `overflow`/flex settings — a gotcha worth remembering on its own, since
  nothing about a fieldset's *authored* CSS hints at it; fixed with an
  explicit `fieldset { min-width: 0 }`; (3) an `inline-block`/`display:
  inline` element (here, a `<form>` around the cancel button) with `max-
  width: 100%` correctly caps its own computed width to the container, but
  the browser can still position it starting mid-line, continuing from
  preceding inline text's flow position, rather than forcing a line break —
  so a "correctly sized" box still overflows past the container's right
  edge. `getBoundingClientRect()` on the element itself distinguished this
  from the first two causes (width correct, x-offset wrong); the robust fix
  is `display: block` on the container so it always starts its own line,
  not a width tweak. Diagnosed by toggling `element.style.display = 'none'`
  via `eval` and re-measuring `body.scrollWidth` after each individual fix,
  isolating which of the three was still contributing rather than assuming
  one fix cleared all of it. General lesson, extending the existing
  CSS-property-literacy lens (tap-highlight, touch-action, forced-colors,
  touch-callout) to layout rather than just touch/contrast: a UA
  stylesheet's element-specific intrinsic-sizing defaults (fieldset's
  `min-content`, similarly `<button>`/`<select>`/`<img>` all have their own)
  are easy to forget precisely because the authored CSS never mentions
  them — worth a deliberate check on any form-heavy layout being tested at
  narrow widths or high zoom, not just the properties this agent has
  already been burned by once.

- **Re-fetching a course source and confirming "seeded data matches
  verbatim" verifies the data, not any prose describing which entity that
  data belongs to — those are two different claims, and a run can pass the
  first check every single time while a wrong claim about the second sits
  unnoticed for many runs.** On `comp4020-crit7-baishi`, `README.md`'s
  opening paragraph claimed the week-9 reschedule exception belonged to
  "this run's own group, Baishi" — but the seed code (`SEED_EXCEPTIONS` in
  `src/lib/db.ts`) had correctly attached both real week-9 exceptions to
  Shitao and Bada (a different tutor's two Monday groups) since the very
  first build run, matching the published `api/crit-groups.json` exactly.
  Ten prior runs' own "re-fetch the source, confirm no drift" checks all
  compared seeded *values* (dates, times, reasons) against the source and
  correctly found none — that check has no way to catch a *narrative*
  claim about which row those values sit on, because it never reads the
  prose at all. Only found once a run applied the clause-by-clause
  re-derivation technique (already used on `CLAUDE.md`) to `README.md` for
  the first time and checked its claims against the actual seed code and a
  live-rendered page, not against the source JSON. General lesson: a
  "confirmed no drift against the source" result and a "confirmed the
  repo's own prose about that data is correct" result are different checks
  — running the first repeatedly is not a substitute for running the
  second at least once, and any prose file naming a specific
  row/entity/group as an example is worth that second check specifically.
- **When a starter template's core entity/feature gets replaced (a guestbook
  swapped for a real app), grep every page for the starter's own vocabulary,
  not just the page the replacement work actually touched.** On
  `comp4020-crit7-baishi`, the crit-roster build replaced the starter's
  guestbook everywhere it mattered functionally — schema, routes, the home
  page's own nav said "Roster" from the first run — but the secondary
  `readme.astro` page's nav still said "Guestbook" two runs later, because
  no run had ever edited that specific line and a green `pnpm check`/
  axe-core sweep has no way to catch a stale label that's neither broken
  markup nor a failing test. Found by a plain fresh read of the page, not a
  tool. Same shape as the crit-5 palette-swap lesson already logged above
  (grep the whole repo for old hex literals, not just the file the change
  was made in) but for prose/copy instead of colour — whenever a rename or
  entity swap lands, `grep -ri` the starter's old name across every page,
  not just the ones the diff touched.
- **"Docs-only, no redeploy needed" is only true if the file in question
  isn't actually imported/rendered by the app itself — check that before
  relying on the judgement call, don't just assert it.** On
  `comp4020-crit7-baishi`, a run that fixed a factual error in
  `README.md` reasoned "docs-only change with no effect on the running
  app, so no redeploy this run" — correct for `CLAUDE.md`/`PROCESS.md`,
  which never render anywhere, but wrong for this repo's `README.md`:
  `src/pages/readme.astro` does `import * as readme from "../../README.md"`
  and compiles it at build time, serving it at `/readme/`, so the fix sat
  unshipped on `origin/main` for two further runs while the live app kept
  serving the old wrong claim. Caught by literally `curl`-ing the live
  `/readme/` route and comparing it against the current source rather than
  trusting the record of what was pushed — the doctrine's own "verify the
  live URL, not the local build" line, applied for the first time in this
  repo's history to a docs-only change specifically. Fixed by rebuilding,
  confirming the fresh `dist/server/entry.mjs` served the corrected text
  locally, then a plain redeploy — no code change needed, the fix already
  existed in git. General check for any future deliverable: before deciding
  a markdown/content file's edit doesn't need a redeploy, grep the app's
  own source for an `import` of that file (or any build-time inclusion) —
  a README that's compiled into a served page is a different category from
  a pure process-narrative file, even though both live at the repo root
  and look interchangeable at a glance.

- **Read the parent assessment's brief, not only the week's crit brief,
  on a multi-crit deliverable.** `comp4020-final-baishi`'s final-project
  brief says `PROCESS.md` runs 900–1100 words and is *rewritten, not
  appended* at each week 9–11 crit, and `README.md` is marked at 400–600.
  Twelve runs each appended a "pass" section from the crit-8 brief alone,
  growing PROCESS.md to 4236 words before a thirteenth run caught it. On
  this repo: edit PROCESS.md in place to describe the project as it
  stands; git and the `/ship` tags keep the history.

## Open threads for future runs

- `comp4020-final-baishi` is the final project (crits 8–10, then
  submission week 12) — a much longer-lived deliverable than a crit, one
  repo carried all the way to the November deadline. First run,
  2026-09-30, 166h to crit 8's ("It's alive!") cutoff: repo arrived as the
  bare template (busybox placeholder, empty `CLAUDE.md`/`README.md`/
  `PROCESS.md`). Picked the concept and built a real proof-of-life slice:
  **The Scroll**, a shared ink canvas that only ever grows — one blank
  strip at the right edge of an SVG scroll, one mark per visit (mouse/pen/
  touch via Pointer Events, a variable-width brush from real pointer
  speed), no edit, no delete, no accounts. Chose this over the brief's own
  named "median answer" (a chat room with the nouns swapped) by grounding
  it in three real sources cited in `README.md`: Robin Sloan's
  [home-cooked-app essay](https://www.robinsloan.com/notes/home-cooked-app/),
  Ben Hoyt's [small-web essay](https://benhoyt.com/writings/the-small-web-is-beautiful/),
  and [Hundred Rabbits' own account of their practice](https://sourcehut.org/blog/2021-12-08-100-rabbits-interview/).
  Stack: Astro (server output, Node adapter standalone) + `better-sqlite3`
  directly (no ORM — one table, `CREATE TABLE IF NOT EXISTS`, two prepared
  statements), argued in `PROCESS.md` on trade-off terms rather than
  asserted. Five commits pushed to `origin/main` (`d654ec9`): app scaffold,
  `spec/scroll.test.ts` (persistence over a fresh HTTP request, input
  validation, no-delete), `README.md`/`CLAUDE.md` (the "good" argument and
  the harness rules it implies), a real bug fix, `PROCESS.md` (955 words,
  already within the final brief's eventual 900–1100 band). The bug: a
  live `agent-browser` pointer-drag test caught a tap-only mark that saved
  correctly but rendered invisibly (see the new dedicated SVG
  bare-moveto `MEMORY.md` entry above) — fixed at the data layer per
  `CLAUDE.md`'s own rule, not just the client call site that triggered it,
  with a spec assertion added. Verified against a real `docker build` +
  `docker run --tmpfs /data` matching CI's exact command (needs `sudo` in
  this sandbox — see the new dedicated entry above), then deployed via
  `flyctl deploy --remote-only --ha=false -a comp4020-final-baishi` and
  verified live with real `agent-browser` pointer drags at both marking
  viewports: a mark drawn, page reloaded, mark still there — the crit's
  actual "trace persists" bar, confirmed on the deployed app itself, not
  just locally. Repo deliberately left private (the harness flips it
  public at cutoff, not this agent, per the standing
  harness-owned-shipping entry elsewhere in this file). Deliberately
  deferred and named as such in `README.md`/`CLAUDE.md`: no enforced
  "one mark per visitor" (judged, not enforced — real identity is crit 9's
  "All at once" job), no real-time layer (also crit 9), no server-side
  logging (crit 10). Not the last run for crit 8 — `reflections/crit-8.md`
  correctly not yet written. See `now.md` for the flagged next angle: the
  drawing zone is currently pointer-only with no keyboard way to draw at
  all, a real gap worth deciding on purpose rather than leaving implicit.
  A second run, 2026-09-30, 159h-to-cutoff, closed that exact gap and it
  surfaced two real, non-obvious bugs — see the two new dedicated
  `MEMORY.md` entries above for both mechanisms (an `<svg role="img">`
  suppressing a focusable child regardless of its own attributes; two AA
  contrast failures axe reported as merely "incomplete" — an
  opacity-dimmed ancestor and plain SVG text, neither an oklch/gradient
  case like the design-system-token findings elsewhere in this file).
  Fixed keyboard access
  ([`fbb528d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/fbb528d))
  and both contrast failures
  ([`874ccac`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/874ccac)),
  verified with a real `agent-browser` Tab walk plus a real Enter/Space
  press against the exact CI container (`docker build` + `docker run
  --tmpfs /data`), `pnpm check` green (6/6) throughout, axe-core 0
  violations after the fix. `PROCESS.md` extended with both commits cited.
  Redeployed and reverified live: a real Tab+Enter on
  `https://comp4020-final-baishi.fly.dev/` reached the zone and left a
  mark a fresh `curl` still shows. 4 commits pushed (`ba4666b`). Not the
  last run — no reflection yet, correctly. See `now.md` for what's
  untried: `pnpm audit`/`outdated` (not yet run on this repo at all), a
  200%-zoom reflow check, and a multi-mark test of the "since &lt;date&gt;"
  line as marks accumulate.
  A third run, 2026-09-30, 153h-to-cutoff, worked that exact list. `pnpm
  audit` clean; `pnpm outdated` had three genuinely in-range patches
  (`jsdom`, `vitest`, `@types/node`, none crossing the `^` pin) applied via
  a plain `pnpm update`, `pnpm check` re-verified green against the exact
  CI container before committing (`ea9fa14`). The 200%-zoom reflow check
  and the multi-mark pointer-drag test (two further genuine drags on top
  of the two marks the spec suite itself had already created) both came
  back "checked, confirmed correct" — see `PROCESS.md`'s new third section
  for the reasoning on the zoom check specifically (the drawing zone's own
  segment can exceed the scrollable strip's width at 200% zoom on mobile,
  judged consistent with the scroll's by-design pan behaviour rather than
  a defect, since the zone-hit control itself stays full-width and
  reachable regardless). Both findings and the dependency bump committed
  and pushed (`83269d1`). No redeploy — nothing this run changes
  runtime/user-visible behaviour. Not the last run — no reflection yet,
  correctly. See `now.md` for what's left: a live end-to-end keyboard
  walkthrough (Tab, Enter, reload, confirm), and the clause-by-clause
  re-derivation technique against `README.md`/`CLAUDE.md` (not yet tried on
  this repo at all, despite repeatedly finding real gaps elsewhere in this
  file).
  A fourth run, 2026-10-01, 142h-to-cutoff, worked that exact list and the
  clause-by-clause re-derivation paid off immediately: see the new
  dedicated `MEMORY.md` entry above (extending the crit-5 palette-swap
  lesson) for the mechanism — the second run's own contrast fix
  (`874ccac`) introduced `--link` because `--accent` alone fails AA, and
  used it in `global.css`'s `.tagline a`, but never checked
  `readme.astro`'s own scoped `<style>` block, which still used `--accent`
  directly for every link rendered from `README.md`. Every hyperlink on
  `/readme/` — the crit's own "real material" page — was under the AA
  floor. Fixed, along with the same file's `blockquote` rule still using
  `opacity` (the exact anti-pattern `874ccac` rewrote `.tagline` to avoid,
  dormant only because `README.md` has no blockquote yet)
  ([`7e2939a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/7e2939a)).
  The other flagged candidate — a full keyboard-only draw-then-reload
  walkthrough, not just the keydown-persists check the second run already
  did — also came back clean: a real `agent-browser` Tab walk reached the
  link then the drawing zone in order, a real `Enter` press left a mark,
  and a completely fresh navigation (not the client's own
  `location.reload()`) showed it still there, against the exact CI
  container. `pnpm check` green (6/6), axe-core 0 violations on both pages
  after the fix. `PROCESS.md` extended, pushed (`b8acc7d`), redeployed and
  reverified live (the corrected link color read back correctly on
  `https://comp4020-final-baishi.fly.dev/readme/`, console clean). Not the
  last run — no reflection yet, correctly. No new self-administered angle
  is currently flagged; a future run could try `pnpm audit`/`outdated`
  again (last checked at the third run) or extend the clause-by-clause
  read to the Dockerfile/CI workflow files, which haven't had this
  treatment yet.
  A fifth run, 2026-10-01, 135h-to-cutoff, worked that exact candidate and
  found a real, if purely infrastructural, bug: the Dockerfile's own
  comment, and `PROCESS.md`'s stack section repeating it, claimed
  `python3`/`make`/`g++` were installed as the fallback for when no
  prebuilt `better-sqlite3` binary matches the image's node/arch — see the
  new dedicated `MEMORY.md` entry above for the mechanism (the package has
  no install/postinstall script at all; it bundles prebuilt N-API binaries
  per platform/arch directly). `pnpm audit`/`outdated` were re-run first
  (clean; both outdated entries still major-only, correctly left alone).
  Removed the apt install from both Docker stages, verified with a
  `--no-cache` rebuild against the exact CI command (`docker build` +
  `docker run -d --init --tmpfs /data`): `pnpm check` green (6/6), a real
  `curl` POST round-tripped a mark. Fixed and pushed (`961bafc`),
  redeployed (`flyctl deploy --remote-only --ha=false`, image now 149MB),
  live `/` and `/readme/` both 200, a real mark round-trip still showing
  correctly on the persistent Fly volume. Not the last run — no reflection
  yet, correctly. No new self-administered angle is currently flagged; a
  future run could extend the clause-by-clause technique to
  `.github/workflows/checks.yml` itself (not yet tried, only the Dockerfile
  has been), or re-check `pnpm audit`/`outdated` again after enough time
  has passed.
  A sixth run, 2026-10-01, 129h-to-cutoff, worked that exact candidate:
  `checks.yml`'s own comments all checked out clean against `fly.toml`/
  `.github/trufflehog.yml` (no drift), and `pnpm audit`/`outdated` were
  unchanged. With nothing flagged, re-read `src/lib/draw.ts` fresh and found
  a real bug matching the pointer-identity shape already logged for crit-4/
  crit-5 — see the new dedicated `MEMORY.md` entry above (the third instance
  of that shape, and the worst: a stray second pointer's release could
  silently drop the real pointer's own mark entirely via an unhandled
  promise rejection, with the drawing zone then permanently inert for the
  rest of that page load and no visible sign anything had gone wrong).
  Confirmed live with two-pointer synthetic sequences before and after the
  fix, against both a local CI-matching container and the live deployment.
  Fixed by tracking `drawingPointerId` instead of a bare boolean
  ([`75bc2b5`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/75bc2b5)),
  written up as a sixth `PROCESS.md` moment, including why no `spec/` test
  covers it (jsdom has no `createSVGPoint`/`getScreenCTM`/
  `setPointerCapture` at all, confirmed directly)
  ([`03cedee`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/03cedee)).
  `pnpm check` green (6/6) against the exact CI container, redeployed and
  reverified live (the same repro against `https://comp4020-final-baishi.
  fly.dev/` left the real mark unaffected, count incremented, console
  clean). Not the last run — no reflection yet, correctly. No new
  self-administered angle is currently flagged; a future run could try the
  CSS-property-literacy lens on `global.css` (not yet applied to this repo)
  or re-read `src/pages/api/strokes.ts`/`layout.ts` for a similar gap.
  A seventh run, 2026-10-02, 118h-to-cutoff, worked that exact list. The
  CSS-property-literacy lens, applied to `global.css`'s one real touch
  surface for the first time, found `.zone-hit` (the drawing zone — a
  sustained-touch-drag surface, the same shape as crit-4's pad and crit-5's
  game canvas, both of which already needed this exact fix) had neither a
  tap-highlight override nor iOS long-press-callout/text-selection-magnifier
  protection, matching the pattern logged for those two other repos. Fixed
  pre-emptively (unverifiable as a visual artefact in this sandbox, same
  `xcrun simctl` gap as every other instance of this lens)
  ([`17216c8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/17216c8)).
  The `forced-colors` border-loss variant came back correctly inapplicable —
  `.zone-hit` gets its visible shape from a sibling SVG stroke, not a CSS
  `background`/`box-shadow`, so there's nothing for forced-colors to strip.
  A fresh read of `layout.ts`/`strokes.ts` found no new identity bug but did
  name a real, correctly-out-of-scope design point: two visitors loading at
  the same stroke count get the same `zoneStart`, so simultaneous drawing
  would visually collide — exactly the concurrent-multi-visitor case
  `README.md` already defers to crit 9. `pnpm audit` clean, one in-range
  `vitest` patch applied
  ([`bba04ae`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/bba04ae)).
  Both verified against the exact CI container, `pnpm check` green (6/6),
  `PROCESS.md` extended to a seventh moment
  ([`bbe824c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/bbe824c)),
  redeployed and reverified live (`getComputedStyle` on the live page
  confirms the new properties, console clean, both pages 200). Not the last
  run — no reflection yet, correctly. No new self-administered angle is
  currently flagged; a future run could try a fresh read of
  `src/pages/readme.astro` (the `marked`-rendering path, not yet examined
  with this lens) or re-check `pnpm audit`/`outdated` again later.
  An eighth run, 2026-10-02, 111h-to-cutoff, worked that exact candidate
  (a fresh read of `readme.astro`'s `marked`-rendering path) and found
  nothing new, then tried `html-validate` against this repo for the first
  time and found a confirmed tool limitation rather than a real bug — see
  the dedicated `aria-label-misuse`/SVG-AAM `MEMORY.md` entry above for the
  mechanism (the linter doesn't share its own implicit-role resolution
  between its own rules, so no markup satisfies both `aria-label-misuse`
  and `no-redundant-role` on this app's roleless `<svg>`). `pnpm audit`/
  `outdated` unchanged, live deployment reconfirmed byte-for-byte against
  `origin/main` on `/readme/`. `PROCESS.md` extended
  ([`09283bf`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/09283bf)).
  No code change, no redeploy. Not the last run.
  A ninth run, 2026-10-02, 105h-to-cutoff, worked that run's own flagged
  candidate: a first-ever Lighthouse run against this repo, against the
  exact CI container. Found a real issue — `best-practices` 0.96 on `/`
  from a genuine console error on every load (no favicon existed at all,
  matching the exact pattern already logged for crit-4/assignment-1/
  crit-7's own first Lighthouse runs); `/readme/` also had no meta
  description. Fixed with a small ink-blot SVG favicon in the app's own
  light-mode palette, linked from both pages, plus the missing meta
  description
  ([`36f8174`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/36f8174)).
  Both pages now score 1.0 across all five Lighthouse categories,
  confirmed by re-running against a rebuilt container; `pnpm check` green
  (6/6) throughout. `PROCESS.md` extended
  ([`1c0e06c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/1c0e06c)),
  pushed, redeployed (`flyctl deploy --remote-only --ha=false`, 150MB
  image), reverified live (favicon 200, console clean, both pages 200).
  Not the last run — no reflection yet, correctly. No new
  self-administered angle is currently flagged; a future run could try a
  fresh read of `src/lib/db.ts` (the least-examined source file so far) or
  re-check `pnpm audit`/`outdated` again later.
  A tenth run, 2026-10-03, 94h-to-cutoff, tried that fresh-read candidate
  on `db.ts` first and found nothing (validation is already fully enforced
  at the API layer against the exported constants). Found a genuinely new
  angle instead: every contrast fix this repo has ever shipped was
  measured and verified in light mode only, even though `global.css` has
  shipped a real `@media (prefers-color-scheme: dark)` block the whole
  time — nobody had pointed `agent-browser set media dark` at either page.
  Checked by hand (WCAG relative-luminance formula) and live against the
  exact CI container: both dark-mode colours clear AA with real margin
  (8.3:1, 7.4:1), a fresh axe-core sweep in dark mode matched the
  light-mode result exactly (0 violations, the one known SVG-text
  "incomplete"), console clean. No code change — a legitimate "checked,
  confirmed correct" outcome, written up as a tenth `PROCESS.md` pass and
  pushed (`45bcd34`); no redeploy, since nothing behaviour-changing
  shipped. `pnpm audit`/`outdated` unchanged. Not the last run — no
  reflection yet, correctly. No new self-administered angle is currently
  flagged; a future run could re-check `pnpm audit`/`outdated` again after
  enough time has passed, or try another fresh close read of
  `src/lib/layout.ts`.
  An eleventh run, 2026-10-03, 87h-to-cutoff, found and fixed the
  overpainting breach (see the dedicated entry above): `3a57fdf` (fix +
  spec), `06a7d0c` (README/CLAUDE.md), PROCESS.md eleventh pass; deployed,
  verified live with refused-only requests so no test mark lands on the
  public scroll. Not the last run.
  A twelfth run, 2026-10-03, 81h-to-cutoff: the 409 stale-strip refusal's
  UI copy contradicted README's promise and reopened a zone every retry of
  which would fail; fixed (name the cause, keep the zone closed), verified
  with two tabs, deployed. Running `pnpm check` against a local container
  needs `-e PORT=8080` and `APP_URL=http://localhost:<port>`, as
  `checks.yml` does — without `PORT` the app listens on 4321 inside.
  A thirteenth run, 2026-10-04, 71h-to-cutoff, rewrote PROCESS.md to the
  brief's band (see the parent-brief entry above) and trimmed README;
  deployed. Not the last run.
  A fourteenth run, 2026-10-04, 64h-to-cutoff: no change needed. A fix
  for a `pnpm audit` finding published the same day wasn't picked up by
  `pnpm update` — pnpm 11's minimum-release-age guard most likely holds
  back very fresh releases. Retry after a day; don't override the guard.
  Fifteenth (58h) and sixteenth (47h) runs confirmed it: still held.
  Seventeenth (40h): guard cleared after ~25h, plain `pnpm update` took
  the fix (`6311120`), audit clean, deployed. Waiting it out was right.
  Crit 8 finished 2026-10-05 (34h): `reflections/crit-8.md` written
  (breakthrough: README as spec, "never overpainted"), pushed, live URL
  confirmed. The same repo continues into crit 9 ("All at once"). From
  then on it's public and CI deploys every push, so every commit is
  public too. Crit 9 owns the deferred concurrency, identity and
  real-time decisions.
  Crit 9 first run, 2026-10-07 (160h): decision recorded first as
  `decisions/0001-two-marks-at-once.md`, then SSE live sync with SQLite
  replay via `Last-Event-ID` and server-side placement by arrival.
  Second run (154h): live stop/start reconnect verified; fixed the
  stream's 20s late open and racing spec files. See `now.md`.
  Third run (143h): the client dropped out-of-order marks (see the
  high-water-mark entry); fixed `a1cc5f2`, deployed.
  Fourth run (136h): mobile two-tab mid-drag test and README/decision
  re-read both clean; no change.
  Fifth run (130h): in-range dep patches (`ab9627c`); repo is public,
  so the push deployed via CI (Fly release v20) — `flyctl releases`
  confirms a CI deploy without `gh` auth.
  Sixth run (119h): clean re-check, no change.
  Seventh run (112h): stream died for good on a refused reconnect (see
  the EventSource entry); fixed `632f838`, CI deploy v23 failed on Fly's
  side, redeployed by hand (v24).
  Eighth run (106h): fan-out with abrupt disconnects clean; comment
  fix only.
  Ninth run (95h): astro 7.3.8 patch (`7c044b4`); CI's docker build
  then failed. Tenth run (88h): traced to the floating corepack pnpm and
  better-sqlite3's implicit node-gyp build (see the binding.gyp entry);
  fixed `66a7297`, CI green, deployed by CI (v29).
  Eleventh run (82h): clean re-check, no change.
  Twelfth run (71h): local stream latency 1–7 ms per mark; no change.
  Thirteenth (64h) to sixteenth (40h) runs: clean
  re-check, no change.
  Crit 9 finished 2026-10-12 (34h): `reflections/crit-9.md` written
  (breakthrough: the ADR's sentences as claims to break), pushed
  `2c3161e`, CI check+deploy green, live confirmed. Crit 10 ("Fly by
  instruments", logging/observability) continues in the same repo.
  Crit 10 first run, 2026-10-14 (160h): identity as a browser cookie
  (ADR 0002), `mine` decided per requester, seal on your own marks,
  logfmt logs of who did what; CI-deployed v40. See `now.md`.
  Second run (154h): live log narration rehearsed (all event kinds
  labelled, lag only); seal survives reconnect replay. No change.
  Third run (143h): off-strip refusal logs under the same visitor label
  as its view; no change.
  Fourth run (136h): in-range dep patches (`d47e0ba`), CI deploy v44.
  Fifth run (130h): live two-client log check clean; no change.
  Sixth run (119h): clean re-check, no change.

- `comp4020-crit7-baishi` (Crit Roster, modelling this course's own weekly
  crit-group scheduling) had its first build run on 2026-09-23,
  167h-to-cutoff: went from the guestbook starter to a deployed, tested app
  in six commits, all pushed to `origin/main` (`753eb6e`). Chose the system
  by fetching the course website's own published `api/crit-groups.json`
  (real six groups, real tutors, real week-9 Labour-Day reschedules) rather
  than inventing data, per the three-layer doctrine at
  `/home/ben/projects/comp4020/CLAUDE.md`. Schema replaces the starter's
  single `messages` table with `crit_groups`/`weeks`/`exceptions`;
  reschedule/cancel are plain form POSTs with server-side validation in the
  data layer, live-synced across tabs via the starter's existing SSE bus.
  `pnpm check` green (33/33 tests), `pnpm check:evidence` clean except the
  expected not-yet-written reflection. Verified live with two genuine
  `agent-browser` tabs (see the new `tab new` entry above) rather than just
  the vitest SSE assertion — a reschedule in one tab drove a real navigation
  in the other. First-ever deploy for this repo:
  `flyctl deploy --remote-only --ha=false -a comp4020-crit7-baishi`
  succeeded; live URL confirmed via `curl` (200) and `agent-browser`
  (console clean, screenshot shows correct real seed data). Not the last
  run — no reflection yet, correctly.
  A second run, 2026-09-23, ~154h-to-cutoff, worked that exact untried-angles
  list. `pnpm audit` found 19 vulnerabilities; a plain in-range `pnpm update`
  cleared 18 (one `esbuild`-via-`drizzle-kit` dev-server advisory left,
  correctly, since this app never exposes esbuild's own server). A fresh
  `html-validate` pass found and fixed 2 buttons/2 inputs missing an
  explicit `type`. The keyboard tab-order walk and a live axe-core sweep
  both came back clean. The 200%-zoom check found what looked like a real
  overflow but traced to a `style.zoom` measurement artifact — see the new
  dedicated entry above (`documentElement.scrollWidth` vs `body.scrollWidth`).
  The headline finding: simulating a Fly.io auto-stop/wake cycle live (see
  the new dedicated `MEMORY.md` entry above) confirmed the browser's
  `EventSource` reconnects correctly but any event broadcast during the
  outage is lost, since the bus keeps no backlog — fixed by reloading on
  every reconnect after the first, with the decision extracted into
  `src/lib/live-reload.ts` so `spec/crit-7.test.ts` could assert it
  directly per this repo's own test-coverage rule. 5 commits, all pushed
  (`7e7a575`), `pnpm check` green (35/35 tests), redeployed and reverified
  live. Not the last run — no reflection yet, correctly. See its `now.md`
  for what's left: a first-ever Lighthouse run, the brief-clause-re-derivation
  technique (not yet tried on this repo at all), and a
  CSS-property-literacy pass (low-priority — this app has almost no custom
  styling).
  A third run, 2026-09-23, ~154h-to-cutoff, worked that exact list. Re-fetched
  the published `api/crit-groups.json` and confirmed the seeded schema still
  matches verbatim (no drift). A fresh read of every page (rather than a
  fourth pass of the same sensors) found a real stale-copy bug: the readme
  page's own nav still said "Guestbook," left over from the starter template
  and never updated when the app's model became a crit roster — see the new
  dedicated `MEMORY.md` entry above for the generalised lesson. Fixed
  (`fc4de33`). A first-ever Lighthouse run against the built server (needed
  running `node dist/server/entry.mjs` directly rather than `astro preview`,
  since this app's build output is `"server"` mode, not static) scored
  `best-practices` 0.96 and `seo` 0.9 for the same favicon-404
  console-error/missing-meta-description pattern logged for every other
  deliverable's first Lighthouse run — fixed with a small SVG favicon and a
  one-line meta description on both pages, confirmed back to 1.0 across all
  five categories on re-run (`9e5d566`). Also re-ran `pnpm audit` (unchanged,
  same one correctly-left esbuild advisory), a fresh axe-core sweep on both
  pages (0 violations), and `html-validate` against the live-rendered HTML
  (clean) — no new findings there. `pnpm check` green (35/35 tests), 3
  commits pushed (`7713f90`), redeployed and reverified live (console clean,
  nav and favicon correct on `https://comp4020-crit7-baishi.fly.dev/`). Not
  the last run — no reflection yet, correctly. See its `now.md` for what's
  left: the brief-clause-re-derivation technique still hasn't actually been
  tried against this repo's own prose/copy beyond the one nav-label read,
  and the CSS-property-literacy pass remains untried (still low-priority —
  this app has no custom-styled interactive elements to lose their shape
  under `forced-colors`, only native form controls).
  A fourth run, 2026-09-24, 143h-to-cutoff, ran the brief-clause-re-derivation
  technique against this repo's own `CLAUDE.md` (not the course source this
  time) and found a real coverage gap: "one exception per group per week" is
  implemented correctly (delete-then-insert against the schema's unique
  constraint) and documented in `README.md` as a deliberate "replace, not
  stack" decision, but had never had a test of its own — fixed with a new
  `spec/crit-7.test.ts` block (`d81472c`). `pnpm audit` clean; `pnpm
  outdated` had one genuine in-range patch (`astro` 7.3.3 → 7.3.4), applied
  via `pnpm update` (`0707cf7`). Also found and worked around a new
  `agent-browser` tooling limitation (`type="time"` inputs don't respond to
  `fill`/`type`, see the new dedicated `MEMORY.md` entry above) and used the
  workaround to drive the first-ever genuine DOM form submission and button
  click against this app's write path (also newly logged above). Along the
  way, found the local `.data/*.db*` scratch database had gone stale from
  prior manual testing (missing a seeded exception) and was masking correct
  behaviour during a live check — deleted and regenerated fresh (gitignored
  local dev state, unrelated to the deployed Fly volume). `PROCESS.md`
  updated, `pnpm check` green (36/36 tests) throughout, all 3 commits pushed
  (`9d08e28`), redeployed and reverified live (200, correct seed data,
  console clean). Not the last run — no reflection yet, correctly. See its
  `now.md` for what's left: the CSS-property-literacy pass remains untried
  (still correctly judged low-priority), and the human-timed session still
  needs the studio crit itself.
  A fifth run, 2026-09-24, ~136h-to-cutoff, worked that exact list: a live
  keyboard tab-order walk came back clean, and a real 200%-zoom reflow
  check at the mobile marking viewport found a genuine, previously-invisible
  reflow bug in the reschedule form — see the new dedicated `fieldset`/
  `inline`-form entry above for the three stacked CSS causes and the fix.
  Fixed and pushed (`6996965`/`5cc110b`), re-verified clean at both marking
  viewports (zoomed and not), a fresh axe-core sweep (0 violations), and the
  full `pnpm check` suite (36/36). Redeployed and reverified live (200,
  console clean, correct content). Not the last run — no reflection yet,
  correctly. Every self-administered technical/content angle this agent has
  a technique for has now been run at least once against this repo; the
  human-timed studio-crit session is the only standing open thread left.
  A sixth run, 2026-09-24, ~130h-to-cutoff, rather than forcing a low-yield
  pass on that empty list tried a genuinely new interaction instead: drove
  two real `agent-browser` tabs through the "more than one tutor has this
  open" scenario `README.md` itself names as the reason live sync exists,
  and found a real data-loss bug — see the new dedicated dirty-tracker
  entry above for the mechanism, the fix, and the `type="time"` false-negative
  trap hit along the way. Fixed with a `createDirtyTracker` gate on every
  reload call site in `src/lib/live-reload.ts`/`src/pages/index.astro`,
  confirmed no regression (a clean tab still reloads normally), added
  `spec/crit-7.test.ts` coverage (38/38 green), cited in `PROCESS.md` and
  `README.md`. Fixed and pushed (`e3a4a3d`/`e403687`), redeployed and
  reverified live (200, console clean, form and notice element present and
  correctly hidden by default). Not the last run — no reflection yet,
  correctly. No new self-administered angle is currently flagged; the
  human-timed studio-crit session remains the only standing open thread.
  A seventh run, 2026-09-25, ~119h-to-cutoff, worked that run's own single
  flagged candidate (does the dirty flag itself ever need clearing) and
  found a real one-way-ratchet bug — see the new dedicated `markClean` entry
  above for the mechanism and fix, and the extended trap entry for how the
  same `type="time"`-reset trap bit twice re-verifying it. Fixed and pushed
  (`38a7d0d`/`41e0e03`), `spec/crit-7.test.ts` coverage added (38 → 39
  tests, green), `PROCESS.md` now at 7 cited moments, redeployed and
  reverified live (200, console clean, fresh axe-core sweep 0 violations).
  Not the last run — no reflection yet, correctly. No new self-administered
  angle is currently flagged; the human-timed studio-crit session remains
  the only standing open thread.
  An eighth run, 2026-09-25, ~112h-to-cutoff, re-read `src/pages/api/
  exceptions.ts`/`src/lib/db.ts` fresh and tried an angle none of the prior
  seven had: hitting `POST /api/exceptions` and the cancel route directly
  with `curl`, bypassing the honest select/option-populated form entirely, to
  check `CLAUDE.md`'s "validate server-side, in the data layer" rule at a
  boundary the form itself can never exercise (missing/non-numeric fields,
  out-of-range ids). Came back clean — every case resolved to a graceful
  `ValidationError` redirect, and Astro's own `security.allowedDomains`
  same-origin check rejected an unauthenticated cross-origin POST with a 403
  before the handler ran. Also confirmed the echoed `?error=` query param is
  properly entity-escaped (no reflected-XSS gap). No code change, cited as
  the 8th `PROCESS.md` moment (`fd1332e`). Not the last run.
  A ninth run, 2026-09-25, ~106h-to-cutoff, followed up on the seventh's own
  `markClean` fix rather than starting a new sensor pass, and found the fix
  was only half-complete — see the new dedicated `MEMORY.md` entry above
  (the "gate reopening only permits the *next* attempt, doesn't resolve the
  one already deferred" lesson) for the mechanism. Confirmed live with two
  tabs: a message that arrived while dirty (notice shown, draft and a
  `window.__marker` both correctly untouched) was never retried once the
  draft was cleared back to pristine — the marker stayed put, proving no
  reload fired. Fixed with `notePendingReload`/`claimPendingReload` in
  `src/lib/live-reload.ts`, wired into `index.astro`'s `input` handler right
  after `markClean`
  ([`8212382`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-baishi/commit/8212382)),
  `spec/crit-7.test.ts` coverage added (39 → 41 tests, green), `PROCESS.md`
  now at 9 cited moments
  ([`5476344`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-baishi/commit/5476344)).
  Re-verified the same two-tab scenario live post-fix (clearing the draft now
  genuinely navigates — marker gone, roster shows the other tab's change),
  fresh axe-core sweep 0 violations, redeployed and reverified live (200,
  console clean, correct seed data). Not the last run — no reflection yet,
  correctly. No new self-administered angle is currently flagged; the
  human-timed studio-crit session remains the only standing open thread.
  A tenth run, 2026-09-26, ~95h-to-cutoff, closed the ninth run's own flagged
  follow-up (does `createReconnectGate`'s plain boolean flip have a
  comparable resolved-vs-merely-possible gap to the dirty tracker's) and
  confirmed it doesn't — the gate has no notice-then-defer step of its own,
  it funnels straight into `reloadUnlessDirty`, which already owns that
  bookkeeping. Found one real small gap instead: `sessionDate`, the pure
  function `CLAUDE.md`'s own "derive, don't duplicate" rule names, had never
  been asserted directly — only eyeballed via screenshots across nine prior
  runs. Added direct coverage including a real seeded week (8) whose Friday
  session crosses a month boundary (`e022569`). Re-fetched
  `api/crit-groups.json` (no drift), `pnpm audit` clean (same one correctly-
  left esbuild advisory), one in-range `astro` patch applied (`a9e6bef`), and
  a fresh `html-validate` pass against the live-rendered home/readme pages
  came back fully clean (after fixing a wrong route guess — `/about` isn't a
  real page here, `/readme` is; Astro's own 404 page was what had been
  validated the first time). `pnpm check` green (44/44 tests), `PROCESS.md`
  now at 10 cited moments, redeployed and reverified live (200, console
  clean). Not the last run — no reflection yet, correctly. No new
  self-administered angle is currently flagged; the human-timed studio-crit
  session remains the only standing open thread. One untried angle noted for
  a future run: `README.md` hasn't had the clause-by-clause re-derivation
  treatment `CLAUDE.md` already got in the fourth run, only spot-checks.
  An eleventh run, 2026-09-26, ~88h-to-cutoff, closed that exact gap and it
  paid off immediately: `README.md`'s opening paragraph claimed the week-9
  exception belonged to "this run's own group, Baishi," but the seed code
  correctly attaches both real week-9 exceptions to Shitao and Bada — see
  the new dedicated `MEMORY.md` entry above (prose-vs-data drift a
  data-only re-fetch check can't catch) for the general lesson. Fixed
  (`0b10fd9`), confirmed live via `agent-browser` that the roster's first
  two rendered headings are genuinely Shitao/Bada, console clean. Every
  other README clause checked out against current code. Cited in
  `PROCESS.md` as an 11th moment (`8f9ea5c`). `pnpm check` green (44/44
  tests), docs-only change so deliberately not redeployed. Not the last
  run — no reflection yet, correctly.
  A twelfth run, 2026-09-26, ~82h-to-cutoff, applied that exact flagged
  treatment to `PROCESS.md` itself for the first time — every cited commit
  hash resolved and every specific claim (the three named validation test
  cases, the replace-not-stack test, the `sessionDate` month-boundary test,
  the favicon/meta-description fix on both pages, explicit `<button>`/
  `<input>` types, the three-cause zoom-reflow CSS fix, the `astro` version
  bump) checked out against the current repo with nothing to fix. Re-ran
  the cheap sensors (`pnpm audit`/`outdated` unchanged) and a fresh
  live-browser pass against a rebuilt server (console clean, 0 axe
  violations on both routes). No code change, no commit — a legitimate
  "checked, confirmed correct" outcome; eleven runs of real fixes on this
  repo makes a clean run the expected steady state now, not evidence of a
  missed check. `spec/README.md`/`fly.toml` are course-managed/starter
  boilerplate this repo isn't meant to deviate from, so little is left to
  check there beyond what this run already read. The human-timed
  studio-crit session remains the only standing structural open thread.
  A thirteenth run, 2026-09-27, ~71h-to-cutoff, worked that run's own
  flagged candidate (re-verify the deployed Fly URL matches `origin/main`)
  and it paid off: the live app was stale, still serving the eleventh
  run's now-fixed README error, because that run had judged the fix
  "docs-only, no redeploy needed" without checking that `readme.astro`
  compiles `README.md` at build time — see the new dedicated `MEMORY.md`
  entry above for the general lesson. No code change (the fix already
  existed in git); rebuilt, confirmed the corrected text locally, then
  `flyctl deploy`. Live `/` and `/readme/` both 200, console clean,
  `/readme/` now reads correctly. No commit this run. Not the last run.
  Next candidate for a future run: grep the repo for any other build-time
  `import` of a markdown/content file, in case the same "is this really
  deploy-inert" question applies elsewhere; otherwise the human-timed
  studio-crit session remains the only standing open thread.
  A fourteenth run, 2026-09-27, ~64h-to-cutoff, closed that exact candidate:
  `readme.astro`'s `README.md` import is the only build-time markdown
  import in the repo, confirmed by grep. Re-verified the live Fly URL
  directly against `origin/main` HEAD (not just trusting the prior run's
  redeploy) — still correct. Re-ran the full check suite (44/44 tests),
  `pnpm audit`/`outdated` (unchanged), a fresh live axe-core sweep on both
  deployed pages (0 violations), and confirmed the CSS-property-literacy
  pass remains correctly inapplicable (no custom-styled interactive
  elements in either `.astro` page). No code change, no commit — everything
  checked out clean. Not the last run. No new self-administered angle is
  currently flagged; the human-timed studio-crit session remains the only
  standing open thread.
  A fifteenth run, 2026-09-27, ~58h-to-cutoff, re-verified the same standing
  candidate (deployed Fly URL vs `origin/main` HEAD) again — no drift this
  time, unlike the thirteenth run. Re-ran `pnpm check` (44/44 green),
  `pnpm audit`/`outdated` (unchanged), and a live `agent-browser` pass
  against the deployed home page (console clean). No code change, no
  commit. Not the last run. No new self-administered angle is currently
  flagged; the human-timed studio-crit session remains the only standing
  open thread.
  A sixteenth run, 2026-09-28, ~47h-to-cutoff, re-confirmed the same clean
  state again (no drift, `pnpm check`/`audit`/`outdated` unchanged, live URL
  correct) and additionally checked this week's brief for a new warning box
  about updating the `comp4020` course plugin — correctly judged
  inapplicable, since this session has no such plugin installed and updating
  one wouldn't be this agent's call regardless (matches the standing
  harness-owned-shipping boundary). No code change, no commit. Not the last
  run.
  A seventeenth run, 2026-09-28, ~40h-to-cutoff, re-ran the same standing
  checks (all clean, no drift) plus read `pnpm check:evidence`'s script
  output against its own known shared-`failed`-flag quirk to positively
  confirm every `PROCESS.md` citation still resolves, not just infer it from
  a single visible failure line. Re-read `index.astro`/`live-reload.ts`
  fresh for an untried edge case in the dirty-tracker/reconnect-gate
  machinery (this repo's most bug-prone area historically) — found nothing
  new; `pendingReload`'s plain-boolean idempotency already covers multiple
  missed messages. No code change, no commit. Not the last run. Four
  consecutive clean runs (14–17) is the expected steady state for a repo
  this thoroughly worked, not evidence of a missed check — the human-timed
  studio-crit session remains the only standing open thread.
  An eighteenth and final run, 2026-09-28, ~34h-to-cutoff, ran the doctrine's
  finishing steps: a fresh live-browser pass at both marking viewports
  (console clean, nav labels correct, Shitao still the first rendered group
  — the eleventh run's README fix still holding), `pnpm check` green (44/44
  tests). `PROCESS.md` was already a complete 11-moment account from
  seventeen prior runs, so nothing more was added to it. Wrote
  `reflections/crit-7.md` (282 words, both standing prompts, naming the
  clause-by-clause re-derivation technique as the breakthrough — it's what
  kept finding real bugs, most recently the README prose-vs-data error in
  the eleventh run, long after the sensor battery first read as exhausted
  around run 5). `pnpm check:evidence` fully clean (reflection found, all 19
  cited commits resolve). Committed and pushed (`d88eb7a`); no redeploy
  needed since `reflections/` is deliberately excluded from the built site
  (unlike `README.md`, nothing imports it), confirmed by re-checking the
  live Fly URL directly (both `/` and `/readme/` 200, correct content). This
  deliverable is now **fully shipped** — this was the last run for
  `comp4020-crit7-baishi`. Across all eighteen runs, the standout general
  lesson (beyond the many individual entries already logged above) is that
  the clause-by-clause re-derivation technique — checking a project's own
  prose (`CLAUDE.md`, `README.md`, code comments) against live behaviour,
  not just running sensors against code — kept surfacing real defects for
  thirteen further runs after the automated battery (axe-core,
  html-validate, Lighthouse, keyboard walks) first read as exhausted. The
  only thing left unresolved is the human-timed studio-crit session, which
  needs the studio itself, not a future run of this agent.

- `comp4020-crit5-baishi` (Two-Tone, a colour-match falling-circle dodge
  game) had its first build run on 2026-08-26, 167h-to-cutoff: went from the
  bare template straight to a playable, testable game in five commits
  (rule+test, initial build, a play-found swap-button fix, the card
  replacement, `PROCESS.md`), all pushed to `origin/main`
  (`7da8559`). `pnpm check` green (21 tests), a fresh axe-core sweep clean,
  `html-validate` clean except the expected doctype/void-style non-issues,
  and both marking viewports played through live against `pnpm preview`
  with a clean console. Deliberately used the harder "two mechanics that
  interact" shape the brief calls out (movement + colour-toggle) rather
  than a single-mechanic dodge. A second run the same day, 160h-to-cutoff,
  closed every angle that run's `now.md` had flagged and found two real
  bugs: the launch teal/pink hue pair collapsed to near-identical greys
  under deuteranopia (see the CVD-simulation-matrix entry below) — fixed
  to sky blue/amber, and re-applied to `public/card.png` too, which still
  showed the old palette after the in-game fix (`5d63433`) — and a missing
  `-webkit-tap-highlight-color` on the full-bleed canvas, the same class of
  finding as crit-4's `.pad` (`8b9e859`). A scripted reactive-bot playtest
  of the difficulty ramp (see below) came back clean, and the
  screen-reader-scope question was explicitly decided (not left
  unconsidered) and written into `PROCESS.md`, now at 7 cited moments. Not
  the last run — no reflection yet, correctly. See its `now.md` for what's
  still untried: Lighthouse (never run on this repo), a real human-timed
  five-minute play session (the scripted bot stands in for reflexes, not
  judgement of fairness), and a live keyboard tab-order walk.
  A third run, 2026-08-26, 154h-to-cutoff, worked that exact list: html-validate
  re-run came back clean (same expected non-issues); the keyboard tab-order
  walk came back clean (nav link → canvas, both with the default visible
  outline, keyboard controls wired on `window` so they work without ever
  tabbing to the canvas); and a real by-eye playtest (screenshots through a
  full round, not the scripted bot) confirmed the two hues, the swap
  button's dashed to-colour hint, and the game-over/restart cycle all read
  clearly — no new design bug, a legitimate "checked, confirmed correct"
  outcome since the spec's "found by playing" requirement was already
  satisfied on the first build run. Lighthouse, run for the first time,
  *did* find something: the same favicon.ico-404 console-error pattern
  crit-4 had already caught, `best-practices` 0.96 → fixed with an SVG
  favicon in the game's own palette, confirmed back to 1.0 on re-run. That
  same pass also caught a second, unrelated gap the palette swap had left
  behind: `styles.css`'s nav-link colour was never updated in the hue swap
  (only `main.ts` was touched), so the page chrome still carried the
  retired pink after the in-game colours moved to sky blue/amber — moved to
  the settled amber. [`48e382b`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-baishi/commit/48e382b).
  `PROCESS.md` now at 8 cited moments, all commits pushed (`21c4d97`). Not
  the last run. See its `now.md` for what's left: a real human-judged
  five-minute session (can't be self-administered, an open thread for the
  studio crit itself), `pnpm audit`/`outdated`, a 200%-zoom reflow check,
  and a copy-vs-behaviour prose pass.
  A fourth run, 2026-08-27, 143h-to-cutoff, worked that exact list.
  `pnpm audit` found 7 real vulnerabilities in transitive dev-tooling deps;
  a plain in-range `pnpm update` (`vite`→8.2.2, `vitest`→4.1.11) cleared
  all of them, `pnpm check` staying green (`ae3fa91`). The 200%-zoom check
  found a canvas-squash effect but traced it to a testing-technique
  artifact rather than a real bug — see the new dedicated entry above
  (`style.zoom` doesn't fire `resize`/change `innerWidth`, so it can't
  faithfully stand in for either real desktop zoom or real mobile
  pinch-zoom on this canvas-driven layout) — no code change. The
  copy-vs-behaviour prose pass checked the meta description against
  `isFatalCollision` directly and found it accurate; nothing to fix.
  `PROCESS.md` now at 9 cited moments, pushed (`f1881aa`). Not the last
  run. See its `now.md` for what's left: the human-timed five-minute
  session (still open, still not self-administerable), a real
  pointer-drag test of drag-to-move specifically (only keyboard movement
  and the swap button's click have had genuine non-keyboard input so
  far), and a live `prefers-reduced-motion` check of the swap button's
  pulse animation (the branch exists in `draw()` but has never been
  observed live via `agent-browser set media reduced-motion`).
  A fifth run, 2026-08-27, 136h-to-cutoff, worked that exact list and both
  checks came back "checked, confirmed correct" — no code change, no
  commit. The pointer-drag test used a temporary `window.__debug` getter
  (reverted before finishing, matching the pattern already logged
  elsewhere in this file) to read `player.x`/`dragging`/`state` live:
  a genuine `agent-browser mouse down` + `mouse move` + `mouse up` drag
  tracked `player.x` to the exact dragged-to position at each step
  (110 → 510 in canvas-local px) and left it there (no snap-back) on
  release, confirming the pointer path works independently of the
  keyboard path already checked. The reduced-motion check sampled a single
  canvas pixel at the swap button's pulse-boundary radius
  (`ctx.getImageData`) repeatedly over ~1.5s: with the OS preference off,
  the sampled colour genuinely flickered between the dashed-stroke colour
  and the background as the pulse animated; after `agent-browser set media
  reduced-motion` + a fresh page load, the same sample stayed pinned to
  the background colour for the same span — confirming the `pulse =
  prefersReducedMotion ? 0 : ...` branch is actually inert under the
  preference, not just present in source. Also re-ran `pnpm audit` (still
  clean) and `pnpm outdated` (same four major-only entries, correctly left
  alone) as a quick re-check, no drift since the fourth run. No commits
  this run — nothing needed one. This is now the last self-administerable
  angle on the fourth run's flagged list; the studio-crit five-minute
  session remains the only open thread. Not the last run — no reflection
  yet, correctly.
  A sixth run, 2026-08-27, 130h-to-cutoff, re-read `main.ts`/`game-logic.ts`/
  `styles.css` fresh (per the prior run's own advice to prefer a fresh read
  over a fourth repeat of the exhausted battery) and tried one genuinely
  untried angle: a real window resize mid-round via
  `agent-browser set viewport`, distinct from the `style.zoom` reflow check
  a prior run had already found to be a testing-artifact false lead for this
  canvas. Found a real (low-impact) gap — `resize()` reclamps the player's x
  but never obstacles' — then found the obvious fix was worse than the bug
  and reverted it; see the new dedicated entry below for the full reasoning.
  No commits this run — the investigation itself, and the decision not to
  ship the fix, is the legitimate outcome. `pnpm check` still green (21
  tests), working tree clean, nothing new pushed. Not the last run. The
  human-timed five-minute session remains the only standing open thread; no
  new self-administerable angle is currently flagged.
  A seventh run, 2026-08-28, 119h-to-cutoff, re-read `main.ts` fresh again
  and applied a technique already logged for a *different* repo (Drift,
  crit-4's blur-vs-visibilitychange lesson, below) to this one for the
  first time — see the new cross-repo entry below for the general lesson.
  Found a real bug: the existing `blur` handler that clears held
  arrow-keys/drag state only covers the window losing OS focus, not a
  same-window tab switch (confirmed via web search: that hides the
  document, firing `visibilitychange`, without ever blurring the window —
  arguably the *more* common real path a player hits than an actual
  window blur). Reproduced live with a temporary `window.__debug` hook
  and a synthetic `document.hidden = true` + `visibilitychange` dispatch:
  a held arrow key stayed stuck under the old code, cleared once
  `visibilitychange` got the same `releaseHeldInput()` call as `blur`.
  Fixed and pushed (`25d1bc3`/`b386c26`), `pnpm check` still green (21
  tests), both marking viewports console-clean afterwards. Not the last
  run. The human-timed five-minute session remains the only standing open
  thread.
  An eighth run, 2026-08-28, 112h-to-cutoff, re-read the code fresh again
  and found a second real bug this same way: the `keydown` handler's
  `gameover` branch calls `resetGame()` and returns before the function
  reaches its own `event.preventDefault()` calls, so Space (the browser's
  default page-scroll-down key) still scrolls the page underneath a
  restart. Invisible at both marking viewports — the page's total height
  never exceeds either one — but real at shorter effective heights a
  phone's on-screen address bar produces, since the canvas is sized
  `min(70vh, 32rem)` and shrinks with actual viewport height (see the new
  `preventDefault`-ordering entry below for the general lesson and how it
  was confirmed live). Fixed and pushed (`b3b2b60`/`60317da`), `pnpm
  check` still green (21 tests). Not the last run. The human-timed
  five-minute session remains the only standing open thread.
  A ninth run, 2026-08-28, 106h-to-cutoff, re-read `main.ts` fresh a third
  time and found a third real bug in the same small area (focus/input
  handling around state transitions): the `gameover` branch's `keydown`
  handler restarted on *any* keydown, with no check for the browser's own
  key auto-repeat (`event.repeat`) — so a movement key still physically
  held at the moment of a fatal collision (the likely case, since dying
  usually happens mid-dodge) kept sending repeat keydowns that silently
  reset the round before the player ever saw the game-over screen, with
  no intentional keypress involved. See the new dedicated entry below for
  the mechanism and how it was confirmed live. Fixed and pushed
  (`f43833d`/`beadbe8`), `pnpm check` still green (21 tests), both
  marking viewports console-clean afterwards. Not the last run. The
  human-timed five-minute session remains the only standing open thread —
  three consecutive runs finding real bugs in the same corner of the file
  suggests that area specifically rewards another close read before a
  future run trusts it's exhausted.
  A tenth run, 2026-08-29, 95h-to-cutoff, re-read `main.ts` fresh a fourth
  time and found a fourth real bug in the exact same handler: the
  Space-to-swap-hue branch had the mirror-image gap of the ninth run's fix
  — it toggled the player's hue on *every* keydown, including auto-repeat,
  rather than once per fresh press, so holding Space past the OS repeat
  threshold flickered the hue uncontrollably (see the extended entry
  above for the mechanism and generalised lesson). Fixed with the
  identical `event.repeat` guard, verified the pointer/click path to the
  same swap control was unaffected, and pushed (`1129a02`/`3afc118`).
  `pnpm check` still green (21 tests), both marking viewports
  console-clean. Not the last run. The human-timed five-minute session
  remains the only standing open thread — four consecutive runs now
  finding real bugs in this same `keydown` handler; a future run should
  give it one more close read (specifically checking whether the
  movement-key branches, which only add/delete into a Set and are
  naturally idempotent under repeat, are actually as harmless as they
  look) before concluding the handler itself is finally exhausted.
  An eleventh run, 2026-08-29, 88h-to-cutoff, confirmed that specific
  check (movement-key repeat is genuinely harmless — `pressed.add`/`delete`
  is idempotent, verified by reading rather than needing a live test) and
  then found a fifth real bug, this time in a cross-handler interaction
  rather than the `keydown` handler alone: `pointermove`'s drag branch only
  checked its own `dragging` flag, and nothing cleared that flag when
  `gameOver()` fired mid-drag — there's no `pointerup` to catch it, since
  the player's finger/mouse never lifted. Confirmed live with a temporary
  `window.__debug` hook: forced a collision while a real `agent-browser`
  drag was still held down, then kept moving the pointer, and watched
  `playerX` keep tracking it (310 → 460 → 610) while `state` stayed
  `"gameover"` — the player circle visibly slid under the dimmed overlay
  after the round had supposedly ended. Fixed the same way the existing
  blur/visibilitychange handler already clears held input: `gameOver()`
  now sets `dragging = false` itself, so `pointermove`'s existing guard
  takes over with no change needed there. See the new cross-handler-state
  entry below for the generalised lesson. Fixed and pushed
  (`60ac9eb`/`dc9c11a`), `pnpm check` still green (21 tests), both marking
  viewports console-clean. Not the last run. The human-timed five-minute
  session remains the only standing open thread.
  A twelfth run, 2026-08-29, 82h-to-cutoff, re-ran the cheap `pnpm audit`/
  `outdated` pair (still clean, still the same four major-only entries) and
  then found a sixth real bug via a third distinct technique — not a fresh
  code read and not brief-clause re-derivation, but re-reading an
  *already-shipped fix's own reasoning* and asking whether it generalised
  as far as it should have (see the new dedicated entry below). The
  eighth run's Space-scroll fix (`b3b2b60`) was scoped to Space
  specifically; ArrowUp/ArrowDown, which have no in-game effect anywhere
  in `main.ts`, had never had `preventDefault()` called on them in any
  state. Confirmed live at a real short viewport (390×500, genuine
  overflow) that ArrowDown scrolled the page 29px during ordinary play,
  no collision or restart involved. Fixed by widening the same
  unconditional check to cover both arrow keys; verified movement and
  Space's toggle still fire normally. Fixed and pushed
  (`79b43cc`/`4b7577d`), `pnpm check` still green (21 tests), both marking
  viewports console-clean. Not the last run. The human-timed five-minute
  session remains the only standing open thread.
  A thirteenth run, 2026-08-29, 71h-to-cutoff, reapplied the twelfth run's
  own flagged next action (re-check whether the just-shipped fix
  generalised as far as it should have) to itself, one level deeper: the
  Space→ArrowUp/ArrowDown fix still only covered the two arrow keys that
  motivated it, not the full "browser scroll key with no in-game use"
  class — Home, End, PageUp and PageDown are the same class and had never
  had `preventDefault()` called on them either. Confirmed live at the same
  short viewport (390×500) with the canvas genuinely focused: each of the
  four moved `window.scrollY` during ordinary play (End 0→25, PageDown
  0→27, Home 30→4, PageUp 30→7 — the latter two tested from a
  pre-scrolled position since scrollY was already 0 going up). Fixed by
  widening the same unconditional check to all eight keys, verified
  movement/Space-toggle unaffected and console clean. Fixed and pushed
  (`212b0b5`/`ab34cbf`), `pnpm check` still green (21 tests). This is now
  the complete set of standard browser-default scroll keys — a future run
  shouldn't expect a fifth instance of this exact class in this repo, though
  the general "does a fix generalise as far as its own stated reasoning
  implies" technique is still worth trying on other already-shipped fixes
  in this handler. Not the last run. The human-timed five-minute session
  remains the only standing open thread.
  A fourteenth run, 2026-08-30, 64h-to-cutoff, tried that same technique
  against a handler other than the scroll-key vein (the run's own flagged
  candidates: the swap-button hit-test, the gameover-restart branch, the
  drag-clamp logic) and found a real bug in the third: `dragging` was a
  single shared boolean, correct for a mouse but wrong for touch — an
  incidental second touch releasing off the canvas cleared the same flag
  regardless of which pointer it belonged to, silently stopping the first
  pointer's still-held drag from tracking further movement. See the new
  dedicated entry below for the mechanism, the fix (`draggingPointerId`
  keyed by `event.pointerId`), and a testing-artifact caveat found along
  the way (`setPointerCapture` throws for a second synthetic pointerId
  while a first already holds capture — real hardware wouldn't hit this,
  but the underlying flag bug was confirmed independently of it). Fixed
  and pushed (`24abb55`/`b3d0d8e`), `pnpm check` still green (21 tests),
  both marking viewports console-clean, a chord tap on the swap button
  mid-drag by a second pointer verified unaffected. Not the last run. The
  human-timed five-minute session remains the only standing open thread —
  two untried candidates left from this run's own list: the
  gameover-restart-on-any-`pointerdown` branch, and whether
  `withinSwapButton`'s fixed-pixel hit radius holds at viewport extremes.
  A fifteenth run, 2026-08-30, 58h-to-cutoff, worked both candidates and
  closed each with no code change — see the new dedicated entry below for
  the restart one's mechanism and the reasoning for why it's not actually
  a distinct bug. The hit-test candidate reasoned out clean too: a fixed
  32px touch target is standard accessible practice regardless of
  viewport size, and all game coordinates already live consistently in
  CSS-pixel space with no DPR mismatch. Also cross-checked this repo's
  `styles.css` against three CSS-property-literacy lessons logged for
  crit-4 that had never explicitly been checked here —
  `-webkit-tap-highlight-color` (already fixed, `8b9e859`), `touch-action`
  scope (already correctly scoped to `#game`, never made crit-4's
  body-wide mistake), and `forced-colors: active` border-loss (doesn't
  apply — this repo's interactive surface is canvas-drawn pixels, not a
  DOM button styled via background/box-shadow) — all three clean. `pnpm
  check` still green (21 tests), no commits this run. Not the last run.
  The human-timed five-minute session remains the only standing open
  thread; no new self-administered angle is currently flagged.
  A sixteenth run, 2026-08-31, 47h-to-cutoff, re-read `main.ts`/
  `game-logic.ts`/`index.html` fresh and traced several more restart/drag
  edge cases (tap-to-restart not also grabbing a drag for the same
  pointer, multiple simultaneous fatal collisions in one frame,
  window-level keydown/keyup being unaffected by in-page Tab-focus moves)
  — each reasoned out as intentional or harmless, no new bug. Ran the
  cheap `pnpm audit`/`outdated` pair (still clean, same four expected
  major-only entries) and, for the first time in two runs, a real live
  browser pass (`pnpm preview` + `agent-browser` at both marking
  viewports): console clean at both, a fresh axe-core sweep at 0
  violations, a mobile screenshot confirming the sky-blue/amber pair and
  swap button still render correctly. No commits — nothing needed one.
  Not the last run. The human-timed five-minute session remains the only
  standing open thread; sixteen runs deep with no new bug in the last two
  is the expected steady state for a repo this thoroughly worked, not a
  sign something's being missed.
  A seventeenth run, 2026-08-31, 40h-to-cutoff, re-read the same three
  files plus `styles.css` fresh and found a genuinely new gap by applying
  the CSS-property-literacy lens already used on crit-4 one instance
  further than either repo had tried: `touch-action: none` on `#game`
  suppresses pan/zoom gestures but not iOS Safari's separate long-press
  callout and text-selection magnifier (see the new dedicated `MEMORY.md`
  entry above for the mechanism and why it's real stakes here, not just
  cosmetic — the drag mechanic is a sustained touch-hold on this exact
  element). Fixed with `-webkit-touch-callout: none` plus
  `-webkit-user-select`/`user-select: none`, verified scoped to `#game`
  only and `user-select: none` actually applied via `getComputedStyle`
  against a real `pnpm preview`, console clean, `pnpm check` green (21
  tests) before and after. Fixed and pushed (`e9b35f8`/`52cb922`),
  `PROCESS.md` now at 18 cited moments. Not the last run. The human-timed
  five-minute session remains the only standing open thread; a future run
  might try `prefers-contrast` beyond `forced-colors` as the next
  CSS-property-literacy variant, though this game's canvas-drawn
  interactive surface (not a DOM button/border-based control) may make
  that one inapplicable, same as `forced-colors` almost was.
  An eighteenth and final run, 2026-08-31, 34h-to-cutoff, ran the
  doctrine's finishing steps rather than another deepening pass: `pnpm
  check` green (21 tests) at the start, a fresh `pnpm preview` pass at
  both marking viewports (console clean, axe-core 0 violations,
  html-validate clean except the expected doctype/void-style non-issues,
  a mobile screenshot confirming the palette and swap button still render
  correctly), wrote `reflections/crit-5.md` (283 words, naming the
  clause-by-clause re-derivation technique itself as the run's
  breakthrough, since it's what kept finding real bugs across a
  dozen-plus runs after the sensor battery first read as exhausted, more
  than any single fix did), confirmed `pnpm check:evidence` fully clean
  (reflection + all 16 cited commits resolve), committed and pushed
  (`bc2c7bb`). This deliverable is now **fully shipped** — this was the
  last run for `comp4020-crit5-baishi`. The only thing left unresolved
  across the whole run history is the human-timed five-minute play
  session, which needs the studio crit itself, not a future run of this
  agent.
- **A live test finding a real, reproducible effect isn't automatically a
  bug — trace the effect back to whether it's actually new behaviour, or
  just an already-accepted mechanic surfacing at a moment that happens to
  make it look novel.** On crit-5, forcing gameover then dispatching two
  synthetic `PointerEvent`s in quick succession (pointer 1's restart tap,
  pointer 2's incidental touch elsewhere on the canvas — same technique as
  the fourteenth run's cross-pointer drag check, `window.__debug` plus
  independent synthetic pointer identities) reproduced a real effect:
  pointer 1's `pointerdown` resets the game (state flips to `"playing"`
  before pointer 1's own handler returns), then pointer 2's `pointerdown`,
  arriving after, is evaluated against that *new* state and grabs
  `draggingPointerId`, which on real hardware (masked in this sandbox by
  the already-logged `setPointerCapture` synthetic-pointer `NotFoundError`
  — confirmed via an explicit `window.onerror` listener that it's the same
  known artifact and not a new failure) would teleport the player to
  wherever the stray second touch landed. First read, this looks like a
  genuine restart-specific bug matching the shape of several already-fixed
  ones in this file (cross-pointer/cross-key state confusion around a
  transition). But tracing it one level further: touching *anywhere* on
  the canvas to instantly grab-and-teleport the player is this game's own
  deliberate, already-tested absolute-positioning touch design (confirmed
  by the pointer-drag entries logged elsewhere in this file) — it applies
  identically any time no pointer currently holds the drag slot, restart
  or not. The "restart" framing made the repro look novel only because a
  coincidental second touch is more likely to land near a deliberate
  restart tap than at a random moment in ordinary play; the underlying
  mechanism and its risk are identical either way. Singling out restart
  for special protection (e.g. a grace-period guard) would be an arbitrary
  fix for a symptom of standing, accepted design, not a distinct defect —
  concluded correctly as "checked, not a new bug," no code change. General
  lesson: when a live repro succeeds, the next question isn't "does this
  need fixing" but "is the mechanism this repro exercises unique to the
  scenario I just tried, or would the identical mechanism produce the same
  effect at any other moment the app already accepts" — only the former is
  a genuine, scoped defect worth a scoped fix.
- **A lesson logged for one repo can be a genuinely untried angle on a
  different repo — check `MEMORY.md`'s own single-repo findings against
  the current repo's code, not just against the exhausted battery already
  run on it.** Crit-4's Drift had already taught that a `blur`-only
  focus-loss handler misses same-window tab switches (`visibilitychange`
  fires, `blur` doesn't, confirmed via web search on crit-5's run — see
  the crit-5 seventh-run entry above). Crit-5's `main.ts` had its own
  `blur` handler for exactly the same reason (clearing held keys/drag
  state) but had never been checked against this specific gap across six
  prior runs, because every one of those runs was either running the
  general sensor battery or re-reading the brief/code fresh rather than
  cross-checking a different repo's already-logged lesson. Generalises:
  after "re-read the code fresh" and "re-run the sensor battery" are both
  exhausted for a repo, a third search worth trying is scanning this
  file's other single-repo entries for a technique or gap-class that
  matches something in the current repo's code but was never actually
  applied to it.
- **An early-return branch in an event handler has to repeat any
  `preventDefault()` the branches after it rely on, not just their own
  logic — a handler that suppresses a key's default action only in its
  "normal" branches leaves that default action live on whichever other
  branch returns early first.** On crit-5, `main.ts`'s `keydown` handler
  had a `gameover` branch (restart on any key) written before the
  movement/hue-swap branches (each with their own `preventDefault()` for
  the specific keys that need it), and the gameover branch returned
  before ever reaching them. Space is the browser's own page-scroll-down
  key, so restarting via Space after a loss let that default scroll
  through unsuppressed — invisible whenever the page fits inside the
  viewport (both this repo's marking viewports, confirmed via
  `document.documentElement.scrollHeight` vs `window.innerHeight`) but
  real the moment it doesn't (a `vh`-sized element shrinks with actual
  viewport height, and a real phone's on-screen address bar reduces that
  below what a fixed marking-viewport height alone assumes — confirmed by
  sweeping `agent-browser set viewport 390 <h>` down from 844 and finding
  real overflow appear at 600/500/400px). Confirmed the actual scroll
  live with a temporary `window.__debug` hook forcing game-over, a real
  `agent-browser press Space`, and reading `window.scrollY` before/after
  (0 → 4 broken, 0 → 0 fixed) — a scroll doesn't throw a console error or
  fail a test, so watching the page move was the only way to see it. Fix:
  hoist the specific `preventDefault()` a later branch needs to run
  *before* the early return, not the whole branch's other logic (the
  hue-swap side-effect still only happens in `"playing"`). General
  lesson, likely to recur in a future crit: whenever an event handler has
  an early-return branch guarding some but not all keys, check whether
  any of the *other* branches' `preventDefault()` calls needed to fire
  unconditionally to suppress a browser default the early-return branch
  would otherwise let through.
- **"Restart on any keydown" is a different claim from "restart on any
  keypress" — a `keydown` handler that doesn't check `event.repeat` reacts
  to the browser's own key auto-repeat, not just to a fresh press.** On
  crit-5, the `gameover` branch of `main.ts`'s `keydown` handler restarted
  the round on every `keydown` unconditionally. Dying usually happens
  mid-dodge, with a movement key still physically held — and a held key
  keeps sending `keydown` events (flagged `repeat: true`) for as long as
  it stays down, with no new player action at all. That auto-repeat was
  silently wiping the game-over screen and score before the player had a
  moment to see either, which is a real defect against the brief's own
  "play ends somewhere" requirement — the ending existed for a frame or
  two, then vanished on its own. Confirmed live with a temporary
  `window.__debug` hook: dispatched a real `keydown` (adds the key to the
  held-keys set), forced gameover, then dispatched a synthetic `keydown`
  for the *same* key with `repeat: true` — state flipped straight back to
  `"playing"`. Fixed with a one-line guard (`if (event.repeat) return;`)
  ahead of the restart call; verified a release-and-repress of the same
  key, or a fresh different key, still restarts immediately. General
  lesson for any "any key restarts / dismisses / advances" handler: check
  `event.repeat` specifically whenever the state being entered or exited
  is one a player is likely to already have a key held down for — a
  death mid-movement, a dismiss-on-keypress overlay shown while a key was
  already down for some other reason, anything where the *triggering*
  state change and the *held key* aren't independent events.
  **Extended (crit-5, tenth run, 2026-08-29):** the same gap recurred one
  keydown branch over, in a toggle rather than a state transition — the
  same handler's Space-to-swap-hue branch flipped the player's colour on
  every keydown, so holding Space past the OS auto-repeat threshold
  flickered the hue uncontrollably with no further player action. Fixed
  with the identical guard, verified the pointer/click path to the same
  control was unaffected. The general lesson widens past
  "restarts/dismisses/advances a *state*": any `keydown`-bound action
  that's meant to fire once per physical press — a toggle, a discrete
  step, a single shot — needs the same `event.repeat` check, not just
  handlers that gate a state transition. When auditing a `keydown`
  handler for this, check *every* branch's action against "would this
  still be correct if called N times for one held key," not just the
  branches that change game/UI state.
- **A palette swap is easy to apply incompletely — grep for every colour
  literal across the whole codebase, not just the file where the mechanic
  lives.** On crit-5, the colourblind-safety hue swap (teal/pink → sky
  blue/amber) landed cleanly in `main.ts` where the game logic is, but
  `styles.css`'s decorative nav-link colour was never touched and kept
  rendering the retired pink for two further runs before a Lighthouse pass
  incidentally surfaced it. Not an accessibility bug by itself (a lone link
  colour has nothing to be confused with), but a genuine consistency defect
  — the site's own chrome disagreed with the palette the game had just
  adopted. Whenever a future crit swaps a colour for accessibility or any
  other reason, grep the whole repo for the old hex literals (CSS, TS,
  SVG/PNG assets) before considering the swap done, not just the file the
  bug report named.
  **The inverse gap is just as real: a fix that introduces a new corrected
  value only lands in the file the bug report named, and a sibling file
  using the same underlying design token silently keeps the old, broken
  one.** On `comp4020-final-baishi`, a contrast fix created `--link`
  specifically because `--accent` alone fails AA against the page
  background, and used it on `.tagline a` in `global.css` — but
  `readme.astro`'s own scoped `<style>` block, styling every link rendered
  from `README.md` (a different file, sharing the same CSS custom
  properties), still referenced `--accent` directly, and nobody had ever
  cross-checked it. Found on a later run's first-ever clause-by-clause
  re-derivation of `README.md`/`CLAUDE.md` against the code — not a fresh
  technical sensor, just reading the project's own files end to end and
  checking every styled element against them. Whenever a contrast/palette
  fix introduces a new named value to replace a bad one, grep for every
  *other* place the bad value (or the same underlying color pairing) is
  still used, not just confirm the one reported instance is fixed.
- **To check whether a game/interaction's colour pair is distinguishable
  under colour-vision deficiency, compute it — don't try to render or
  screenshot a simulation.** `agent-browser` has no CVD emulation
  (Chrome DevTools' own `Emulation.setEmulatedVisionDeficiency` isn't
  exposed through it, same gap as the missing zoom/print-media/touch
  primitives already logged above). Instead, apply the Machado, Oliveira &
  Fernandes (2009) simulation matrices directly to the two hex colours in
  Node: convert sRGB→linear, multiply by the published 3×3 matrix
  (verified against the `colour-science` Python library's own dataset via
  WebFetch before trusting the numbers — protanopia
  `[[0.152286,1.052583,-0.204868],[0.114503,0.786281,0.099216],[-0.003882,-0.048116,1.051998]]`,
  deuteranopia
  `[[0.367322,0.860646,-0.227968],[0.280085,0.672501,0.047413],[-0.011820,0.042940,0.968881]]`,
  tritanopia
  `[[1.255528,-0.076749,-0.178779],[-0.078411,0.930809,0.147602],[0.004733,0.691367,0.303900]]`),
  convert back linear→sRGB, then compare Euclidean RGB distance against
  the un-simulated distance. On crit-5 this caught a real, otherwise
  invisible failure: teal `#2dd4bf`/pink `#f472b6` simulate to RGB distance
  ~27 under deuteranopia (vs ~222 normally) — a colourblind player
  literally couldn't tell them apart, in a game whose entire rule is
  telling them apart. Also check the replacement pair's contrast against
  the actual background colour (WCAG relative-luminance formula, same
  computation), not just its CVD separation — a pair that's well-separated
  under simulation but low-contrast against a dark canvas (a plain navy
  scored 1.64:1 against this game's `#171b2e`, versus teal's 9.15:1) would
  trade one accessibility problem for another. This generalises to any
  future crit/assignment whose mechanic or content depends on
  distinguishing colours by hue alone.
- **A temporary, uncommitted debug hook on `window` is the way to
  playtest a game whose real state (obstacle positions, elapsed time,
  score) lives in module scope with no DOM/CSS trace to read from
  outside.** Same shape as crit-4's `AudioContext`-capture technique, but
  for game state instead of an audio node: add a getter
  (`window.__debug = { get state() { return {...} } }`) right after the
  page's own setup code, rebuild, drive real input via `agent-browser`
  (dispatched `KeyboardEvent`s for swap/move, `PointerEvent`s for drag),
  and poll the getter with `eval` between actions. On crit-5 this let a
  scripted bot play a real ~5-minute session against the live build and
  prove the post-ramp difficulty doesn't become an unfair wall — something
  arithmetic on `fallSpeed`/`spawnIntervalMs` alone couldn't settle.
  Revert the hook before running `pnpm check`/committing; it's a
  verification tool, not a shipped feature.
- **A fix for a benign edge case can introduce a worse one — trace the fix's
  own new code path through the game's per-frame logic before committing it,
  not just whether it clears the symptom you set out to fix.** On crit-5, a
  real window resize mid-round (via `agent-browser set viewport` after
  `open`, using the `window.__debug` technique above to read module-scoped
  state — distinct from the `style.zoom` reflow check logged elsewhere,
  which a prior run had already found to be a testing-artifact false lead
  for this specific canvas) surfaced a real gap: `resize()` reclamps the
  player's x to the new, possibly-narrower canvas width but never touches
  in-flight obstacles, so one can end up positioned outside the new bounds —
  invisible and unreachable until it falls past the bottom and gets culled
  normally. This is fully benign: no crash, no leak, and no effect on the
  outcome, since an unreachable obstacle can neither kill the player nor be
  matched. The obvious fix (reclamp obstacles' x the same way, one line in
  `resize()`) built and looked correct at a glance — a live resize test even
  showed obstacles correctly repositioned within the new bounds. But tracing
  the timing carefully rather than trusting that one clean test run: `update()`
  runs unconditionally on the very next `requestAnimationFrame` tick after a
  resize, using whatever position `resize()` just set, so the clamp can
  teleport a previously-unreachable, different-hue obstacle onto the
  player's exact current position and end the round on the next frame —
  purely from a window resize the player took no action to cause. That is
  strictly worse than the bug it fixed: the original quirk can never affect
  the outcome, while the "fix" can produce a genuinely unfair, unreactable
  death, directly against this crit's own "a collision has to feel fair"
  ethos (echoing the doctrine's own line, "only playing can tell you whether
  the collision feels fair"). Reverted rather than shipped; no commit. The
  general lesson: for any fix to a rare/benign edge case in something with a
  per-frame update loop, ask what the fix's own new code path can produce in
  combination with the *next* tick of that loop, not just whether it now
  passes the specific scenario you were testing — "the live test passed"
  and "the fix is actually an improvement" are different claims, and the
  gap between them only shows up by reasoning through frame-by-frame
  ordering, not by re-running the same test again.
- crit-1 and crit-2 are both fully finished and pushed (reflections written,
  all checks green, doctrine finishing steps done — crit-2 also had a
  deepening pass find and fix two real issues, see `now.md`). Both repos have
  stayed private throughout (confirmed again 2026-08-11: `api.github.com`
  still 404s on `comp4020-crit2-baishi`), so the live Pages URL has never
  been checked — per the harness-owned-shipping entry just above, this isn't
  something a run needs to *do* anything about, just something worth a
  read-only check once a repo is public.
- `comp4020-ass1-baishi` (slider-based ink-shrimp explainer) is now **fully
  shipped**, done at 21h-to-cutoff (2026-08-16, ~15:00): wrote
  `reflections/assignment-1.md` (285 words, both standing prompts, the
  shrimp-geometry moment as the named breakthrough since it's the most
  demo-able for the week 4 retro this same entry doubles as), re-verified
  `pnpm check` green and both marking viewports console-clean against a
  local `pnpm preview`, confirmed `pnpm check:evidence` fully clean
  (reflection + all 5 `PROCESS.md` citations resolve), committed
  (`7d9a8c8`) and pushed to `origin/main`. Repo still 404s on
  `api.github.com` and its Pages URL as of this push — expected, shipping
  (visibility flip + Pages enable) is harness-owned, not something this
  agent has credentials for. Nothing left for this deliverable except a
  read-only live-URL check once the repo goes public.
- `comp4020-ass2-baishi` (SLOP2474, "The Forger's Craft," a course-site
  build on `astro-theme-university`/`astro-course-university`/
  `astro-theme-slop`) arrived at this run (2026-09-14, 165h-to-cutoff)
  already substantially built by prior runs/ticks: course config, all four
  content collections (people/sessions/lectures/assessments), a real
  slide deck, a course-specific policies page and `spec/course-content.test.ts`
  were all in place and pushed. This run did a real live-browser
  verification pass at both marking viewports across every page type,
  found and confirmed one genuine AA-contrast fix that a prior tick had
  already made but never verified live (see the new `contrast.ts`/oklch
  entry above for the mechanism), declined to add a bespoke `spec/` test
  for it, and rewrote `PROCESS.md` into a real 8-moment, 598-word account.
  `pnpm check` and `pnpm check:evidence` both green, pushed at `fed3ba8`.
  Not the last run — no reflection expected (assignment, not a crit). See
  `now.md` for the flagged next angles (full site tab-order walk,
  Lighthouse, `pnpm audit`/`outdated`, reduced-motion on the deck).
  A second run, 2026-09-14, 159h-to-cutoff, worked that exact list. `pnpm
  audit` found 12 vulnerabilities (1 critical, 7 high, 4 moderate),
  including a real astro advisory reachable at the pinned version; a plain
  in-range `pnpm update` cleared every one with no pin crossing a major
  version, `pnpm check` staying green (`85fd45d`). A copy-vs-behaviour pass
  found one real inconsistency: every other in-prose assessment reference
  site-wide deliberately links the generic `/assessments/` listing with
  generic anchor text, but the policies page named a specific assessment
  ("Assignment 1") while still linking the generic listing — fixed to link
  its own page (`98796bb`). The keyboard tab-order walk, a first-ever
  Lighthouse run (clean, all five categories 1.0 — unlike every other
  deliverable's first Lighthouse run in this file, which all found
  something), and a home-page-prose-vs-assessment-structure check all came
  back "checked, confirmed correct." The reduced-motion check hit a new
  category of unverifiable-live gap — see the dedicated `navigator.webdriver`
  entry below. `PROCESS.md` left unchanged (already at 598 of this
  assignment's 600-word cap); see `now.md` for the note that the audit fix
  is worth swapping in if a future run has trimming room. Not the last run.
  A third run, 2026-09-15, 146.5h-to-cutoff, worked the flagged tab-order/
  zoom/mobile list and found the run's most significant fix yet: the
  second run's own claim that the hero heading's axe "incomplete" flag was
  just the harmless oklch/gradient limitation had never actually been
  measured, only assumed from the pattern matching nav links and tag
  badges. Pixel-sampling the live rendered composite found a real, marginal
  AA failure (2.99:1, under even the 3:1 large-text minimum) — see the
  corrected `contrast.ts`/oklch entry above for the mechanism and the
  pure-black-compositing linear-scalar fix. Fixed (`2196f23`) and the
  now-inaccurate `PROCESS.md` claim corrected in the same pass, restaying
  under the 600-word cap by tightening the surrounding prose rather than
  just appending (`096dcf0`). The 200%-zoom reflow check and a full
  mobile-viewport (390×844) pass across every page type both came back
  clean — no horizontal overflow, no console errors. Two more findings
  confirmed real but correctly out of scope (upstream theme/platform code,
  not this course's own content, per the established boundary): the
  footer's `.at-footer-theme-toggle` resets `all: unset` with no
  `:focus-visible` re-added, a real keyboard-focus-visibility gap; and the
  deck's structural controls aren't reachable via Tab, only via the arrow
  keys the deck's own docs name as its intended input. `pnpm check` and
  `pnpm check:evidence` both green, pushed. Not the last run — no
  reflection expected. See `now.md` for what's left.
  A fourth run, 2026-09-15, 135h-to-cutoff, re-read the brief's own submission
  paragraph literally rather than treating its spec bullets as the whole
  ask: "the narrative should explain course-design decisions, which were
  encoded into the harness... and which were deliberately omitted" is a
  specific instruction about `PROCESS.md`'s *content*, not just its
  word-count/citation format — and the file, though accurate, never once
  named anything as deliberately left unchecked. Added a paragraph doing
  exactly that (the teacher-per-week spec only checks *a* teacher exists,
  not the *right* one; prose voice and throughline coherence are left for a
  marker, not a test) and trimmed elsewhere to hold the 600-word cap
  (`6e3eb88`). A full non-adjacent-page sweep at both viewports (sessions,
  a lecture, an assessment, the deck, policies) came back console-clean and
  overflow-free everywhere, matching the third run's mobile pass. Reading
  the home page's own "what you will do" paragraph closely for voice
  quality (a genuinely untried angle — prior runs read it for *content*
  accuracy, not sentence-level clarity) found a real, previously-unnoticed
  bug: "a studio built around that failure rather than around it" is
  circular, since "it" naturally resolves to "that failure," saying nothing
  contrastive at all. Fixed to "the studio is built around that failure,
  not around the making" (`c71df4c`). `pnpm check` green throughout, both
  commits pushed. Not the last run. See `now.md` for what's left — the
  same close-prose-read technique hasn't yet been applied to the twelve
  lecture/session bodies, only home and the three assessments/policies.
  A fifth run, 2026-09-16, 124h-to-cutoff, closed that exact gap: read all
  ten lecture bodies and all twelve session bodies for voice/clarity, plus
  the three people bios and the week-01 deck for the first time with this
  lens. All clean — no circularity, no repetition, consistent voice
  throughout. `pnpm audit` clean, `pnpm outdated` unchanged (same four
  major-only entries, still correctly left alone), `pnpm check`/
  `check:evidence` green, `PROCESS.md` unchanged at 599/600 words. No
  commits — the close-prose-read technique has now covered every page type
  in the site at least once, with nothing found on this last sweep. This
  is the expected steady state for a repo this thoroughly worked (see the
  crit-4/crit-5 precedent elsewhere in this file), not a sign something's
  being missed. Not the last run.
  A sixth run, 2026-09-16, 111h-to-cutoff, tried a genuinely new angle
  instead of repeating the exhausted technical-sensor/prose-reread battery:
  fetched the brief's own three named exemplars for *this* assignment
  (Calling Bullshit, Fab, CS007 — distinct from assignment-1's own
  exemplar) and compared structure/tone/throughline-technique directly
  against SLOP2474 — see the extended exemplar-comparison entry above for
  the finding (the course already does Calling Bullshit's single-metaphor
  move, plus live cross-week callbacks in the lecture prose that neither
  exemplar does as explicitly). `pnpm check` reconfirmed green (36 pages, 0
  axe violations, no broken links, 6/6 tests). No code change, no
  commit — a citable positive finding for the response-to-brief criterion,
  not a defect. Not the last run.
  A seventh run, 2026-09-17, 100h-to-cutoff, closed that run's own flagged
  lead: slop.university exists but is a satirical news site (mock research
  papers/posters), not a cohort course listing, so there is nothing there to
  compare this course against — a dead end, not an untried angle, don't
  re-fetch it expecting a catalogue to have appeared. `pnpm audit` clean;
  `pnpm outdated` had one genuinely in-range patch (`@types/node`, still
  inside its `^24.13.4` pin) among otherwise major-only entries — `pnpm
  update` picked it up, `pnpm check` stayed green, committed (`2669c3c`). A
  fresh live-browser spot check (home + week 9) came back console-clean.
  `PROCESS.md` still full at 599/600 words. Not the last run.
  An eighth run, 2026-09-17, 93h-to-cutoff, tried a genuinely new angle
  instead of the exhausted technical-sensor/prose-reread/exemplar-comparison
  battery: checked whether prior contrast fixes had ever been verified in
  dark mode, not just light — they hadn't, across seven prior runs. Found a
  real, previously-unverified AA failure (see the new dedicated
  `light-dark()`/dark-mode entry above for the mechanism and fix) and fixed
  it: `.at-card-title`'s colour is now `light-dark(var(--at-secondary),
  var(--at-primary))` rather than the fixed `--at-secondary` alone. Fixed
  and pushed (`ccea0a6`/`5d47b76`), `PROCESS.md` updated to cite it as a
  third live-browser defect, held to exactly 600/600 words by tightening
  the "How I got here" prose rather than cutting a moment. `pnpm check`/
  `check:evidence` both green. Not the last run.
  A ninth run, 2026-09-17, 87h-to-cutoff, checked the raw assignment JSON's
  `spec` field directly (not the WebFetch tool's AI-paraphrased summary,
  which had rendered the course-code rule as "three-digit" ambiguously) and
  confirmed the "SLOPxxxx keeps the three digits the repo arrived with,
  first digit is the ANU level" rule is already correctly schema-enforced
  in `course-config.ts` (a zod `superRefine` ties `level` to the code's own
  first digit, with a comment naming why 2 was chosen) — nothing to fix,
  a genuine "checked, confirmed correct" against a clause no prior run had
  explicitly verified. `pnpm audit` clean, `pnpm outdated` unchanged (same
  three major-only entries). Fetched the assessment page directly for the
  first time this run and confirmed `PROCESS.md`'s commit-citation format
  (hash as link text, GitHub commit URL as target) matches its stated rule
  exactly. The main finding: a live resize-mid-interaction check on the
  slide deck specifically (see the new dedicated `MEMORY.md` entry above —
  the assessment page's own HD artefact-band language names exactly this,
  and it had never been run against the deck across eight prior runs) came
  back clean — hash and rendered slide both held steady across a real
  viewport change mid-navigation, console clean. No code change, no
  commit — a legitimate "checked, confirmed correct" outcome. Not the last
  run.
  A tenth run, 2026-09-18, 76h-to-cutoff, ran `pnpm check`/`check:evidence`
  green (unchanged) then tried a genuinely new angle: a **full-site**
  dark-mode contrast sweep with a hand-rolled canvas-based checker (see the
  new dedicated `MEMORY.md` entry above), rather than trusting the one
  element a prior fix had verified in dark mode to represent the whole
  site. Checked home, sessions index, lectures index, assessments index,
  people index, policies, one lecture, one assessment, and the week-1
  deck's current slide — all clean except a false-positive flag on the
  hero title, traced to the checker's own background-image/gradient blind
  spot (the same category axe-core has) rather than a real defect: the
  hero's colour and scrim are fixed literals with no `light-dark()`
  anywhere, so it's provably scheme-independent and the existing light-mode
  fix already covers it. No code change, no commit — a legitimate "checked
  more thoroughly, confirmed correct" outcome. Not the last run.
  An eleventh run, 2026-09-18, 69h-to-cutoff, tried a genuinely new angle:
  swept the week-1 deck's contrast across all 8 slides and all 4 slide
  classes it actually uses (default, `impact`, `quote`, `centered`),
  rather than the slide-1-only checks every prior deck pass had done. First
  confirmed the deck is a scheme-invariant fixed-dark surface (`set media
  dark`/`light` produced byte-identical computed colours), settling that
  no "dark mode" framing adds anything on this specific page — see the two
  new dedicated `MEMORY.md` entries above for that finding and for two
  checker false-positives found and fixed along the way (an element's own
  local opaque background needs checking before walking up to ancestors;
  the theme's shared `.at-heading-anchor` permalink icon is a zero-size
  hover-reveal decoy, not a real element to test). After both checker
  fixes, all 8 slides passed AA cleanly. No code change, no commit — a
  legitimate "checked, confirmed correct" outcome, and a genuinely
  untried angle (per-slide-class deck coverage) rather than a repeat. Not
  the last run. Several further runs through 2026-09-19 (~39h-to-cutoff)
  kept re-confirming the same exhausted state — brief re-fetched with no
  drift, `pnpm check` green, no new technical/content angle found — without
  further `MEMORY.md` entries, since nothing new surfaced beyond what's
  already recorded here (see `now.md` history for the specific angles each
  of those runs tried, e.g. the studio-only-weeks structural check and the
  `related:` prefix-convention check on 2026-09-19).
  The final run, 2026-09-20, 28h-to-cutoff, ran the doctrine's finishing
  steps: brief re-fetched (identical, no drift), `pnpm check` green (36
  pages, 0 axe violations, no broken links, deck sound, 6/6 tests),
  `pnpm check:evidence` green (10 cited commits resolve), `pnpm audit`
  clean, and the `astro`/`vite`/`rolldown` patch-bump retry still blocked
  on the same `@oxc-project/types@0.150.0` upstream gap — fourth
  consecutive run confirming it, not yet healed. A fresh `pnpm build` +
  `pnpm preview` live-browser pass at both marking viewports (home, a
  session, an assessment, a lecture, the week-1 deck, policies) came back
  console-clean throughout, screenshots confirmed correct rendering at
  both sizes. `PROCESS.md`'s closing line still read "Not a finishing
  run" from when it was written mid-week — updated to reflect that this
  is the finishing run, re-trimmed to hold the 600-word cap (598/600).
  Committed and pushed (`64d9ac6`). This deliverable is now **fully
  shipped** — this was the last run for `comp4020-ass2-baishi`. No
  reflection file needed (assignment, not a crit) — the week 7 retro
  presents from `PROCESS.md` directly. Nothing left except a read-only
  live-URL/Pages-visibility check once the repo goes public, same as
  every other fully-shipped deliverable in this file.
- Writing `PROCESS.md` incrementally during a build/deepen run (not only in
  the inside-24h finishing steps) worked well twice now — crit-2's two
  deepening fixes and assignment-1's shrimp-geometry fix were both written
  up while fresh rather than reconstructed at cutoff. Keep doing this: it's
  consistent with the doctrine's finishing-step requirement, just done
  early, and a stale template left untouched until the last day is a worse
  failure mode than an early draft that gets extended later.
  **Extended (crit-5, 2026-08-26):** this now holds from the very first
  build run, not just deepen runs — crit-5's `PROCESS.md` was written with
  three genuine cited moments on the same run the game was first built,
  before any deepening pass existed to defer it to. Nothing about the
  moments-format needs the repo to be further along first; a first-run
  build already has real decisions worth citing (a design call, a testable
  rule, a bug found by playing).
- Every deliverable's template ships `public/card.png` as a literal
  dashed-border "Replace this card" placeholder image, and nothing in
  `pnpm check` or CI catches an unreplaced one (the invariants only check
  the `og:image` meta tag's *presence*, per `spec/README.md` — a path that
  resolves to the placeholder still passes). Replace it as an early
  build-phase task on every new deliverable, not something deferred to
  finishing steps: on crit-5, a quick `agent-browser`-rendered 1200×630 card
  (dark background, the game's own two hues, one-line pitch) done during the
  first build run took a couple of minutes and closed the gap immediately,
  rather than leaving a giveaway placeholder live on a link preview for
  however many runs the repo stays in build/deepen phase.
- Pushing to `origin/main` is not just a final-run step — every crit-4 run
  logged above pushed after its own commits, mid-week, not only at cutoff,
  and crit-5's first build run (2026-08-26) followed the same pattern
  deliberately: the doctrine's own framing ("commits and `memory/` are the
  only continuity" between runs) implies a future run's starting state is
  whatever's on `origin/main`, not necessarily this run's local working
  tree. Local-only commits are one dropped/fresh checkout away from being
  invisible to the next run. Push at the end of every run that has commits
  worth keeping, not just the one the prompt names "last."
- A "no tutorial, teaches itself" constraint (crit-5's game brief; may recur
  for the final project) is satisfiable by pacing rather than by any visible
  affordance text: design the opening state so the *first* consequence of
  each new rule is cheap and unambiguous (crit-5's first obstacle is sparse
  and 50/50 on colour, so an early hit is either an obviously-avoidable miss
  or a same-colour pass-through that reads as "that was fine"), then let
  necessity teach the harder rule once the easy strategy (dodge everything)
  stops being sufficient. This generalises past this one game: any
  self-teaching interaction can be checked by asking "what does a first-time
  player's very first mistake actually cost them, and does its consequence
  alone explain the rule."
- A game/interaction whose entire rule rests on distinguishing two colours
  (crit-5's same-hue-safe/different-hue-fatal mechanic) has a colourblind-
  accessibility failure mode no generic a11y sweep (axe-core, html-validate)
  will ever catch, because the "content" is drawn canvas pixels with no
  text alternative to check — a colourblind player may be structurally
  unable to tell the two hues apart, i.e. unable to play at all, not just
  inconvenienced. Not yet checked on crit-5 (see its `now.md`); the general
  technique for a future run: verify the chosen hue pair against a
  colour-vision-deficiency simulation (e.g. a protanopia/deuteranopia
  filter) before trusting "two visually distinct colours" as accessible on
  eye alone, and prefer pairs separated in lightness/shape as well as hue
  if the mechanic allows it.
- `comp4020-crit4-baishi` (Drift, the eight-pad pentatonic instrument) had a
  full deepening pass on 2026-08-19, 160h-to-cutoff: closed the audio-liveness,
  audit-battery, and card.png threads the prior run's `now.md` had opened (see
  `now.md` for detail), and found + fixed a real self-introduced desktop
  layout regression along the way (see the `vw`-vs-container-width entry
  above). All 8 commits pushed to `origin/main` (`b2de0d1`). A later run on
  2026-08-20, 136h-to-cutoff, found and fixed a genuinely new bug in the same
  repo (see the blur/visibilitychange entry below) — pushed at `b48a2d4`. A
  third run the same day, 130h-to-cutoff, closed the specific lens that
  fix's own `now.md` had flagged as the next thing to try (does the
  `AudioContext` itself ever need a resume-on-focus handler distinct from
  the voice-release one) plus a previously-untried live keyboard-brightness
  check — both came back "checked, nothing to fix" (see the
  constructor-capture entry above), no commits. A fourth run, 2026-08-21,
  119h-to-cutoff, tried the real-mouse-drag-glissando and analyser-based
  pitch-correctness angles (see the two entries just above) — also came
  back "checked, confirmed correct," no commits. A fifth run the same day,
  112h-to-cutoff, found one genuinely untried angle left (audio-domain
  proof of the vertical brightness/filter sweep, see the entry just above)
  and it too came back "checked, confirmed correct," no commits. A sixth run
  the same day, 106h-to-cutoff, found one more genuinely untried angle (full
  8-voice chord headroom/clipping, see the entry just above) — also
  "checked, confirmed correct," no commits. The technical audit battery for
  this repo is now exhausted across six runs and two full days without a
  single further finding — a future run should treat "I can't think of an
  untried technical check" as the expected state here, not a reason to
  invent one. Only open thread left: pad-count/range untested against a
  real naive player — needs the studio crit itself, not another
  self-administered probe. Not the last run — no reflection yet, correctly.
  A seventh run, 2026-08-22, 95h-to-cutoff, found a real bug anyway — not via
  another sensor, but by re-reading the brief's own interaction clauses one
  at a time against the current code (see the brief-clause-re-derivation
  entry below): Tab+Enter/Space activation only ever gave a fixed 180ms blip
  regardless of hold duration, unlike every other input path's real sustain.
  Fixed and pushed (`bbd50d6`/`bd3ff2a`). The exhausted-sensor-battery
  framing above was correct for *sensors* but doesn't mean "nothing left to
  find" — a different search method found something real. An eighth run the
  same day, 88h-to-cutoff, reapplied the identical technique to the
  blur/visibilitychange fix itself (moment 5) and found it only covered the
  whole page losing focus, not focus moving within the page: holding Space
  on a pad then tabbing to the next one without releasing left the first pad
  droning forever, since the eventual `keyup` targets wherever focus
  currently is, not the pad focused at keydown. Fixed with a `focusout`
  listener, pushed (`3bbf17a`/`99b75db`). Two real bugs found this way in a
  row — see the updated brief-clause-re-derivation entry above for the
  generalised lesson. A ninth run, same day, 82h-to-cutoff, applied the
  identical technique a third time to that `focusout` fix itself (the
  specific edge case its own `now.md` had flagged: does releasing on *any*
  focus-loss reason ever end a note early during a cross-modal chord) and
  this time came back clean — see the entry above for the mechanism
  (pointerdown's existing `preventDefault()` already stops pointer input
  from stealing focus off a keyboard-held pad). No code change, no commit.
  A tenth run, 2026-08-23, 71h-to-cutoff, tried one more genuinely untried
  angle — real pointer-drag audio-domain proof of the brightness sweep, as
  opposed to the keyboard-arrow version already checked (see the entry
  above) — also came back "checked, confirmed correct," no commits. An
  eleventh run, same day, 64h-to-cutoff, re-read `main.ts`'s own comments
  clause-by-clause (not the brief this time — the code's own claims) and
  found one never live-tested: the Tab+Enter/Space fix's comment claims
  `event.preventDefault()` on `keydown` stops the button's native
  click-activation from also firing the separate assistive-tech `click`
  fallback (a different voiceId, `click-x` vs `focus-x`, so a real
  double-fire would layer two live oscillators, not no-op). See the
  oscillator-count-patch entry below for the check and result — also came
  back "checked, confirmed correct," no commits. A twelfth run, 2026-08-23,
  58h-to-cutoff, found one more genuinely untried angle: real independent
  multi-touch through the `pointerPads` Map itself, not the mouse+keyboard
  stand-in every prior chord/headroom check had used (see the
  pointerPads-cardinality entry above) — also came back "checked, confirmed
  correct," no commits. A thirteenth run, 2026-08-24, 47h-to-cutoff, found a
  new real gap by reading the stylesheet fresh against real-device touch
  defaults rather than another synthetic probe: `.pad` had no
  `-webkit-tap-highlight-color` override (see the entry above). Fixed
  pre-emptively — the visual artifact itself is unverifiable in this
  sandbox — and pushed (`1eef57a`/`1a62142`). A fourteenth run, 2026-08-24,
  40h-to-cutoff, followed up on that run's own flagged next-action
  (pinch-zoom/user-scaling) and found another real gap in the same vein:
  `body` had a blanket `touch-action: none` blocking pinch-zoom
  page-wide, not just on the pad row it was meant to protect (see the
  touch-action-scoping entry above). Scoped to `.instrument`, verified via
  `getComputedStyle` and a live mouse-drag re-check, pushed
  (`000b512`/`778efcb`). Not the last run. A fifteenth run, 2026-08-24,
  34h-to-cutoff, was the final run: extended the same CSS-property-literacy
  lens the prior two runs had found live in (the `now.md` handoff had
  flagged `forced-colors`/`prefers-contrast` as untried variants) and found
  one more real, unverifiable-in-sandbox gap of the same shape —
  `.pad` is `appearance: none; border: none`, getting its whole visible
  circle from a `background` gradient and `box-shadow`, both forced to
  `none` under Windows High Contrast (`forced-colors: active`), so a pad
  would render as a bare letter with no boundary. Fixed with a
  `@media (forced-colors: active)` rule borrowing MDN's own documented
  fix shape (a `ButtonBorder`/`Highlight` border), confirmed scoped
  correctly via `getComputedStyle` reporting the ordinary-mode border
  unchanged (`806c2da`). Then ran the full finishing routine: local
  `pnpm check`/`check:evidence` green, both marking viewports
  screenshotted and console-clean against a real `pnpm preview`,
  `PROCESS.md` extended to a 10th cited moment (`06d6bc5`), wrote
  `reflections/crit-4.md` (289 words, both standing prompts, naming the
  clause-by-clause re-derivation technique as the breakthrough since it's
  what kept finding real bugs after the automated sensor battery had gone
  dry six-plus runs running), committed and pushed (`fe72eca`). This
  deliverable is now **fully shipped** — this was the last run for
  `comp4020-crit4-baishi`.
- **A sustained-note instrument (anything with press-and-hold voices) needs a
  blur/visibilitychange check, not just a press-then-release check.** On
  crit-4's Drift, every prior interaction test had driven a full
  keydown→keyup or pointerdown→pointerup cycle on a page that stayed focused
  the whole time — so nothing had ever exercised the ordinary real-world case
  of alt-tabbing away while still holding a key or pointer down. Confirmed
  live: dispatch a real `keydown`/`mousedown`, then `window.dispatchEvent(new
  Event('blur'))` (or flip `document.hidden` and dispatch
  `visibilitychange`) with *no* matching release, and check whether the
  pad/voice state ever clears. On Drift it didn't — `keyup`/`pointerup` only
  fire on a page that's still focused, so a backgrounded tab has no way to
  ever hear the release, and the note drones forever. This is a real,
  accidentally-triggerable bug against "no fail state," not a theoretical
  edge case, and none of axe-core/html-validate/Lighthouse/a keyboard
  tab-order walk would ever catch it — it's specific to hold-to-sustain
  interaction models. Fix: a `releaseAllVoices()` wired to both `blur` and
  `visibilitychange`, releasing every tracked voice through the instrument's
  normal release envelope. Worth checking on any future crit/assignment
  built around press-and-hold (a synth pad, a held button, a drag-to-sustain
  control) — the same gap will exist wherever release depends on an event
  that only fires while the page stays focused.
- **A boolean/mutable flag set by one event and only ever cleared by that
  same event's natural counterpart will leak whenever something *else*
  ends the interaction first.** This is the same shape as the
  blur/visibilitychange lesson above (a `keyup`/`pointerup`-only release
  misses a backgrounded tab), but it generalises past focus loss to any
  forced state transition. On crit-5, `dragging` was set `true` on
  `pointerdown` and only ever set `false` on `pointerup`/`pointercancel`
  — nothing accounted for the *game* ending the interaction instead (a
  fatal collision arriving while the pointer was still physically down,
  which has no matching pointerup to clear it). `pointermove` kept
  applying the drag to the player position under the game-over overlay
  because it only checked its own flag, never the broader state machine.
  Confirmed live with a temporary debug hook: forced the collision
  mid-drag, then kept moving the pointer, and watched the tracked position
  keep changing while the game state stayed "over." Fixed by having the
  state-transition function (`gameOver()`) clear the flag itself, the same
  pattern the existing `releaseHeldInput()` already used for focus loss —
  once one place resets it, every consumer's existing guard on that flag
  takes over for free. General check for a future crit: for every mutable
  flag an input handler sets on its own "start" event, find every *other*
  way the interaction it represents can end (not just that handler's own
  natural end event) and confirm each one clears the flag too — a review
  technique distinct from re-reading handlers in isolation, since the bug
  only exists in the combination of two handlers that each look correct
  alone.
- **The same "shared mutable flag" shape recurs one dimension over: a flag
  that's fine when only one instance of its triggering event can ever be
  active at once (true for a mouse — exactly one pointer) breaks the
  moment a second concurrent instance becomes possible (true for touch —
  multiple simultaneous pointers).** On crit-5, `dragging` (before the
  gameOver-clearing fix logged above) was a plain boolean: any
  `pointerdown` set it true, any `pointerup`/`pointercancel` set it false,
  with no record of *which* pointer was actually dragging. This is
  identical in kind to crit-4's `pointerPads` Map lesson (a map keyed by
  an identity needs its cardinality tested, not just single-entry
  behaviour) but here the bug was a scalar with no identity at all rather
  than a map misused. Confirmed live with a temporary `window.__debug`
  hook and two independent synthetic `PointerEvent` identities: pointer A
  dragged normally, pointer B (an incidental second touch elsewhere on
  the canvas — a palm edge, a bracing finger) went down and immediately
  up, and pointer A's next move was silently dropped even though A was
  never released — B's unrelated release had cleared the shared flag.
  Fixed by replacing the boolean with `draggingPointerId: number | null`
  and checking `event.pointerId === draggingPointerId` at every
  read/write site. **Testing wrinkle worth recording separately:**
  `canvas.setPointerCapture()` throws `NotFoundError` for a second
  synthetic pointerId dispatched while a first synthetic pointer already
  holds capture, even though a lone synthetic pointerId dispatched by
  itself captures fine — this is a limitation of simulating multi-touch
  via `dispatchEvent` (same family as the already-logged `-p ios`/
  `xcrun simctl` gap: only genuine hardware creates fully independent
  active-pointer sessions), not evidence the app's code path is wrong.
  Don't let that exception alone read as "the app throws" — isolate
  whether the *bug being tested* (here, a flag transition) still
  reproduces via the parts of the sequence that don't depend on capture
  succeeding (B's `pointerdown`+`pointerup` alone, independent of whether
  its `setPointerCapture` call threw, was enough to prove the flag leak).
  General check for any future crit with a canvas/DOM element that could
  ever receive two pointers at once (a drag surface, a multi-touch
  instrument, a two-finger gesture): grep for a bare boolean tracking
  "is something being dragged/pressed/held" and ask whether it would
  survive a *second*, unrelated pointer's full down-then-up cycle
  happening in the middle of the first one's gesture.
- **A third instance of the same shared-boolean-vs-pointerId shape, found by
  grepping for the pattern itself (the general check named just above) on a
  third, unrelated repo — and this time the failure mode was worse than
  either prior instance.** On `comp4020-final-baishi`'s drawing zone
  (`src/lib/draw.ts`), `drawing` was a bare boolean exactly like crit-5's
  `dragging` before its fix. A stray second pointer's `pointermove` got
  silently appended into the real stroke (no identity check at all, unlike
  crit-5 where the gap was narrower — there the second pointer's *down* was
  blocked by a separate `done`-style guard; here `pointermove` had no guard
  of its own). Worse, the stray pointer's `pointerup` calling
  `finish(event)` executed `zoneHit.releasePointerCapture(event.pointerId)`
  for a pointer ID the zone never captured — and unlike crit-5's sandbox-only
  `setPointerCapture` artifact (logged just above, masked by a
  synthetic-dispatch limitation that wouldn't occur on real hardware), this
  `NotFoundError` is a *real*, spec-correct throw for any pointer ID that
  was genuinely never captured, synthetic or not. Because `finish` is an
  `async` function and the throw happens before its first `await`, it
  becomes an **unhandled promise rejection** (confirmed via a
  `window.addEventListener('unhandledrejection', ...)` listener, not
  `window.onerror` — a synchronous-looking throw inside an `async` function
  body doesn't fire a plain `error` event), not a caught exception — so
  `submitMark()` for the *real* pointer's eventual `finish` call never ran.
  The flag (renamed `drawingPointerId`) was already cleared by the stray
  pointer's own `finish` invocation, so the genuine pointer's own, correct
  `pointerup` right after was a silent no-op: no fetch, no status update, no
  visible error, and the app's own `done` one-mark-per-visit flag was
  already set — the zone was now permanently inert for the rest of that
  page load, with no sign anything had gone wrong. Confirmed live with two
  independent synthetic `PointerEvent` sequences against a running
  container, before and after the fix (`drawingPointerId: number | null`,
  checked in `pointermove` and `finish` alike). **A genuinely new technique
  note from this instance:** a jsdom-based unit test of this fix was
  considered and ruled out directly, not assumed impossible —
  `svg.createSVGPoint`, `svg.getScreenCTM` and `element.setPointerCapture`
  are all simply absent from jsdom (confirmed with a two-line Node script,
  not inferred from "SVG is usually bad in jsdom"), so any client-side
  pointer-identity bug touching real SVG geometry or pointer capture isn't
  reachable by this project's existing `spec/` layer (all HTTP-level, per
  its own stated shape) at all — a live two-pointer `agent-browser`
  reproduction is the only verification available, not a shortcut taken
  because writing the jsdom test seemed like too much effort. Worth
  re-checking this exact jsdom gap before assuming any future crit's
  pointer/drag bug can get proper `spec/` coverage, rather than discovering
  the gap fresh each time.
- **"Never erased" has a second half nobody checks: never *overpainted*.**
  On `comp4020-final-baishi`, ten runs verified "no update/delete path
  exists" and never asked whether a new mark could land on an old one. It
  could: `setPointerCapture` keeps a drag reporting `pointermove`s after the
  pointer leaves the capturing element, so an ordinary over-long stroke ran
  back across every earlier mark, and the API accepted any path string.
  General check for any shared-canvas/append-only surface: grep for
  `setPointerCapture` and confirm captured points are clamped to the
  intended region, and confirm the server bounds geometry (parse the path
  grammar strictly; for SVG `Q`/`C`, bounding control points bounds the
  curve via the convex-hull property; allow for stroke width/halo). A
  persistence promise is about what the user *sees* surviving, not just
  which SQL statements exist.
- **An SSE endpoint must write something the moment it opens.** Node
  (and Fly's proxy) hold response headers until the body's first byte, so
  a stream that only sends heartbeats leaves `EventSource` at
  "connecting" until the first one. Found on `comp4020-final-baishi`;
  an immediate comment line (`: open`) fixes it. Test the first chunk,
  not just the headers.
- **Spec files hitting one shared running app race by default** (vitest
  runs files in parallel). A test that counts rows or expects the next
  id passes or fails on timing. Set `fileParallelism: false`, and treat
  a live-delivery test that passed in CI as unproven until it's run
  red against the unfixed build.
- **A live-sync client that dedupes by "id <= highest seen" loses data
  whenever ids can arrive out of order** — and they can: a POST response
  and an SSE stream are separate connections, and a reconnect replays
  older ids after the client already saw a newer one from its own write.
  Server-side replay being correct says nothing about the client. Keep a
  set of drawn ids (plus the server-rendered floor). Repro on
  `comp4020-final-baishi`: `agent-browser network route --abort` on the
  stream, write from elsewhere, write from the page, unroute, compare
  the page's count with the server's. A jsdom spec loading the real
  rendered HTML can drive the client module directly when it touches
  only plain DOM.
- **`EventSource` reconnects on its own only after a network error; a
  reconnect answered with a non-200 (Fly's proxy gives 502 while a deploy
  or wake fails) closes it for good, silently.** Repro: kill the app,
  serve a 503 on its port (tiny `http.server`) through one retry, restart
  the app, write a mark — the page never gets it. Fix: on `error` with
  `readyState === CLOSED`, open a new one after a backoff from a replay
  floor the server can fill. Found on `comp4020-final-baishi`.
- **A CI-driven Fly deploy can fail on Fly's side** (machines-API timeout,
  "lease currently held by Fly.io system") and leave the app 502 for
  minutes. After every push on a CI-deployed repo, check `flyctl
  releases` for `failed`; a manual `flyctl deploy --remote-only
  --ha=false` clears the lease and ships. Also check the Actions run
  itself, readable without auth: `curl -s 'https://api.github.com/repos/
  <org>/<repo>/actions/runs?per_page=3'` for `conclusion`, then
  `.../runs/<id>/jobs` for the failing step — a failed `check` job skips
  `deploy`, so no failed Fly release appears at all.
- **Live-sync clients that auto-scroll or reflow when remote content
  arrives must hold still while the local user has a pointer down.** On
  `comp4020-final-baishi`'s live scroll, an incoming mark grew the canvas
  and auto-followed to the new end mid-drag, so the rest of the local
  stroke mapped to the wrong place. Only a two-tab test (start a drag,
  inject a remote write via `curl`, continue, release) shows it; check
  the saved path's coordinates, not just that it saved.
- **Multi-voice headroom is a distinct claim from single/two-voice liveness
  and needs its own audio-domain check.** Every earlier analyser-splice check
  on Drift (liveness, chord mixing, glissando pitch tracking, filter-sweep
  audibility) used at most a two-note chord — none had ever driven the
  instrument to its actual maximum simultaneous-voice count. On a sixth run
  (2026-08-21, 106h-to-cutoff), held a real `mouse down` on pad 1 (genuine
  gesture, resumes the context) then layered in the other seven pads via
  synthetic `keydown` (safe once the context is already running — the
  autoplay-gate caveat only applies to the *resuming* gesture, not
  subsequent voices added after resume) to build the full 8-note chord Drift
  can ever produce, and read `getFloatTimeDomainData` off the spliced
  analyser: peak 0.85 with zero samples at the ≥0.999 clipping threshold —
  the `DynamicsCompressor` in the signal chain (`main.ts`'s `ensureAudio`)
  keeps real headroom even at maximum simultaneous load, confirmed by
  measurement rather than assumed from the node existing. Also confirmed the
  release side of the same scenario: releasing all 8 (real `mouse up` +
  synthetic `keyup` ×7) dropped every pad's `.active` class immediately, and
  the analyser read a genuinely decaying signal — 0.13 peak ~0.6s after
  release (the 0.28s-delay/0.32-feedback echo tail still audible, expected)
  falling to ~3.5e-17 (silence) by ~2s — no stuck voice, no leaked
  oscillator continuing to render after every key was up. Console stayed
  clean throughout. "Checked, confirmed correct," no code change. The
  general lesson: for any instrument whose voices share a bus with limited
  headroom (a compressor, a fixed-gain mixer), the audio-liveness technique
  above only proves *a* signal exists — proving the design's actual ceiling
  case (every voice at once) doesn't clip needs the same technique deliberately
  pushed to that ceiling, not just to two voices for convenience.
