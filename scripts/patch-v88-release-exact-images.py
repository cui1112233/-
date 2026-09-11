from pathlib import Path

path = Path('.github/workflows/v88-linux-amd64-image-release.yml')
text = path.read_text(encoding='utf-8')


def step_slice(name, next_name):
    start = text.index(f'      - name: {name}\n')
    end = text.index(f'      - name: {next_name}\n', start)
    return start, end, text[start:end]


def replace_in_step(name, next_name, old, new):
    global text
    start, end, block = step_slice(name, next_name)
    if old not in block:
        raise SystemExit(f'{name}: target block not found')
    block = block.replace(old, new, 1)
    text = text[:start] + block + text[end:]


deploy_old = '''          compose=(docker compose --env-file "$compose_dir/novel-fetch-121.env" -f "$compose_file" -f "$compose_dir/docker-compose.browser-worker.yml")
          "${compose[@]}" config >/dev/null

          container_id="$(${compose[@]} ps -q v88-node)"
          test -n "$container_id"
          service_image="$(docker inspect "$container_id" --format '{{.Config.Image}}')"
          test -n "$service_image"
          docker image inspect "$service_image" >/dev/null
          rollback_image="v88-public-v88-node:rollback-${short_sha}-$(date +%Y%m%d%H%M%S)"
          docker tag "$service_image" "$rollback_image"
          printf '%s\\n' "$rollback_image" > /tmp/v88-last-rollback-image
          printf '%s\\n' "$service_image" > /tmp/v88-last-service-image

          worker_service_image='v88-public-novel-fetch-121-worker:v88-latest'
          worker_container_id="$(${compose[@]} ps -q novel-fetch-121-worker || true)"
          : > /tmp/v88-last-rollback-worker-image
          printf '%s\\n' "$worker_service_image" > /tmp/v88-last-worker-service-image
          if [ -n "$worker_container_id" ]; then
            previous_worker_image="$(docker inspect "$worker_container_id" --format '{{.Config.Image}}')"
            test -n "$previous_worker_image"
            docker image inspect "$previous_worker_image" >/dev/null
            rollback_worker_image="v88-public-novel-fetch-121-worker:rollback-${short_sha}-$(date +%Y%m%d%H%M%S)"
            docker tag "$previous_worker_image" "$rollback_worker_image"
            printf '%s\\n' "$rollback_worker_image" > /tmp/v88-last-rollback-worker-image
          fi

          docker image inspect "$ghcr_image" --format '{{.Os}}/{{.Architecture}}' | grep -qx 'linux/amd64'
          docker image inspect "$worker_ghcr_image" --format '{{.Os}}/{{.Architecture}}' | grep -qx 'linux/amd64'
          docker tag "$ghcr_image" "$service_image"
          docker tag "$worker_ghcr_image" "$worker_service_image"
          "${compose[@]}" up -d --no-deps --force-recreate --pull never novel-fetch-121-worker
          "${compose[@]}" up -d --no-deps --force-recreate --pull never v88-node
          "${compose[@]}" ps novel-fetch-121-worker v88-node
'''

