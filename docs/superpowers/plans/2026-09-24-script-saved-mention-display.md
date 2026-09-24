# Script Saved Mention Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the saved shot-card view visually consistent with the editor by rendering saved `@` mentions as asset chips without changing the underlying prompt text.

**Architecture:** A display-only component uses the same mention segmentation as the editor. `ShotOutputCards` passes it raw card text and current asset candidates; copy, edit, references, and video generation continue using raw `card` strings.

**Tech Stack:** React, JSX, Node built-in test runner, Ant Design, Vite.

## Global Constraints

- Canonical source is Git branch `v88`; commit before deployment.
- Saved prompt, copy payload, and video input remain plain `@名称`.
- Unique image-bearing assets render image plus `@名称`; unique assets without an image render a text tag.
- Ambiguous or unknown mentions remain plain text.
- Do not change works, assets, videos, databases, or volumes.

---

### Task 1: Add a display-only mention renderer

**Files:**
- Create: `frontend/src/user/components/ScriptMentionDisplay.jsx`
- Create: `frontend/src/user/components/ScriptMentionDisplay.test.js`

**Interfaces:**
- Consumes `text` and normalized `candidates`.
- Produces `ScriptMentionDisplay({ text, candidates, highlightRange })` with no write-back behavior.

- [ ] **Step 1: Write the failing test**

The test asserts that the new component uses `buildInlineMentionSegments`, creates a `data-mention-display` chip, and reads `candidate.imageUrl`.

- [ ] **Step 2: Run the new test and observe failure**

Run `node --test frontend/src/user/components/ScriptMentionDisplay.test.js`.

Expected: failure because the component has not been created.

- [ ] **Step 3: Implement the smallest renderer**

Map the existing inline mention segments into text spans or a display chip. A chip contains the optional asset image and `@名称`; it never changes `text`.

- [ ] **Step 4: Run the new test and observe pass**

Run `node --test frontend/src/user/components/ScriptMentionDisplay.test.js`.

Expected: pass.

- [ ] **Step 5: Commit task one**

Commit the component and test with `feat(script): render saved mention chips`.

### Task 2: Replace only the visual body of saved shot cards

**Files:**
- Modify: `frontend/src/user/components/ShotOutputCards.jsx`
- Modify: `frontend/src/user/components/ShotOutputCards.test.js`

**Interfaces:**
- Consumes the existing card text, `extractInfo`, active highlight range, and operation callbacks.
- Produces a saved-card body rendered with `ScriptMentionDisplay`; operation callbacks continue to receive raw `card`.

- [ ] **Step 1: Write the failing test**

The test asserts that `ShotOutputCards` renders `ScriptMentionDisplay` with `text={card}`, retains `onCopy(card)`, and retains `onGenerateVideo(card, index)`.

- [ ] **Step 2: Run the new test and observe failure**

Run `node --test frontend/src/user/components/ShotOutputCards.test.js`.

Expected: failure because the saved body is still raw `<pre>` content.

- [ ] **Step 3: Implement the smallest integration**

Build candidates with the existing asset formatter and replace only the visual raw-card content with `ScriptMentionDisplay`. Preserve active search highlighting.

- [ ] **Step 4: Run the new test and observe pass**

Run `node --test frontend/src/user/components/ShotOutputCards.test.js`.

Expected: pass.

- [ ] **Step 5: Commit task two**

Commit the integration and test with `feat(script): show mentions in saved shot cards`.

### Task 3: Verify and release the exact v88 revision

**Files:**
- Modify only Task 1 or Task 2 files if a scoped regression is found.

- [ ] **Step 1: Run focused regression tests**

Run the new display and saved-card tests together with inline mention and editor regressions.

Expected: all tests pass.

- [ ] **Step 2: Build and validate the frontend**

Run `npm --prefix frontend run build`, then run `git diff --check`.

Expected: build succeeds and source diff is clean.

- [ ] **Step 3: Push the exact revision to v88**

Run `git push origin HEAD:v88`, then verify its SHA with `git ls-remote origin refs/heads/v88`.

Expected: remote revision matches the committed source.

- [ ] **Step 4: Deploy frontend only**

Create a new public Node image with the rebuilt `frontend/dist`, back up the preceding `.env`, set `QIANTIE_NODE_IMAGE` and `QIANTIE_RELEASE_SHA`, and run `docker compose up -d --no-deps v88-node`. Do not use `--remove-orphans`.

- [ ] **Step 5: Verify public runtime**

Check `/api/build-info` reports the released SHA and `/script` returns HTTP 200.
