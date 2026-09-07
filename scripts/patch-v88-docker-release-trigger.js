const fs = require('node:fs');

const file = '.github/workflows/v88-linux-amd64-image-release.yml';
const source = fs.readFileSync(file, 'utf8');
const marker = 'on:\n  workflow_dispatch:\n';
if (source.includes(marker)) {
  console.log('V88_DOCKER_RELEASE_ALREADY_MANUAL');
  process.exit(0);
}
const start = source.indexOf('on:\n');
const endMarker = '  workflow_dispatch:\n';
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('无法定位 Docker release workflow 的 on 块');
const after = end + endMarker.length;
const next = source.slice(0, start) + marker + source.slice(after);
fs.writeFileSync(file, next);
console.log('V88_DOCKER_RELEASE_MANUAL_ONLY');
