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

CM never manipulates DOM fields directly. Actions are allow-listed and applied by the current function area's existing business state/API.

Mutations are serialized, and queued actions are rejected if the user has switched away from the bridge that accepted them.

### Structured AI proposals

`frontend/src/shared/pet/cmActionProposal.js` parses a final `cm-actions` JSON block from an Agent response.

The user sees the natural-language reply and a separate modification proposal. Nothing is written until the user clicks **应用修改**.

CM metadata is folded into the Agent server's existing safe context fields (`summary`, `entities`, `actions`) so the backend's page-context whitelist remains intact.

## Script workbench (`/script`)

Implemented:

- Current character/scene becomes CM Selection when the entity editor is opened.
- Character update.
- Character create.
- Set/unset protagonist.
- Scene update.
- Scene create.
- Full script replacement.
- Constraint update.
- Entity-to-constraint binding.
- Existing script revision preview remains compatible.
- Missing `enrichScriptEntity` import fixed in the design branch.

### Stable constraint references

`scriptConstraints.js` now stores `entityReferences` by entity ID rather than copying entity names/text.

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

## Still intentionally pending

These areas need their own page bridges rather than DOM automation:

- Novel Panel iframe: add CM context/action messages to its existing MessageChannel bridge.
- Shot-level direct mutation: current shot cards publish Selection, but `shot.update` is not registered as directly applicable yet because the shot output needs a stable structured shot data model rather than string replacement.
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
