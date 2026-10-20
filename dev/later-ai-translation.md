# Later — AI translation (explicitly NOT Phase 1)

**Status:** Explicitly authorized slices implemented below; broader roadmap remains deferred, outside product Phase 1
**Source:** [Master plan](plan.md)  
**Repository rules:** [AGENTS.md](../AGENTS.md)

This file covers a deferred roadmap track. It does not authorize implementation or change the MVP scope.

### Background AI runs — 2026-10-20

Whole-chapter and selected-paragraph runs may now continue while the user
works elsewhere. The AI dialog offers “Continue in background”, and closing
the dialog (X, Escape, chapter switch) keeps the run alive instead of
cancelling it; only the explicit Cancel action stops a run. An app-level job
tracker mirrors the Rust worker through the existing `ai-translation-event` and
`ai-selection-event` streams, and a status bar below the workspace toolbar
lists each background run with chapter, mode, elapsed time and Cancel / Open /
Dismiss actions. The translation header button spins while the current
chapter has a running job. Reopening the dialog re-attaches to a running job
and shows a finished proposal that still waits for review; a background
whole-chapter result fills an empty draft exactly like a foreground run, while
a draft with content keeps the proposal for an explicit Insert.

No Rust change was required: the worker already runs on its own thread and
reports through app-level events. Selected-paragraph runs keep their saved
checkpoints and survive an app restart; a whole-chapter proposal lives in
memory and is lost if the app quits before the run finishes. Two existing
selection regressions were updated because closing a dialog no longer cancels
its run. Frontend checks and the full frontend suite (96 tests) passed; native
window behavior, live provider runs and cross-platform checks remain open.

Run times read as a duration rather than a bare second count — `42s`, then
`5m 30s`, then `1h 5m 30s` — through one shared formatter (`lib/duration.ts`)
used by the background status bar, the translation dialog and the HTML-repair
dialog. The Burmese, Mon, Arakanese and Shan catalogs were updated so the
sentence fragments no longer state the unit next to the formatted duration.

### Whole-chapter and selected-content translation — 2026-10-15

The explicitly requested selected-content workflow is implemented alongside the
existing Whole chapter default. Selection begins empty; users can select available
or untranslated units, preview saved proposals, and explicitly append accepted
results. Tables and figures are complete units. Standalone images require no
provider call; inline images remain at their source positions. Repeated resource
uses have distinct source identities. Source assets remain unchanged; SVG,
responsive/unsupported structures and missing resources show actionable reasons.

Rust owns namespace-aware selection, Unicode sentence/word/grapheme splitting,
text-range reconstruction and validation. Original markup, attributes, links,
image references and table structure stay local. Ancestor wrappers and ordered
list numbering survive noncontiguous selections. Requests run sequentially with
a 4 KiB selected-XHTML budget, 24 KiB complete-prompt limit, up to 512 UTF-8 bytes
of neighboring context on each side, and 64 KiB output limit per part. Smaller
retry halves the source budget down to 512 bytes without discarding checkpoints.
Indivisible oversized fragments are reported without truncation.

Migration 10 preserves existing drafts and stores source units, runs,
configuration snapshots, parts and append receipts without credentials or
duplicating image bytes. Failures pause the queue; retry, smaller retry, skip,
cancel and explicit consented resume retain completed work. Interrupted runs
recover paused. Append flushes edits, prevents competing writes, checks revision
and source identity, validates duplicate IDs, and commits the draft and receipt
in one transaction. Repeated request IDs are idempotent. Accepted results update
the mounted Rich editor through its loss-aware path and remain Draft. Local image
URLs are resolved only for display; serialized XHTML retains source references.

Verification: `bun run check`, 47 frontend tests, Rust formatting and 206 Rust
tests passed, with four existing ignored tests. Tests cover local HTTP provider
failures, restart checkpoints, selection identity, Unicode, tables, image
placement, append conflicts/idempotency and export/reopen with unchanged image
bytes and source/snapshot hashes. Clippy reports existing warnings in unrelated
code; the production build retains its bundle-size warning.

Rendered synthetic-fixture checks covered 1280×800 and 960×640 in light/dark,
loaded image/table previews, readable Myanmar text, focus wrapping and Escape.
These do not verify native IME or live provider behavior. Next unfinished task:
rebuild/restart native Sagar and smoke-test consented generation, cancel/retry,
append and export/reopen with real assets and Myanmar IME. Windows/Linux and
EPUBCheck checks remain open. Broader roadmap checkboxes below remain unchanged.

