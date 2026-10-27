# AutoDL H3 Transparent Reference Fallback

## Goal

Allow the configured image-to-video workflow `minimax_h3_zm_u24` to submit
when a user has not selected a reference image, without changing the user's
selected workflow.

## Decision

The Go AutoDL H3 adapter will insert the verified public transparent PNG
`https://tvmao-public.tos-cn-beijing.volces.com/tapnow/empty.png` as
`ref_image_0` only when all reference-image sources are empty and the
selected workflow is not the explicit text-only workflow
`minimax_h3_lightx2v_no_pic`.

User-selected reference images keep their original order and are never
replaced. The explicit text-only workflow continues to omit `ref_image_N`.
The adapter continues to submit the configured workflow ID; it does not
silently select a different workflow.

## Boundaries

- The fallback is an outbound AutoDL submission detail. It does not change
  existing task rows, user model configuration, database schema, or UI.
- The PNG was checked on 2026-10-27 and returned public HTTP 200 with
  `Content-Type: image/png`.
- Existing failed video tasks are not retried by this change. A real retry is
  a billable provider action and requires a separate user instruction after
  the deployed behavior is verified.

## Acceptance

- A `minimax_h3_zm_u24` submission without images contains the transparent
  PNG as `ref_image_0`.
- A submission with a user image sends that image as `ref_image_0` instead.
- An explicit `minimax_h3_lightx2v_no_pic` submission still has no
  `ref_image_N` field.
- The targeted Go tests and the Go suite pass before a Go-only release.
