# V88 Batch Factory Public Release Design

## Goal

Publish the redesigned Batch Factory into the public V88 runtime without reverting any newer V88 work and without touching V78.

## Baselines

- Public/main development branch: `v88`.
- V88 baseline at execution start: `fc758bac1573d54e8ba9cdadc941daeac00447cf`.
- Redesigned Batch Factory source branch: `feature/v88-batch-factory-rebuild-20260912`.
- Redesigned Batch Factory head at execution start: `32dae4ab913d703bc6cd523dd0d7569b7ec8db29`.
- The source branch and `v88` are diverged. The Batch Factory branch contains 6 unique commits while V88 contains newer work that must remain intact.

## Release Strategy

Use latest V88 as the authority and integrate the six Batch Factory commits into an isolated integration branch. Do not deploy the old feature branch directly. Resolve conflicts in favor of preserving current V88 infrastructure, novel-fetch, deployment, authentication, and other unrelated fixes while preserving the intended Batch Factory behavior.

After integration, open a PR back to `v88`, use the V88 validation workflows, and merge only when the integration is clean. Public release must use the unified immutable-image path: paired Node and Go images built from the same release SHA. Retired host-stage cutover workflows are not a valid production deployment path.

## Functional Scope

The public Batch Factory must include the redesigned workflow already represented by the six feature commits:

1. Editable book source persists correctly.
2. Asset prompts are isolated per book.
3. Novel production workflow is organized around book -> VIDEO -> shot production.
4. Book split duration constraints are represented in the production workflow.
5. Book status list is simplified for the redesigned UI.
6. Production modules are expanded by default.

The integration must preserve current V88 behavior outside this scope.

## Existing Product Rules To Preserve

The integration must not regress previously agreed Batch Factory rules:

- `VIDEO01` represents one final video item; shot navigation is per-shot, like the script storyboard-card interaction.
- A requested 6-second generation uses 6 seconds when supported. If a provider/model does not support 6 seconds, use the supported 10-second generation path rather than cropping.
- If a provider is asked for 6 seconds but returns 10 seconds, retain the generated asset; downstream merge may exceed audio duration until the user adjusts speed.
- Audio matching supports both duration-driven alignment and playback-speed compression/extension. Video may be slowed when audio is longer, and users may adjust the speed multiplier manually.
- Single-video and two-video composition paths remain valid.
- Public release target is V88 only; V78 is not modified or restarted.

## Technical Constraints

- API/backend remains Go where the Batch Factory V11 API lives.
- User frontend remains React + Ant Design.
- MySQL schema changes, if required, must use Goose migrations; no ad-hoc production DDL.
- Redis remains the queue/lock/non-relational coordination layer.
- TOS remains object storage.
- System preset prompts remain backend-owned templates, replaced with runtime prompt content.
- Production deployment uses immutable images from one exact commit SHA.

## Verification Gates

Before merging to `v88`:

- Compare the integration branch against current `v88` and confirm only intended Batch Factory/docs changes are introduced.
- Run Batch Factory Go tests and frontend tests/build relevant to the changed files.
- Run V88 public release contract tests.
- PR checks must pass, or any unrelated infrastructure failure must be explicitly isolated before proceeding.

Before declaring public success:

- Public `/api/build-info` must identify the deployed release SHA.
- Public `/batch-factory` must load without login/session regression.
- Batch Factory V11 API route must be reachable through the public topology.
- A real Batch Factory flow must demonstrate book selection/editing, VIDEO/shot navigation, and production state without falling back to the old UI.
- Existing V88 novel-fetch and other unrelated routes must remain reachable.

## Rollback

Record the pre-release public build SHA before mutation. If public verification fails, restore the previous immutable Node and Go image pair and verify `/api/build-info` returns the pre-release SHA. Never roll back by switching the public host to V78.
