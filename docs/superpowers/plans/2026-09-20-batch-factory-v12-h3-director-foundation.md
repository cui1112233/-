# Batch Factory V12 H3 Director Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze the real H3 acceptance trace and add the strict V12 structured Director document contract that maps one card to each non-empty processed video-source line.

**Architecture:** Keep the existing Batch Factory book, Director revision, and production model. Add a focused `h3_director_trace.go` contract/parser inside the existing Go package, embed the validated document in the existing immutable `DirectorResult` JSON envelope, and retain all legacy V11 fields for read-only compatibility. This slice does not yet allocate canonical duration, segment VIDEO cards, compile prompts, or wire new V12 mutations.

**Tech Stack:** Go 1.x, standard `encoding/json`, existing `batchfactoryv11` package tests, MySQL JSON persistence through the existing Director revision store.

## Global Constraints

- Work on branch `v88`; preserve every pre-existing uncommitted change and stage only files named by the current task.
- The one-card-per-line authority is the frozen H3 processed `video_source_text`, not natural line breaks in the unprocessed full novel.
- Every new V12 Director card must persist `character_slot_ids`; `[]` is valid for a shot with no character, while every non-empty slot ID must resolve in the document roster.
- New V12 writes reject string Scene Memory and reject missing structured Director fields; legacy V11/V12 data remains readable and is never synthesized into full H3.
- H3 visual baseline and character/scene analysis are always acquired and saved. Prompt display/injection switches are outside this foundation slice and must not be encoded as analysis switches here.
- No production implementation is written before its corresponding test has been observed failing for the expected missing behavior.
- Do not create an H3 service, database, queue, task center, or duplicate book/asset/production model.

---

### Task 1: Freeze the Real H3 Acceptance Trace and Establish the First RED Test

**Files:**
- Create: `backend/internal/batchfactoryv11/testdata/h3_acceptance001_trace.json`
- Create: `backend/internal/batchfactoryv11/testdata/h3_v12_complete_director_trace.json`
- Create: `backend/internal/batchfactoryv11/h3_director_trace_test.go`

**Interfaces:**
- Consumes: real H3 `ACCEPTANCE001.zip` manifest, processed video source, `CanonicalTimeline.json`, and final H3 prompt artifacts.
- Produces: frozen fixtures and the wished-for `ParseH3DirectorDocument(raw json.RawMessage, source H3VideoSource) (H3DirectorDocument, error)` contract used by Task 2.

- [ ] **Step 1: Add the normalized real acceptance fixture**

Store literal evidence from `ACCEPTANCE001.zip`:

```json
{
  "provenance": {
    "artifact": "ACCEPTANCE001.zip",
    "mode": "offline-deterministic",
    "source_hash": "7fd4e403990989ac04b829ce336449287ff3cdb27ffdbe4a51f12dfe74ecb198"
  },
  "manifest": {
    "actual_audio_seconds": 7.42,
    "reference_total_seconds": 8,
    "h3_segments": 3
  },
  "video_source_text": "五岁的我刚被认回豪门，爸妈就甩下一百万生活费。\n把我和陆晚晚扔在别墅里大眼瞪小眼。\n三个月后，爸妈提前回国，想给我们一个惊喜。",
  "canonical_timeline": []
}
```

Populate `canonical_timeline` with the three literal cards from the archive, including its original empty `continuity` objects. Record final prompt count and SHA-256 hashes rather than normalizing the old sample into a fuller schema.

- [ ] **Step 2: Add the complete V12 Director contract fixture**

Use the same three processed video-source lines, but make the fixture explicitly a V12 schema input. It must include a resolvable roster, structured continuity, actions, camera, movement, weights, and micro-shots. The third exterior establishing card must carry an explicit empty character list:

```json
{
  "schema_version": "h3-director/v1",
  "writer": "batch-factory-v12",
  "video_source_revision": "video-source-acceptance001-r1",
  "video_source_hash": "7fd4e403990989ac04b829ce336449287ff3cdb27ffdbe4a51f12dfe74ecb198",
  "character_roster": [
    {"slot_id":"C001","canonical_name":"我"},
    {"slot_id":"C002","canonical_name":"陆晚晚"}
  ],
  "director_cards": [
    {
      "source_index": 3,
      "source_key": "L003",
      "source_text": "三个月后，爸妈提前回国，想给我们一个惊喜。",
      "character_slot_ids": [],
      "action": "三个月后的别墅外景建立时间跳转",
      "camera": {"shot_size":"远景","shot_angle":"平视","framing":"别墅全景"},
      "movement": {"camera_movement":"缓慢推近","subject_movement":"无","transition":"时间跳切"},
      "continuity": {"scene_id":"S003","location":"别墅外","axis":"主轴不变","light_direction":"日光从画面右侧入射","positions":{},"facings":{},"gazes":{},"held_props":{},"action_ends":{}},
      "duration_weight": 3,
      "micro_shots": []
    }
  ]
}
```

