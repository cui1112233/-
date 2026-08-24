# 02 · CM Penguin Companion — Implementation Status

Branch: `design/02-cm-penguin-companion`

## Implemented in this branch

### Global companion shell

- Replaces the mounted legacy `StackyPet` with `CmPenguinCompanion` in the user workspace.
- Keeps the old `StackyPet.jsx` untouched for rollback/reference.
- Reuses the existing CM sprite sheet and animation states.
- Keeps drag positioning, click speech, proactive speech, working/success/error animation and Agent task persistence.
- Keeps page-provided Agent skill IDs.
- Supports Escape/close request boundaries so a closed chat cannot be repopulated by a stale request.
- Keeps Agent workspace continuation with the same task ID.

### CM Bridge

New runtime bridge: `frontend/src/shared/pet/cmBridge.js`.

A function area registers:

- page/pagePath
- capabilities
- getContext()
- apply(action)
- optional undo(token)

For normal React workbenches, CM does not manipulate DOM fields directly. Actions are allow-listed and applied by the current function area's existing business state/API.

The Novel Panel is an iframe exception: it uses its existing authenticated `MessageChannel` boundary and a small workbench bridge. The parent still owns authentication; CM receives only an explicitly shaped context and sends allow-listed commands through the port.

Mutations are serialized, and queued actions are rejected if the user has switched away from the bridge that accepted them.

### Structured AI proposals

`frontend/src/shared/pet/cmActionProposal.js` parses a final `cm-actions` JSON block from an Agent response.

The user sees the natural-language reply and a separate modification proposal. Nothing is written until the user clicks **应用修改**.

CM metadata is folded into the Agent server's existing safe context fields (`summary`, `entities`, `actions`) so the backend's page-context whitelist remains intact.

Selected editor text and shot metadata are forwarded only through bounded allow-lists; credentials and arbitrary iframe/page state are not included.

## Script workbench (`/script`)

Implemented:

- Current character/scene becomes CM Selection when the entity editor is opened.
- Character update.
- Character create.
- Set/unset protagonist.
- Scene update.
- Scene create.
- Full script replacement.
- Structured shot update with guarded undo.
- Constraint update.
- Entity-to-constraint binding.
- Existing script revision preview remains compatible.
- Missing `enrichScriptEntity` import fixed in the design branch.

### Structured shot records

`scriptShotOutput.js` now keeps a CM-facing Shot Record model instead of treating every card as an anonymous string.

Each visible shot receives a snapshot target ID derived from its index and current content fingerprint. The target therefore stays valid for the exact visible revision and becomes stale automatically if the shot changes before the user applies a CM proposal.

For JSON shot outputs:

- the original object remains structured
- CM receives current structured data plus an editable-field list
- `shot.update` accepts only allow-listed shot fields such as duration, shot size, angle, movement, transition, visual context, prompt and character lists
- unrelated object fields are preserved
- the updated object is written back into the original JSON shot container

For markdown/text shot outputs:

- the shot still has a fingerprinted Shot Record target
- direct field-level mutation is not guessed from prose
- CM may replace only the complete shot-card `content`
- surrounding shot boundaries/separators are preserved

The Agent receives a bounded `shotData` snapshot so it knows whether the current card is structured JSON or a text card and which fields are editable.

`shot.update` creates a dedicated undo token. Undo succeeds only while the complete script output still equals the revision produced by CM. If the user edits/regenerates after the CM change, stale undo is rejected instead of overwriting newer work.

### Stable constraint references

`scriptConstraints.js` stores `entityReferences` by entity ID rather than copying entity names/text.

Supported reference modes:

- `identity-lock`
- `visual-lock`
- `content-lock`

Before generation, references are resolved against the current `extractInfo`; therefore renaming or editing a character does not break the constraint. The generated restriction text uses the latest entity data.

The constraint modal shows active entity references and lets the user remove them.

Deleting an entity also removes its dangling constraint references.

## Shuihuo production

### Segment production

- Clicking/focusing a segment publishes `Selection Context`.
- `segment.update` applies through the existing `updateSegment` API.
- `segment.bindAsset` applies through the existing `replaceSegmentAssets` API.
- Allowed segment fields are explicitly whitelisted.

### Character / scene / prop assets

- Clicking/focusing an asset publishes its stable asset ID and current prompt.
- `asset.update` uses the existing `updateAsset` API.
- `asset.create` uses the existing `createAsset` API.
- Asset fields are explicitly whitelisted.