deploy_new = '''          base_compose=(docker compose --env-file "$compose_dir/novel-fetch-121.env" -f "$compose_file" -f "$compose_dir/docker-compose.browser-worker.yml")
          "${base_compose[@]}" config >/dev/null

          container_id="$(${base_compose[@]} ps -q v88-node)"
          test -n "$container_id"
          previous_node_image_id="$(docker inspect "$container_id" --format '{{.Image}}')"
          test -n "$previous_node_image_id"
          docker image inspect "$previous_node_image_id" >/dev/null
          rollback_image="v88-public-v88-node:rollback-${short_sha}-$(date +%Y%m%d%H%M%S)"
          docker tag "$previous_node_image_id" "$rollback_image"

          worker_container_id="$(${base_compose[@]} ps -q novel-fetch-121-worker || true)"
          rollback_worker_image=''
          had_worker=false
          if [ -n "$worker_container_id" ]; then
            had_worker=true
            previous_worker_image_id="$(docker inspect "$worker_container_id" --format '{{.Image}}')"
            test -n "$previous_worker_image_id"
            docker image inspect "$previous_worker_image_id" >/dev/null
            rollback_worker_image="v88-public-novel-fetch-121-worker:rollback-${short_sha}-$(date +%Y%m%d%H%M%S)"
            docker tag "$previous_worker_image_id" "$rollback_worker_image"
          fi

          docker image inspect "$ghcr_image" --format '{{.Os}}/{{.Architecture}}' | grep -qx 'linux/amd64'
          docker image inspect "$worker_ghcr_image" --format '{{.Os}}/{{.Architecture}}' | grep -qx 'linux/amd64'

          release_dir="/opt/qiantie/releases/v88/${short_sha}"
          mkdir -p "$release_dir"
          release_override="$release_dir/docker-compose.release-images.yml"
          rollback_override="$release_dir/docker-compose.rollback-images.yml"
          printf 'services:\n  v88-node:\n    image: %s\n  novel-fetch-121-worker:\n    image: %s\n' "$ghcr_image" "$worker_ghcr_image" > "$release_override"
          if [ "$had_worker" = true ]; then
            printf 'services:\n  v88-node:\n    image: %s\n  novel-fetch-121-worker:\n    image: %s\n' "$rollback_image" "$rollback_worker_image" > "$rollback_override"
          else
            printf 'services:\n  v88-node:\n    image: %s\n' "$rollback_image" > "$rollback_override"
          fi
          printf '%s\\n' "$release_override" > /tmp/v88-last-release-override
          printf '%s\\n' "$rollback_override" > /tmp/v88-last-rollback-override
          printf '%s\\n' "$had_worker" > /tmp/v88-last-had-worker

          compose=(docker compose --env-file "$compose_dir/novel-fetch-121.env" -f "$compose_file" -f "$compose_dir/docker-compose.browser-worker.yml" -f "$release_dir/docker-compose.release-images.yml")
          "${compose[@]}" config >/dev/null
          "${compose[@]}" up -d --no-deps --force-recreate --pull never novel-fetch-121-worker
          "${compose[@]}" up -d --no-deps --force-recreate --pull never v88-node
          "${compose[@]}" ps novel-fetch-121-worker v88-node
'''
replace_in_step('Deploy verified images to V88 ECS', 'Verify V88 ECS deployment', deploy_old, deploy_new)

verify_old = '''          "${ssh_cmd[@]}" bash -s -- "$ECS_COMPOSE_FILE" <<'REMOTE'
          set -Eeuo pipefail
          compose_file="$1"
          compose_dir="$(dirname "$compose_file")"
          cd "$compose_dir"
          compose=(docker compose --env-file "$compose_dir/novel-fetch-121.env" -f "$compose_file" -f "$compose_dir/docker-compose.browser-worker.yml")
          "${compose[@]}" ps novel-fetch-121-worker v88-node

          worker_id="$(${compose[@]} ps -q novel-fetch-121-worker)"
          test -n "$worker_id"
'''
verify_new = '''          "${ssh_cmd[@]}" bash -s -- "$ECS_COMPOSE_FILE" "$GHCR_IMAGE" "$WORKER_GHCR_IMAGE" "$SHORT_SHA" <<'REMOTE'
          set -Eeuo pipefail
          compose_file="$1"
          expected_node_image="$2"
          expected_worker_image="$3"
          short_sha="$4"
          compose_dir="$(dirname "$compose_file")"
          release_override="/opt/qiantie/releases/v88/${short_sha}/docker-compose.release-images.yml"
          test -s "$release_override"
          cd "$compose_dir"
          compose=(docker compose --env-file "$compose_dir/novel-fetch-121.env" -f "$compose_file" -f "$compose_dir/docker-compose.browser-worker.yml" -f "$release_override")
          "${compose[@]}" ps novel-fetch-121-worker v88-node

          node_id="$(${compose[@]} ps -q v88-node)"
          worker_id="$(${compose[@]} ps -q novel-fetch-121-worker)"
          test -n "$node_id"
          test -n "$worker_id"
          actual_node_image="$(docker inspect "$node_id" --format '{{.Config.Image}}')"
          actual_worker_image="$(docker inspect "$worker_id" --format '{{.Config.Image}}')"
          test "$actual_node_image" = "$expected_node_image"
          test "$actual_worker_image" = "$expected_worker_image"
          expected_node_id="$(docker image inspect "$expected_node_image" --format '{{.Id}}')"
          expected_worker_id="$(docker image inspect "$expected_worker_image" --format '{{.Id}}')"
          test "$(docker inspect "$node_id" --format '{{.Image}}')" = "$expected_node_id"
          test "$(docker inspect "$worker_id" --format '{{.Image}}')" = "$expected_worker_id"
'''
replace_in_step('Verify V88 ECS deployment', 'Rollback V88 ECS on failed verification', verify_old, verify_new)

