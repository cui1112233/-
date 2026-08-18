# System Preset Slot Ownership Design

**Date:** 2026-08-18

## Goal

Every system preset has a stable, explicit ownership slot. A preset name is display text only: changing a published preset's name or body must update the matching selector and later generation requests without breaking project selections.

The first user-facing workflow is Shuihuo Production asset analysis. Its "人物场景预设" panel will have separate project-level selectors for character extraction and scene extraction. A published preset assigned to either slot appears only in that selector.

## Why Slots Instead Of Names

Matching by name makes a renamed prompt unreachable. The stable reference is the preset `id`; the stable role is a controlled `slot` identifier. A project saves the selected preset IDs, then each request resolves the currently published version of those IDs. As a result, publishing a new version under the same ID immediately changes the displayed name and effective body while preserving project selection.

## Slot Registry

`lib/system-preset-catalog.js` will export one registry. Each entry has:

- `id`: stable ownership identifier, for example `shuihuo.asset.character-extraction`.
- `module`: owning system module.
- `label`: admin and user-facing label.
- `request`: the server operation that can consume it.
- `mode`: `primary` for a selectable main prompt or `addon` for a bounded supplement.

The catalog seeds every built-in preset with exactly one `protocolLock.slot`. Existing Shuihuo slots are:

| Slot | Default preset | Used by |
| --- | --- | --- |
| `shuihuo.asset.character-extraction` | `shuihuo-extract-characters` | Asset analysis character extraction |
| `shuihuo.asset.scene-extraction` | `shuihuo-extract-scenes` | Asset analysis scene extraction |
| `shuihuo.segmentation.smart` | `shuihuo-smart-segmentation` | AI storyboard segmentation |
| `shuihuo.prompt.image` | `shuihuo-image-prompt` | Image prompt candidates |
| `shuihuo.prompt.video` | `shuihuo-video-prompt` | Video prompt candidates |
| `shuihuo.prompt.negative` | `shuihuo-negative-prompt` | Negative prompt candidates |

The same registry assigns each existing Script and Novel Panel preset a slot. A slot is required for all newly created or edited presets. Built-in and known legacy presets are migrated by creating a normal newer published version that preserves their body and records the catalog slot. A legacy custom preset without a known slot is shown as `待设置归属`; it cannot be published or selected until an administrator edits it and chooses a slot. The system never guesses a custom prompt's role from its name or body.

## Admin Behavior

The System Presets editor gets a required `归属` select after the module select. Its options are filtered to the selected module from the slot registry. The table adds a `归属` column and shows `待设置归属` for old custom records that require repair.

Creating a new primary preset requires a slot. Editing an existing preset creates a new version with its slot preselected; an administrator may move it to another valid slot deliberately. Add-ons also receive one slot, but are only appended to compatible requests and are not offered as a project primary selection.

The admin API returns a public `slot` field in preset summaries and a public slot catalog. It never exposes prompt bodies to normal accounts. Existing edit/version/publish authorization remains unchanged.

## Shuihuo Project Selection

`AssetGenerationConfig` gains two nullable project-owned string columns:

- `character_preset_id`
- `scene_preset_id`

The existing numeric `prompt_template_id` remains untouched for compatibility. A repeatable MySQL migration adds the two columns. The Go API validates only shape and project ownership; it does not attempt to resolve Node-owned preset records.

The node gateway owns resolution because it owns the system preset store. It exposes a read-only authenticated catalog endpoint containing only published Shuihuo presets, their IDs, names, versions, and slots. `AssetsView` loads it with the project generation configuration and renders two selectors:

- `人物资产提示词`: published primary presets in `shuihuo.asset.character-extraction`.
- `场景资产提示词`: published primary presets in `shuihuo.asset.scene-extraction`.

Existing projects default logically to the two built-in IDs until they save a different selection. The stored value is an ID, not a snapshot name or prompt body. If a selected preset is no longer published or its slot no longer matches, the control displays an actionable invalid-selection state and blocks asset analysis; it does not silently fall back to a different prompt.

## Request Flow

1. The project saves `characterPresetId` and `scenePresetId` through the existing asset-generation configuration endpoint.
2. The user selects a text model and clicks `智能预设` in the asset panel.
3. The frontend submits only the two selected IDs and model ID to `/analysis/assets`.
4. The Node gateway validates that both IDs are published, belong to Shuihuo, and own the required slots. It replaces any browser-supplied prompt body with the two resolved published bodies, preserving their IDs and versions in the forwarded request.
5. The Go asset-analysis handler receives the resolved content only. It creates a reproducible request snapshot from the actual resolved body and does not trust a browser prompt.

Changing an existing preset's name/body and publishing a new version under the same ID changes both selector text and the next resolved request. A project only needs to select again when the preset is archived, deleted, or deliberately moved to another slot.

## Safety And Error Handling

- Unknown slot IDs, cross-module IDs, draft IDs, and add-ons submitted as a primary selection return `409` with a specific correction message.
- No missing selection is substituted from user input. The two built-in defaults are used only for projects that have never saved an explicit selection.
- Project configuration remains account- and project-scoped.
- Prompt body resolution happens only at the Node gateway. The Go service validates the resolved slot identifiers/version but does not gain access to admin prompt storage.
- Publishing a new version is atomic within the existing preset store; a generation request resolves one published version per selected ID.

## Tests

1. Preset-store tests cover valid slot assignment, rejection of missing/foreign slots, and legacy custom preset repair behavior.
2. Admin route and React contract tests cover the filtered `归属` select, table display, and public metadata without exposing bodies.
3. Node gateway tests prove a user-selected character/scene pair replaces browser-supplied prompt text, preserves ID/version metadata, and rejects invalid/moved/archived selections.
4. Go store and handler tests prove both project fields are saved, read, isolated by account, and preserved through existing configuration changes.
5. Shuihuo UI tests cover two independently filtered dropdowns, default built-in choices for a new project, save/reload, and invalid-selection blocking.
6. Run Node tests, targeted Go tests from `backend`, frontend build, `git diff --check`, and a browser check that the two selectors render without invoking an external model.

## Non-Goals

- No prompt body is copied into project data.
- No automatic rewrite of unknown legacy custom prompt ownership.
- No automatic replacement of a project-selected custom preset after it is archived or moved.
- This change does not make model credentials, Redis, or media-generation providers available.