## TTS (`/tts`)

- Clicking/focusing a TTS card publishes the card as CM Selection.
- `tts.update` can update text, voice, style, speed and pitch.
- Voice/style values are validated against the current UI catalogs.
- Speed and pitch are clamped to the same UI limits.
- Existing generated audio is invalidated after parameter changes so stale audio cannot be mistaken for the new settings.

## Novel Panel (`/novel-panel`)

Implemented through the existing iframe `MessageChannel` rather than DOM automation from the parent page.

### Context

The workbench reports a bounded CM context containing:

- current workspace/history identity and label
- source length
- character, scene, shot and segment counts
- whether the source has changed since the current generated outline
- the active allow-listed editor field
- the exact current selected text, with length limits

The active selection becomes CM Selection, so the companion can show what the user is editing and the Agent receives the actual selected text rather than only a label.

### Safe write path

Publicly exposed capability: `novel.selection.replace`.

- Works only on an explicit non-empty selection inside an allow-listed input/textarea.
- Target ID contains field/range/context fingerprint data.
- Apply is rejected if the selection changed after the Agent created the proposal.
- Apply goes through the workbench's own editable-state commit and local draft-save flow.
- Undo is supported.
- Undo is rejected if the user manually changed the field after CM applied the edit, preventing a stale undo from overwriting newer work.

The iframe bridge also contains an internal whole-source update implementation for future use, but `novel.source.update` is deliberately **not** an allow-listed/public CM action in this version. The Agent is not given the complete long-form source, so exposing whole-document replacement would create an unsafe grounding/overwrite path.

Authentication remains in `NovelPanelPage.jsx`; the iframe CM protocol never receives the account token.

The 1.3 MB V77 `app.js` bundle was not rewritten for this integration. The bridge reuses the workbench's existing `writeFieldValue`, editable-state commit and draft-save interfaces at runtime.

## Still intentionally pending

These areas need additional structured models or stronger confirmation rules:

- Novel Panel full-document rewrite: add a dedicated long-document editing protocol (diff/range/revision based) before exposing a whole-source action.
- History: keep read-only/search-first; destructive actions should require explicit confirmation.
- Settings: diagnostic context only; never expose secrets/API keys.
- Rich undo tokens for entity/asset/TTS mutations. Existing script replace keeps its current one-step undo behavior.

## Primary acceptance scenario

1. User opens a character such as “林晚”.
2. CM shows “林晚” as current context.
3. User says: “她太强势了，外表强势但内心没有安全感；以后生成要保持她的外形。”
4. Agent can propose two structured actions: `character.update` and `constraint.bind`.
5. CM shows the proposal; it does not claim it is already applied.
6. User clicks **应用修改**.
7. Character data is updated while keeping the same entity ID.
8. Constraint stores that ID reference.
9. Later generation resolves the reference against the latest character data.
10. If analysis becomes complex, the existing Agent task can be opened directly in Agent Workspace without copying the question.

## Shot editing acceptance scenario

1. User clicks/focuses “分镜 7”.
2. CM receives the shot snapshot ID, full visible card text and bounded structured `shotData`.
3. User says: “这个镜头太平了，改成低机位推进，人物不要变。”
4. For JSON output, Agent proposes `shot.update` with only the relevant structured fields (for example `shot_angle`, `movement`, `prompt`). For text-card output, it proposes a complete `content` replacement instead of inventing field parsing.
5. CM shows the proposal and waits for **应用修改**.
6. The Script Bridge re-parses the current output and requires the original fingerprinted target ID to still exist.
7. Only the selected shot is updated; later shots and unrelated JSON fields remain unchanged.
8. CM offers **撤销**.
9. If the script has since been manually edited or regenerated, stale undo is refused instead of overwriting the newer output.

## Novel Panel acceptance scenario

1. User highlights a sentence or phrase in an allow-listed Novel Panel editor field.
2. CM changes its context chip to that selection.
3. User says what is wrong with the selected text and asks CM to rewrite it.
4. Agent receives the exact selected text and can propose `novel.selection.replace` using the current selection target ID.
5. CM shows the proposed edit; no write occurs yet.
6. User clicks **应用修改**.
7. The iframe validates that the selection fingerprint is still current, then commits the new value and schedules the existing local draft save.
8. CM offers **撤销**.
9. If the user has already edited the field again, stale undo is refused instead of overwriting the newer edit.