## Prerequisites

Begin only after the user explicitly changes the product phase to permit AI integration.

## Tasks and acceptance criteria

- [ ] Provider-independent `TranslationProvider` interface with cancellable jobs.
- [ ] Prompt/context builder with glossary and per-block identity.
- [ ] API key security and opt-in network/privacy disclosures.
- [ ] Proposals stored as separate drafts, not automatic overwrites of reviewed manual translations.
- [ ] Batch progress, retry, costs, rate limits and user review.

## Supporting design

- [Section 3 — Component architecture](plan.md)
- [Section 5 — Translation data model (proposed SQLite v1)](plan.md)
- [Section 6 — Tauri command contract (initial proposal)](plan.md)

Follow the master plan’s quality gates and repository definition of done. Check tasks only after implementation and acceptance criteria are verified; keep completion status aligned with the master plan.

### Settings-only slice — 2026-10-13 (explicitly authorized)

Home (Library) now has AI settings, explicitly requested by the user. Scope is
configuration and availability only — no translation calls, no book content
leaves the device:

- Built-in CLI providers (Codex, OpenCode, Claude Code): PATH-only
  availability in the list; an explicit Check runs `<binary> --version` with a
  timeout. No process is spawned and no network request is made without the
  user pressing Check.
- Custom OpenAI-compatible providers: name, base URL, API key and model in
  app-owned SQLite (migration 4); reads are masked to key presence, secrets
  are never logged or serialized. An explicit Test performs a single
  `GET {base}/models` with the stored key; validation rejects non-http(s),
  credential-bearing, and query/fragment URLs.
- None of the milestone tasks above are complete; provider interface,
  prompt/context building, proposals-as-drafts, batch progress and keyring
  migration all remain open.

### Translation Model tab — 2026-10-13 (explicitly authorized)

Settings gained a Translation Model tab: pick the agent (Codex, OpenCode,
Claude Code or a saved custom provider), then pick its model from a searchable
list. Model discovery per agent: Codex via `codex debug models --bundled`
(offline) with fallback to `codex debug models` plus a known-models catalog;
OpenCode via `opencode models` (local cache, no `--refresh`, so no network);
Claude Code via a built-in catalog of aliases and current full IDs (the CLI
offers no machine-readable list); custom providers via live `GET {base}/models`
with fallback to the saved model. Any model ID can also be entered manually.
The choice persists in app-owned SQLite (migration 5, `ai_translation_selection`)
for future translation work. Saving only remembers the choice — no translation
runs and no book content is sent.

### Assist panel — 2026-10-13 (explicitly authorized)

The Translation header is now Rich text | HTML | AI, keeping the reviewed and
keep-original actions. The AI view shows the saved agent/model, requires an
explicit per-run consent checkbox, and generates only on demand: the backend
spawns the installed Codex (`exec --model`), OpenCode (`run --model`) or
Claude Code (`-p --model --output-format text --max-turns 5`) CLI in an empty
temp directory with a 10-minute deadline, then validates the output against
the chapter schema. Runs are cancellable, terminal states arrive as
`ai-translation-event`s, and the proposal previews read-only with Insert into
draft (two-step confirm over existing content, always unreviewed) and Copy
text. The saved draft is never modified by a run; custom-API agents are
rejected for translation until a network provider path is designed. Prompt,
arg-shape, proposal-validation and stub-CLI runner/timeout/cancel coverage is
in `services/ai_translate.rs`; source loading in `storage/ai_translate.rs`.

### Structure-preserving redesign — 2026-10-13 (explicitly authorized)

Proposals now translate the chapter's original HTML body with identical
structure: only human-readable text may change. Tables, images, links, ids
and attributes must round-trip exactly — enforced by an element-skeleton
comparison (`services/ai_translate.rs`), with code-fence stripping and
`data:` image embedding for Rich-editor display. Any structural change rejects
the proposal with nothing inserted. Fresh (empty) drafts receive the result
straight into the Rich editor; chapters with content keep the preview +
explicit Insert flow. Stuck runs are diagnosable: a `started` event, an
elapsed ticker, surfaced event-subscription failures, and truncated tool
stderr on failures (local display only).

### Button + streaming dialog — 2026-10-13 (explicitly authorized)

