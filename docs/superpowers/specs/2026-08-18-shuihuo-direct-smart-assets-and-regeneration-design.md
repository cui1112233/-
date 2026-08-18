# Shuihuo Direct Smart Assets And Regeneration Design

**Date:** 2026-08-18

## Goal

Make `人物场景预设` match the direct workflow: one click on `智能预设` sends the project novel and the selected published extraction prompt to the text model, then places generated character, scene, and prop prompt assets in the left preset list. Remove the candidate-review modal and separate adoption action.

Allow one-at-a-time prompt regeneration for an unsatisfactory asset, such as character `小红`, using the same selected published extraction prompt. Regeneration replaces only that asset's prompt and retains its existing generated images.

## User Flow

1. The user selects a text model and a published `人物场景、道具提取` prompt in the toolbar.
2. Clicking `智能预设` sends the project's source novel, selected prompt ID/version, and selected text model to the server. The button displays a loading state during the request.
3. The server validates that the prompt is published and belongs to the asset-extraction slot, resolves its server-owned body, and asks the text model for structured character, scene, and prop assets.
4. On success, the server saves the returned assets directly with source `ai_candidate`. The refreshed left preset list immediately shows them. No candidate modal, checkboxes, or `采纳已选` action is shown.
5. `智能预设` remains available after a successful run. Selecting the same prompt again intentionally runs another full analysis. On a successful response, it replaces the previous unedited AI-generated assets in the left current-preset list and retains manually added or manually edited assets.
6. A failed run does not modify saved assets and remains retryable.
7. Each character, scene, and prop card exposes `重生`. For `小红`, it sends the project novel plus `小红`'s name, category, and current prompt to the text model using the currently selected published extraction prompt.
8. On successful regeneration, only `小红`'s prompt changes. Other assets do not change. Existing images remain but appear as prompt-outdated until a user voluntarily submits a new image-generation task.

## Data And API Boundaries

The browser supplies only model ID, prompt preset ID, project ID, and asset ID. Node resolves the published prompt body and replaces every browser-supplied system prompt before forwarding to Go.

The direct analysis endpoint accepts repeated calls for the same project and prompt version. A successful repeat replaces only assets from the previous AI-generated set that have not been manually edited. Manually added assets and manually edited AI assets remain unchanged. The replacement is transactional: a model or validation failure preserves the previous generated set. The direct regeneration endpoint remains available for every existing asset.

An AI asset removed from the current-preset list is retained as a historical asset when it has generated images. Its images retain immutable snapshots of the asset name, category, and prompt used at image submission. Historical assets are omitted from the left preset list but remain in the matching right-side image library. They are never treated as orphaned media.

Regeneration returns one validated `category`, `name`, and `prompt` item. The server preserves the existing asset ID, category, name, source, manual-edit marker, images, and bindings unless the user changes them separately.

## UI

The toolbar keeps the text-model selector, extraction-prompt selector, and `智能预设` button. The button remains available after a successful run so the user can intentionally run the selected prompt again.

The asset candidate modal and its adoption controls are removed. The left list renders current saved assets only. Every non-voice asset card gains a compact `重生` control beside its prompt/actions. While a card is regenerating, only that card's control is disabled and shows progress.

When a regenerated asset has one or more images, its card displays a short `提示词已更新` state. Existing media is not deleted, replaced, or regenerated automatically. Right-side image cards show the image's own historical prompt snapshot. Clicking an image card opens the existing asset editor for its associated current or historical character, scene, or prop, so the user can inspect and edit it. Saving a historical asset updates that historical asset and its library presentation but does not automatically restore it to the left current-preset list.

## Failure Handling

- Missing text model, unavailable published preset, invalid response, or upstream failure preserves the previous generated set and does not modify assets.
- A single-asset regeneration failure leaves the existing prompt and images unchanged and makes the card retryable.
- Asset writes are transactional: malformed model output cannot leave partial generated assets.
- Manually added assets and manually edited AI assets are not deleted or overwritten by an all-project smart preset run.
- Historical AI assets and their generated images remain accessible from the right-side libraries. Their prompt snapshots remain readable even after a later smart-preset run replaces the left current-preset list.

## Verification

1. Go handler/store tests cover repeatable direct analysis replacement, manual-asset preservation, historical-asset/image retention with prompt snapshots, project/account isolation, direct regeneration replacement, and failure non-mutation.
2. Node gateway tests prove that both endpoints resolve only a published asset-extraction preset body and reject browser prompt bodies.
3. Frontend tests cover direct-click submission, absence of the candidate modal, repeated same-prompt availability, per-card regenerate state, stale-image label, and opening the editor from a historical right-side image card.
4. Run focused Node and Go tests, frontend build, `git diff --check`, restart the local gateway/backend as needed, and inspect the authenticated browser UI without making an external paid model call.

## Non-Goals

- No automatic image generation or deletion during smart preset or prompt regeneration.
- No change to voice assets, video generation, narration, or storyboard media.
- No prompt history/version chooser for regenerated individual assets.