The actual fixture contains all three cards and at least one complete micro-shot per card; the excerpt above fixes the no-character semantics.

- [ ] **Step 3: Write the first failing behavior test**

Name the break: an implementation that counts full-novel line breaks, omits `character_slot_ids`, accepts string Scene Memory, or loses detailed camera/action data must fail.

```go
func TestParseH3DirectorDocumentUsesProcessedVideoSourceLines(t *testing.T) {
    raw := readH3Fixture(t, "h3_v12_complete_director_trace.json")
    source := H3VideoSource{
        Revision: "video-source-acceptance001-r1",
        Hash: "7fd4e403990989ac04b829ce336449287ff3cdb27ffdbe4a51f12dfe74ecb198",
        Text: "\n五岁的我刚被认回豪门，爸妈就甩下一百万生活费。\n\n把我和陆晚晚扔在别墅里大眼瞪小眼。\n三个月后，爸妈提前回国，想给我们一个惊喜。\n",
    }

    got, err := ParseH3DirectorDocument(raw, source)
    if err != nil {
        t.Fatal(err)
    }
    if got.VideoSourceNonEmptyLineCount != 3 || len(got.DirectorCards) != 3 {
        t.Fatalf("processed video source/card count = %d/%d", got.VideoSourceNonEmptyLineCount, len(got.DirectorCards))
    }
    if got.DirectorCards[2].CharacterSlotIDs == nil || len(got.DirectorCards[2].CharacterSlotIDs) != 0 {
        t.Fatalf("no-character card must persist explicit []: %#v", got.DirectorCards[2].CharacterSlotIDs)
    }
    if got.DirectorCards[0].Camera.ShotSize == "" || got.DirectorCards[0].Continuity.SceneID == "" {
        t.Fatalf("structured camera/continuity lost: %#v", got.DirectorCards[0])
    }
}
```

- [ ] **Step 4: Run the test and verify RED**

Run:

```bash
cd backend && go test ./internal/batchfactoryv11 -run '^TestParseH3DirectorDocumentUsesProcessedVideoSourceLines$' -count=1
```

Expected: compilation fails because `H3VideoSource`, `H3DirectorDocument`, and `ParseH3DirectorDocument` do not exist. This is the correct missing-contract failure; fixture read errors or malformed JSON are not acceptable RED results.

---

### Task 2: Add the Minimal Structured H3 Director Types and Parser

**Files:**
- Create: `backend/internal/batchfactoryv11/h3_director_trace.go`
- Modify: `backend/internal/batchfactoryv11/h3_director_trace_test.go`

**Interfaces:**
- Consumes: `json.RawMessage` plus frozen `H3VideoSource`.
- Produces: `ParseH3DirectorDocument`, `H3DirectorDocument`, `H3DirectorCard`, `H3SceneMemory`, `H3MicroShot`, `H3Camera`, `H3Movement`, `H3Audio`, and roster types.

- [ ] **Step 1: Implement only the types required by the first test**

```go
type H3VideoSource struct {
    Revision string
    Hash     string
    Text     string
}

type H3DirectorDocument struct {
    SchemaVersion                string           `json:"schema_version"`
    Writer                       string           `json:"writer"`
    VideoSourceRevision          string           `json:"video_source_revision"`
    VideoSourceHash              string           `json:"video_source_hash"`
    VideoSourceNonEmptyLineCount int              `json:"video_source_non_empty_line_count"`
    CharacterRoster              []H3Character    `json:"character_roster"`
    DirectorCards                []H3DirectorCard `json:"director_cards"`
}
```

Define the nested types with concrete structured fields from the design. Do not add final duration fields to Director cards.

- [ ] **Step 2: Implement strict processed-video-source alignment**

`ParseH3DirectorDocument` must:

1. Decode JSON without accepting a legacy `storyboard` envelope.
2. Require `schema_version == "h3-director/v1"` and `writer == "batch-factory-v12"`.
3. Require revision/hash equality with `H3VideoSource`.
4. Split `source.Text` into trimmed non-empty logical lines, preserving their actual text after outer whitespace trimming.
5. Require exactly one ordered card per line, `source_index == i+1`, non-empty stable `source_key`, and literal `source_text` equality.
6. Set `VideoSourceNonEmptyLineCount` from the authoritative source rather than trusting AI JSON.

- [ ] **Step 3: Run the first test and verify GREEN**

Run:

