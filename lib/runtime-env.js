const fs = require('node:fs');

function hydrateMissingEnvFromFile(filePath, keys, env = process.env) {
  if (!filePath || !Array.isArray(keys) || !keys.length) return env;
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return env;
    throw error;
  }

  const allowed = new Set(keys.map(key => String(key || '').trim()).filter(Boolean));
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (!allowed.has(key) || String(env[key] || '').trim()) continue;
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) env[key] = value;
  }
  return env;
}

module.exports = { hydrateMissingEnvFromFile };
