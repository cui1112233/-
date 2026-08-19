# Shuihuo Asset Preset Generation Design

**Date:** 2026-08-18

## Goal

Complete the project-level `人物场景预设` workbench so it can analyze source material into selectable character, scene, and prop presets; generate persistent reference images for only the selected presets; and automatically bind those presets back to the storyboard subtitles while retaining manual control.

This extends the existing Shuihuo project, model, task, object-storage, media, and system-preset services. It does not expose provider credentials, endpoints, request templates, or published system-prompt bodies to normal users.

## User Flow

1. In `人物场景预设`, the user selects a text model and published analysis preset, then clicks `智能预设`.
2. A scope dialog offers `全部预设`, `只解析角色`, `只解析场景`, and `只解析道具`.
3. The server resolves only the published system preset assigned to that scope, calls the selected text model, and returns editable candidates. The dialog visibly reports `AI正在分析` while the request is active.
4. The user selects the candidate presets to retain. Applying candidates creates project assets and immediately runs subtitle-to-asset binding.
5. Each storyboard row refreshes its character, scene, and prop selections from those bindings. The user may add or remove each binding at any time; auto-binding never locks a row.
6. The user selects an enabled image model, aspect ratio, a project style, and, for character assets only, a published `人物设定` preset. The generation scope can again be all assets or one category, and only checked assets are submitted.
7. `AI生成` creates one asset-specific image task for every selected asset. Completed images appear in the matching right-side library, and can be viewed, selected, regenerated, or deleted without becoming storyboard media.

## System-Preset Ownership

The Node gateway owns all system-prompt resolution. The browser sends only preset IDs and model IDs; it can never submit an effective prompt body.

Published Shuihuo primary slots required by this feature are:

| Slot | Built-in default | Used for |
| --- | --- | --- |
| `shuihuo.asset.character-extraction` | `shuihuo-extract-characters` | Character analysis |
| `shuihuo.asset.scene-extraction` | `shuihuo-extract-scenes` | Scene analysis |
| `shuihuo.asset.prop-extraction` | `shuihuo-extract-props` | Prop analysis |
| `shuihuo.asset.binding` | `shuihuo-asset-binding` | Subtitle-to-asset binding |
| `shuihuo.asset.character-sheet` | `shuihuo-character-color-sheet` | Character color design sheet |
| `shuihuo.asset.character-sheet` | `shuihuo-character-accessory-sheet` | Character three-view accessory sheet |
| `shuihuo.asset.character-sheet` | `shuihuo-character-three-view` | Standard three-view sheet |
| `shuihuo.asset.character-sheet` | `shuihuo-character-expression-sheet` | Expression and state sheet |
| `shuihuo.asset.character-sheet` | `shuihuo-character-single-view` | Single-view character sheet |

The five character-sheet prompts use the user-provided text. They are selectable only for `character` asset generation. A publication changes the next request immediately without rewriting project data; projects retain only the stable preset ID and resolved version snapshot with the submitted task.

## Style Library

Styles are project-scoped records, not strings in a browser form. Each style contains:

- name
- editable style prompt
- optional image reference media

The style selector chooses one record for the project generation configuration. Style changes do not alter previously submitted asset tasks. If an image model does not support a reference image, the server omits the image while retaining the style prompt. A style can be edited or deleted only when no active asset-generation task depends on that edit; deletion clears the project selection first.

## Asset Analysis And Binding

The analysis request accepts one category scope and one selected text model. `全部预设` calls the three extraction slots and presents their combined candidates, grouped by category. A category-only request calls just its matching slot.

Candidate application is transactional per candidate: a successful candidate becomes a project asset with source `ai_candidate`; failures are returned per item and do not silently discard other selected candidates.

After application, the server submits a bounded subtitle-binding analysis using the selected text model and `shuihuo.asset.binding`. The model receives current project assets and the project subtitles in chunks. Its structured output identifies asset IDs per subtitle. Each result is validated for project ownership before replacing that segment's character, scene, and prop bindings.

If binding fails after assets are saved, assets remain available and the response reports that automatic binding was not completed. The UI offers a retry. Existing manually edited bindings are preserved unless the user explicitly chooses `重新自动绑定`; newly analyzed assets are only added automatically to unedited bindings. In all cases, the row-level controls remain the final manual override.

## Asset Image Generation

Asset generation uses a dedicated task kind and an asset-image relation. It must not create synthetic storyboards or write images into the segment media table.

For every selected asset, the server creates an immutable task input snapshot containing:

- asset ID, category, current asset prompt, and name
- selected enabled image model and requested aspect ratio
- selected style name and style prompt
- reference image object only when the selected model supports it
- selected character-sheet preset ID and resolved version for characters only

The effective positive prompt is assembled server-side. Scene and prop generation omit character-sheet content. The worker calls the existing image-provider adapter, writes the returned image to object storage, creates an asset-image record, and reports safe task state through the existing project task drawer. Re-generation creates an additional image candidate and never overwrites an existing image.

Asset-image cards are shown in `角色库`, `场景库`, and `道具库` with task state, preview, delete, select-as-primary, and regenerate. They can be bound as visual references by a later storyboard/media request, but are not automatically substituted for segment primary images.

## UI Layout

The existing large `人物场景预设` overlay remains. Its top bar is ordered as:

1. text model
2. analysis-preset selector
3. `智能预设`
4. image model
5. aspect ratio
6. style selector and `选择风格`
7. character-sheet selector, visible only while the character category is active
8. `AI生成`
9. existing audio controls

The left panel is the checked analysis/asset list. The right panel has tabs for `AI角色`, `AI场景`, `AI道具`, `AI音色`, `角色库`, `场景库`, and `音色库`. Style selection opens a grid with editable style cards and reference-image upload. The generated image grid follows the supplied reference: only real stored images render as cards; pending and failed tasks show their real task state rather than fabricated thumbnails.

## Error Handling And Safety

- Missing model, unpublished preset, incompatible category, invalid image reference, or unavailable provider blocks submission before work starts and explains the corrective action.
- Maximum selected asset count and subtitle chunk size are enforced server-side to avoid upstream timeout and uncontrolled costs.
- A failed task never changes the asset prompt, existing generated images, segment media, or manual bindings.
- Requests and task/status APIs return IDs, safe labels, and error summaries only. They never return model credentials, raw provider requests, private object keys, or system-prompt bodies.
- All styles, assets, images, tasks, and bindings remain account- and project-scoped.

## Verification

1. Go tests cover category validation, project/account isolation, prompt snapshot assembly, manual-binding preservation, asset-image persistence, and reference-image capability behavior.
2. Node tests prove that each analysis and character-sheet request resolves only published slot-compatible preset bodies and rejects browser-supplied prompt bodies.
3. Frontend contracts cover scope selection, candidate selection, category filtering, style edit/upload, character-only sheet controls, real task state, and manual add/remove binding controls.
4. Run targeted Node tests, `go test ./...`, frontend build, and `git diff --check`.
5. Browser verification checks analysis and generation controls using existing data without submitting a paid model request. A real end-to-end image generation test happens only after the user selects a configured provider and confirms the task submission.

## Non-Goals

- No extraction of or dependence on third-party protected code.
- No automatic use of asset images as a storyboard primary image.
- No change to video, narration, export, or existing completed project media.
