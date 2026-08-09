const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relPath) {
  const filePath = path.join(root, relPath);

  assert(
    fs.existsSync(filePath),
    `Required file is missing: ${relPath}`
  );

  return fs.readFileSync(filePath, 'utf8');
}

function assertIncludes(text, needle, label) {
  assert(
    text.includes(needle),
    `${label} should include ${JSON.stringify(needle)}`
  );
}

function assertNotIncludes(text, needle, label) {
  assert(
    !text.includes(needle),
    `${label} should not include ${JSON.stringify(needle)}`
  );
}

const home = read('index.html');
const scriptPage = read('views/script.html');
const agentPage = read('views/agent.html');
const ttsPage = read('views/tts.html');
const pagesRouter = read('routes/pages.js');
const commonJs = read('public/js/common.js');
const techDoc = read('docs/技术文档.md');

assertNotIncludes(home, 'id="page-script"', 'index.html');
assertNotIncludes(home, 'id="page-agent"', 'index.html');
assertNotIncludes(home, 'id="novel-input"', 'index.html');
assertNotIncludes(home, 'src="/js/script.js"', 'index.html');

assertIncludes(home, 'data-href="/script"', 'index.html');
assertIncludes(home, 'data-href="/agent"', 'index.html');
assertIncludes(home, 'data-href="/tts"', 'index.html');

assertIncludes(scriptPage, 'id="page-script"', 'views/script.html');
assertIncludes(scriptPage, 'id="novel-input"', 'views/script.html');
assertIncludes(scriptPage, 'src="/js/script.js"', 'views/script.html');

assertIncludes(agentPage, 'id="page-agent"', 'views/agent.html');
assertNotIncludes(agentPage, 'src="/js/script.js"', 'views/agent.html');

assertIncludes(ttsPage, 'id="page-tts"', 'views/tts.html');
assertIncludes(ttsPage, 'src="/js/tts.js"', 'views/tts.html');

assertIncludes(pagesRouter, "router.get('/',", 'routes/pages.js');
assertIncludes(pagesRouter, "router.get('/script'", 'routes/pages.js');
assertIncludes(pagesRouter, "router.get('/agent'", 'routes/pages.js');
assertIncludes(pagesRouter, "router.get('/tts'", 'routes/pages.js');

assertIncludes(commonJs, 'data-href', 'public/js/common.js');

assertIncludes(techDoc, 'Express', 'docs/技术文档.md');
assertIncludes(techDoc, 'Authorization: Bearer <token>', 'docs/技术文档.md');
assertIncludes(techDoc, 'views/', 'docs/技术文档.md');
assertIncludes(techDoc, 'public/', 'docs/技术文档.md');
assertNotIncludes(techDoc, '零第三方依赖', 'docs/技术文档.md');
assertNotIncludes(techDoc, '无 Express / Koa / Fastify', 'docs/技术文档.md');
assertNotIncludes(techDoc, 'X-Auth-Token 请求头', 'docs/技术文档.md');

console.log('Multipage architecture validation passed.');
