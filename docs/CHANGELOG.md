# CHANGELOG — MeetNote

## 2026-09-18 — Summary Presets (feature `summary-presets`, Architecture.md v1.0)

Implemented T1–T17 from `docs/Architecture.md` §9. `npm test` is green (48/48). Two
tasks (T7, T8) are code-complete but not closed — see "Known gaps" below.

### T1 — Built-in preset templates
- `server/llm/presets.js`: `BUILT_IN_PRESETS` (General Meeting, Sales Call, Technical
  Standup, Interview) + `instantiateBuiltIns()`. General Meeting's sections reuse
  `GENERAL_SECTIONS` from `preset-schema.js` verbatim so its keys are guaranteed to
  match the legacy 5 fields (§3.2, WHY-1), not just "usually match via slugify".

### T2 — Validate + CRUD logic (pure)
- `validatePreset(input, existingPresets, currentId)` in `server/llm/presets.js`.
  Covers BR-2..BR-7, E4 (label ≤60, description ≤300). Section keys are preserved
  across edits per §3.1 rule 5 (matched via `rawSection.key` against the preset
  being edited), fresh sections get a new key via `sectionKeyFor`.

### T3 — CRUD routes + `storage/presets.json` + BR-9 seeding
- `server.js`: `handlePresetsRoute()` implements GET/POST/PUT/DELETE
  `/api/summary-presets[/:id]`, wired inside `handleApi()` — i.e. behind the same
  `hasTrustedHost`/`isTrustedApiRequest` gate as every other `/api/*` route
  (verified with an automated CSRF-Origin test, see T17).
- Mutations go through `mutateJson(PRESETS_FILE, [], ...)` (never `replaceJson`).
  `:id` is only ever used as an array lookup key, never joined into a filesystem
  path. Deleting the last preset re-seeds the 4 built-ins (BR-9).

### T4 — Converter (3 dialects) + normalizer
- `server/llm/preset-schema.js` (new): `buildJsonSchema`, `buildGeminiSchema`,
  `buildNormalizer`, `buildSummaryFormat`, `snapshotOf`, `sectionKeyFor`,
  `GENERAL_SECTIONS`, `GENERAL_SNAPSHOT`.
- `server/llm/contracts.js`: exported `cleanString`/`cleanStringList` so the
  dynamic normalizer can reuse them instead of duplicating logic.
- Regression tests (mandatory, `test/preset-schema.test.js`):
  `buildJsonSchema(GENERAL)` deep-equals `schemas/meeting-summary.schema.json`;
  `buildGeminiSchema(GENERAL)` deep-equals `gemini.js`'s `SUMMARY_SCHEMA` (now
  exported from `providers/gemini.js` for this test).
- **Deviation from Architecture.md §7**: the normalizer's BR-14 "drop + log
  unknown key" step uses `console.warn` instead of the file-backed `logEvent`.
  §7's module header says `preset-schema.js` is "thuần hàm, không I/O" (pure,
  no I/O) so it can stay independently testable, but `logEvent` requires
  filesystem access — the two requirements conflict. Resolved in favor of
  keeping the module I/O-free; `console.warn` still surfaces the event without
  adding a storage dependency. Flagged for Tech Lead review.

### T5 — `buildSectionsBlock` in all 3 prompt builders + `PROMPT_VERSION` → v3
- `server/llm/prompts.js`: new export `buildSectionsBlock(preset)`.
  `buildSummaryPrompt`, `buildChunkPrompt`, `buildSynthesisPrompt` all accept an
  optional `preset` argument; when present they splice in the shared sections
  block instead of the old hardcoded 5-field bullet list. Omitting `preset`
  reproduces the previous prompt text byte-for-byte (verified in tests) so the
  no-presetId backward-compat path (§4.2) is unaffected.
- Mandatory test (`test/preset-schema.test.js`): one preset run through all 3
  builders, asserting every `section.key` appears in each of the 3 outputs.

### T6 — Service wiring + dynamic chunk scaffold
- `server/llm/index.js`: `summarizeMeeting(adapter, model, meeting, outputLanguage,
  preset)` builds `format = buildSummaryFormat(preset)` internally when a preset
  is given, and threads `format` down to `adapter.summarize({ prompt, model, format })`.
  `generateSummary({..., preset})` passes it through.
- `CHUNK_SCAFFOLD_TOKENS` (static 2000) replaced with
  `CHUNK_SCAFFOLD_BASE_TOKENS + estimateTokens(format.sectionsBlock)` per the
  Protocol 8 audit in Architecture.md §5.3 (the one pipeline step that did not
  generalize safely as-is).
- **Minor deviation**: T6's acceptance text names the added parameter `format`;
  it is implemented as `preset` (the full preset definition), with `format`
  computed inside the function. Functionally equivalent — the object handed to
  each adapter is still exactly `buildSummaryFormat(preset)` — but flagging the
  naming difference since Architecture.md's literal signature text differs.

### T7 — Codex adapter, dynamic schema file — CODE COMPLETE, NOT CLOSED
- `server/llm/providers/codex.js`: `withTempSchemaFile()` writes
  `schemas/.tmp/<uuid>.json`, passes it through both `runStructured` attempts
  (initial + one repair retry), removes it in a `finally`. `.gitignore` updated
  with `schemas/.tmp/`.
- **Not closed per Architecture.md §6.1 / Protocol 5.4**: this dev machine has
  no Codex CLI (`codex` not on PATH, `/Applications/ChatGPT.app/.../codex`
  absent). Manually verified the code path fails safely (returns
  `LLM_PROVIDER_UNAVAILABLE`, not a crash) when Codex is missing — see
  `project_state.json` backlog entry `T7-gate-smoke-test-codex-blocked-cli-not-installed-on-dev-machine`.
  A real smoke test with Codex installed is still required before this task
  can be marked done.

### T8 — Gemini adapter, dynamic `responseSchema` — CODE COMPLETE, NOT CLOSED
- `server/llm/providers/gemini.js`: `run()` now accepts `format` and swaps in
  `format.geminiSchema` / `format.normalize` when present; static
  `SUMMARY_SCHEMA`/`normalizeSummary` stay as the no-preset fallback.
- **Not closed**: no `GEMINI_API_KEY` on this machine (env empty, no Keychain
  entry). See backlog entry `T8-gate-smoke-test-gemini-blocked-no-api-key-on-dev-machine`.
  Needs a real 10-section-preset smoke test before closing.

### T9 — DeepSeek adapter, dynamic normalize + golden fixture
- `server/llm/providers/deepseek.js`: `run()` accepts `format`, uses
  `format.normalize` when present.
- `tests/fixtures/deepseek/dynamic-sections.json` added and used by
  `test/preset-schema.test.js`.
- **Protocol 5.3 gap, disclosed**: Architecture.md §6.3 records that a real
  DeepSeek call was made and verified (key set, order, 3 field types, no extra
  key) but only documents the *shape* of that response using placeholder
  notation (`"<string>"`), not the literal captured response bytes. Dev did not
  have a raw HTTP capture available to paste verbatim. The fixture reproduces
  the verified shape with representative content and is annotated as such in
  `_note`. This is weaker than a true golden file (Protocol 5.3 intends a byte-
  for-byte capture) — flagged for Tech Lead/QA to backfill with a real capture
  when a DeepSeek key is available on a dev machine.
- Live DeepSeek smoke test was not re-run in this session (API key access is
  restricted in this environment); only the fixture-based normalize test ran.

### T10 — `POST /api/summary` extended with `presetId`
- `server.js`: reads `body.presetId`, looks it up in `presets.json`, 400
  `PRESET_NOT_FOUND` if missing (BR-19, no silent fallback). Response now
  includes `summaryPreset` (server-captured snapshot, BR-16). Both
  `storage/summaries/<hash>.json` writers (`server.js` route + `syncMeetingArtifacts`)
  now persist `summaryPreset` (§3.5 — the two writers' shape mismatch predates
  this feature and was intentionally left unmerged, per WHY-8).

### T11 — Client API wrapper
- `js/presets.js` (new): `Presets.list/create/update/remove` with an in-memory
  cache invalidated on every mutation. `index.html` loads it after `summary.js`,
  before `export.js`/`app.js`.

### T12 — Generic renderer + BR-20
- `js/summary.js`: `GENERAL_SECTIONS` mirrors the server constant;
  `virtualSnapshotForLegacy()` implements BR-20 (old summaries render as the
  current General Meeting shape, nothing written to disk); `format()`/
  `_formatSection()` drive the flat `meeting.summary` string from a snapshot
  instead of 5 hardcoded fields.
- `js/app.js`: `_renderSummaryContent()`/`_renderSummarySection()` replace the
  flat-text summary tab with a per-section renderer. Every label and every
  value is passed through `Utils.escapeHtml` (label is user-entered, value may
  come from the LLM). Empty sections show "Không có nội dung" (BR-13).
- `_extractActionItems()` in `summary.js` seeds `meeting.actionItems` from the
  preset's first `actionList` section instead of assuming a field named
  `actionItems` — fixes C4/C1 from Architecture.md §8.

### T13 — Preset dropdown + regenerate confirmation
- `js/app.js`: `#summary-preset` dropdown added to the Summary tab, populated
  by `_populateSummaryPresetSelect()` (defaults to `lastSummaryPresetId`, else
  "General Meeting", else the first preset — BR-10). Generate button now shows
  a confirmation modal (`_confirmRegenerateSummary()`) before overwriting an
  existing summary (BR-15). "Preset đã bị xóa" badge shown when
  `meeting.summaryPreset.presetId` is no longer in the live preset list (BR-18).
- **Known limitation, disclosed**: BR-15 also asks for a *stronger* warning
  when the current summary "has been edited by hand". The app has no summary-
  editing UI anywhere (the Summary tab was always read-only, unlike the
  Transcript tab) and Architecture.md does not add one, so there is no signal
  to detect a manual edit. Implemented a single confirmation instead of a
  two-tier warning. Flagged for Tech Lead — either BR-15's stronger warning
  should be dropped for v1, or a "manually edited" flag needs to be designed
  (out of scope for Dev to invent unilaterally per "không đổi data model").