AI is a separate header button, not a view tab (Rich text | HTML unchanged).
It opens a confirm dialog showing agent, model and direction with an explicit
Generate button. Runs stream the tool's stdout live (`stream` events with
full-so-far text into an auto-scrolling read-only view, ~750 ms throttle,
1 MB cap) instead of appearing suddenly; cancel/timeout/deadline behavior is
unchanged and the child is always killed and reaped.

### Proposal retry correction — 2026-10-13

The proposal dialog uses an accessible X close control. Retry carries the final
failed output back to the Rust service, which retains only complete top-level
XML sections matching the immutable source structure and requests the remaining
source sections. Truncated or structurally changed sections are regenerated;
combined output still requires full schema and structure validation. Partial
output is held in the open dialog, not persisted across closing/restart. A
complete but invalid proposal reports that there is no unfinished section to
continue. Native CLI/UI and cross-platform verification remain open.

### Reasoning effort selection — 2026-10-13 (explicitly authorized)

Translation Model now includes Default plus model-specific reasoning levels /
variants. Codex catalog parsing reads `slug` and `supported_reasoning_levels`;
OpenCode discovery uses local `models --verbose` metadata and enabled variant
names; Claude Code uses the documented per-model effort table. Models without
listed adjustable levels retain Default. Migration 6 adds nullable
`reasoning_effort` without replacing existing selections. Settings and proposal
summary display the saved effort, and Generate/Retry pass it to the CLI via
Codex `--config model_reasoning_effort="…"`, OpenCode `--variant`, or Claude
Code `--effort`. Rust checks the choice on save and execution; Default sends no
override. Codex catalog fallback/manual IDs allow documented level names with
model compatibility left to the CLI; OpenCode requires advertised variants.

Verified installed CLI help and local OpenCode metadata (Muse Spark 1.3 free
advertises minimal/low/medium/high/xhigh). Regression tests cover catalog
metadata, disabled variants, CLI arguments, invalid effort/model combinations,
and upgrading a saved v5 selection. Native model invocation/UI and
Windows/Linux remain the next unfinished verification tasks.