```bash
cd backend && go test ./internal/batchfactoryv11 -run '^TestParseH3DirectorDocumentUsesProcessedVideoSourceLines$' -count=1
```

Expected: PASS.

- [ ] **Step 4: Run the existing Director package baseline**

Run:

```bash
cd backend && go test ./internal/batchfactoryv11 -count=1
```

Expected: PASS, proving the isolated parser has not changed legacy flow.

---

### Task 3: Enforce Character Slot and Structured Scene Memory Semantics

**Files:**
- Modify: `backend/internal/batchfactoryv11/h3_director_trace_test.go`
- Modify: `backend/internal/batchfactoryv11/h3_director_trace.go`

**Interfaces:**
- Consumes: decoded `H3DirectorDocument` from Task 2.
- Produces: semantic validation errors that wrap `ErrInvalid` and include the exact card/field location.

- [ ] **Step 1: Add table-driven failing tests**

Create independent cases with literal expected error fragments:

```go
tests := []struct {
    name string
    mutate func(map[string]any)
    want string
}{
    {"missing character_slot_ids", deleteCardField("character_slot_ids"), "director_cards[0].character_slot_ids is required"},
    {"unknown character slot", setCardField("character_slot_ids", []any{"C999"}), "director_cards[0].character_slot_ids[0] unknown slot C999"},
    {"string continuity", setCardField("continuity", "承接上一镜"), "director_cards[0].continuity must be an object"},
}
```

Also add a positive test proving an explicit `[]` survives JSON marshal/unmarshal as non-nil.

- [ ] **Step 2: Run the semantic tests and verify RED**

Run:

```bash
cd backend && go test ./internal/batchfactoryv11 -run '^(TestParseH3DirectorDocumentRejectsInvalidStructure|TestH3DirectorCardPreservesExplicitEmptyCharacterSlots)$' -count=1
```

Expected: FAIL because Task 2 only performs source alignment and does not yet enforce presence, slot resolution, or object-only continuity.

- [ ] **Step 3: Add minimal semantic validation**

Use a custom `UnmarshalJSON` only where presence must be distinguished from an omitted field. Track raw `character_slot_ids` and `continuity` keys before decoding, then validate:

- `character_slot_ids` key exists and decodes as `[]string`.
- Every non-empty slot resolves in `character_roster`; empty strings are invalid.
- `continuity` exists and its raw first non-space byte is `{`.
- `duration_weight > 0`.
- Each card has at least one micro-shot; each micro-shot has `weight > 0`, non-empty task/visual/action, structured camera/movement/audio, and explicit `character_slot_ids` with the same slot-resolution rule.
- Card action, camera shot size/angle/framing, camera movement, subject movement, transition, and scene ID/location are non-empty.

Return errors as `fmt.Errorf("%w: ...", ErrInvalid)`.

- [ ] **Step 4: Run targeted and package tests and verify GREEN**

Run:

```bash
cd backend && go test ./internal/batchfactoryv11 -run '^Test(ParseH3DirectorDocument|H3DirectorCard)' -count=1
cd backend && go test ./internal/batchfactoryv11 -count=1
```

Expected: both commands PASS.

---

### Task 4: Embed the Full H3 Document in the Existing Immutable Director Revision Envelope

**Files:**
- Modify: `backend/internal/batchfactoryv11/director_output.go`
- Modify: `backend/internal/batchfactoryv11/h3_director_trace_test.go`
- Test existing persistence paths: `backend/internal/batchfactoryv11/director_store_mysql.go`, `backend/internal/batchfactoryv11/memory_store.go`

**Interfaces:**
- Consumes: validated `H3DirectorDocument`.
- Produces: optional `DirectorResult.H3Director *H3DirectorDocument` serialized as `h3_director`, without changing legacy `characters/scenes/props/storyboard` decoding.

- [ ] **Step 1: Add failing envelope round-trip tests**

```go
func TestDirectorResultRoundTripsValidatedH3Document(t *testing.T) {
    document := mustParseCompleteH3Fixture(t)
    input := DirectorResult{H3Director: &document}
    raw, err := json.Marshal(input)
    if err != nil { t.Fatal(err) }
    var got DirectorResult
    if err := json.Unmarshal(raw, &got); err != nil { t.Fatal(err) }
    if got.H3Director == nil || got.H3Director.DirectorCards[2].CharacterSlotIDs == nil {
        t.Fatalf("H3 document or explicit [] lost: %#v", got.H3Director)
    }
}
```