probe_old = '''            const response = await fetch(`${process.env.QIANTIE_121_BROWSER_WORKER_URL}/healthz`, {
'''
probe_new = '''            const buildInfoResponse = await fetch('http://127.0.0.1:3000/api/novel-panel/build-info');
            if (!buildInfoResponse.ok) throw new Error(`v88-node internal build-info failed: ${buildInfoResponse.status}`);
            const buildInfo = await buildInfoResponse.json();
            if (buildInfo.app_version !== 'v78.3.0.31' || buildInfo.release_version !== 'v78.3.0.31') {
              throw new Error(`unexpected v88-node build-info: ${JSON.stringify(buildInfo)}`);
            }
            const response = await fetch(`${process.env.QIANTIE_121_BROWSER_WORKER_URL}/healthz`, {
'''
replace_in_step('Verify V88 ECS deployment', 'Rollback V88 ECS on failed verification', probe_old, probe_new)

rollback_old = '''          compose=(docker compose --env-file "$compose_dir/novel-fetch-121.env" -f "$compose_file" -f "$compose_dir/docker-compose.browser-worker.yml")
          test -s /tmp/v88-last-rollback-image
          test -s /tmp/v88-last-service-image
          rollback_image="$(cat /tmp/v88-last-rollback-image)"
          service_image="$(cat /tmp/v88-last-service-image)"
          docker image inspect "$rollback_image" >/dev/null
          docker image inspect "$service_image" >/dev/null
          docker tag "$rollback_image" "$service_image"

          if [ -s /tmp/v88-last-rollback-worker-image ]; then
            test -s /tmp/v88-last-worker-service-image
            rollback_worker_image="$(cat /tmp/v88-last-rollback-worker-image)"
            worker_service_image="$(cat /tmp/v88-last-worker-service-image)"
            docker image inspect "$rollback_worker_image" >/dev/null
            docker tag "$rollback_worker_image" "$worker_service_image"
            "${compose[@]}" up -d --no-deps --force-recreate --pull never novel-fetch-121-worker
            "${compose[@]}" up -d --no-deps --force-recreate --pull never v88-node
            "${compose[@]}" ps novel-fetch-121-worker v88-node
          else
            "${compose[@]}" stop novel-fetch-121-worker || true
            "${compose[@]}" rm -f novel-fetch-121-worker || true
            docker compose -f "$compose_file" up -d --no-deps --force-recreate --pull never v88-node
            docker compose -f "$compose_file" ps v88-node
          fi
          echo "Rolled back V88 ECS to $service_image"
'''
rollback_new = '''          test -s /tmp/v88-last-rollback-override
          test -s /tmp/v88-last-had-worker
          rollback_override="$(cat /tmp/v88-last-rollback-override)"
          had_worker="$(cat /tmp/v88-last-had-worker)"
          test -s "$rollback_override"

          if [ "$had_worker" = true ]; then
            compose=(docker compose --env-file "$compose_dir/novel-fetch-121.env" -f "$compose_file" -f "$compose_dir/docker-compose.browser-worker.yml" -f "$rollback_override")
            "${compose[@]}" config >/dev/null
            "${compose[@]}" up -d --no-deps --force-recreate --pull never novel-fetch-121-worker
            "${compose[@]}" up -d --no-deps --force-recreate --pull never v88-node
            "${compose[@]}" ps novel-fetch-121-worker v88-node
          else
            release_override="$(cat /tmp/v88-last-release-override 2>/dev/null || true)"
            if [ -n "$release_override" ] && [ -s "$release_override" ]; then
              release_compose=(docker compose --env-file "$compose_dir/novel-fetch-121.env" -f "$compose_file" -f "$compose_dir/docker-compose.browser-worker.yml" -f "$release_override")
              "${release_compose[@]}" stop novel-fetch-121-worker || true
              "${release_compose[@]}" rm -f novel-fetch-121-worker || true
            fi
            rollback_node=(docker compose -f "$compose_file" -f "$rollback_override")
            "${rollback_node[@]}" up -d --no-deps --force-recreate --pull never v88-node
            "${rollback_node[@]}" ps v88-node
          fi
          echo "Rolled back V88 ECS with exact rollback image override: $rollback_override"
'''
replace_in_step('Rollback V88 ECS on failed verification', 'Prune old V88 AMD64 release artifacts', rollback_old, rollback_new)

path.write_text(text, encoding='utf-8')
print('patched exact release image deployment')