Sources: [Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference),
[OpenCode variants](https://opencode.ai/docs/models/#variants),
[Claude Code effort](https://code.claude.com/docs/en/model-config#adjust-effort-level).

### Codex temporary-directory fix — 2026-10-13

Codex translation runs now pass `exec --skip-git-repo-check`: their isolated
working directory is deliberately outside a Git repository. Regression tests
check this flag with both default and explicit reasoning effort. This skips
only the Git-directory check; it does not disable sandboxing or approval rules.

### Completed proposal validation correction — 2026-10-13

A completed proposal with a trailing `<hr/>` inside its credit paragraph was
rejected by the editor nesting check. The proposal boundary now uses parsed,
namespace-aware XML to move only trailing horizontal rules outside paragraphs,
preserving text, attributes, and rule order. The same normalization is used
for source/proposal comparison; the immutable source is never rewritten.
Other invalid nesting and active content remain rejected. Structural comparison
also includes element depth to catch reparented elements. Errors now include
validation details instead of hiding the reason.

Retry of a complete retained output revalidates it without launching another
translation; incomplete output still continues from matching complete sections.
The dialog buffers events arriving before the start command returns so a fast
local recovery cannot lose its terminal event. A synthetic Myanmar fixture
covers the credit paragraph, valid saved output, complete retry, multiple rules,
unsafe attributes and invalid nesting. All 112 Rust tests, frontend lint/build,
and formatting passed. The exact supplied chapter also passed a local validation
check; a recovered copy was saved beside its attachment without changing the
original. Native UI insertion and Windows/Linux remain unfinished verification.

### Disabled button contrast — 2026-10-13

Shared disabled buttons now use an opaque neutral background with muted text
and a visible border. This fixes Generate's gray-on-faded-blue label before
consent is checked, using the existing light/dark theme tokens. Consent and
disabled behavior are unchanged. Native visual verification remains open.

### Per-book metadata and translation instructions — 2026-10-13

Each workspace now has Book Settings beside the book title: export title,
primary author, publisher, description, source/target language and book-wide
AI guidance for consistent names, terminology and style. Migration 7 stores
metadata overrides and instructions separately from the immutable snapshot.
Validation precedes a transactional save; existing titles/drafts survive the
migration. Optional blank metadata retains the source value.

The AI proposal dialog shows saved book guidance and accepts an optional
current-run instruction. Rust reads book instructions by the chapter's project,
combines both sets with the standard translation/preservation prompt, and
limits each guidance field to 20,000 characters. Current-run naming/style
conflicts take precedence over book-wide guidance; preservation checks remain
mandatory. Changing run guidance clears retained partial output before Retry.
Instructions are sent only with an explicitly consented Generate/Retry and
are never written to the exported EPUB.

Export now applies saved metadata even when no new title is supplied in the
export request. Namespace-aware DC edits update only the primary creator,
retain IDs/refinements and additional creators, and add missing optional fields
with escaped Unicode/XML text. Integration tests reopen the resulting EPUB,
check all edited metadata, isolate guidance between two projects, reject
partial invalid saves, and confirm byte-identical source/snapshot preservation.
Frontend lint/build, cargo formatting and all 116 Rust tests passed. Native
Book Settings/AI interactions and cross-platform verification remain open;
full EPUBCheck conformance was not performed.

### Bundled-app CLI discovery fix — 2026-10-14

Release builds launched from Finder/Dock inherit a sparse `launchd` PATH, so
`codex` (nvm/npm shim), `opencode` (`~/.opencode/bin`) and `claude`
(`~/.local/bin`) reported "Not found on PATH" even when installed. CLI lookup
in `services/ai.rs` now searches process PATH, then the login-shell PATH
(bounded `printf %s "$PATH"` probe, constant args only), then well-known
per-user install directories (including nvm version bins) plus brew/system
prefixes, deduplicated with process-PATH precedence. Error messages no longer
claim PATH-only lookup and stay free of filesystem paths. Four regression
tests cover fallback listing, nvm expansion, shell-output parsing and
combined-directory resolution. Rust suite (101 unit, 19 export, 17 import),
frontend lint/build and cargo formatting passed; new code is clippy-clean
(six pre-existing clippy warnings in untouched files remain). Next unfinished
verification: rebuilt release app on macOS finding all three tools, plus
Windows/Linux checks.

### Codex shim runtime fix — 2026-10-14

After the discovery fix, Codex Check still failed with "found but reported an
error": the only `codex` on the machine is an nvm `#!/usr/bin/env node` shim,
and spawned children inherit the app's sparse GUI environment where `node` is
missing (`env: node: No such file or directory`, exit 127 — reproduced with a
sparse `PATH`; the same command succeeds with an augmented `PATH`). Spawned
CLI children in `run_cli_output` (version/model probes) and `execute_streaming`
(translation and HTML-fix runs) now receive an augmented `PATH` built from the
tool's own directory plus the discovery directories, so shim runtimes resolve
regardless of how the app launched. No shell is involved and no user input
reaches the child environment. Two regression tests cover child-PATH ordering
and an `env`-shebang shim resolving its runtime. Full suite (103 unit, 19
export, 17 import), formatting and frontend lint/build passed; touched files
are clippy-clean. Next unfinished verification: Codex Check connecting in the
rebuilt release app, plus a real Generate run.

### Selected translation UI redesign — 2026-10-15

The selected-content frontend now separates source selection, translation
progress/recovery, and paired source/result review into explicit stages. The
footer exposes one contextual primary action and keeps text-sharing consent
visible for new text runs. History and instructions use compact disclosures;
ready results already added are disabled and explained. Full previews retain
local image resolution and safe HTML; review uses two columns or stacks below
850px. Source and proposal selection IDs remain separate, and append failures
retain checked proposals and their request ID. Whole chapter remains the default.

Frontend validation passed: lint, TypeScript, production build and 56 tests.
Rendered synthetic-fixture checks covered both themes at normal/minimum sizes
and a narrow stacked layout, including readable Myanmar text. The existing build
bundle warning remains. No Rust, command, database or EPUB transformation changes
were needed. Native IME/live provider and cross-platform checks remain open.

### Saved proposal deletion — 2026-10-15

History has a confirmed “Delete this saved run…” action. It clears the run’s
proposals, checkpoints and configuration while keeping authored draft text and
insertion receipts. Migration 11 preserves the identity mappings that prevent
accidental re-adds. Active jobs cannot be deleted; deleted runs cannot resume.
Frontend build checks and 58 tests passed; the Rust suite passed 209 tests with
four existing ignored tests. Native deletion UI and other OS checks remain open.

### Insertion history is not draft presence — 2026-10-15

Previously inserted units are selectable for translation and review. “Added
before” no longer locks them. Selecting such results exposes an explicit re-add
confirmation at the footer; existing duplicate IDs still fail validation. This
supports restoring text removed in HTML without deleting saved proposals,
chapters or books. Bulk source selection and selection without proposals no
longer exclude units solely because they have insertion history. Native UI
verification remains open; frontend and Rust recovery regression tests cover
the manual-removal-and-restore path.

### Chapter-wide proposal review — 2026-10-15

Saved batches now accumulate in one source-ordered review list. A subsequent
translation run does not replace the earlier batch's visible proposals or clear
checked results. Multiple versions of one unit remain available through a
version picker; each preview uses its own saved language/model configuration.
The current run still owns progress, retry and deletion; chapter-wide append
uses the existing atomic service. No storage migration or provider change was
needed. Verified 61 frontend tests, nine selected-content Rust integration
tests, lint/TypeScript/build, and light/dark rendered synthetic fixtures at
minimum/normal sizes. Native live-provider checks remain pending.

### Append order recovery — 2026-10-15

Order and re-add confirmation are combined beside Add in the footer. Missing
confirmation disables Add before submission; backend order errors expose the
same control. Append retries retain their request ID and checked proposals,
and Retry actually retries saving. Save success/failure is visible without
scrolling or reopening. Empty current drafts are no longer treated as containing
later content based on history alone. Verified frontend checks/65 tests, ten
selected-content integration tests and rendered synthetic footer checks; native
live-provider verification remains open.

### Accepted proposal lifecycle — 2026-10-15

Accepted proposal output and parts are now consumed atomically with draft save.
Other ready versions for those source occurrences are cleared at that moment;
unaccepted source units remain in the chapter-wide pending list. Minimal
identity/receipt history remains for idempotency and duplicate safeguards.
Previously receipted output is cleaned when selection state loads. Newly
translated runs remain available even for source items with insertion history.
This replaces the earlier policy of retaining accepted proposals for restoration;
manual removal can be followed by translating the source again. Frontend checks,
66 frontend tests and 213 Rust tests passed (four existing ignored); native
empty-state/retranslate and cross-platform verification remain open.

### One pending translation per source occurrence — 2026-10-15

Retranslation replaces the previous saved proposal only after successful complete
validation. Replacement is transactional and deletes obsolete output/parts;
failed/cancelled attempts retain the previous result. Newer successful runs win
over older delayed completions. Legacy duplicate proposals are cleaned on load.
The version picker is removed; other paragraphs and chapter drafts remain intact.
Frontend and Rust replacement regressions passed; native interaction verification
remains pending. This supersedes the previous multiple-version retention policy.

### OpenCode V2 compatibility — 2026-10-19 (explicitly authorized)

The OpenCode V2 upgrade changed the CLI contract and the server API, which broke
the OpenCode translation path end to end. The V1 spellings are gone and the
adapter now speaks V2 only. This supersedes the earlier V1-based discovery,
streaming and cleanup behavior recorded above.

Model discovery reads the V2 catalog with `opencode api model.list`, which
performs service discovery and authentication itself and never leaves the
machine. The catalog document is `{ location, data[] }`; each entry supplies
`providerID`, `modelID`, a display name and the advertised variants, which
become the model's reasoning-effort options. The plain `opencode models` list
remains a fallback when the API is unavailable.

The translation server runs against the V2 HTTP API: `POST /api/session` (the
model and variant travel with the session), `GET /api/event` for the SSE
stream, `POST /api/session/{id}/prompt`, `POST /api/session/{id}/interrupt`
and `DELETE /api/session/{id}`. V2 responses wrap their payload in a
`{ location, data }` envelope. V2 only accepts the built-in `opencode`
basic-auth user, and every route requires the server password, so the adapter
authenticates with it. Sharing stays disabled through the injected inline
configuration, which V2 exposes as the configuration entry without a path.

The event vocabulary changed completely: V1 `message.updated` /
`message.part.updated` / `message.part.delta` are now `session.step.started` /
`session.step.ended`, `session.text.started` / `session.text.delta` /
`session.text.ended`, closed by `session.execution.succeeded`. Text is grouped
by ordinal, only the assistant turn started by `session.step.started` may
become a proposal, reasoning and the echoed user prompt are never streamed, and
any tool request still aborts the run without approving anything. A failed
turn reports the provider error from the assistant message instead of a
generic failure.

Verified against the installed OpenCode V2 CLI: the live catalog probe reads
50 models, and the live stream probe returns the requested text over SSE.
243 Rust tests passed (two existing ignored probes) and clippy reports no new
findings; native UI interaction and cross-platform verification remain open.