Add a legacy JSON case asserting `H3Director == nil` while the existing storyboard remains readable.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
cd backend && go test ./internal/batchfactoryv11 -run '^TestDirectorResult(RoundTripsValidatedH3Document|KeepsLegacyOutputReadable)$' -count=1
```

Expected: compilation fails because `DirectorResult.H3Director` does not exist.

- [ ] **Step 3: Add the optional envelope field**

```go
type DirectorResult struct {
    // existing legacy-compatible fields remain unchanged
    H3Director *H3DirectorDocument `json:"h3_director,omitempty"`
}
```

Do not derive this field inside `NormalizeDirectorOutput`; only the new V12 path may supply it after strict parsing.

- [ ] **Step 4: Verify JSON round-trip and existing store behavior**

Run:

```bash
cd backend && go test ./internal/batchfactoryv11 -run '^TestDirectorResult' -count=1
cd backend && go test ./internal/batchfactoryv11 ./internal/storage ./internal/httpapi -count=1
```

Expected: PASS. The existing MySQL Director store already marshals the whole `DirectorResult` into `output_json`, so this verifies the new document is retained without a parallel Director table.

---

### Task 5: Foundation Review, Regression, and Scoped Commit

**Files:**
- Review only the files created or modified by Tasks 1-4.

**Interfaces:**
- Consumes: green structured Director foundation.
- Produces: a clean, reviewable commit that does not stage unrelated dirty-worktree changes.

- [x] **Regression prerequisite: stabilize equal-time in-memory production ordering**

The scoped regression exposed an existing nondeterministic map-order bug: two
production jobs created under the test clock can share the same `CreatedAt`, so
sorting by time alone can reverse the main and candidate versions. Preserve the
existing creation order by comparing the numeric suffix of memory-generated IDs
when timestamps tie. The new regression test must fail before the fix and then
pass repeatedly:

```bash
cd backend && go test ./internal/batchfactoryv11 -run '^TestMemoryStoreListProductionJobsUsesCreationOrderWhenTimestampsTie$' -count=100
cd backend && go test ./internal/batchfactoryv11 -run '^TestRemoveBookProductionCandidateKeepsMainVersion$' -count=1000
```

Both commands must pass before the full scoped regression. This is test-runtime
determinism only; it does not change persisted MySQL ordering or H3 semantics.

- [ ] **Step 1: Format only changed Go files**

Run:

```bash
gofmt -w backend/internal/batchfactoryv11/h3_director_trace.go backend/internal/batchfactoryv11/h3_director_trace_test.go backend/internal/batchfactoryv11/director_output.go backend/internal/batchfactoryv11/memory_store.go backend/internal/batchfactoryv11/memory_store_production_order_test.go
```

- [ ] **Step 2: Run the full scoped regression**

Run:

```bash
(cd backend && go test ./internal/batchfactoryv11 ./internal/storage ./internal/httpapi -count=1)
node --test routes/batch-factory-v12.test.js routes/batch-factory-v11.test.js
```

Expected: all Go packages pass and all Node route tests pass.

- [ ] **Step 3: Inspect the exact diff and mutation coverage**

Verify that removing any of these rules would fail a test: processed video-source line count, explicit empty character list, unknown slot rejection, string Scene Memory rejection, complete nested field retention, and legacy JSON readability.

Run:

```bash
git diff --check -- backend/internal/batchfactoryv11 docs/superpowers/plans/2026-09-20-batch-factory-v12-h3-director-foundation.md
git status --short
```

- [ ] **Step 4: Stage only this slice and commit**

```bash
git add -- \
  backend/internal/batchfactoryv11/testdata/h3_acceptance001_trace.json \
  backend/internal/batchfactoryv11/testdata/h3_v12_complete_director_trace.json \
  backend/internal/batchfactoryv11/h3_director_trace.go \
  backend/internal/batchfactoryv11/h3_director_trace_test.go \
  backend/internal/batchfactoryv11/director_output.go \
  backend/internal/batchfactoryv11/memory_store.go \
  backend/internal/batchfactoryv11/memory_store_production_order_test.go \
  docs/superpowers/plans/2026-09-20-batch-factory-v12-h3-director-foundation.md
git diff --cached --check
git commit -m "feat: add V12 H3 director trace foundation"
```

Before committing, confirm `git diff --cached --name-only` contains no other existing worktree file.

## Slice Exit Criteria

- The real H3 acceptance artifact is frozen without being mislabeled as a complete V12 trace.
- V12 full Director input is validated against frozen processed video-source lines, not the full novel.
- Every card and micro-shot persists explicit `character_slot_ids`; empty arrays survive, unknown slots fail.
- String Scene Memory fails; structured action/camera/movement/continuity/weight/micro-shot data survives JSON round-trip.
- Existing legacy Director JSON remains readable.
- No timeline allocation, final VIDEO segmentation, prompt compilation, provider call, merge, package, or 121 behavior has been changed in this slice.
