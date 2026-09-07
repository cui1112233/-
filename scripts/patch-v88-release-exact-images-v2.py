from pathlib import Path

path = Path('.github/workflows/v88-linux-amd64-image-release.yml')
text = path.read_text(encoding='utf-8')


def replace_in_step(step, next_step, old, new):
    global text
    start = text.index(f'      - name: {step}\n')
    end = text.index(f'      - name: {next_step}\n', start)
    block = text[start:end]
    if old not in block:
        raise SystemExit(f'{step}: target block not found')
    block = block.replace(old, new, 1)
    text = text[:start] + block + text[end:]


deploy_old = '''          docker tag "$ghcr_image" "$service_image"
          docker tag "$worker_ghcr_image" "$worker_service_image"
          "${compose[@]}" up -d --no-deps --force-recreate --pull never novel-fetch-121-worker
          "${compose[@]}" up -d --no-deps --force-recreate --pull never v88-node
          "${compose[@]}" ps novel-fetch-121-worker v88-node
'''
deploy_new = '''          release_dir="/opt/qiantie/releases/v88/${short_sha}"
          mkdir -p "$release_dir"
          release_override="$release_dir/docker-compose.release-images.yml"
          printf 'services:\n  v88-node:\n    image: %s\n  novel-fetch-121-worker:\n    image: %s\n' "$ghcr_image" "$worker_ghcr_image" > "$release_override"
          compose=(docker compose --env-file "$compose_dir/novel-fetch-121.env" -f "$compose_file" -f "$compose_dir/docker-compose.browser-worker.yml" -f "$release_dir/docker-compose.release-images.yml")
          "${compose[@]}" config >/dev/null
          "${compose[@]}" up -d --no-deps --force-recreate --pull never novel-fetch-121-worker
          "${compose[@]}" up -d --no-deps --force-recreate --pull never v88-node
          "${compose[@]}" ps novel-fetch-121-worker v88-node
'''
replace_in_step('Deploy verified images to V88 ECS', 'Verify V88 ECS deployment', deploy_old, deploy_new)

verify_old = '''          "${ssh_cmd[@]}" bash -s -- "$ECS_COMPOSE_FILE" "$GHCR_IMAGE" <<'REMOTE'
          set -Eeuo pipefail
          compose_file="$1"
          ghcr_image="$2"
          compose_dir="$(dirname "$compose_file")"
          cd "$compose_dir"
          compose=(docker compose --env-file "$compose_dir/novel-fetch-121.env" -f "$compose_file" -f "$compose_dir/docker-compose.browser-worker.yml")
          "${compose[@]}" ps novel-fetch-121-worker v88-node

          node_id="$(${compose[@]} ps -q v88-node)"
          test -n "$node_id"
          expected_node_image_id="$(docker image inspect "$ghcr_image" --format '{{.Id}}')"
          running_node_image_id="$(docker inspect "$node_id" --format '{{.Image}}')"
          test -n "$expected_node_image_id"
          test -n "$running_node_image_id"
          if [ "$running_node_image_id" != "$expected_node_image_id" ]; then
            echo "V88 Node image mismatch: expected $expected_node_image_id, running $running_node_image_id" >&2
            exit 1
          fi

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
          expected_node_image_id="$(docker image inspect "$expected_node_image" --format '{{.Id}}')"
          expected_worker_image_id="$(docker image inspect "$expected_worker_image" --format '{{.Id}}')"
          test "$(docker inspect "$node_id" --format '{{.Image}}')" = "$expected_node_image_id"
          test "$(docker inspect "$worker_id" --format '{{.Image}}')" = "$expected_worker_image_id"
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

path.write_text(text, encoding='utf-8')
print('patched formal release to exact image overrides')
