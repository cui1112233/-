const DELIMITER = /^\s*---\s*$/;
const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md']);

function trimText(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim();
}

function extensionOf(name) {
  const match = String(name || '').toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : '';
}

function titleFromFileName(name, index = 1) {
  const raw = String(name || '').replace(/\\/g, '/').split('/').pop() || '';
  const title = raw.replace(/\.[^.]+$/, '').trim();
  return title || `手动导入 ${String(index).padStart(2, '0')}`;
}

function itemFromText(sourceText, index) {
  const text = trimText(sourceText);
  return {
    title: `手动导入 ${String(index).padStart(2, '0')}`,
    sourceText: text,
    txtText: text,
    txtFileName: `manual-${String(index).padStart(2, '0')}.txt`
  };
}

export function parsePastedContent(value) {
  const input = String(value ?? '').replace(/\r\n?/g, '\n');
  const items = input
    .split('\n')
    .reduce((groups, line) => {
      if (DELIMITER.test(line)) {
        groups.push('');
      } else {
        groups[groups.length - 1] = `${groups[groups.length - 1]}${groups[groups.length - 1] ? '\n' : ''}${line}`;
      }
      return groups;
    }, [''])
    .map((text, index) => itemFromText(text, index + 1))
    .filter(item => item.sourceText);
  if (!items.length) throw new Error('请输入至少一篇有效内容');
  return items;
}

export function canImportFile(file) {
  return Boolean(file && SUPPORTED_EXTENSIONS.has(extensionOf(file.name)));
}

export function normalizeImportedFile(fileName, value) {
  const sourceText = trimText(value);
  if (!sourceText) throw new Error('文件内容为空，无法导入');
  return {
    title: titleFromFileName(fileName),
    sourceText,
    txtText: sourceText,
    txtFileName: String(fileName || 'manual.txt')
  };
}

export function normalizeSkillIds(skillIds) {
  return [...new Set((Array.isArray(skillIds) ? skillIds : []).map(value => String(value || '').trim()).filter(Boolean))].slice(0, 3);
}