### T14 — Preset management screen (Settings)
- `js/app.js`: new "Summary Presets" section in Settings — list with
  create/edit/delete, and a full editor modal (name/description/instruction +
  section list with add/remove/reorder/type picker). BR-21 (shared, no
  accounts) and BR-22 (don't put secrets in the instruction) warnings shown in
  both the settings section and the editor modal.

### T15 — Restore preset from snapshot
- `js/app.js`: `_restorePresetFromSnapshot()` creates a brand-new preset from
  `meeting.summaryPreset.sections` via `Presets.create()`, then selects it in
  the dropdown. Does not touch the deleted preset id (BR-19).

### T16 — Export + import sanitize
- `js/export.js`: `toMarkdown`/`toPlainText` now render the summary section-by-
  section from the snapshot (one `##` heading per section in Markdown) instead
  of dumping the flat `meeting.summary` string under one "Summary" heading.
  "Action Items" export is untouched (still `meeting.actionItems`, per E3).
- `js/storage.js`: `_sanitizeSummaryPreset()` validates an imported
  `summaryPreset` (well-formed sections, known types, length caps) or drops it
  to `null` — BR-20's virtual snapshot then covers rendering. Added
  `lastSummaryPresetId` to the settings default/sanitize path.

### T17 — Test suite
- `test/presets.test.js`: `BUILT_IN_PRESETS`/`instantiateBuiltIns` (T1),
  `validatePreset` covering BR-2..BR-7 plus key-stability-on-edit (T2), and an
  HTTP integration suite spawning the real server (T3/T10): seeding, full
  POST→PUT→DELETE round trip with re-seed on empty, a validation-error 400,
  a cross-site Origin rejection (confirms the new route sits behind the
  existing CSRF gate), and `PRESET_NOT_FOUND` on `/api/summary`.
- `test/preset-schema.test.js`: the two mandatory T4 regression tests, the T5
  three-builder test, `sectionKeyFor` edge cases, `buildNormalizer` BR-13/BR-14
  (including that section order in the output always matches `sections[]`
  regardless of raw key order), and the T9 golden-fixture test.
- `npm test`: 48/48 passing.

### Other notes
- Chose port `8797` for the new `test/presets.test.js` HTTP suite — the
  original draft reused `8799`, which collides with the existing
  `test/http.test.js` and caused flaky `ECONNREFUSED`/`ECONNRESET` failures
  when all test files run together via `node --test test/*.test.js`.

## 2026-09-18 — Review fix round: T9 Protocol 5.3 gap closed

### T9 — DeepSeek golden fixture replaced with a real capture (Reviewer Critical #1)
- Reviewer's 2026-09-18 `docs/review-report.md` correctly rejected the previous
  `tests/fixtures/deepseek/dynamic-sections.json`: its `raw` field was hand-
  written by Dev (self-disclosed in the old `_note`), not bytes from an actual
  DeepSeek response — a Protocol 5.3 violation, verdict REQUEST_CHANGES. This
  round does not count against the Dev↔Reviewer Protocol 3 limit, per the
  review report (process gate, not a technical defect).
- PM called the real `/api/summary` endpoint against the running MeetNote
  server (provider=deepseek, model=deepseek-chat, a 3-section preset —
  context/paragraph, risks/bulletList, followUps/actionList) and captured the
  full HTTP 200 response. `tests/fixtures/deepseek/dynamic-sections.json` was
  rebuilt from that capture:
  - `preset.sections` now use the real preset's key/label/type/hint values
    from the capture's `summaryPreset` block (not placeholder labels).
  - `raw` is `JSON.stringify` of the real captured `{context, risks,
    followUps}` values. This is *not* the literal DeepSeek HTTP response body
    (`/api/summary` returns the already-normalized object, not the provider's
    raw text — the raw provider text only exists transiently inside
    `server/llm/providers/deepseek.js` and isn't exposed by the API). Because
    DeepSeek is called with `response_format: json_object`, its raw response
    text is exactly this JSON object with no wrapper, so reconstructing `raw`
    via `JSON.stringify` of the real captured values is content-faithful, not
    a guess. This derivation is documented in the fixture's own
    `_rawDerivation` field so it's auditable without cross-referencing this
    CHANGELOG.
  - `expected` mirrors the same real values (confirmed by hand-tracing
    `coerceSectionValue`/`cleanString`/`cleanStringList` in
    `server/llm/preset-schema.js`: all captured strings were already
    trimmed with no length overage, so normalize is a no-op on content).
  - No field value in the new fixture was invented — every string comes
    directly from the real capture.
- No test code changes were needed: `test/preset-schema.test.js`'s existing
  `buildNormalizer(fixture.preset)` / `normalize(fixture.raw, 'deepseek')` /
  `assert.deepStrictEqual(data, fixture.expected)` shape already matched: only
  the fixture *content* was replaced.
- `npm test`: 48/48 passing (unchanged count — this was a fixture swap, not a
  new test). T9 is now closed per Protocol 5.3/5.4: the golden fixture is
  backed by a real captured response, not a hand-written approximation.

### Medium issue — `console.warn` vs `logEvent` in `preset-schema.js` (BR-14)
- Reviewer flagged (Medium, not blocking) that dropping unknown keys via
  `console.warn` instead of `logEvent` loses long-term auditability (not
  written to `storage/logs*`, not visible in client diagnostics/bug reports).
- PM reviewed and accepts keeping `console.warn` as-is: the underlying reason
  (importing `logEvent` from `server.js` into `preset-schema.js` would create
  a circular require, since `server.js` already `require`s `preset-schema.js`)
  was already independently verified by Reviewer by reading both files. The
  drop-unknown-key behavior itself (BR-14) is unaffected — only post-hoc log
  searchability is. No code change made for this item; flagged here per
  Reviewer's request so the decision is traceable instead of silently
  standing. Revisit only if a future task genuinely needs to query
  `summary.unknown_key` events after process restart.

## 2026-09-18 — Pre-meeting Context, Notes-aware Summary & Presets (Architecture.md v2.0, Part A: T1–T8)

Implemented T1–T8 from `docs/Architecture.md` §11 Task Breakdown (Part A only —
T9–T15 export/tag UI are a separate Dev's scope, not touched here). `npm test`
is green (70/70, including all pre-existing `summary-presets` tests).

### T1 — `MEETING_TYPES` table (BR-25)
- `js/meeting-types.js` (new): the 10-entry table (`code/label/abbr/presetName`),
  dual-mode (`const` for the browser + `module.exports` guard for Node), plus
  `meetingTypeByCode`/`isKnownMeetingTypeCode` helpers.
- `server/meeting-types.js` (new): `module.exports = require('../js/meeting-types.js')`
  — one source of truth per Architecture WHY-3, no second copy.
- `index.html`: new `<script src="js/meeting-types.js">`, loaded before
  `storage.js` so both can use the globals synchronously.

### T2 — 4 new meeting fields (`meetingType`, `topic`, `leadBy`, `tags`)
- `js/storage.js`: added `normalizeMeetingType`/`normalizeShortText`/
  `normalizeTagList` helpers; wired into the new-meeting default object and
  `_sanitizeImportedMeeting` (BR-31/BR-76 — missing field in an old backup
  defaults quietly). Also added `presetByMeetingType` to `DEFAULT_SETTINGS`
  and its own import sanitizer (`_sanitizePresetByMeetingType`, for T8).
- `server.js`: added `normalizeMeetingTypeCode`/`normalizeShortText`/
  `normalizeTagList` (independent implementation from the client's, per
  Architecture §3.1 — each side keeps enforcing its own rules even if the
  other is bypassed) and `sanitizePreMeetingFields(meeting)`, applied inside
  the `PUT /api/meetings` merge (`.map(sanitizePreMeetingFields)` — only
  touches the 4 new fields, every other field still passes through
  untouched). `validateMeetingForSummary` now also returns `notes`,
  `meetingType`, `topic`, `leadBy` — previously these were silently stripped,
  which would have made BR-32 impossible to satisfy no matter what T5/T6 did.

### T3 — Pre-meeting info UI (New Meeting + Meeting Detail)
- `js/app.js`: New Meeting form gets 3 new optional fields (meeting type
  dropdown via `_meetingTypeOptions()`, topic, led-by) between Participants
  and Spoken Language; both Start Recording and Save as Draft pass them
  through — neither is blocked by them (BR-24).
- Meeting Detail gets a new "Pre-meeting info" card (editable, Save button)
  above the tabs. `_bindPreMeetingInfo()` implements:
  - BR-28: a one-time soft nudge ("Thêm vào danh sách người tham dự?") when
    `leadBy` doesn't match any existing participant, dismissible via an
    in-memory `Set` (`_leadBySuggestionDismissed`) so it never repeats in the
    same session — no persistence, same scope as the existing manual-preset
    override state (§8).
  - BR-29: `_preMeetingStaleHint()` shows a soft reminder when
    `meeting.updatedAt` is newer than `summaryGeneration.generatedAt`.
  - **Decision made without an explicit Architecture answer**: there is no
    dedicated "pre-meeting info last edited at" timestamp on the meeting
    object, so BR-29's staleness check uses the meeting's own `updatedAt`
    compared against `summaryGeneration.generatedAt`. This is a slightly
    coarser signal than "pre-meeting info specifically changed" (any field
    edit bumps `updatedAt`), but it's the closest available signal without
    adding a new field to the data model (which Dev is not authorized to do
    unilaterally). Flagged for Tech Lead/PM to confirm or refine.

### T4 — Search extended to `topic`/`leadBy`/`meetingType`/`tags`
- `js/storage.js` `searchMeetings`: added the 4 new match branches with the
  exact BR-30/BR-73 scoring (topic +4, leadBy +3, meetingType label +2,
  tags +3) and `field` values (`'topic'`, `'leadBy'`, `'meetingType'`,
  `'tags'`) matching what `js/app.js:2099` already prints verbatim into the
  UI.

### T5 — `buildContextBlock` + `SUMMARY_PRINCIPLES`/`CHUNK_PRINCIPLES`, `PROMPT_VERSION` → v4
- `server/llm/prompts.js`: `buildContextBlock(meeting, {maxNotesChars})` (BR-32
  ..BR-39) computes `headerLines`/`notesBlock`/`text`/`contextUsed` in one
  place. `SUMMARY_PRINCIPLES` and `CHUNK_PRINCIPLES` copied **verbatim** from
  the "BLOCK DÙNG CHUNG" in `docs/preset-templates.md` (BR-61); `BR63_NOTE`
  constant for the notes-override sentence, appended only when
  `contextUsed.notes === true`.
- `buildSummaryPrompt`/`buildChunkPrompt`/`buildSynthesisPrompt` all take a
  new optional `context` parameter (defaults to `buildContextBlock(meeting)`
  when omitted, so pre-existing unit tests that don't pass one still work
  byte-compatibly for the no-context-fields case).
- `test/context-prompt.test.js` (new): unit tests for `buildContextBlock`
  (empty-field omission, truncation-at-newline, `contextUsed` flags), a
  3-builder test proving notes + full pre-meeting info reach all 3 prompts
  identically, a test proving `CHUNK_PRINCIPLES` never contains "ĐÃ CHỐT"
  while `SUMMARY_PRINCIPLES` does, and a `PROMPT_VERSION` pin.

### T6 — Context threaded into the service + BR-38 scaffold + BR-39 provenance
- `server/llm/index.js`: `summarizeMeeting` now calls `buildContextBlock`
  exactly **once** (G3 of Architecture §4.1) and passes the same `context`
  object into every builder call (single-pass, every chunk, and synthesis) —
  never recomputed per builder, per WHY-6. `scaffoldTokens` extended to
  `CHUNK_SCAFFOLD_BASE_TOKENS + sectionsBlock + context.text + CHUNK_PRINCIPLES`
  tokens (BR-38). `contextUsed` returned from `summarizeMeeting` is threaded
  through `generateSummary` into `generation.contextUsed` (BR-39).
- `js/summary.js` `_payload`: now sends `notes`/`meetingType`/`topic`/`leadBy`
  in the `meeting` object (previously dropped here — G1 of the pipeline).
- `test/context-prompt.test.js` includes a full Protocol 6 lineage test:
  stubs `global.fetch` under the DeepSeek adapter (chosen because Codex's
  `contextWindow` is 0 and never chunks), forces a real map-reduce with a
  large transcript, and asserts the **exact** truncated-notes string and
  pre-meeting header lines appear in every chunk + the synthesis prompt
  actually sent over the wire, that the chunk prompts never contain "ĐÃ CHỐT"
  while the synthesis prompt does, and that `generation.contextUsed` deep-
  equals the flags computed at G3 — not just "was called".

### T7 — Replaced `BUILT_IN_PRESETS` with the 10 BR-64 presets
- `server/llm/presets.js`: `BUILT_IN_PRESETS` now holds the 10 presets from
  `docs/preset-templates.md`, copied **verbatim** (name/description/
  instruction/sections/hints) — `instruction` contains only the "Hướng dẫn
  cho AI" block, the shared "BLOCK DÙNG CHUNG" is deliberately **not**
  appended (BR-65; it now lives as `SUMMARY_PRINCIPLES`/`CHUNK_PRINCIPLES` in
  `prompts.js`, T5). The "General Meeting" seed is the new BR-64 7-Vietnamese-
  section shape, **not** a reuse of `GENERAL_SECTIONS` (Architecture §9.3
  trap) — `GENERAL_SECTIONS`/`GENERAL_SNAPSHOT` in `preset-schema.js` are
  untouched, still the legacy 5-English-key BR-20 virtual snapshot.
  `instantiateBuiltIns()`/`seedPresetsIfEmpty` logic unchanged, so BR-66
  (never overwrite an existing non-empty `presets.json`) already held.
- `test/presets.test.js` updated for the 10-preset world: name list, count
  assertions (4→10) in both the pure and HTTP-integration tests, a BR-65
  regression (no built-in `instruction` contains "NGUYÊN TẮC BẮT BUỘC"), a
  BR-67 regression (`MEETING_TYPES.presetName` matches `BUILT_IN_PRESETS.name`
  1-to-1), and a §9.3-trap regression (seed keys ≠ legacy `GENERAL_SECTIONS`
  keys). Every seed is asserted to pass the real `validatePreset`
  (§9.2 — OKR's instruction is close to the 2000-char cap).
- `test/preset-schema.test.js` updated: the two T4 pinned-schema-equality
  tests (`buildJsonSchema`/`buildGeminiSchema` vs the static schema files)
  now build their preset from `GENERAL_SECTIONS` directly instead of
  `instantiateBuiltIns()[0]`, since that coupling no longer holds after T7 —
  and a new test pins that it must *not* hold (§9.3 regression guard).

### T8 — Preset suggestion by `meetingType` (BR-55..BR-58)
- `js/app.js`: `_chooseDefaultPresetId(presets, meeting)` implements the
  exact §8 priority order (session manual override → remembered
  `presetByMeetingType[code]`, pruning a stale entry on miss (BR-58) →
  name-match against the type's `presetName` → `lastSummaryPresetId` →
  "General Meeting" → first preset → none). `_populateSummaryPresetSelect`
  uses it and shows a "Gợi ý cho <label>" hint next to the dropdown only for
  the two `meetingType`-driven branches (BR-55); a manual `change` on the
  dropdown records `_manualPresetByMeeting[meetingId]` for the rest of the
  session (BR-56.1) and clears the hint. On a successful Generate,
  `settings.presetByMeetingType[meeting.meetingType]` is updated to the
  preset actually used (BR-57.1).

### Test suite
- New: `test/context-prompt.test.js`, `test/meeting-types.test.js`,
  `test/pre-meeting-fields.test.js` (server-side PUT /api/meetings sanitize,
  BR-26/BR-27/BR-68, HTTP integration style matching `test/presets.test.js`).
- Updated: `test/presets.test.js`, `test/preset-schema.test.js` (see T7).
- Chose port `8796` for `test/pre-meeting-fields.test.js` — `8797`/`8798`/
  `8799` are already used by `presets.test.js`/`jobs.test.js`/`http.test.js`.
- `npm test`: 70/70 passing.

### Not implemented (out of Part A scope, left for the next Dev)
- T9–T15 (export filename/dir/routes, client export UI, tag model/UI/library
  view) — explicitly out of scope for this session per the brief, to avoid
  file conflicts with a parallel Dev.
- Tag auto-add on `meetingType` change (BR-70) is T14 scope, not touched by
  T3 here — T3 only covers the 3 pre-meeting fields, not `tags`.

## 2026-09-18 — Export .md & Tags (Architecture.md v2.0, Part B: T9–T16)

Implemented T9–T16 from `docs/Architecture.md` §11 Task Breakdown. `npm test`
is green (115/115), including all 70 pre-existing tests from `summary-presets`
and Part A. The Windows branch of T12 is **not implemented** — it returns 501
per the Protocol 5.2 gate (U2, §14); see the T12 note below.

### T9 — `server/export/filename.js`
- New pure module: `yymmdd` (local time, invalid/missing date falls back to
  `new Date()`), `slugTopic` (topic-over-title, reuses
  `preset-schema.js`'s `stripDiacritics` — now exported for this purpose —
  instead of re-deriving the NFD/đ handling), `abbrFor` (looks up
  `MEETING_TYPES`), `buildFileName` (`[yymmdd, slug, abbr].filter(Boolean)`,
  never a stray `-`), and `applyReservedNameGuard` (Windows reserved device
  names → `_` suffix), exported separately from `buildFileName` so the guard
  is unit-testable on its own — see "Decisions" below.
- `server/llm/preset-schema.js`: added `stripDiacritics` to `module.exports`
  (it already existed internally; T9 is its second caller).

### T10 — `server/export/dir.js`
- `validateExportDir(input, { storageDir, rootDir, dryRun, timeoutMs })`
  implements Architecture §5.1 steps 1–8 in order: required/`\0`/length/
  absolute (`~` expanded against `os.homedir()`)/inside-app/too-broad/
  exists-or-create-1-level/write-probe. Wrapped in a 5s `Promise.race`
  timeout → `EXPORT_DIR_UNAVAILABLE`. `dryRun` (used by
  `/api/export-settings/check`) skips `mkdir` for a missing directory but
  still runs the real write probe when the directory already exists.
- `writeExportFile(dir, baseName, content)` implements the WHY-2 sequence
  exactly: `open(target, 'wx')` to reserve the name (retrying
  `(2)`…`(99)` on `EEXIST`, `EXPORT_TOO_MANY_FILES` past 99) →
  `writeFile` a `.tmp` colocated in the same directory → `rename` over the
  reservation → on any failure in the write/rename step, `rm` both the tmp
  file and the reserved target (never leaves a 0-byte placeholder wearing
  the real name). Serialized behind one global promise chain so concurrent
  exports don't race on the `(n)` suffix sequence. 30s timeout wraps the
  whole write.
- `mapFsError` centralizes the `EACCES/EPERM → NOT_WRITABLE`,
  `ETIMEDOUT/EIO/EHOSTDOWN → UNAVAILABLE`, `ENOSPC → NO_SPACE (507)` mapping
  from Architecture §5.1, used by both validate and write paths.

### T11 — Export settings + export routes (`server.js`)
- `storage/export-settings.json` (server-owned, new): only ever written by
  `PUT /api/export-settings` after `validateExportDir` — never merged into
  `settings.json` (WHY-1: `PUT /api/settings` replaces that file wholesale
  from an unvalidated client body).
- `GET /api/export-settings`, `PUT /api/export-settings`,
  `POST /api/export-settings/check` (dry-run), `POST /api/export/markdown`
  wired into `handleApi` behind the same `hasTrustedHost`/
  `isTrustedApiRequest` gate as every other `/api/*` route.
- `POST /api/export/markdown`: reads `meetingId` from `meetings.json` (never
  trusts client-sent metadata), re-validates the configured directory on
  **every** export (BR-43, not just when Settings was saved), computes
  `warnings: ['EXPORT_NO_SUMMARY' | 'EXPORT_LARGE_TRANSCRIPT']`, and logs
  only `{fileName, attempt}` via `logEvent` — never the full path or file
  content. `content` > 8 MB → `413 EXPORT_CONTENT_TOO_LARGE`; unknown
  `meetingId` → `404 EXPORT_MEETING_NOT_FOUND`; no directory configured →
  `400 EXPORT_DIR_NOT_CONFIGURED`.

### T12 — `POST /api/export/open-folder` (macOS only)
- `process.platform !== 'darwin'` → `501 { error: { code:
  'OPEN_FOLDER_UNSUPPORTED' } }` immediately, **before** touching
  `child_process` at all — this is the Protocol 5.2 gate for U2 (§14):
  Windows `explorer.exe` behavior under `shell:false` (binary path, argument
  handling, and a rumored non-zero exit code on success) is still
  unverified on a real Windows machine. Only the macOS branch runs
  `spawn('/usr/bin/open', [dir], { timeoutMs: 5000 })`, matching the
  Architecture §7.2 V4 verification run exactly.
- Body is always empty — the server re-reads and re-validates
  `export-settings.json` itself; no route accepts a directory from the
  request.

### T13 — Client export UI
- `js/exporter.js` (new): thin `fetch` wrapper for
  `/api/export-settings[/check]`, `/api/export/markdown`,
  `/api/export/open-folder`, plus `copyPath()` (clipboard API with an
  `execCommand('copy')` fallback, mirroring `Export.copyTranscript`'s
  existing pattern). Never sends a path — only `markdownDir` (settings
  screen) or `content` (export).
- `js/export.js` `toMarkdown(meeting, { includeTranscript, presetDeleted })`:
  reordered per BR-51 (pre-meeting info block → summary sections → preset
  note → Action Items → **Notes → Transcript**, swapped from the old
  Notes-after-Transcript order), added the `Loại cuộc họp`/`Chủ đề`/`Chủ
  trì`/`Tag` lines (skipped when empty), the BR-52 preset-name +
  generatedAt blockquote, and made Transcript inclusion optional (BR-54).
  `presetDeleted` is an explicit boolean parameter rather than an async
  lookup inside this function — see "Decisions" below.
- `js/app.js`: `detail-export-md` now opens `_openExportModal` (include-
  transcript checkbox, BR-53 soft warning when there's no summary yet) →
  `_runExport` (checks `Exporter.getSettings().configured` first, routes to
  Settings with a toast if not; best-effort preset-deleted lookup via
  `Presets.list()`) → `_showExportResult` (modal with full path, warnings,
  "Copy đường dẫn" — always present, WHY-10 — and "Mở thư mục", which
  removes itself and falls back to a toast the moment it gets a real `501`
  from the server, per §5.3's "tự động rút gọn UI"). Settings gained an
  "Xuất file" section (`_loadExportSettings`/`_bindExportSettings`): text
  input + "Kiểm tra thư mục" (dry-run check) + "Lưu thư mục" (PUT).

### T14 — Tags: model + `js/tags.js` + UI + auto-add
- `js/tags.js` (new, pure, dual-mode like `js/meeting-types.js`):
  `normalizeTag`/`normalizeTagList` (≤30 chars, dedupe case-insensitively,
  keep first casing, cap 10), `canAddTag` (`TAG_EMPTY`/`TAG_DUPLICATE`/
  `TAG_LIMIT_REACHED`), `tagHue` (FNV-1a 32-bit % 360 — deterministic, no
  `Math.random`), `tagStyle` (only numbers from `tagHue` ever reach the
  style string), `collectTags` (recency-then-frequency ranked), `suggestTags`
  (substring match, capped at 8). The meeting model's `tags: []` field,
  default value, and both sanitizers (`js/storage.js`,
  `sanitizePreMeetingFields` in `server.js`) already existed from Part A/T2
  — verified unchanged here.
- Meeting Detail's "Pre-meeting info" card gained a Tags row: chip list
  (`_renderTagChips`, remove buttons) + free-text input with an autocomplete
  dropdown (`_bindTagEditor`, sourced from `collectTags(Storage.getAllMeetings())`).
  Every tag add/remove persists immediately via `Storage.saveMeeting` — this
  editor does **not** wait for the pre-meeting card's own "Save" button,
  since BR-70's auto-add is specified as an immediate reaction to the
  `meetingType` dropdown changing, not a batched save (see "Decisions").
- BR-70 auto-add: `#detail-meeting-type`'s `change` event calls
  `_autoAddMeetingTypeTag`, which appends the type's label to `tags` unless
  already present, the 10-tag cap is hit, or the label is in
  `App._autoTagSuppressed[meetingId]` (populated when the user removes an
  auto-added tag, cleared only by a fresh page load — no persistence, same
  scope as `_leadBySuggestionDismissed`). New Meeting has no tag editor of
  its own, so `_initialTagsForMeetingType` seeds `tags` at
  meeting-**creation** time instead (both Start Recording and Save Draft) —
  this is "meetingType chosen for the first time" per BR-70's own wording.

### T15 — Library: tag chips, filter bar, "Theo tag" view
- `js/app.js`: replaced the old show/hide-DOM filter (`el.style.display`)
  with `App._meetingsView = { mode, text, tags: Set }` + `_visibleMeetings()`
  (AND between text and tags, OR across selected tags — BR-72) per
  Architecture §10.3/WHY-8. `_renderMeetingsByTag` groups by tag (a meeting
  with N tags appears in N blocks), block order follows `collectTags`,
  "Chưa gắn tag" always last (BR-74).
- Filter input / tag chip clicks / view-mode buttons now call
  `_refreshMeetingsList()`, which replaces only `#meetings-list-container`
  and `#tag-filter-bar` — **not** the search input itself, so typing doesn't
  lose keyboard focus on every debounced re-render.
- Selection + bulk-delete logic extracted into
  `_bindMeetingSelectionHandlers()`, re-run after every
  `_refreshMeetingsList()` (the container's `innerHTML` — and therefore its
  checkboxes — is replaced on every filter change). `_selectedMeetingIds`
  itself never resets on a filter change, only re-filtered against
  currently-selectable ids, so "select 2 → change tag filter → bulk delete"
  keeps deleting the right 2 meetings even if one of them scrolls out of the
  now-filtered view.
- `_renderMeetingItem` gained a tag-chip row (BR-71); `css/components.css`
  gained the tag chip/filter-bar/group styles. All tag text goes through
  `Utils.escapeHtml`; only numeric hue values from `tagStyle` are
  interpolated into inline `style` attributes.

### T16 — Test suite
- `test/export-filename.test.js`: `yymmdd`/`slugTopic`/`abbrFor`/
  `applyReservedNameGuard`/`buildFileName`, including the exact worked
  example from Architecture §11 T9 (`260918-Hop-chot-gia-Q4-SC`).
- `test/export-dir.test.js`: runs against **real** temp directories (no `fs`
  mocking) — accepts a real writable dir, rejects relative paths, expands
  `~`, rejects inside-app and too-broad boundaries, creates exactly 1
  missing level, dry-run never creates a directory, `0o500` → real write-
  probe failure (not `access()`), 3 sequential writes never overwrite (`
  (2)`/`(3)` suffixes, earlier files byte-for-byte intact), and a fault-
  injection test (real fs, only `fs.promises.rename` swapped for one call)
  proving a mid-write failure leaves neither a `.tmp` file nor an empty
  target placeholder.
- `test/export-routes.test.js`: spawns the real server (pattern from
  `test/presets.test.js`), covers the full `GET`/`PUT`/`check` cycle on a
  real temp export directory, the CSRF gate, a real `/api/export/markdown`
  write-then-read-back round trip (2 exports → ` (2).md`, first file
  untouched), 404/413/`EXPORT_DIR_NOT_CONFIGURED`, and a real
  `POST /api/export/open-folder` smoke test (macOS on this dev machine →
  `opened:true`; any other `process.platform` → asserts `501
  OPEN_FOLDER_UNSUPPORTED` instead, so this test is meaningful either way it
  runs in CI).
- `test/tags.test.js`: every `js/tags.js` function, including the FNV-1a
  determinism/case-insensitivity property and that `tagStyle` never
  interpolates the tag's own text.
- `npm test`: 115/115 passing (70 pre-existing + 45 new).

### Decisions made without an explicit Architecture answer
- **`GET /api/export-settings`'s `status` field**: Architecture §5.2 lists
  `status` in the response shape but doesn't enumerate its values. Chose
  `'configured' | 'not_configured'` (mirrors `configured: boolean`) since
  nothing else in the spec references reading this field. Flagged for
  Tech Lead/PM in case a richer status (e.g. distinguishing "configured but
  now unreachable") was intended — not implemented since it would require
  probing the directory on every settings-page load, which Architecture
  doesn't ask for.
- **`applyReservedNameGuard` exported separately from `buildFileName`**: the
  T9 acceptance example "`CON` → `CON_`" can only be produced directly for a
  bare reserved name — `buildFileName` always prepends `yymmdd-`, so a real
  end-to-end collision with a bare `CON`/`PRN`/etc. is effectively
  impossible. Exported the guard as its own pure function so the acceptance
  criterion can be tested literally (`applyReservedNameGuard('CON') ===
  'CON_'`) while `buildFileName` still applies it to the full joined name as
  Architecture §5.4 specifies.
- **Tag edits persist immediately, independent of the pre-meeting "Save"
  button**: BR-70 describes auto-add as happening "tại chỗ đổi meetingType"
  (immediately), which only makes sense if tag mutations aren't batched
  behind a separate Save click. Manual tag add/remove follows the same
  immediate-persist rule for consistency (matches how Action Items already
  behave elsewhere in the app, unlike Notes which does have its own Save
  button).
- **"Mở thư mục" button removal is reactive, not proactive**: Architecture
  §5.3 says the client should "tự động rút gọn UI" to just "Copy đường dẫn"
  when the server returns 501. Implemented this as removing the button
  after the *first* click that gets a 501, rather than pre-emptively hiding
  it via a client-side OS sniff before any request — avoids adding a
  second, possibly-wrong source of truth about platform support (the
  server's live response already is one). "Copy đường dẫn" is present from
  the start either way (WHY-10).
- **New Meeting form has no tag editor**: Architecture §11 T14 only lists
  `js/app.js` (Meeting Detail) for the autocomplete UI, not the New Meeting
  form. BR-70's initial auto-add is still honored at creation time via
  `_initialTagsForMeetingType`, just without a visible chip list on that
  screen — a user who wants to edit tags before the first save can do so
  immediately after in Meeting Detail.

### Not implemented (Protocol 5.2 gate, unchanged from Architecture §14)
- T12's `win32` branch of `POST /api/export/open-folder` — stays `501
  OPEN_FOLDER_UNSUPPORTED` until U2 is verified on a real Windows machine
  (binary path, `shell:false` argument handling, and the exit-code-on-
  success question). Not a regression — Architecture explicitly forbids
  implementing this branch yet.

## 2026-09-18 — Import phone recording, batch 1: server foundation (TV1–TV8, Architecture.md v3.0 §V)

Implemented TV1–TV8 from `docs/Architecture.md` §V13 Task Breakdown. TV9–TV17
(client UI, golden fixtures, `.opus`) are explicitly out of scope for this
batch. `npm test` is green (174/174, including every pre-existing test).
**Not closed per Protocol 5.4**: U-V7 (a real per-provider smoke test) was not
run — see "Known gaps" below. TV2/TV3 must not be declared done until it runs.

### TV1 — `server/stt/formats.js` + format capability table + `GET /api/stt/providers` extension
- `server/stt/formats.js` (new): single source for `EXTENSION_MIME`,
  `MIME_ENCODINGS`/`encodingForMime` (the literal function
  `server/stt/providers/google.js` calls to reject a format — refactored out
  of `google.js` so the "table sent to the client" and "table the server
  enforces" cannot drift, BR-141), `PROVIDER_FORMATS` (soniox/deepgram/
  whisper declared as data, sourced from each provider's official docs
  fetched by Tech Lead in the Architecture session; google's `accepted`/
  `rejected` are *computed* by running every known extension through
  `encodingForMime`, not hand-typed), `APP_ACCEPTED_EXTENSIONS` (union),
  `extensionOf`, `statusFor`, `resolveAudioMime`.
- `server/stt/index.js` `listProviders()`: each provider entry now also
  returns `maxUploadBytes` (read straight off `adapter.maxUploadBytes`, the
  exact constant `stt.transcribe` enforces) and `formats`. Built from an
  explicit field whitelist as before — R-AE test asserts a body built with
  `SONIOX_API_KEY=SECRET-123` never contains the string `SECRET`.
- `server.js`: `GET /api/stt/providers` now also returns `maxAudioBytes`
  (`MAX_AUDIO_BYTES`) and `appAcceptedExtensions`. `saveAudio` now resolves
  the stored mime via `resolveAudioMime(header, filename)` instead of trusting
  a possibly-empty/`application/octet-stream` `Content-Type` header verbatim.
- `server/stt/providers/{soniox,deepgram,whisper}.js`: each now imports and
  re-exposes `PROVIDER_FORMATS.<id>` as `adapter.formats` (Protocol 8.3 —
  pipeline/route code asks the adapter object, never branches on provider
  name). `google.js`'s local `encodingForMime` was deleted in favor of the
  shared one.
- `test/stt-formats.test.js` (new): pure-function tests for all of the above,
  the Google-derived-not-hand-typed regression, and 2 real-server integration
  tests (`GET /api/stt/providers` shape + secret-leak guard; a `.wav` upload
  with an empty `Content-Type` still gets stored as `audio/wav`).

### TV2 — Google `duration` fix (R-AB) + `durationKind` (R-AC)
- `server/stt/providers/google.js`: `duration` is now
  `max(resultEndTime of every result, endTime of every word)`, falling back
  to the pre-existing (wrong but non-crashing) "start of the last word"
  formula only when neither field is present/positive. `durationKind` is
  always `'speech-end'` for Google (still not real audio length — silence
  after the last word is never counted). `POLL_TIMEOUT_MS` 15min → 3h
  (BR-102, same change applied to Soniox's 30min → 3h).
- `server/stt/contracts.js`: `normalizeResult` now also validates/passes
  through `durationKind` (`'audio-length'|'speech-end'|'none'`, anything else
  → `'unknown'`).
- `server/stt/index.js` `transcribe()`: after normalizing, if the adapter
  declares `durationKindFor(model)` (Protocol 8.3 capability), its return
  value overrides whatever the raw result claims — one place decides, so an
  adapter forgetting to set `durationKind` on a particular code path can
  never silently ship `'unknown'`. All 4 adapters now implement
  `durationKindFor`: soniox/deepgram → always `'audio-length'`; whisper →
  `'audio-length'` for `whisper-1`, `'none'` for `gpt-4o-*` (duration is
  always 0 for those models); google → always `'speech-end'`.
- **Known gap, Protocol 5.4**: no Google API key/real response was available
  in this environment to build a golden fixture. `tests/fixtures/google/`
  does **not** exist. Added a unit test for the pure arithmetic (max of two
  numeric candidates + the string-parse helper `parseGoogleSeconds`) using
  synthetic numbers, explicitly NOT claiming this substitutes for a real
  captured response — see `test/stt.test.js`'s existing Google test (URL
  routing only, also synthetic) for the established precedent of what this
  codebase already accepts as a unit-level (not golden-file) test for this
  provider. **TV2 must not be declared closed** until U-V7 runs with a real
  key.

### TV3 — `server/stt/merge.js`: `computeTimeline` + `buildMergedTranscript`
- Pure functions per Architecture §V4.3. `computeTimeline(parts, {gapSeconds})`
  returns parts **in their original array order** (never silently reordered
  on the caller), each carrying `spanSeconds`/`offsetSeconds` computed by
  walking the parts in `order` sequence. `buildMergedTranscript(parts)`
  (expects parts already timelined) inserts one `part-divider` segment per
  part and, for a non-completed part, exactly one `part-gap` segment; sums
  `duration` from completed parts' `spanSeconds` only (no gap seconds, no
  failed/dropped parts); `durationEstimated` true if any completed part's
  `durationKind !== 'audio-length'`; `missingParts` = orders of failed/dropped
  parts.
- **Decision made without an explicit Architecture answer**: the dropped-part
  gap text (FAI-10 pattern, "Thiếu đoạn … (đã bỏ phần N).") needs a time
  range, but Architecture's own worked example (§V3.3 JSON) uses what reads
  as **wall-clock** times ("15:19 → 16:07", stated elsewhere as spanning "48
  phút" — only consistent as clock-of-day, not as mm:ss elapsed time), while
  `buildMergedTranscript(parts)`'s documented signature takes **only**
  `parts[]`, no `meeting.date`. A pure function with that signature cannot
  compute a wall-clock time. Implemented the range using **elapsed time
  within the merged timeline** (`formatClock`, mm:ss / h:mm:ss) instead —
  fully determined by the available inputs. Flagged for Tech Lead/UX: if a
  wall-clock range is actually required, it needs either `meeting.date` added
  to this function's signature or to be composed client-side in TV12/TV14
  (out of this batch's scope) instead.
- `test/merge-timeline.test.js` (new): all 5 PRD §12 provider scenarios
  (including `duration=0` gpt-4o-* and Google's start-of-last-word fallback
  edge), strictly-increasing/non-overlapping offsets across mixed statuses,
  duration summation rule, `durationEstimated` truth table, failed/dropped/
  queued gap segments with lineage assertions (exact `time`/`part` values,
  not just "a segment exists"), and the "empty-transcript-from-provider looks
  exactly like a failed part" case.

### TV4 — `server/meeting-parts.js`: normalization, capabilities, ownership merge
- New module (Architecture §V3/§V3.6/§V11): `normalizePart` (defensive
  re-clamp of a stored/incoming part — **must be idempotent**, see the
  `clientDurationSeconds` bug below), `meetingCapabilities(meeting)` (the
  Protocol 8.3 capability object: `multiPart`, `singleAudioPlayback`,
  `inlineTranscriptEdit`, `durationIsAudioLength`, `qualityWarningEligible`,
  `summaryNeedsMissingPartConfirm`), `rebuildMergedMeeting` (the one function
  every part-mutating operation ends with — recomputes
  transcript/duration/durationEstimated/missingParts/`sonioxUsage`/`status`
  together, so they cannot drift apart), `aggregateUsage` (§V3.4 — `sonioxUsage`
  becomes a sum across completed parts, `partCount`/`partsCounted` added,
  `provider`/`model`/`pricingUsdPerHour` collapse to `'mixed'`/`null` on
  disagreement), `registerParts`/`applyPartResult`/`markPartFailed`/
  `markPartRunning`/`retryPart`/`dropPart`/`reorderParts` (each pure,
  meeting-in/meeting-out), `applyTranscriptEdits` + `preserveServerOwnedFields`
  (§V3.6 R-R: a stale `completed` client snapshot can no longer wipe
  `parts`/`duration`/`status`/`sonioxUsage`; an inline transcript edit is
  matched positionally by `partId`+`srcIndex` and, on any structural mismatch,
  the **entire** incoming transcript is ignored rather than partially applied).
- `server.js` `PUT /api/meetings`: added a check for
  `current.parts?.length > 0` (checked **before** the pre-existing
  single-part `'processing'`-only guard) that routes through
  `preserveServerOwnedFields` — the single-part guard is otherwise untouched,
  confirmed by the pre-existing `test/jobs.test.js` "stale processing
  snapshot" test still passing unmodified.
- **Bug found and fixed during testing (not in the original plan)**:
  `normalizePart`'s `clientDurationSeconds` clamp used
  `Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) :
  null` — since `Number(null) === 0` in JS, running an already-normalized
  part (`clientDurationSeconds: null`) back through `normalizePart` a second
  time (which every route that reads-then-writes a part does, by design)
  silently turned `null` into `0`. Caught by `test/parts-routes.test.js`'s
  retry test (part 1's re-serialized JSON differed from before). Fixed with
  an explicit `null`/`undefined` check in both `server/meeting-parts.js` and
  the equivalent client-side sanitizer in `js/storage.js` (`_sanitizeImportedPart`
  had the identical bug, same fix applied there too, TV8).
- `test/meeting-parts.test.js` (new): `isValidPartId`, `meetingCapabilities`
  truth tables, `registerParts` limits/ordering, `applyPartResult`/`dropPart`/
  `reorderParts` isolation (each only touches the part it's supposed to), and
  3 `preserveServerOwnedFields` tests (stale-completed-snapshot cannot wipe
  parts; single-part meeting entirely unaffected — test hồi quy; inline edit
  written back to the correct part + a structural-mismatch snapshot ignored
  wholesale).

### TV5 — Job queue: 2 concurrent, `partId`, `STT_API_TIMEOUT_MS`, watchdog, recover-queued
- `server.js`: `STT_API_TIMEOUT_MS` (30 min, new) replaces
  `LLM_API_TIMEOUT_MS` (2 min) as `createSttService`'s `timeoutMs` — the
  pre-existing bug where a large Deepgram/Whisper upload (which happens
  inside the same HTTP call) had only 2 minutes to complete.
  `MAX_CONCURRENT_TRANSCRIPTIONS = 2` (BR-88, **not yet measured** under a
  real 2×500MB load — U-V3, unchanged from Architecture's own caveat).
  `JOB_MAX_WALL_MS` (6h, overridable via `MEETNOTE_JOB_MAX_WALL_MS` for
  tests) watchdog (`sweepStuckJobs`, polled every
  `MEETNOTE_JOB_WATCHDOG_INTERVAL_MS`-or-5min) marks a job stuck past that
  wall time `failed`/`STT_JOB_TIMEOUT` — and a job `finishJob` only ever
  overwrites once (`stored.status === 'processing'` guard), so a stray late
  provider response can never resurrect a job the watchdog already declared
  dead back to `'completed'`.
- Job dedupe key changed from `meetingId` to `` `${meetingId}#${partId||''}` ``
  (both `runningJobs` in-memory map and `findActiveJob`) — a single-part job's
  key is `` `${meetingId}#` ``, identical dedupe behavior to before.
  `openStoredAudio(job.partId || job.meetingId)` (M5 — retrying/running part 2
  can never accidentally load part 1's or the whole meeting's audio).
  `recoverInterruptedJobs` now only fails jobs that were actually
  `'processing'` at restart; a `'queued'` job (never called a provider) is
  left as-is for the scheduler to run right after boot
  (`pumpJobQueue()` added to the startup chain).
- New `pumpJobQueue()` is the single scheduler entry point: promotes the
  oldest `'queued'` jobs to `'processing'` up to
  `MAX_CONCURRENT_TRANSCRIPTIONS`, called after every job creation, after
  every job finishes (`.finally()`), and once at boot. `POST
  /api/import-transcription` now always creates a `'queued'` job and calls
  `pumpJobQueue()` before responding, so the pre-existing "returns 201 with
  status:'processing'" contract still holds whenever there's queue capacity
  (verified: this test was **not modified** and still passes).
- **Deviation from Architecture §V6.7, flagged**: `POST
  /api/import-transcription` was **not** given the R-S provider/model
  whitelist check the doc asks for. The pre-existing `test/jobs.test.js`
  deliberately posts `provider: 'invalid-test-provider'` and asserts a `201`
  (to simulate an async-failing job without a real network call) — adding a
  synchronous whitelist rejection here would return `400` instead and break
  that regression test. R-S **is** enforced on the brand-new `POST
  /api/meetings/:id/parts` route (no legacy caller to break). Flagged for
  Tech Lead: either accept the legacy endpoint keeping its lenient contract,
  or approve rewriting `test/jobs.test.js`'s fixture to use a real (but
  unconfigured) provider id instead of the sentinel string.

### TV6 — 5 multi-part routes + `POST /api/import-transcription` `partId` support
- `server.js`, all under `/api/` (same `hasTrustedHost`/`isTrustedApiRequest`
  gate as every other route, no route accepts a file path):
  - `POST /api/meetings/:id/parts` — validates `partId` shape, the R-S
    provider/model whitelist (`stt.validateSelection`, new export on the STT
    service), re-checks each part's real on-disk size (`fs.stat` via
    `openStoredAudio`, never the client's claimed `sizeBytes`) and format
    (`statusFor(adapter.id, extension)`) before creating anything;
    `409 MEETING_NOT_MULTIPART` if the meeting already holds a finished
    single-part recording (E-V4 — no upgrade path in v1); bumps
    `promptContextUpdatedAt`.
  - `POST /api/meetings/:id/parts/:partId/retry` — only ever mutates the one
    part + creates one job; `409 PART_ALREADY_RUNNING` if it's
    `queued`/`processing`.
  - `POST /api/meetings/:id/parts/reorder` — pure (`reorderParts`, no I/O),
    `400 PARTS_ORDER_INVALID` on anything but a full permutation of the
    current part ids; never touches `summary`/`summaryPreset`/
    `summaryGeneration`.
  - `DELETE /api/meetings/:id/parts/:partId` — flips status to `'dropped'`,
    **never** deletes the audio file (BR-103/BR-134).
  - `GET /api/meetings/:id/parts` — compact poll shape, no transcript content.
- **Deviation from Architecture §V6.2, flagged**: an unknown provider on
  `POST /parts` returns the pre-existing `STT_PROVIDER_NOT_FOUND` status code
  (**404**, `server/stt/contracts.js STATUS_BY_CODE`, used identically by
  every other STT-provider route in this codebase) rather than the literal
  "400" Architecture's prose states. Kept consistent with the established
  one-code-one-status convention instead of introducing a route-specific
  exception. Flagged for Tech Lead to confirm.
- `test/parts-routes.test.js` (new, 15 tests): register (N parts → 1
  meeting + N jobs; unknown provider rejected + nothing created; malformed
  partId rejected; 11th part rejected; finished-single-part conflict), retry
  (isolation — part 1 byte-for-byte unchanged, exactly 1 new job; already-
  running → 409), reorder (0 new jobs, order + summary/preset/generation
  fields verified before/after), drop (audio file count on disk unchanged,
  permanent gap text), poll (no transcript field present), and a security
  test hitting all 5 routes with a DNS-rebinding `Host` header (all 403).
  The retry/reorder tests seed an already-built multi-part meeting directly
  via `PUT /api/meetings` (using the real `rebuildMergedMeeting`) instead of
  through `POST /parts`, specifically so they don't depend on a real STT
  provider (or this machine's Keychain) ever resolving — see "Known gaps".

### TV7 — Prompt: per-part labels + merged-recording context, `PROMPT_VERSION` → v5
- `server/llm/prompts.js`: `formatTranscript` (shared by `buildSummaryPrompt`
  and `buildChunkPrompt`) now renders a `part-divider`/`part-gap` segment as
  `--- text ---` and a segment with `.part` as
  `[m:ss] Speaker (Phần N): text` — a segment without `.part` renders
  **exactly** as before v5 (verified byte-for-byte in tests). `buildContextBlock`
  adds up to 3 header lines (`Recording parts: N (merged from N separate
  audio files)`, the "do not merge speakers across parts" instruction, and a
  "Missing parts: …" line) only when `meeting.partCount > 0` — a no-op
  otherwise, so a single-part meeting's `buildContextBlock`/prompt output and
  `contextUsed` shape are unchanged (test hồi quy). `contextUsed` gains
  `merged`/`partCount`/`missingParts` (BR-39/BR-135 provenance), again only
  when `partCount > 0`. `buildTitlePrompt` now filters out any segment
  carrying `.kind` (V11#20 — it has no divider/gap rendering of its own).
  `PROMPT_VERSION` → `'meeting-summary-v5'`.
- `server.js` `validateMeetingForSummary`: now preserves `segment.kind`/
  `segment.part` and adds `partCount`/`missingParts` on the returned meeting
  — without this, `buildContextBlock`'s new lines and `formatTranscript`'s
  per-part labels can never fire no matter what the client sends (same class
  of bug BR-32 fixed for notes/pre-meeting info in the previous batch).
- `js/summary.js` `_payload`: now sends `partCount` (`meeting.parts.length`)
  and `missingParts` alongside the already-forwarded `transcript` (which
  already carries `.kind`/`.part` whenever `meeting.transcript` does — no
  change needed there, it was never filtering those fields out).
- `test/prompt-parts.test.js` (new): `formatTranscript` divider/labeled/
  single-part-unchanged cases, `buildContextBlock` merged-lines/missing-line/
  single-part-unchanged cases, all 3 builders carrying the part-2 label
  (including a chunk that starts mid-part-2), `buildSynthesisPrompt`'s merged
  + no-cross-part-speaker-merging lines, the single-part
  byte-for-byte-unchanged regression, and `buildTitlePrompt`'s divider
  filtering.
- Updated `test/context-prompt.test.js`'s pre-existing `PROMPT_VERSION`
  pin test (`'meeting-summary-v4'` → `'meeting-summary-v5'`) — intentional,
  per the version bump this task requires.

### TV8 — Client data layer: `parts` + 5 new fields, `promptContextUpdatedAt` bump, audio cleanup
- `js/storage.js`: `saveMeeting` now bumps `promptContextUpdatedAt` (BR-146)
  whenever any of the 8 prompt-relevant fields (`title`/`date`/`duration`/
  `participants`/`meetingType`/`topic`/`leadBy`/`notes`) actually changes on
  an **update** (never on first creation) — the single place this logic
  lives, per Architecture §V3.7. `_sanitizeImportedMeeting` (backup restore)
  now whitelists `source`/`sourceFilename`/`sourceSizeBytes`/
  `durationEstimated`/`missingParts`/`promptContextUpdatedAt`/`parts`
  (≤10, each through the new `_sanitizeImportedPart`, mirroring
  `server/meeting-parts.js normalizePart`) — **fixes the pre-existing bug**
  where `sourceFilename` was silently absent from the whitelist entirely
  (BR-112/BR-137), and would previously have dropped an entire merged
  meeting's `parts` on backup restore.
- `js/app.js`: new `_audioIdsForMeeting(meeting)` helper (returns every
  part's `partId` for a merged meeting, else `[meeting.id]`) used by both the
  single-meeting delete confirmation and the bulk-delete flow, so deleting a
  merged meeting frees all N audio files instead of leaving N-1 orphaned on
  disk (V11#8/R-Q).
- See TV4 above for the `clientDurationSeconds` idempotency bug fixed in
  `_sanitizeImportedPart` at the same time it was found in
  `server/meeting-parts.js`.

### Test suite
- New: `test/stt-formats.test.js`, `test/merge-timeline.test.js`,
  `test/meeting-parts.test.js`, `test/parts-routes.test.js`,
  `test/prompt-parts.test.js` (5 of the 6 files Architecture §V2 named for
  this feature; `test/import-preflight.test.js` is TV9, next batch).
- Updated: `test/context-prompt.test.js` (`PROMPT_VERSION` pin).
- **Pre-existing flaky test fixed opportunistically (out of this batch's
  file scope, but blocking a reliable green run)**: `test/pre-meeting-fields.test.js`
  hardcoded port `8796`, which silently collided with
  `test/export-routes.test.js`'s `PORT + 1` (`8795 + 1 = 8796`) fresh-server
  test — an intermittent `SocketError` depending on `node --test`'s parallel
  file scheduling. Moved to `8802`. Chose `8800`/`8801` for
  `test/parts-routes.test.js`/`test/stt-formats.test.js`.
- `npm test`: 174/174 passing, confirmed stable across 4 consecutive full
  runs (no flakes observed after the port fix above).

### Known gaps / escalations for Tech Lead+QA before this batch can close
1. **U-V7 blocks closing TV2/TV3** (Protocol 5.4): no real per-provider smoke
   test was run (no API keys available in this environment). Must be run on
   a machine with at least one provider key before TV2/TV3 are "done".
2. **U-V3** (RAM under 2×500MB concurrent transcription) still unmeasured —
   unchanged from Architecture's own caveat, `MAX_CONCURRENT_TRANSCRIPTIONS`
   shipped at 2 as specified.
3. Two literal-text deviations from Architecture, both because implementing
   them as written would break a pre-existing regression test or an
   established codebase-wide convention (detailed under TV5/TV6 above):
   `POST /api/import-transcription` provider whitelist (R-S) not added;
   `POST /parts` unknown-provider status code is 404, not 400.
4. TV3's dropped-part gap text uses elapsed (not wall-clock) time — see TV3
   above; may need revisiting once TV12/TV14 (next batch) render it.
5. TV17 (`.opus`) was **not** touched, per its explicit gate.
6. Reviewer has not yet run on this batch (Protocol 7) — do not treat
   anything in this entry as "approved", only as "implemented and
   self-tested".

## Fix — stale meeting snapshot làm BR-63 (notes ghi đè transcript) không hoạt động (2026-09-18)

**Bug**: `_bindMeetingDetail(meetingId)` fetch `const meeting = Storage.getMeeting(meetingId)` một lần duy nhất lúc mở trang. Sau khi sửa Notes + Save (lưu đúng vào storage), bấm Generate Summary ngay trong cùng phiên xem trang (không reload) vẫn gửi `meeting.notes` CŨ lên server — vì handler dùng nhầm biến `meeting` (closure cũ) thay vì `before` (bản fetch fresh ngay phía trên trong cùng handler). Hệ quả: BR-63 (notes ghi đè transcript nghe nhầm) và phần suy luận tên người nói dựa vào notes không có dữ liệu để hoạt động — lỗi im lặng, không có cảnh báo nào cho user.

**Fix**: `js/app.js` — đổi `Summary.generate(meeting, ...)` thành `Summary.generate(before, ...)` trong handler Generate Summary.

**Review**: APPROVE (Protocol 7, xem `docs/review-report.md`). `npm test`: 174/174 pass.

**Phát hiện phụ (Low, không chặn, ghi lại phòng ngừa)**: `copy-transcript` handler dùng closure `meeting.transcript` cũ nhưng vẫn đúng do `transcript` là mảng share reference qua shallow clone của `Storage.getAllMeetings()` — inline-edit transcript mutate in-place nên phản ánh cả ở object cũ. Đúng nhưng fragile — nếu sau này `getAllMeetings()` đổi sang deep-clone, chỗ này sẽ vỡ âm thầm.

## Ghi nhận — user test 32kbps, kết luận sơ bộ (2026-09-18)

User thử ghi âm sau khi hạ bitrate xuống 32kbps, quan sát: câu nói nhỏ/ở xa vẫn tách đúng, một số từ "dễ" (rõ ràng) lại nhận sai. User tự kết luận nguyên nhân nhiều khả năng do giới hạn model STT (từ vựng/tên riêng ít gặp), không phải do chất lượng file bị nén thấp — khớp với phân tích: lỗi do bitrate thấp thường biểu hiện ngược lại (tiếng nhỏ/xa mất trước, tiếng rõ bền hơn), còn lỗi từ vựng xảy ra ở mọi mức bitrate.

**Trạng thái verify Protocol 5 cho thay đổi 32kbps**: đây là quan sát không chính thức (chưa có test A/B cùng nội dung ở 2 mức bitrate). Đủ để KHÔNG phải revert thay đổi, nhưng CHƯA đủ để coi là "đã verify đầy đủ" theo đúng nghĩa Protocol 5 (golden-file so sánh WER 32kbps vs 130kbps). Giữ nhãn `[CHƯA VERIFY]` ở `js/recorder.js` cho tới khi có test A/B chính thức.

Lỗi nhận sai từ vựng riêng lẻ (không liên quan bitrate) → hướng xử lý đúng là BR-63 (notes ghi đè transcript), đã fix ở phần trước trong cùng ngày.

## 2026-09-18 — Import phone recording, batch 2: client UI + golden fixtures (TV9–TV16, Architecture.md v3.0 §V13)

Implemented TV9–TV16 from `docs/Architecture.md` §V13 Task Breakdown. TV17 (`.opus`) stays gated
per U-V1, untouched. `npm test` is green (211/211 passing + 2 explicitly skipped — see TV16).
**Reviewer has not run on this batch (Protocol 7)** — treat everything here as "implemented and
self-tested", not "approved". Per PM's instruction this batch is reviewed together with batch 1
(TV1–TV8).

### TV9 — `js/import-preflight.js` (pure) + tests
- `classify(file, providerId, providersPayload)`: returns `blockA` (EXT_UNSUPPORTED/EMPTY_FILE —
  dead end regardless of provider) or `blockB` (PROVIDER_REJECTS_FORMAT/TOO_LARGE_FOR_PROVIDER —
  recoverable by switching provider) or `ok`. Reads `providersPayload.appAcceptedExtensions` and
  `providers[].formats/maxUploadBytes` — the exact TV1 response shape — never a second hand-typed
  extension/size table (BR-141). `providersPayload === null` (BR-142, endpoint unreachable) →
  every file is `ok` with `preflightUnavailable: true`, never fail-closed.
- `alternatives` (for the B1/B2/B3 UX variants) lists every OTHER provider that can actually take
  the file (format **and** size), each tagged `ready` — the renderer (not `classify`) decides
  B1/B2/B3 from that list's shape, documented in the module's own header comment.
- `findDuplicateMeeting`/`findDuplicateInBatch` (BR-109/139, name+size match, never content
  hashing), `capImportBatch` (BR-88, reports the exact rejected count instead of silently
  dropping), `formatMbVi` (Vietnamese decimal-comma formatting per UX §6 quy ước).
- `test/import-preflight.test.js` (13 tests): every acceptance row in Architecture §V13 TV9,
  including the "merged mode never sums part sizes" case and a B2 (ready:false) case.

### TV11 (ordering half) / TV12 (capabilities) — `js/parts.js` (pure) + tests
- `meetingCapabilities(meeting)`: a **client-side mirror** of `server/meeting-parts.js`'s function
  of the same name (Protocol 8.3) — deliberately re-implemented rather than shared via `require()`
  since this file runs unbundled in the browser; comment says explicitly to keep the two in sync
  by hand if the server one changes.
- `suggestPartOrder(files)` implements BR-119's exact 3-step priority (natural filename sort when
  ≥1 digit present **and** the sort actually distinguishes every file with no ties → `lastModified`
  ascending when every neighbor differs by ≥1s → original pick order). **Bug caught by its own
  test**: the first version checked `/\d/.test(filename)` on the WHOLE filename, so a plain
  `ghi-am-chieu.m4a` "had a digit" (the `4` in `m4a`) and always sorted by name even with zero real
  numbering — fixed by stripping the extension before the digit check.
- `gapWarningSeconds`/`classifyGap` (ERR-10/ERR-11, ≤soft warning only — R-O `[UNVERIFIED]`
  `lastModified` reliability, same caveat as BR-119), `qualityWarning` (BR-106: real words-per-
  minute over a ≥5-minute duration, ignoring `part-divider`/`part-gap` segment text), `formatDDMM`
  (Vietnamese dd/mm for ERR-07/DAT-01/DAT-03 inline microcopy — kept separate from `js/utils.js`'s
  English date formatting per BR-147).
- `test/parts-order.test.js` (17 tests).

### TV10/TV11 — `js/import.js` (modal), `index.html`, `css/components.css`
- New `Import` global replaces the old `App._handleUpload` (deleted) — `dash-upload` now calls
  `Import.open()`. State machine: state A (empty) → B (1 file) → C (≥2 files, "nhiều cuộc họp
  riêng", default) → 4b (≥2 files, "1 cuộc họp gồm N phần", `.import-mode-switch` only shown at
  ≥2 files). Drag-and-drop: an in-modal dropzone plus a window-level overlay
  (`#import-app-dropzone`) that opens the modal on drop from anywhere in the app (BR-78).
- Per-file preflight re-runs on every provider change (ERR-03b "Dùng X cho lần này" /
  ERR-03c/03d "Hoàn tác", with a 600ms `.import-highlight-flash` on the STT config card so the
  user notices the config line that just changed even though they clicked a button elsewhere).
- Merged mode (4b): part list with drag-and-drop reorder (native HTML5 DnD) **and** ▲/▼ buttons
  (both required per TV11 acceptance), natural-sort/`lastModified` suggestion banner, per-pair gap
  warnings (ERR-10/ERR-11/MRG-15) via `Parts.gapWarningSeconds`, ≥6-part soft warning, 10s
  head/tail audio preview via a throwaway `<audio>` + `URL.createObjectURL` (V8.3 feature-detect:
  `loadedmetadata`/`error`/5s-timeout all funnel into the same "unavailable, disable the preview
  buttons only" path — never blocks import itself).
- Single/separate-mode submit reuses the **existing** `App._processUploadedRecording` +
  `App._pollJobStatus` machinery unchanged (per Architecture §V8.1's explicit instruction not to
  rewrite the working single-file path) — `_processUploadedRecording` gained one new optional 4th
  parameter (`sttOverride: {provider, model}`, BR-87) so the modal's per-import provider choice
  actually reaches `/api/import-transcription`, which it silently did **not** before this batch
  (the endpoint already accepted `provider`/`model`, nothing on the client ever sent them).
- Merged-mode submit: uploads every part's audio to `PUT /api/audio/<partId>` (partId generated
  client-side, `part-<uuid>`), then a single `POST /api/meetings/:id/parts` with the full ordered
  array (matching §V6.2's request shape) rather than one call per part.
- New `App._pollPartsStatus(meetingId)` (mirrors `_pollJobStatus` but polls the compact
  `GET /api/meetings/:id/parts` shape) — one poller per **meeting**, not per part/job, so N parts
  count as exactly 1 background task and fire exactly 1 completion toast (V11#25). Wired into
  `_resumeProcessingJobs` (V11#24): a `processing` meeting with `parts.length > 0` now resumes via
  this poller instead of the old single-job path.
- `css/components.css`: `.modal-lg`, `.import-dropzone`, `.import-app-dropzone`,
  `.import-file-row`/`.import-part-row` (+ `.is-dragging`/`.is-drop-target`), `.import-mode-switch`,
  `.import-highlight-flash`, `.segment-progress`, `.transcript-part-divider`, `.transcript-gap`,
  `.part-status-list` — everything else reuses existing classes per UX §7's "tái dùng" table.

### TV12 — Meeting Detail for a merged recording
- `js/app.js` `_renderMeetingDetail`: transcript rendering now branches on `segment.kind` —
  `part-divider`/`part-gap` render as `.transcript-part-divider`/`.transcript-gap` (never
  `contenteditable`, matching §V3.6's "chỉ segment thường mới sửa được"); a plain segment (every
  segment of a single-part meeting) renders **exactly** as before (verified in
  `test/export-markdown.test.js`'s equivalent client-side logic, and by inspection — the branch is
  dead code when no segment has `.kind`).
- Audio player: `capabilities.singleAudioPlayback` gates the existing single-file player;
  `capabilities.multiPart` renders a per-part `<audio>` playlist instead (`GET /api/audio/<partId>`
  — V11#22, `[SKIP-v1]` on a single combined file).
- New `_renderMultiPartSection`: a progress card (`N/M phần xong · đã X phút`, **no** fake
  percentage bar — BR-101) while `status === 'processing'`, and one error card per `failed` part
  with "Thử lại" / "Thử nhà cung cấp khác" (own confirmation modal warning that speaker
  labels/style may drift, BR-124's stated exception) / "Bỏ phần N khỏi bản ghi này" (its own
  confirm modal, then `DELETE /api/meetings/:id/parts/:partId` — audio is never removed, BR-134).
- `_renderQualityWarning` wires `Parts.qualityWarning` behind
  `capabilities.qualityWarningEligible` (BR-128 — never warn when `durationEstimated`, since the
  denominator can't be trusted). **Scope decision**: only implemented at whole-meeting granularity
  (QLT-01); the per-part variant (QLT-02, "Phần 2 có transcript ngắn bất thường") was not built —
  BR-106's own wording talks about "bất kỳ phần nào", which reads as multi-part-specific, and
  Architecture's TV12 acceptance row doesn't literally require the per-part text. Flagged for
  PM/UX to confirm whether QLT-02 is actually required before closing this task.
- Header badges: `Nhập từ file` (BR-108, `meeting.source === 'import'` — this field has existed
  since TV8 batch 1 but nothing ever displayed it until now) and `Thiếu N phần`
  (`missingParts.length`).
- Generate Summary: disabled outright (PRG-13 tooltip) while any part is `queued`/`processing`
  (`_anyPartRunning`); when `capabilities.summaryNeedsMissingPartConfirm` is true instead, the
  button stays enabled but a new confirmation modal (`_confirmMissingPartsSummary`) runs first,
  naming the missing part number(s) — implements the E-V1 PM decision (BR-135 wins over the older
  UX §5.4b/§5.7b "disable outright" text). **New microcopy, not in UX §6**: the confirmation
  modal's title/body ("Tóm tắt khi bản ghi còn thiếu phần?" / "Bản ghi này đang thiếu phần …") was
  written by Dev for this task — flagged for PM/UX to review/replace.

### TV13 — Pre-meeting info: `date` + `participants`, for every meeting
- `js/app.js` Pre-meeting info card gained a `date` editor (`<input type="datetime-local">`,
  feature-detected at runtime exactly like `js/import.js`'s own detector — falls back to a
  `date`+`time` pair per U-V6) and a `participants` chip editor (`.chip`/`.chip-remove`, Enter to
  add / click to remove — reusing the existing chip pattern, a lighter-weight sibling to the Tags
  editor rather than literally the `.tag-chip`/color-hash machinery, since participants don't need
  `tagStyle`'s hue coloring).
- Blanking the date field and blurring restores the previously-saved value (never falls through to
  "now") — `restoreDateIfBlank`, bound to both the `datetime-local` input and the fallback `date`
  input.
- Save button (`save-premeeting`) now also writes `date`/`participants`, toasts the new Vietnamese
  DAT-02 copy ("Đã lưu thông tin cuộc họp", replacing the old English "Pre-meeting info saved" —
  this button now saves the TV13 fields UX explicitly names for this exact toast), and shows the
  DAT-03 toast ("Đã chuyển bản ghi này sang ngày …") only when the **calendar day** actually
  changed, not just the time (§5.9.2). Existing `promptContextUpdatedAt`/BR-146 bump logic in
  `Storage.saveMeeting` already covers `date`/`participants` unchanged from TV8 — no changes needed
  there.
- Header meta line gains the DAT-01 hint ("Nhập vào MeetNote ngày dd/mm") whenever `date` and
  `createdAt` differ by more than 1 day, in either direction; the same sentence repeats under the
  date editor in the Pre-meeting card.
- All Meetings list (`_renderMeetingItem`) gains the DAT-07 "Mới nhập" badge
  (`_isRecentlyImportedPastDate`: `createdAt` within the last 24h **and** `|date − createdAt| > 1
  day`) so a meeting whose date was just set to the past doesn't silently vanish off the top of the
  date-sorted list (§5.9.3 WHY).

### TV14 — Export .md for a merged recording
- `js/export.js` `toMarkdown`: a `part-divider` segment now renders as `### Phần N/M · filename`
  (stripped of the em-dashes) instead of the generic `**[time] speaker:**` line; a `part-gap`
  segment renders as `*⚠ <text>*` — both branches are unreachable for a single-part meeting (no
  segment there ever has `.kind`), which is the mechanism behind the mandatory byte-for-byte
  regression guarantee. A new top-of-file line (`⚠ Bản ghi này còn thiếu phần N.`) fires whenever
  `meeting.missingParts` is non-empty, independent of `includeTranscript` (BR-129/PRG-17).
- `js/app.js` `_openExportModal` shows the same warning line before the user confirms export.
- `js/export.js` gained a `module.exports` guard at the bottom (same no-op-in-browser pattern as
  `js/meeting-types.js`/`js/tags.js`) purely so `test/export-markdown.test.js` could `require()` it
  directly — **not** a behavior change (`typeof module` is always `'undefined'` in the browser).
- `test/export-markdown.test.js` (4 tests, `Utils`/`Summary`/`meetingTypeByCode` stubbed as
  minimal globals since `js/export.js` has no module system of its own): the mandatory single-part
  byte-for-byte case, divider ordering, missing-part warning + permanent gap marker both surviving
  export, and the warning appearing even with `includeTranscript:false`.

### TV15 — Attach a recording to an existing draft (BR-98)
- `js/app.js`: Meeting Detail shows a "Gắn file ghi âm" button when a meeting has no `audioId`,
  an empty transcript, and is not already multi-part — opens `Import.open({ attachMeetingId })`.
  `js/import.js`'s attach mode skips the context-fields block entirely (the draft's own context is
  already there), restricts intake to exactly 1 file, and re-verifies eligibility again right
  before upload (defense in depth against the meeting having changed in another tab).
- **Decision made without an explicit Architecture answer**: `server.js` `POST
  /api/import-transcription` now rejects (`409 MEETING_ALREADY_HAS_TRANSCRIPT`) a **non-partId**
  submission for a meeting whose `transcript` is already non-empty. Architecture §V13 TV15 lists
  `server.js` as a touched file but doesn't specify what the server-side change should be. Chosen
  guard: block only on a non-empty **transcript** (not on `audioId` presence) — a meeting whose
  audio upload succeeded but whose transcription then FAILED still has an empty transcript, so
  "Thử lại" (retry) on a genuinely failed single-part job is completely unaffected; only a meeting
  that already finished successfully is protected from a silent overwrite. Verified with a new
  test in `test/jobs.test.js` covering both the rejection and the still-allowed retry case.

### TV16 — Golden fixtures + Protocol 6.3 lineage test
- **Real smoke test run on this dev machine for 2 of 4 providers** (Soniox and Deepgram — both
  have a real API key already in this machine's macOS Keychain, verified present via `security
  find-generic-password` without ever reading/printing the key value). Generated a real ~4.93s
  Vietnamese speech `.wav` on-device via macOS `say -v Linh` (a real system TTS tool, not a
  fabricated fixture), ran it through the actual running MeetNote server end-to-end
  (`PUT /api/audio/:id` → `POST /api/import-transcription` → poll → `GET /api/data`), and — via a
  **temporary** one-line capture inserted into `server/stt/index.js`'s `transcribe()` (reverted
  immediately after, confirmed by `git diff` showing zero net change to that file) — captured the
  literal object each adapter's `transcribe()` returned, i.e. the exact `raw` input
  `normalizeResult()` consumes.
  - `tests/fixtures/soniox/real-transcribe-vi.json`, `tests/fixtures/deepgram/real-transcribe-vi.json`:
    real `raw` + the real captured `expectedNormalized` output, with `_capturedBy`/`_method`
    documenting the exact real steps (Protocol 5.3 — no hand-written mock).
  - Whisper and Google: **no key available** (checked both env vars and macOS Keychain, both
    absent) — no fixture was written for either. `test/stt-golden.test.js` explicitly `t.skip()`s
    them with a message pointing at Architecture §V12.4 U-V7, rather than silently passing or
    inventing a fixture.
  - This **partially closes U-V7** for TV2/TV3 (Soniox/Deepgram now have a real run proving
    `durationKind: 'audio-length'` and a correct `duration`); Whisper/Google remain unverified —
    TV2/TV3 still cannot be declared fully closed per Protocol 5.4 until those two also get a real
    run.
- `test/stt-golden.test.js`: the 2 real-fixture regression tests (`normalizeResult(fixture.raw,
  provider)` deep-equals `fixture.expectedNormalized`), the 2 skip stubs, and a Protocol 6.3
  end-to-end lineage test — 3 simulated parts (part 1 = the real Soniox capture, part 2 = a
  deliberately synthetic FAILED part, part 3 = the real Deepgram capture) run through
  `applyPartResult`/`markPartFailed` (M7) → the internally-triggered `rebuildMergedMeeting` (M8-10)
  → `buildSummaryPrompt`/`buildChunkPrompt`/`buildSynthesisPrompt`/`buildContextBlock` (M13/V5.3),
  asserting **exact values** at every step (real segment text at the real computed offset, the
  real `duration` sum, `missingParts`, the gap segment's exact text, monotonically increasing
  timestamps across a 2-real-provider + 1-synthetic-failure mix, and the real text appearing with
  the correct `(Phần N)` label in a chunk that starts mid-part-3) — not just "it ran".
- The full end-to-end **real** 3-file multi-part run QA is asked to do before release (Architecture
  §V13 TV16 note, Protocol 6.3) was **not** attempted here — that is explicitly QA's task, not
  Dev's, per the Architecture note under the TV16 row.

### Test suite
- New: `test/import-preflight.test.js` (13), `test/parts-order.test.js` (17),
  `test/stt-golden.test.js` (5, 2 skipped), `test/export-markdown.test.js` (4). Extended:
  `test/jobs.test.js` (+1, TV15).
- `npm test`: 211 passing, 2 skipped (Whisper/Google golden fixtures — no key on this machine),
  0 failing.

### Decisions made without an explicit Architecture/UX answer (flagged for PM/UX)
1. **E-V1 confirmation modal copy** ("Tóm tắt khi bản ghi còn thiếu phần?" / body naming the
   missing part) — not in UX §6, authored by Dev for this task.
2. **E-V2 app-limit wording** for Soniox/Deepgram/Google's `TOO_LARGE_FOR_PROVIDER` case
   ("MeetNote giới hạn X cho <provider>", `microcopyId: 'ERR-02-app-limit'`) — E-V2 itself flags
   this as needing PM/UX approval; ERR-02's literal wording is kept only for Whisper.
2b. Retry-with-a-different-provider modal's own copy ("Nhãn người nói và văn phong của phần này có
   thể lệch…") — also new, expressing BR-124's stated exception in a place UX §6 doesn't cover.
3. **BR-106 quality warning scope** — implemented as a single whole-meeting check (QLT-01) only;
   the per-part QLT-02 variant was not built (see TV12 above).
4. **TV15 server guard shape** — `409 MEETING_ALREADY_HAS_TRANSCRIPT` gated on transcript
   emptiness, not `audioId` presence (see TV15 above for why).
5. **BR-119's ambiguous safety clause** ("mọi tên file khác nhau sau khi bỏ phần số") — read as "the
   natural-sort order must not contain a tie between two different files", not literally "every
   filename differs from every other after stripping digits" (the latter reading would reject the
   canonical `phan-1.m4a`/`phan-2.m4a` case the rule is clearly meant to handle). See
   `js/parts.js`'s `suggestPartOrder` comment.
6. **BR-106/single-part `durationEstimated`**: while auditing `runTranscriptionJob`, found that a
   single-part (non-merged) meeting transcribed via Google/`gpt-4o-*` never gets
   `meeting.durationEstimated` set at all (only multi-part meetings do, via `applyPartResult`) —
   meaning BR-128's false-positive suppression for the quality warning does not apply to a
   single-file Google/gpt-4o-* import today. This is pre-existing behavior in
   `server.js`'s single-part branch of `runTranscriptionJob` (untouched by TV1-8 or this batch) —
   not modified here since it is outside this batch's explicit TV9-16 scope and touches the legacy
   single-file pipeline `server.js:runTranscriptionJob` was told to leave alone. Flagged for
   Tech Lead to decide whether it's an existing gap worth a follow-up task.

### Known gaps for QA/Tech Lead before this feature can be declared fully done
1. U-V7 (Protocol 5.4) still open for Whisper/Google — no API key available in this environment.
2. U-V3 (RAM under 2×500MB concurrent transcription) still unmeasured, unchanged from batch 1.
3. TV12's per-part quality warning (QLT-02) not implemented — see decision #3 above.
4. The 4 new UI microcopy strings listed above need PM/UX sign-off.
5. QA's full real 3-file multi-part end-to-end run (Architecture §V13 TV16 note) has not happened.
6. Reviewer has not run on batch 1 or batch 2 yet (Protocol 7) — nothing above is "approved".

## TV18 — Reviewer High-issue fixes: reorder/Q9 UI + confirm-before-remove (batch 3)

Reviewer rejected batch 2 for 2 High issues (see `docs/review-report.md`, "Review —
import-phone-recording (gộp TV1-TV16, trước khi commit/push)"), both scoped as gaps in
Architecture.md's Task Breakdown rather than Dev deviating from spec — did not count against the
Protocol 3 quota per Reviewer's own verdict. This batch closes both.

### Issue 1 — BR-121 (reorder-after-transcribe) and Q9 (add a part to a finished merged meeting)
had no UI, even though both server routes (`POST /parts/reorder`, `POST /parts`) were already
built and tested in batch 2.

- **`js/parts.js`** (TV18): 3 new pure, independently-tested functions —
  `computeReorderedPartIds(parts, partId, delta)` (the full-permutation array the reorder route
  requires — includes every part regardless of status, since `reorderParts` server-side rejects
  anything short of a full permutation of ALL current parts), `removingCreatesGap(index, length)`
  and `formatGapRangeClock(prevLastModified, nextLastModified)` (shared with issue 2 below).
- **`js/app.js`** — `_renderMeetingDetail`'s per-part playback list (previously read-only, added
  in TV12) is now `_renderPartsPlaybackCard(meeting)`: adds ▲/▼ buttons per part (gated on
  `meeting.status !== 'processing'`, i.e. no part still queued/processing — a job in flight never
  has its part moved out from under it) and a "+ Thêm phần" button in the card header (same gate).
  `_movePart(meetingId, partId, delta)` computes the order via `Parts.computeReorderedPartIds` and
  POSTs to `/parts/reorder`; "+ Thêm phần" opens `Import.open({ attachMeetingId, mode:
  'appendPart' })`.
- **`js/import.js`** — `Import.open()`/`addFiles()`/`_html()`/`_startDisabled()`/
  `_summaryLineHtml()`/`_startLabel()`/`_start()` now branch on a new `_attachMode` field
  (`'appendPart'` vs the pre-existing legacy TV15 single-file attach). Append mode forces
  `state.mode = 'merged'` from the start (reusing the existing merged-list UI — gap hints,
  blocking-errors-block-Start, ▲▼ reorder of the NEW files before submit — even for a single new
  file) and adds `_startAppendParts()`, which POSTs to the SAME `/api/meetings/:id/parts` route
  `_startMerged()` already uses, just against the existing `meetingId`. New parts are always
  appended after the meeting's current last part (server-side `registerParts` behavior, unchanged)
  — the user then uses the new ▲/▼ in Meeting Detail to move it into the correct position if it
  isn't actually last, exactly as Architecture §11.9's note on Q9 describes. Confirmed with a
  smoke test against a real running server (register 2 parts → reorder via
  `computeReorderedPartIds` → append a 3rd part), not just unit tests of the pure function.
- Both server routes already bump `promptContextUpdatedAt`/`updatedAt` (batch 2), so the existing
  "thông tin mới hơn tóm tắt" staleness hint fires automatically after a reorder or an appended
  part — no new staleness-tracking code was needed for BR-121/Q9's "chỉ hiện nhắc nhở" requirement.
- **Self-decided, flagged for PM/UX**: ▲/▼ only, no drag-and-drop, for the Meeting Detail reorder
  UI (the import modal's pre-Start merged list already has both; Reviewer's suggestion listed
  "kéo-thả/▲▼" as alternatives). The append-parts modal's "Các phần · tổng X" header and the
  6-parts cost warning describe only the NEWLY added files, not the existing meeting's total —
  minor, no UX copy exists yet for this specific modal instance, so exact wording is a
  self-decision.

### Issue 2 — no confirmation before removing a part from a merged cluster BEFORE Start (MRG-18/19)
- **`js/parts.js`**: `removingCreatesGap`/`formatGapRangeClock` (above) are the pure logic;
  `removeEntry` in `js/import.js` now confirms via a modal (`App.showModal`, matching the same
  pattern as `js/app.js`'s post-hoc drop-part FAI-08/09 modal) whenever the removed entry is NOT
  the last one in the current list AND the mode is `'merged'` — matching the brief's explicit
  gating rule ("bỏ phần cuối = chỉ ngắn bớt cuộc họp, không tạo lỗ giữa"). The confirm body uses
  MRG-18's copy verbatim, with the `(HH:mm → HH:mm)` range appended only when both neighboring
  entries have a usable `lastModified`; degrades to the range-less sentence otherwise (never
  guesses, same posture as `Parts.gapWarningSeconds`). Cancelling re-renders the import modal
  unchanged (`_render()`); confirming removes the entry and shows IMP-27's toast — no gap trace
  can be recorded for this case (unlike the ALREADY-registered drop-part flow's permanent
  `dropped` + FAI-10 record) since these files were never sent to the server.
- **IMP-27** ("Còn file của buổi họp khác?...") — added as `App.toast(..., 'info')` after ANY
  removal while in merged mode (both the confirmed and the exempt-last-entry paths), matching the
  UX doc's "khi user bỏ bớt phần ra ở chế độ ghép" condition. **Self-decided**: shown as a toast,
  not a persistent inline line under the file list — the UX doc says "hiện dòng gợi ý" without
  specifying the rendering mechanism, and a toast reuses the existing pattern already used
  elsewhere in this file for one-off informational messages (e.g. the DAT-03 day-change toast in
  `js/app.js`) instead of adding new persistent-hint state to the modal.

### Test suite
- `js/parts.js`'s 3 new pure functions: 8 new tests appended to `test/parts-order.test.js`
  (`computeReorderedPartIds` — swap-with-neighbor, no-op at an edge, sorts by `.order` not array
  position, unknown partId; `removingCreatesGap` — every position except last, single-entry list;
  `formatGapRangeClock` — renders a real HH:mm range, degrades to `''` when a timestamp is
  missing).
- `js/import.js`/`js/app.js` themselves remain untested by `node --test` (DOM-dependent glue code,
  same documented convention as the rest of this feature — see both files' header comments); the
  new server-facing behavior they drive (`/parts/reorder`, `/parts` append) was already covered by
  `test/parts-routes.test.js` in batch 2, and re-verified here with a manual smoke test against a
  real running `server.js` instance (register 2 parts → compute+apply a reorder → append a 3rd
  part — all 3 calls returned the expected shapes).
- `npm test` after these changes: 221 passing, 2 skipped (unchanged Whisper/Google golden
  fixtures), 0 failing — full output pasted in the Dev report to PM for this round.

## 2026-09-19 — Rotating backup for critical metadata files (data-loss incident fix)

Direct fix for the real incident logged in `project_state.json` → `blockers`
(`incident-2026-09-19-qa-wiped-real-storage-meetings-json-...`): a QA session hit the real
server instead of an isolated test one and permanently wiped `storage/meetings.json`, with no
backup anywhere to recover it. This is an independent fix, unrelated to the
`import-phone-recording` feature itself.

- **`server.js`**: `atomicWriteJson(filePath, value)` (the single choke point already used for
  every JSON metadata write) now calls `backupBeforeOverwrite(filePath)` before its existing
  temp-file-then-rename write. `backupBeforeOverwrite` only acts for a fixed allowlist,
  `BACKED_UP_FILES` — `MEETINGS_FILE`, `SETTINGS_FILE`, `JOBS_FILE`, `PRESETS_FILE` — deliberately
  excluding lower-stakes/high-frequency writes through the same function (audio metadata sidecars,
  export-settings, bug reports, the preset-schema tmp file) so backups stay meaningful instead of
  noise.
  - Before an important file is overwritten, if it currently exists on disk, its **current**
    content (i.e. what's about to be replaced) is copied verbatim to a file under
    `storage/.backups/`, named `<basename>-<ISO timestamp, `:` and `.` replaced with `-`>-<8-char
    random id>.json`. The random suffix only exists to avoid same-millisecond filename collisions
    under rapid writes; it has no other meaning.
  - After each backup, `pruneOldBackups(basename)` keeps only the 5 most recent files per
    basename (lexicographic sort on the ISO-prefixed filename), deleting the rest.
  - Backup is strictly best-effort: any failure (directory uncreatable, disk full, permission
    denied, etc.) is caught, logged via `console.error`, and swallowed — it can never throw out of
    `atomicWriteJson` and can never block the real write. Verified directly in the new test's
    "broken backup directory" case.
  - No restore endpoint/UI in this v1 (explicitly out of scope per the brief). Manual restore:
    stop the server, copy the desired file from `storage/.backups/<name>-<timestamp>-<id>.json`
    over the corresponding `storage/<name>.json`, then restart the server. This is documented as a
    comment directly above `backupBeforeOverwrite` in `server.js`.
  - Explicitly did **not** add any "new array smaller than old array" guard/warning — that would
    conflict with the legitimate "Delete selected" bulk-delete feature (a deliberate shrink is not
    a bug). Out of scope per the brief; backup-only.
  - `storage/.backups/` needs no `.gitignore` change — `storage/*` is already ignored.

### Test suite
- New `test/atomic-backup.test.js` (port 8803, isolated `MEETNOTE_STORAGE_DIR` temp dir, same
  spawn-the-real-server pattern as `test/http.test.js` — `atomicWriteJson` itself isn't exported,
  so the backup behavior is only observable end-to-end through real API routes):
  - `PUT /api/settings` twice → a backup file exists whose parsed content is the value from the
    *first* write, not the second (asserts the actual JSON value, not just "a file exists").
  - `PUT /api/settings` 7 times in a row → exactly 5 backup files remain, never 6+.
  - `POST /api/bug-reports` twice (writes a JSON file through the same `atomicWriteJson`, but not
    in `BACKED_UP_FILES`) → zero backup files created for it.
  - Replace `storage/.backups` with a plain file (forces `fsp.mkdir(..., {recursive:true})` to
    throw `ENOTDIR`) → the next `PUT /api/settings` still returns 200 and the new value is
    actually persisted (`GET /api/data`).
- `npm test`: 223 passing (219 pre-existing + 4 new), 2 skipped (unchanged Whisper/Google golden
  fixtures, no API key on this dev machine), 0 failing.

## 2026-09-20 — Fix 4 bugs from `import-phone-recording` QA round 2 (Dev↔QA round 1/5, Protocol 3)

Fixes for the 4 bugs in `docs/test-report.md` § "Test Report — import-phone-recording, lần 2
(server cách ly đã verify, trước khi merge PR #1)": BUG-003 (High), BUG-002/BUG-004 (Medium, new
this round), BUG-001 (Medium, carried over unfixed from round 1). Independent of the still-open
Critical `storage/meetings.json` incident tracked in `project_state.json` → `blockers` — not
touched by this round.

### BUG-003 (High) — BR-94 date plausibility never ran for hand-typed dates
- Root cause: `_suggestedDateIso`/`_suggestedDateSource` (`js/import.js`) already implemented
  BR-94's threshold (future > now+1 day, or before 2000-01-01) correctly, but only for the
  `file.lastModified` auto-suggestion. Every place a user could type/change a date by hand — the
  import modal's per-entry date field, and Meeting Detail's pre-meeting date editor
  (`save-premeeting`, added in TV13/US-23) — assigned the typed value straight through with no
  validation at all, client or server.
- New `js/meeting-date.js`: `isPlausibleMeetingDate(iso)`, a pure function extracting the exact
  same threshold already approved for the auto-suggestion (`FUTURE_GRACE_MS = 24h`,
  `MIN_PLAUSIBLE_MS = 2000-01-01`), dual-mode (`module.exports` guard) so `node --test` exercises
  it directly — new script tag added to `index.html` before `import.js`/`app.js`.
  `_suggestedDateIso`/`_suggestedDateSource` themselves were left untouched (already verified
  correct by QA; no reason to risk regressing them by rewiring to share the new helper).
- `js/import.js`: both manual-date change handlers (`[data-field="date"]` for
  `datetime-local`-capable browsers, `[data-field="date-day"]`/`[data-field="date-time"]` for the
  fallback) now call `MeetingDate.isPlausibleMeetingDate` before accepting the typed value; on
  rejection, shows a Vietnamese `App.toast` error and resets the input(s) back to the entry's
  current `dateIso` instead of accepting the bad value.
- `js/app.js`: `save-premeeting` click handler now validates `_readDateEditor()`'s result the same
  way before assigning `m.date`; on rejection, shows the same toast, calls new
  `_setDateEditorValue(iso)` (sets the date input(s) back to the meeting's currently-saved
  `date`), and skips the date assignment — other pre-meeting fields
  (`meetingType`/`topic`/`leadBy`) in the same Save click still save normally, only the invalid
  date is rejected.
- Tests: new `test/meeting-date.test.js` (6 cases) — now, 1 month future (exact QA repro), a date
  before 2000, the exact inclusive lower bound, the 1-day boundary on both sides, and unparsable
  input never throwing.

### BUG-002 (Medium) — duplicate-import warning only matched part 1 of a merged meeting
- Root cause: `findDuplicateMeeting` (`js/import-preflight.js`) only compared against
  `meeting.sourceFilename`/`meeting.sourceSizeBytes`, which for a merged meeting only ever hold
  part 1's values (BR-137) — parts 2+ were never checked, so re-selecting a file already used as
  part 2/3/4 of an existing merged meeting produced no warning at all.
- Fix: `findDuplicateMeeting` now also checks every entry of `meeting.parts[]`
  (`filename`/`sizeBytes`) for each candidate meeting, in addition to the existing top-level
  fields — a match on either the top-level fields or any part counts as a duplicate.
- Tests: added to `test/import-preflight.test.js` — the exact QA repro (2000-byte `partB.m4a` as
  part 2 of a merged meeting must resolve, not `null`), part-1/top-level match still works, no
  match at all still returns `null`, and a single-file meeting with an empty `parts` array is
  unaffected.

### BUG-004 (Medium) — "info newer than summary" nudge compared the wrong timestamp
- Root cause: `_preMeetingStaleHint` (`js/app.js`) compared `meeting.updatedAt` (bumped on
  *every* save — tags, action item ticks, preset choice) against
  `meeting.summaryGeneration.generatedAt`. The correct field, `meeting.promptContextUpdatedAt`
  (bumped only when one of the 8 prompt-context fields actually changes — already implemented
  correctly in `js/storage.js` since batch 1/TV8), was computed but never read anywhere.
- New `js/summary-staleness.js`: `isPreMeetingInfoStale(meeting)`, a pure function (dual-mode,
  script tag added to `index.html`) comparing `promptContextUpdatedAt` vs. `generatedAt`, with
  R-AF deny-by-default (missing `promptContextUpdatedAt` → never stale). `_preMeetingStaleHint`
  now just calls this and renders the same markup as before.
- Tests: new `test/summary-staleness.test.js` (5 cases) — the exact BUG-004 repro (tag-only save
  bumping `updatedAt` but not `promptContextUpdatedAt` must not nudge), a real prompt-context
  change correctly nudges even with an *older* `updatedAt` (proves `updatedAt` really is ignored
  now), no `summaryGeneration` yet, missing `promptContextUpdatedAt` (deny-by-default), and equal
  timestamps (must be strictly after, not `>=`).

### BUG-001 (Medium, carried over unfixed from round 1) — silent-part error message was raw English
- Root cause: the failed-part error card (`_renderMultiPartSection`, `js/app.js`) always rendered
  the generic title "Phần N chưa tạo được transcript" plus `error.message` verbatim — for an empty
  transcript (`STT_TRANSCRIBE_FAILED`, thrown by `normalizeResult` in
  `server/stt/contracts.js` when a part has no detectable speech), that raw message is the
  English string "The provider did not return any transcript for this audio.", not the Vietnamese
  "không nghe thấy giọng nói" BR-136 requires.
- New `Parts.partErrorCopy(part)` in `js/parts.js` (already the shared pure-logic module for
  multi-part client helpers, used by both `import.js` and `app.js`): recognizes
  `part.error.code === 'STT_TRANSCRIBE_FAILED'` and returns a Vietnamese title +
  detail ("Phần N không nghe thấy giọng nói" / "Có thể do bấm nhầm nút ghi âm hoặc đoạn ghi bị im
  lặng hoàn toàn."); every other error code keeps the previous generic title with the raw
  provider message as a secondary detail (BR-104: error code/message belongs in the secondary
  detail line, never the headline). Returns plain text only — `js/app.js` still owns
  `Utils.escapeHtml` on both fields before rendering, same convention as the rest of the file.
- Tests: added to `test/parts-order.test.js` — `STT_TRANSCRIBE_FAILED` gets the Vietnamese
  headline with no leaked English text, any other code keeps the generic title + raw message,
  and a missing `error` object never throws.

### Self-assessed points where the brief/docs were silent (flagging per Dev Agent instructions)
- BUG-003 Meeting Detail behavior on an invalid date: the brief/BR-94 describe "reject, keep the
  previous value" for the *value itself*, but say nothing about whether the rest of a
  `save-premeeting` click (meetingType/topic/leadBy) should still be saved when only the date is
  invalid. Chose to save the other fields and only skip the date — no PRD text suggested the
  whole Save action should be aborted for an unrelated field's edit, and this matches this
  card's existing per-field-independent feel (each editor already saves its own concern).
- BUG-001 microcopy: `docs/ux-import-phone-recording.md` has no approved string for this exact
  case (grepped, no hit). Wrote "Phần N không nghe thấy giọng nói" / "Có thể do bấm nhầm nút ghi
  âm hoặc đoạn ghi bị im lặng hoàn toàn." directly from BR-136's own wording ("không nghe thấy
  giọng nói trong phần này") and the Dev-facing suggestion already in `docs/test-report.md`'s
  BUG-001 entry, rather than inventing new phrasing — flagging in case UX/PM want to bless
  different exact wording later.
- New shared pure-logic files (`js/meeting-date.js`, `js/summary-staleness.js`): not explicitly
  named in Architecture.md. Followed the codebase's own established convention (same header
  comment pattern as `js/meeting-types.js`/`js/tags.js`/`js/parts.js`: pure function, no DOM/fetch,
  `module.exports` guard, one script tag added to `index.html` before the glue code that uses it)
  rather than inlining the logic in `js/app.js`/`js/import.js` directly, specifically so each new
  fix could get a real `node --test` case instead of only living behind manual/live QA — the brief
  explicitly required "test cho cả 4 fix". Flagging as a small scope decision (new files, not
  requested verbatim) in case Tech Lead wants these folded into Architecture.md's module list.

### Test suite
- `npm test`: 239 passing (223 pre-existing + 16 new: 6 in `test/meeting-date.test.js`, 5 in
  `test/summary-staleness.test.js`, 3 in `test/parts-order.test.js`, 2 in
  `test/import-preflight.test.js`), 2 skipped (unchanged Whisper/Google golden fixtures, no API
  key on this dev machine), 0 failing.
- Manual smoke check: started `server.js` on an isolated port (8903) + isolated
  `MEETNOTE_STORAGE_DIR` (`/tmp/meetnote-dev-smoke`, deleted after) — confirmed `GET /api/data`
  returned `meetings: []` before touching anything, the 2 new script tags serve `200` at their
  `index.html` paths, then tore the temp dir down. Did not touch `storage/` or port 8765 at any
  point.
- Not re-claiming "fixed"/"done" for the feature as a whole — Reviewer and QA still need to run
  their own passes per Protocol 7.

## 2026-09-20 — Live notes panel on the recording screen

User report: no way to take notes while a meeting is actively recording — `meeting.notes` was
only editable from the "Notes" tab on the (post-meeting) Meeting Detail screen.

### Changed
- `js/app.js` `_renderRecording()` — added a third panel to `.recording-streams` (alongside Live
  Transcript / Live Translation): a `#rec-notes-textarea` seeded from `meeting.notes || ''`.
  Added a `has-notes` modifier class on `.recording-streams` (kept alongside the pre-existing
  `has-translation`/`transcript-only` markers).
- `js/app.js` `_bindRecording()` — new `saveNotes()` + debounced (600ms) `input` listener,
  mirroring the existing live-transcript autosave pattern (`Transcriber.onResult`): re-fetch
  `Storage.getMeeting(meetingId)` fresh, set `.notes`, `Storage.saveMeeting(m)`. Also flushes on
  `blur` and explicitly before `_saveActiveRecording()` runs (Stop & Save), so a pending debounce
  can't be dropped by finalizing the meeting first.
- `css/layout.css` — `.recording-streams.has-notes` (2-col) / `.has-translation.has-notes`
  (3-col) grid rules, notes-panel textarea styling, and the `max-width: 768px` breakpoint now
  collapses `.has-notes` to 1 column same as `.has-translation`.
- No new field: reuses `meeting.notes`, the same field the post-meeting Notes tab and BR-63
  notes-override flow already read/write. No server/API/schema change.

### Reviewed (Protocol 7)
- `docs/review-report.md` — APPROVE, no Critical/High. 2 Medium fixed same round: a CSS
  specificity bug (`.recording-notes-body` padding override was losing to the 2-class
  `.recording-transcript-panel .panel-body` rule — fixed by matching specificity) and the
  explicit pre-finalize notes flush described above (previously relied on implicit `blur`
  ordering on button click). Low-severity notes (this changelog entry, minor DRY across the 3
  fetch-mutate-save call sites) accepted as-is / addressed here.

### Verified
- Manual: ran against the real running dev server (127.0.0.1:8765, did not start a second
  `npm start` — see the EADDRINUSE incident already on record in `project_state.json`
  `blockers`), created one throwaway test meeting, confirmed the Notes panel renders alongside
  Live Transcript + Live Translation, typing shows "Saving…" → "Saved · 00:00", a real
  `PUT /api/meetings` 200 request fires, and the text lands in `storage/meetings.json`. Deleted
  the test meeting afterward (confirmed with the user first) — `storage/meetings.json` back to
  the original 4 real meetings.
- Not verified: mobile-width layout by eye (the `max-width: 768px` collapse rule was reasoned
  from the existing `.has-translation` pattern, not visually confirmed — browser tool couldn't
  click through the mobile-emulation viewport this round).

## 2026-09-20 — Fix DeepSeek summary generation failing with "unreadable summary" on long/preset-heavy meetings

Bug report (user): `POST /api/summary` with provider=DeepSeek and the built-in "Brainstorming"
preset failed with `Failed to generate summary: The provider returned an unreadable summary.`
on the user's real "University dashboard" meeting (955 transcript segments).

### Root cause (verified against the real DeepSeek API, Protocol 5.1/5.3 — not guessed)
- Re-built the exact prompt this app sends (real preset + real transcript, via
  `buildSummaryPrompt`/`buildContextBlock`/`instantiateBuiltIns`) and POSTed it directly to
  `https://api.deepseek.com/chat/completions` with this dev machine's real DeepSeek key
  (macOS Keychain, `meetnote-local`/`deepseek-api-key`) — same request shape
  `server/llm/providers/deepseek.js` sends, `max_tokens` omitted (pre-fix code).
- Result: `finish_reason: "length"`, `completion_tokens: 8192` exactly — DeepSeek's documented
  default `max_tokens` for non-thinking mode (verified via `api-docs.deepseek.com`,
  2026-09-20: "When not set, the default is 8K in non-thinking mode"). The response body was
  valid JSON syntax cut off mid-string, so `parseJsonLoose` (server/llm/contracts.js) correctly
  returned `null` and `preset-schema.js`/`contracts.js` correctly reported
  `LLM_INVALID_OUTPUT` — the error code path was working as designed, the request just never
  asked DeepSeek for enough output.
- Confirmed the fix by re-running the same real request with an explicit higher `max_tokens`:
  the Brainstorming preset's "toàn bộ ý tưởng" (preserve every idea) instruction on this
  meeting genuinely needed ~26-27K completion tokens (`finish_reason: "stop"`, valid JSON, all
  6 preset sections populated, one run captured 398 ideas in `toanBoYTuong`) — far above
  DeepSeek's 8192-token default, so this was never going to self-resolve via the existing
  one-shot repair retry in `withRepair` (server/llm/contracts.js), which reuses the same
  (unset) `max_tokens` and would hit the identical cap again.
- `transcript-budget.js` already reserves ~30% of a model's context window for "prompt
  scaffolding + output" (`INPUT_BUDGET_RATIO`) when deciding single-pass vs. map-reduce, but
  that reserved headroom was never actually communicated to the DeepSeek HTTP request — the
  adapter had no `max_tokens` in its request body at all (Codex/Gemini adapters weren't
  checked/touched; this fix is scoped to the reported DeepSeek bug only — see Known issues).

### Fixed — `server/llm/providers/deepseek.js`
- The real summarize/title call (`run()`) now sends an explicit `max_tokens: Math.floor(spec.contextWindow / 2)`
  (32768 for both `deepseek-chat` and `deepseek-reasoner`, whose declared `contextWindow` is
  65536) instead of relying on DeepSeek's own low default. Verified real: after this change,
  the same real "University dashboard" + Brainstorming request that previously truncated at
  8192 tokens completed normally (`finish_reason: "stop"`) using ~25-27K tokens, comfortably
  under the new 32768 cap and under `LLM_API_TIMEOUT_MS` (2 min; the real call took ~95s).
  Verified separately that an intentionally oversized `max_tokens` (60000, i.e.
  `prompt_tokens + max_tokens` exceeding the declared 65536 context window) does **not** error
  — DeepSeek just stops naturally at `finish_reason: "stop"` — so this fixed value carries no
  new risk of a spurious 400 for large prompts.
- `finish_reason === 'length'` on any DeepSeek call (first attempt or the one repair retry) is
  now detected explicitly and raised as its own `LLM_INVALID_OUTPUT` error with a message that
  says the response was cut off and suggests Regenerate or a lighter preset — instead of
  silently handing the truncated text to `normalize()`, which could only ever report the
  generic "unreadable summary" message with no hint at the actual cause. Also logs
  `[deepseek.output_truncated]` (model/maxTokens/completionTokens, no meeting content) via
  `console.warn` for future diagnosis, matching the existing I/O-light logging convention in
  `preset-schema.js` (§7) rather than wiring in file-backed `logEvent` from inside
  `server/llm/providers/`.

### Test suite — `test/deepseek-provider.test.js` (new)
- This provider previously had **zero** automated tests (Codex/Gemini also have none — flagged
  below, not fixed here). Added, using synthetic dummy meeting content only — the real
  "University dashboard" meeting used for root-cause reproduction is the user's own private
  data and was **not** committed to fixtures/tests:
  - Mocked-`fetch` unit test: asserts the outgoing request body now carries
    `max_tokens: 32768` for `deepseek-chat`.
  - Mocked-`fetch` unit test: a `finish_reason: "length"` response (synthetic truncated JSON,
    same shape as the real captured truncation, not the real content) raises the new
    cut-off-specific error, not a generic one.
  - Real smoke test (Protocol 5.4): a small synthetic 2-line meeting through the real DeepSeek
    API, skipped with a clear reason when no key is available (same skip convention as
    `test/stt-golden.test.js`).
- `npm test`: 242 passing (239 pre-existing + 3 new), 2 skipped (pre-existing Whisper/Google,
  unrelated to this fix), 0 failing.

### Known issues / flagged, not fixed here (out of scope for this bug report)
- **Gemini's adapter (`server/llm/providers/gemini.js`) has the same shape of gap**: its real
  `generateContent` call sets `responseSchema` but no `generationConfig.maxOutputTokens`
  (only the `testConnection` ping sets `maxOutputTokens: 1`). Not verified whether Gemini's
  own default is generous enough to avoid the same failure mode — flagging per Protocol 8
  ("bước cũ đã chạy ổn từ trước dễ bị bỏ qua audit hơn") rather than fixing on
  the strength of an unverified guess.
- `server/llm/transcript-budget.js`'s `estimateTokens` (3.5 chars/token) under-counted the real
  DeepSeek `prompt_tokens` for the repro meeting by ~47% (24182 estimated vs. 35638 real,
  per DeepSeek's own reported `usage.prompt_tokens`). This didn't cause today's bug (the
  single-pass budget check still passed correctly either way for this meeting), but it means
  `inputBudget()`'s single-pass/map-reduce threshold and the `MAX_CHUNKS` guard are working
  off an optimistic estimate for Vietnamese-heavy transcripts on at least this provider —
  worth a dedicated Tech Lead-verified pass across all 3 providers, not folded into this fix.
- `MODELS` in `deepseek.js` lists `deepseek-chat`/`deepseek-reasoner`; a docs fetch today
  (api-docs.deepseek.com, 2026-09-20) referenced `deepseek-flash`/`deepseek-v4-pro` in its
  `max_tokens` parameter description, suggesting DeepSeek's public model lineup may have moved
  on. Both `deepseek-chat` and `deepseek-reasoner` still answered real requests successfully
  today, so this is not blocking, but the model allowlist should get a real Protocol 5
  verification pass rather than being assumed current.

### Reviewed (Protocol 7)
- See `docs/review-report.md` (append below this entry).

### Dev↔Reviewer round 1 fixes (Protocol 3, 1/3 rounds used)
Reviewer returned REQUEST_CHANGES (no Critical, 3 High + 1 Medium). Addressed all 4 in this
same session before re-requesting review:
- **High — wasted repair retry on truncation**: the new truncation error used
  `LLM_ERROR.INVALID_OUTPUT`, which `withRepair` (server/llm/contracts.js) always retries once
  — for a real length-cutoff, the retry reuses the same `max_tokens` and would truncate again,
  silently doubling latency/cost before the user ever sees the error. Added a generic
  `skipRepair` flag to `llmError()`'s meta (contracts.js) — not DeepSeek-specific, any provider
  can opt an INVALID_OUTPUT error out of the one-shot repair — and `withRepair` now rethrows
  immediately when a caught error sets it. `deepseek.js`'s truncation error sets
  `skipRepair: true`. New test asserts exactly 1 `fetch` call for a truncated response (was
  unverified before — the 2 original unit tests never counted calls).
- **High — `deepseek-reasoner` never verified**: the fix applied the same
  `Math.floor(contextWindow / 2)` override to both models, but only `deepseek-chat` was ever
  real-call-verified. Worse: `api-docs.deepseek.com`'s documented **default** for thinking mode
  is 64K tokens — already *above* the 32768 half-window value this fix would have forced,
  meaning the original fix could have made `deepseek-reasoner` strictly worse (a lower cap than
  its own default) while fixing `deepseek-chat`. Scoped the override to
  `spec.id === 'deepseek-chat'` only; `deepseek-reasoner` keeps requesting DeepSeek's own
  default, unchanged from before this fix. New test asserts `max_tokens` is `undefined` in the
  request body for `deepseek-reasoner`.
- **High — ambiguous test placeholder string**: `test/deepseek-provider.test.js`'s
  finish_reason test used the mock content `'{"summary":"ok","keyPoints":["a","b September lo'`
  — Reviewer couldn't rule out from reading the code alone whether "September" was an
  accidental leak of real meeting content. Confirmed directly: it was not (typed as filler,
  not copied from any capture script or fixture) — but the string was a bad choice regardless,
  since it's genuinely ambiguous to a reader with no more context than the diff. Replaced with
  an unambiguous placeholder (`"placeholder-item-one"`, `"placeholder-item-tw` cut mid-word)
  and a comment stating directly that this file contains no real meeting content anywhere.
- **Medium — misleading comment**: the original comment claimed the `contextWindow / 2` value
  "match[ed]" `transcript-budget.js`'s `INPUT_BUDGET_RATIO` (0.7 input / ~0.3 output), but 0.5
  ≠ 0.3. Rewrote the comment to state the actual reasoning: the ~30% reserve implied by
  `INPUT_BUDGET_RATIO` (~19.7K tokens for a 65536-token window) was itself measured as
  insufficient during real-call verification (actual need was ~26-27K tokens), so half the
  window was chosen deliberately as more generous than that reserve, not as an equal match to it.

`npm test` after round 1 fixes: 245 total, 243 passing (241 pre-existing + 4 new in
`test/deepseek-provider.test.js`, up from 3 — added the `deepseek-reasoner` non-override test
and the fetch-call-count assertion), 2 skipped (pre-existing, unrelated), 0 failing.

## 2026-09-20 — Independent hide/show toggle for Live Transcript & Live Translation

User request, following the same-day live-notes-panel change above: a way to hide/show the
Live Transcript / Live Translation panels on the recording screen. Confirmed with the user:
each panel gets its own independent toggle (not one combined switch), and the remaining
panels (Notes included) expand to fill the freed space.

### Changed
- `js/storage.js` `DEFAULT_SETTINGS` — 2 new global (not per-meeting) preference fields:
  `recordingShowLiveTranscript: true`, `recordingShowLiveTranslation: true`. Persisted through
  the existing `Storage.saveSettings()` → `PUT /api/settings` path, no new endpoint.
- `js/app.js` — new `_eyeIcon(open)` helper (open-eye / eye-slash SVG). `_renderRecording()`
  reads the settings above to decide each panel's initial visibility, adds a
  `btn-icon btn-sm` toggle button to each panel's header, and gives the Live Transcript panel
  an `id="rec-transcript-section"` (it previously had none — only Live Translation did).
- `js/app.js` `_bindRecording()` — replaced the static `has-translation`/`has-notes`/
  `transcript-only` class scheme on `.recording-streams` with a `data-cols` attribute
  recomputed on every toggle (`updateStreamsLayout()`, counts currently-visible sections).
  Hiding a panel is `display:none` only — Recorder/Transcriber keep running underneath, and
  `addTranscriptSegment()`/`updateInterim()` keep appending into the hidden panel's DOM
  unconditionally, so nothing is lost while it's hidden. Re-showing a panel now also
  force-scrolls it to bottom (`panelBody.scrollTop = panelBody.scrollHeight`), since that same
  call is a no-op while the panel is `display:none`.
- `css/layout.css` — replaced the `has-*` class rules with `[data-cols="2"]` (even split) /
  `[data-cols="3"]` (transcript/translation even, Notes narrower) attribute rules; base
  `.recording-streams` rule already covers the 1-column case. The `max-width: 768px` block
  now matches the same attribute selectors to collapse to 1 column on mobile.

### Reviewed (Protocol 7)
- `docs/review-report.md` — APPROVE. Reviewer traced `data-cols` correctness across every
  hide/show combination (including no-translation meetings, where `translationSection`/
  `translationVisToggle` are `null` and `bindVisibilityToggle`'s early return covers it) and
  confirmed the toggle is view-only (doesn't touch Recorder/Transcriber/waveform/billing). One
  Low finding — re-showing a panel didn't catch up its scroll position — fixed same round (see
  above).

### Verified
- Manual: real dev server (127.0.0.1:8765, no second `npm start`). Created a test meeting with
  Translate To enabled, confirmed both eye-icon toggles render on their panel headers, hiding
  Live Transcript collapses to `data-cols="2"` (Translation + Notes fill the row), hiding Live
  Translation too collapses to `data-cols="1"` (Notes full-width). Confirmed a real
  `PUT /api/settings` 200 fires per toggle and the hidden state is remembered across a page
  reload and a brand-new recording (global preference, as intended). Afterward restored the
  user's real settings back to both-visible via `Storage.saveSettings(...)` in the live
  console (production code path, not a hand-edited JSON file) and deleted the 2 throwaway test
  meetings — confirmed with the user before both the settings restore and the deletions.
  `storage/meetings.json` back to the original 4 real meetings; `storage/settings.json`
  confirmed both flags `true` again.
- Not verified: mobile-width layout by eye (same gap as the live-notes-panel change above —
  browser tool's mobile-emulation click issue, unrelated to this code).

## 2026-09-22 — Fix Pending Actions modal: reuse `Storage.toggleActionItem()`

Fixed the last Medium issue from `docs/review-report.md` (post-approve on the 4-item batch):
the "done" checkbox handler in `_openPendingActionsModal()` (`js/app.js`) was reimplementing
`Storage.toggleActionItem()` by hand (find item, set `.done = true`, `saveMeeting`) instead of
calling the existing helper (`js/storage.js:272`).

- `js/app.js`: checkbox `change` handler now calls `Storage.toggleActionItem(meetingId, actionId)`.
  Kept a lookup guard (`Storage.getMeeting(meetingId)?.actionItems?.some(...)`) before calling,
  to preserve the old no-op-on-missing-item behavior since `toggleActionItem` itself doesn't
  early-return a signal for "not found" beyond returning the meeting unchanged.
- Behavior preserved exactly: the modal only lists items from `Storage.getPendingActionItems()`
  (already-undone items only), so toggling can only flip undone → done here — same net effect
  as the old hardcoded `action.done = true`.
- `npm test`: 243 passing / 2 skipped (no API key, Protocol 5.4) / 0 failing.
- `npm test`: 243 passing / 2 skipped (unrelated) / 0 failing, before and after the scroll fix.

## 2026-09-22 — T-W6: batch Soniox now sends `context` (D-W1/D-W2/D-W3)

Implemented T-W6 from `docs/Architecture.md` §W5.4/§W6. Batch transcription
(`server/stt/providers/soniox.js`) previously sent no `context` at all (§W1.11), unlike the
live websocket path (`js/transcriber.js:_buildContext`).

- `server/stt/soniox-context.js` (new): `buildSonioxContext({ title, participants }, { onWarning })`
  — pure function, same `general` shape as the live path (`domain`/`topic`/`participants`), plus:
  - D-W2: a `{ key: 'speakers', value: '<N> speakers' }` pair when `participants` is non-empty,
    matching the official Soniox example verbatim (§W5.2). Labelled experimental in the doc — no
    comment/log here claims it improves accuracy (E-W5).
  - D-W3: calls `onWarning(message)` (never throws) when participants > 15, since Soniox only
    supports up to 15 speakers per session.
  - Hard caps enforced regardless of input size: `general` ≤ 10 pairs, total context ≤ ~10,000
    chars. Over budget → drops the `participants` pair first, keeps `speakers`/`topic` (never
    sends an oversized request that Soniox would reject with `invalid_request`).
- `server/stt/providers/soniox.js`: `transcribe()` now accepts `meetingTitle`/`participants` and
  passes `buildSonioxContext(...)` as `context` in the `/v1/transcriptions` POST body.
- `server/stt/index.js`: `transcribe()` threads `meetingTitle`/`participants` through to the
  adapter (other adapters destructure and ignore the extra fields, unaffected).
- `server.js` (`runTranscriptionJob`): loads the meeting via `readJson(MEETINGS_FILE, [])` and
  passes `meeting.title`/`meeting.participants` into `stt.transcribe(...)`. Same meeting-level
  fields are used regardless of `job.partId` (participants don't vary per part).
- `test/soniox-context.test.js` (new, 11 cases, pure `node --test`, no network): covers D-W1
  (domain/topic present with no participants), D-W2 (`speakers` only appears when participants
  are known, blank names filtered before counting), D-W3 (warns at >15, not at exactly 15, never
  throws without a callback), and both hard caps (pair count, total char budget, `speakers`/
  `topic` kept over `participants` when truncating).
- Out of scope (per task boundary): T-W7 (golden-file smoke test against the real Soniox API) —
  not started.
- `npm test`: 254 passing / 2 skipped (no API key, Protocol 5.4) / 0 failing.

## 2026-09-22 — T-W7: real-API smoke test for Soniox batch `context` (Protocol 5.4)

- Verified the Soniox API key already present in this dev machine's macOS Keychain (account
  `soniox-api-key`, per `server/stt/index.js`'s `SECRET_CONFIG`) — confirmed present, never
  read/printed by any committed code.
- Generated a real ~5.6s Vietnamese WAV on-device (`say -v Linh --data-format=LEI16@16000`,
  matches `PROVIDER_FORMATS.soniox.accepted` in `server/stt/formats.js`), stored only in the
  session scratchpad (not committed).
- Called `server/stt/providers/soniox.js`'s `createSonioxAdapter().transcribe()` directly (temp
  script, deleted after the run — not committed) with `meetingTitle: 'Q4 Planning Sync'` and 3
  fake `participants`, so `buildSonioxContext()` (`server/stt/soniox-context.js`) produced a
  non-empty `context` and it was actually sent in the real `/v1/transcriptions` POST body.
- Result: request succeeded end-to-end (upload → create transcription with `context` → poll →
  fetch transcript → cleanup), no 400/422 from Soniox rejecting the `context` shape, and a valid
  Vietnamese transcript came back. This confirms T-W6's `context` field is accepted by the real
  API, closing the Protocol 5.4 gap the Reviewer flagged.
- New golden fixture: `tests/fixtures/soniox/real-transcribe-with-context.json` (raw response +
  `normalizeResult()` output, `_capturedBy`/`_method` document exactly how it was captured, same
  format as `tests/fixtures/soniox/real-transcribe-vi.json`). No new automated test added against
  it per task scope — the fixture itself is the Protocol 5.4 evidence; `npm test` unaffected
  (still 254 passing / 2 skipped / 0 failing).

## 2026-09-22 — T-W1/T-W2/T-W3/T-W4/T-W10/T-W11 (backend only): "refine transcript" — re-run
batch STT against audio that already has a transcript, single-meeting + multi-part (§W3/§W11-§W13)

Scope: **backend only**, per task boundary — no `js/app.js`/UI changes (T-W5/T-W8/T-W14-UI parts
are separate, later tasks). T-W6/T-W7 (Soniox `context`) were already done in a prior session, not
touched here.

- **`server/refine.js` (new)** — pure (meeting-in, meeting-out) writers, no file I/O:
  - Single-meeting: `markRefineRunning` (snapshots `liveTranscript`/`liveTranslations` exactly
    ONCE — a second refine run never overwrites the original live snapshot with an
    already-refined one, WHY-W4), `applyRefineResult` (replaces `transcript`, keeps `status`
    untouched at `'completed'` per WHY-W3, accumulates `usageBreakdown`/`sonioxUsage`, applies
    E-W3: an empty `translations` result keeps the existing translations instead of overwriting
    with `[]`), `markRefineFailed` (transcript unchanged, only `refine.status` becomes
    `'failed'`, per R-W1).
  - Multi-part: `markPartRefineQueued` (called once per part at job-creation time — snapshots
    `previousTranscript`/`previousTranslations`, sets `part.refine.status='running'`, and
    deliberately leaves `part.status` at `'completed'` so the merged transcript never blinks to a
    gap mid-refine, WHY-W8), `applyPartRefineResult`, `markPartRefineFailed` (does **not** reuse
    `retryPart` from `server/meeting-parts.js`, which wipes `transcript` before running — the
    real data-loss bug the Architecture flagged, W10.9/G2). All three end with
    `rebuildMergedMeeting` so `meeting.transcript`/`duration`/`sonioxUsage`/`refiningParts` never
    drift from `parts[]`.
  - `JOB_MODES` (Protocol 8.3 capability table) + `modeFor(job)`: `{ attach: {...}, refine: {...}
    }`, each entry declaring `ownsMeetingStatus`/`ownsPartStatus`/`usage` plus per-mode writer
    functions. A job with no `mode` field (every job created before this feature) resolves to
    `JOB_MODES.attach`, byte-for-byte the pre-existing writers (`applyPartResult`/`markPartFailed`
    from `server/meeting-parts.js`, reused as-is, not reimplemented).
  - `MAX_REFINE_PART_SECONDS = 300 * 60` — Soniox async's fixed, non-negotiable file-duration
    limit (§W9-S3); used by the route to pre-emptively `skip` an over-length part with reason
    `PART_TOO_LONG` (E-W2) instead of letting the job fail expensively after upload.

- **`server/meeting-parts.js` (T-W10/T-W11)**:
  - `normalizePart`: preserves `refine`/`previousTranscript`/`previousTranslations`/
    `transcriptSource`/`usageBreakdown` across every re-normalization (idempotent — the same trap
    the file's own comment already warns about for `clampNullableNonNegativeNumber`). All five
    fields are optional; absent = pre-refine behavior exactly as before.
  - `aggregateUsage` (T-W11): a part refined more than once has `usageBreakdown` = the FULL run
    history; when present, sums across `usageBreakdown` instead of only the latest `part.usage`.
    A part that was never refined has no `usageBreakdown` and falls back to `part.usage` exactly
    as before — byte-for-byte unchanged for every meeting that never touches refine.
  - `rebuildMergedMeeting`: now also derives `meeting.refiningParts` (array of `part.order` for
    every part whose `refine.status === 'running'`) for the future UI's "Đang tinh chỉnh N/M
    phần" indicator (T-W5, not built yet).
  - `SERVER_OWNED_STATIC_FIELDS`: added `'refiningParts'` (derived, same ownership class as
    `duration`/`status`).
  - No changes to `retryPart`, `markPartRunning`, `markPartFailed`, `applyPartResult` — refine
    intentionally does not reuse `retryPart` (see above) and `pumpJobQueue` now decides whether to
    call `markPartRunning` based on `JOB_MODES[job.mode].ownsPartStatus` (see below), not by
    removing the function.

- **`server.js`**:
  - `pumpJobQueue`: `markPartRunning` is now called only when `modeFor(job).ownsPartStatus` is
    true (Protocol 8.3 — asks the mode table instead of `if (job.partId)` alone). `attach` mode
    keeps `ownsPartStatus: true` (unchanged behavior); `refine` mode is `false` (part.status
    already handled by the route at job-creation time, see `markPartRefineQueued` above).
  - `runTranscriptionJob`: dispatches success/failure through `mode.writePartSuccess`/
    `writeSingleSuccess`/`writePartFailure`/`writeSingleFailure` from the resolved `JOB_MODES`
    entry. `attach` mode has no `writeSingleSuccess`/`writeSingleFailure` on purpose — the
    pre-existing `mergeTranscriptionIntoMeeting` targeted-merge path (file I/O, not a pure meeting
    transform) is kept exactly as it was for the single-meeting "attach" case.
  - New `writeJobFailure(job, errorInfo)` helper: the one place `runTranscriptionJob`,
    `recoverInterruptedJobs`, and `sweepStuckJobs` all go through for a failure write, so the
    watchdog/restart-recovery paths are just as mode-aware as the normal failure path (§W3.3: a
    refine job that times out or gets orphaned by a server restart must land in
    `meeting.refine.status`/`part.refine.status`, never flip `meeting.status`/`part.status` to
    `'failed'` the way an `attach` job legitimately does).
  - **New route `POST /api/meetings/:id/refine-transcript`** (§W13.1, supersedes the
    single-meeting-only §W4.1 draft): goes through the same `hasTrustedHost`/`isTrustedApiRequest`
    guard as every other `/api/` route (global check in `requestHandler`, not reimplemented here).
    - Single meeting (no `parts`): `201 { mode:'single', jobId, status }` on a fresh job,
      `200 { mode:'single', jobId, status }` on dedupe (same in-memory + `findActiveJob` dedupe
      pattern as `/api/import-transcription`), `422 REFINE_NOT_APPLICABLE` when there's no
      `audioId`, `404` when the meeting or its stored audio doesn't exist.
    - Multi-part: `partIds` optional (missing/empty = every part). Eligibility = `status ===
      'completed'` AND `refine?.status !== 'running'` AND audio still on disk AND
      `duration <= MAX_REFINE_PART_SECONDS`. `400 PART_NOT_FOUND` for an unknown id in `partIds`
      (checked before any mutation — nothing is created). Ineligible parts go into a `skipped[]`
      array with a `reason` (`ALREADY_RUNNING`/`PART_NOT_COMPLETED`/`PART_TOO_LONG`/
      `AUDIO_NOT_FOUND`) instead of erroring the whole request. `409 REFINE_ALREADY_RUNNING` only
      when every requested part is already running; `422 REFINE_NO_ELIGIBLE_PARTS` when nothing
      is eligible for any other reason. On success: one `mutateMeeting` call applies
      `markPartRefineQueued` for every eligible part in the SAME transaction (previousTranscript
      snapshot + `refine.status='running'` can never be applied to only some of the requested
      parts), then one job per part is created (`201 { mode:'parts', jobs:[...], skipped:[...] }`)
      — matching W13.1's "N jobs, no job tổng" decision (dedupe/watchdog/concurrency-cap all
      already work at job granularity).
    - Provider/model, when given, go through `stt.validateSelection` (same R-S whitelist as
      `POST /api/meetings/:id/parts` — this is a new route, unlike the legacy
      `/api/import-transcription` which predates that convention and stays lenient).
  - **Extended `PUT /api/meetings` guard (R-W2)**: added a branch — when
    `current.refine?.status === 'running'` on a **single-meeting** (no `parts`) record, the server
    keeps `transcript`/`translations`/`duration`/`status`/`sonioxUsage`/`refine`/`liveTranscript`/
    `liveTranslations`/`transcriptSource`/`usageBreakdown` regardless of what `incoming.status`
    the client sent (the pre-existing guard right below only fires for
    `incoming.status === 'processing'`, which a refine's snapshot never looks like — the meeting
    stays `'completed'` the whole time). Non-owned fields (title, tags, notes, etc.) still pass
    through from `incoming` untouched. Placed *after* the existing multi-part branch
    (`current.parts.length > 0` → `preserveServerOwnedFields`), which the Architecture audit
    (W11.3) confirmed already protects multi-part refine end-to-end with no changes needed there.

- **Tests (new)**:
  - `test/refine.test.js` (10 cases, pure unit tests, no server spawn, mirrors
    `test/meeting-parts.test.js`'s style): covers every writer in `server/refine.js` with
    Protocol 6.2-style value assertions (not just "was called") — snapshot-once semantics, E-W3's
    translation-keep rule for both single and multi-part, usage accumulation math (asserts the
    exact summed `estimatedCostUsd`, not just that it changed), the multi-part "other part is
    byte-for-byte untouched" invariant, and `modeFor` resolving an undefined `job.mode` to
    `JOB_MODES.attach`.
  - `test/refine-routes.test.js` (11 cases, real server spawn against a throwaway storage dir, no
    `STT_*` env vars so every provider job fails fast and deterministically with
    `STT_AUTH_REQUIRED` — same pattern as `test/jobs.test.js`): endpoint contract (201/200 dedupe/
    404/422 for single; 201/400/409/422 + `skipped[]` reasons for multi-part), the extended PUT
    guard (a stale client snapshot claiming `status:'completed'` with different content must not
    win while `refine.status==='running'`), the DNS-rebinding security check (§V16), a canary
    proving refine does **not** reuse `retryPart`'s wipe-then-run path (part's transcript survives
    a failed refine job), and a regression test asserting `POST /api/import-transcription` (job
    with no `mode`) still completes/fails exactly as it did before `JOB_MODES` existed.
  - `test/prompt-parts.test.js` already covered T-W14's acceptance criteria (the per-part
    speaker-label warning surviving in `buildSummaryPrompt`/`buildChunkPrompt`/
    `buildSynthesisPrompt`) from a prior session — no new file added for it, would have been a
    duplicate.
  - `npm test`: **275 passing / 2 skipped (no API key, Protocol 5.4) / 0 failing** (was 254/2/0
    before this task — 21 new tests, 0 regressions).

- **Escalation carried forward, not resolved by this task** (see report to Tech Lead/PM): the
  brief that assigned this task asserted "E-W1→E-W6 đã chốt", but `docs/Architecture.md`'s own
  §W16 ends with an explicit `⏸ CHECKPOINT — CHỜ PM DUYỆT §W10–§W16` that says multi-part work
  (T-W10 onward) should not start yet, and its own escalation table still lists E-W3/E-W5/E-W6 as
  "Vẫn mở" rather than decided. Implemented anyway per the explicit brief (E-W3's "keep old
  translations on empty result" rule was followed exactly as stated), but this discrepancy between
  the brief and the checkpoint marker inside the design doc itself was not resolved before coding
  — flagging per CLAUDE.md's "escalate instead of silently proceeding on a contract mismatch" rule.

## 2026-09-22 — T-W13.2: expose refine status on GET /api/meetings/:id/parts (Reviewer fix, round 2)

- **Fixes the sole Medium from the 2026-09-22 review round** (`docs/review-report.md`): the
  `GET /api/meetings/:id/parts` poll route's fixed-field projection was missing the refine data
  added by the previous round's T-W10/T-W11 work, so the (future) T-W5 UI would have had no cheap
  way to poll per-part refine progress without falling back to a full `/api/data` fetch — exactly
  the thing this route exists to avoid (§W10.13).
- `server.js`, `GET /api/meetings/:id/parts` projection — minimal addition only, no other field
  touched:
  - Per part: `refine: part.refine || null` and `transcriptSource: part.transcriptSource ||
    'original'` — same field names/shapes already established in `server/meeting-parts.js`
    (`normalizePart`/`normalizePartRefine`) and written by `server/refine.js`, not new names.
  - Meeting-level: `refiningParts: Array.isArray(meeting.refiningParts) ? meeting.refiningParts :
    []` — this is already computed and persisted onto the meeting by `rebuildMergedMeeting`
    (`server/meeting-parts.js`) on every mutation, so the route only needed to read it off the
    stored meeting, no new computation.
- `test/parts-routes.test.js` — new test `GET /parts exposes per-part refine status and
  transcriptSource, plus meeting-level refiningParts (T-W13.2)`: seeds a 2-part meeting where part
  1 has `refine.status: 'running'` + `transcriptSource: 'refined'` and part 2 has never been
  refined (fields absent), then asserts on the actual response values — `refiningParts` equals
  `[1]` (part 1's `order`), part 1's `refine.jobId`/`refine.status` come through unchanged, and
  part 2 falls back to `transcriptSource: 'original'` / `refine: null` (backward-compatible
  default, not `undefined`/missing — old clients that don't know these fields still get a valid
  response shape).
- `npm test`: **276 passing / 2 skipped (no API key, Protocol 5.4) / 0 failing** (was 275/2/0
  before this fix — 1 new test, 0 regressions).
- Not self-declared "done" — this is Dev round 2 of the Dev↔Reviewer cycle (Protocol 3, round
  1/3 used by the original Medium finding), awaiting a real Reviewer pass before being reported
  as closed.
