from pathlib import Path

workflow_path = Path('.github/workflows/v88-linux-amd64-image-release.yml')
workflow = workflow_path.read_text(encoding='utf-8')

protected_probe = '''            const buildInfoResponse = await fetch('http://127.0.0.1:3000/api/novel-panel/build-info');
            if (!buildInfoResponse.ok) throw new Error(`v88-node internal build-info failed: ${buildInfoResponse.status}`);
            const buildInfo = await buildInfoResponse.json();
            if (buildInfo.app_version !== 'v78.3.0.31' || buildInfo.release_version !== 'v78.3.0.31') {
              throw new Error(`unexpected v88-node build-info: ${JSON.stringify(buildInfo)}`);
            }
'''
if protected_probe not in workflow:
    raise SystemExit('release workflow protected build-info probe not found; refusing blind patch')
workflow = workflow.replace(protected_probe, '', 1)
workflow_path.write_text(workflow, encoding='utf-8')

replacements = {
    Path('tests/v88-public-browser-worker-deploy.test.js'): (
        "  assert.match(verify, /\\/api\\/novel-panel\\/build-info/, 'verify step must check the now-public Novel Panel build identity inside the exact Node container');",
        "  assert.doesNotMatch(verify, /\\/api\\/novel-panel\\/build-info/, 'verify step must not anonymously call the protected Novel Panel build-info endpoint');",
    ),
    Path('tests/novel-panel-v783031-ecs-deploy.test.js'): (
        "assert.match(verifyBlock, /api\\/novel-panel\\/build-info/,\n  'release verification must probe the now-public Novel Panel build identity from inside the exact Node container');",
        "assert.doesNotMatch(verifyBlock, /api\\/novel-panel\\/build-info/,\n  'release verification must not anonymously probe the protected Novel Panel build-info endpoint');",
    ),
    Path('tests/v88-release-registry-resilience.test.js'): (
        "  assert.match(verify, /127\\.0\\.0\\.1:3000\\/api\\/novel-panel\\/build-info/, '必须在 v88-node 容器内部先验证 build-info');",
        "  assert.doesNotMatch(verify, /127\\.0\\.0\\.1:3000\\/api\\/novel-panel\\/build-info/, '发布验收不能匿名访问受保护的 Novel Panel build-info');",
    ),
}

for path, (old, new) in replacements.items():
    text = path.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'{path}: expected protected-build-info assertion not found')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')

print('patched V88 release verification to auth-safe exact-image checks')
