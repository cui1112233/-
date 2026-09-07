const fs = require('node:fs');

const file = '.github/workflows/v88-linux-amd64-image-release.yml';
let source = fs.readFileSync(file, 'utf8');

const broken = `            docker tag "$fallback_image" "$ghcr_image"\n            REMOTE\n          fi`;
const fixed = `            docker tag "$fallback_image" "$ghcr_image"\n          REMOTE\n          fi`;

if (source.includes(fixed)) {
  console.log('V88_RELEASE_HEREDOC_ALREADY_FIXED');
  process.exit(0);
}

const first = source.indexOf(broken);
if (first < 0) throw new Error('未找到 V88 发布脚本中的错误 heredoc 结束符');
if (source.indexOf(broken, first + broken.length) >= 0) throw new Error('错误 heredoc 片段出现多次，拒绝自动修改');

source = source.slice(0, first) + fixed + source.slice(first + broken.length);
fs.writeFileSync(file, source);
console.log('V88_RELEASE_HEREDOC_FIXED');
