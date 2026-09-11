function createRuntimeBuildInfoHandler({ service, releaseSha = process.env.QIANTIE_RELEASE_SHA } = {}) {
  const payload = {
    service: String(service || '').trim(),
    git_sha: String(releaseSha || '').trim()
  };
  return (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };
}

module.exports = { createRuntimeBuildInfoHandler };
