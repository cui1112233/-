# Script Inline Image Mention Design

## Decision

Script generation has two intentionally different subject references:

1. A subject without a usable primary image remains ordinary editable text, for example `@妻子`.
2. A subject with a usable primary image is rendered inside the editor as one atomic inline label: its thumbnail followed by its name.

The inline label is a visual representation of the same canonical mention. The stored and generated prompt text remains `@妻子`, so copying, saving, regenerating, and legacy text-only consumers remain compatible. A label never represents an uploaded image if the entity no longer has a usable primary image; it immediately falls back to ordinary `@妻子` text.

## Editor behavior

The full script editor and the single-shot editor use the same mention model. Typing `@` opens the existing cursor-anchored asset menu. Choosing an entity with a primary image replaces the typed mention token with an atomic inline label. Choosing one without an image inserts ordinary `@名称`. Backspace/delete removes an inline label as a single unit; ordinary text continues to edit normally.

Choosing a missing-image item opens the existing entity image editor. Creating a subject continues to prefill the typed mention name in the existing character/scene creation dialog. These actions do not create another asset store or duplicate images.

## Video reference upload contract

At video submission, each shot is normalized to its canonical plain text. The existing reference-image collector resolves every entity named by an inline image label or a textual `@名称` against the current character/scene library.

- A resolved entity with a usable primary image contributes that image to the video request reference attachments.
- A resolved entity without a primary image contributes only its text name; no empty or placeholder image is uploaded.
- Repeated references to the same entity are deduplicated by entity identity while preserving the currently supported reference ordering.

This lets users write ordinary prompts first, then make a subject image-backed simply by assigning its primary image; it also ensures image-backed mentions reach the actual video provider rather than being decorative editor UI.

## Compatibility and failure behavior

Existing stored prompt text needs no migration. Loading old `@名称` text renders as an inline image label only when the current library has a matching primary image. If an image URL cannot be loaded, the editor renders the normal textual mention rather than a broken thumbnail. Video submission keeps the existing request failure behavior and never submits a missing image as an attachment.

## Verification

Focused tests cover mention token replacement, fallback text, atomic label serialization, primary-image collection/deduplication, and the payload passed into the current video request. Browser acceptance covers both editor surfaces: one image-backed subject, one text-only subject, upload of the image-backed reference, and reversion after removing the main image.
