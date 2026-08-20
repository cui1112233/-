# Asset Editor Existing Image Preview

## Goal

When a user opens an existing non-voice Shuihuo asset, the right side of the asset editor shows its current primary image. The upload affordance remains available to replace that image.

## Scope

- Reuse the existing asset-image APIs only.
- Load the image list for the selected asset and use its primary image; if none is marked primary, use the first returned image.
- Request the image through the authenticated image download API and display it as an object URL.
- A newly selected local file immediately replaces the right-side preview before save.
- A missing image or failed download keeps the existing upload placeholder and shows no stale image.
- Voice assets remain unchanged.

## Data Flow

1. Opening the editor selects an existing asset.
2. The editor reads its already-loaded asset image metadata, or requests it when necessary.
3. The primary image is downloaded through the asset image API and converted to an object URL.
4. The preview object URL is released when the dialog closes, the selected asset changes, or a newer image replaces it.
5. Uploading a replacement uses the existing project asset-image upload endpoint and refreshes the parent asset data.

## Error Handling

- Image list and download failures do not block editing asset metadata.
- The editor returns to the upload placeholder after a failed preview fetch.
- Saving an existing asset without choosing a new file updates metadata only and retains the current image.

## Verification

- Add a focused UI contract test for rendering the existing-image preview path and retaining the replacement upload control.
- Run the focused Node test, the Shuihuo UI contract test, the frontend production build, and a browser check with an existing asset image.
