from pathlib import Path

path = Path('.github/workflows/v88-linux-amd64-image-release.yml')
text = path.read_text()
start_marker = '      - name: Verify V88 ECS deployment\n'
end_marker = '\n      - name: Rollback V88 ECS on failed verification\n'
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('unable to locate V88 verify step')

replacement = r'''      - name: Verify V88 ECS deployment
        shell: bash
        run: |
          set -Eeuo pipefail
          if [ "$ECS_DEPLOY_READY" != "true" ]; then
            echo "::notice::ECS verification skipped because deployment was not attempted."
            exit 0
          fi
          ssh_cmd=(ssh -i "$HOME/.ssh/v88_ecs" -o IdentitiesOnly=yes -o BatchMode=yes -o PasswordAuthentication=no -o ConnectTimeout=20 "$ECS_USER@$ECS_HOST")
          "${ssh_cmd[@]}" bash -s -- "$ECS_COMPOSE_FILE" "$GHCR_IMAGE" <<'REMOTE'
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
          for attempt in $(seq 1 30); do
            worker_health="$(docker inspect -f '{{.State.Health.Status}}' "$worker_id" 2>/dev/null || true)"
            if [ "$worker_health" = healthy ]; then
              break
            fi
            if [ "$attempt" = 30 ]; then
              echo "Novel Fetch 121 Browser Worker did not become healthy" >&2
              exit 1
            fi
            sleep 2
          done

          "${compose[@]}" exec -T v88-node node - <<'NODE'
          (async () => {
            const required = ['QIANTIE_121_BROWSER_WORKER_URL', 'QIANTIE_121_WORKER_SECRET', 'QIANTIE_121_CREDENTIAL_SECRET'];
            for (const key of required) {
              if (!String(process.env[key] || '').trim()) throw new Error(`${key} missing inside v88-node`);
            }
            const response = await fetch(`${process.env.QIANTIE_121_BROWSER_WORKER_URL}/healthz`, {
              headers: { 'x-qiantie-internal-secret': process.env.QIANTIE_121_WORKER_SECRET }
            });
            if (!response.ok) throw new Error(`121 Browser Worker health request failed: ${response.status}`);
            const body = await response.json();
            if (body.ok !== true) throw new Error('121 Browser Worker health response is not ok');
          })().catch(error => {
            console.error(error);
            process.exit(1);
          });
          NODE

          for attempt in $(seq 1 30); do
            body="$(curl -fsS http://127.0.0.1:3000/api/build-info || true)"
            if printf '%s' "$body" | grep -q '\"app_version\"'; then
              feedback_html="$(curl -fsS http://127.0.0.1:3000/batch-rewrite/ || true)"
              feedback_js="$(curl -fsS http://127.0.0.1:3000/batch-rewrite/interaction-feedback.js || true)"
              task_visibility_js="$(curl -fsS http://127.0.0.1:3000/batch-rewrite/task-visibility-hotfix.js || true)"
              novel_panel_html="$(curl -fsS http://127.0.0.1:3000/novel-panel || true)"
              printf '%s' "$feedback_html" | grep -q 'interaction-feedback.js'
              printf '%s' "$feedback_html" | grep -q 'task-visibility-hotfix.js'
              printf '%s' "$feedback_js" | grep -q 'processBtn'
              printf '%s' "$task_visibility_js" | grep -q 'latestTaskDate'
              test -n "$novel_panel_html"
              echo "Local ECS exact-image and public-surface verification passed."
              exit 0
            fi
            sleep 2
          done
          echo 'Local ECS public liveness or Novel Fetch static verification failed.' >&2
          exit 1
          REMOTE

          for attempt in $(seq 1 20); do
            public_body="$(curl -fsS --connect-timeout 5 "http://${ECS_HOST}:3000/api/build-info" || true)"
            if printf '%s' "$public_body" | grep -q '\"app_version\"'; then
              public_feedback_html="$(curl -fsS --connect-timeout 5 "http://${ECS_HOST}:3000/batch-rewrite/" || true)"
              public_feedback_js="$(curl -fsS --connect-timeout 5 "http://${ECS_HOST}:3000/batch-rewrite/interaction-feedback.js" || true)"
              public_task_visibility_js="$(curl -fsS --connect-timeout 5 "http://${ECS_HOST}:3000/batch-rewrite/task-visibility-hotfix.js" || true)"
              printf '%s' "$public_feedback_html" | grep -q 'interaction-feedback.js'
              printf '%s' "$public_feedback_html" | grep -q 'task-visibility-hotfix.js'
              printf '%s' "$public_feedback_js" | grep -q 'processBtn'
              printf '%s' "$public_task_visibility_js" | grep -q 'latestTaskDate'
              curl -fsS --connect-timeout 5 "http://${ECS_HOST}:3000/novel-panel" >/dev/null
              echo "Public V88 exact-image release surfaces verified."
              exit 0
            fi
            sleep 2
          done
          echo 'Public V88 liveness or Novel Fetch static verification failed.' >&2
          exit 1
'''

path.write_text(text[:start] + replacement + text[end:])
