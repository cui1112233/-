const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createNovelFetchStore } = require('../lib/novel-fetch-store');

function tmpUsers() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-store-'));
  return { usersDir: path.join(dir, 'users'), dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('saveProcessed writes txt + meta and lists', () => {
  const t = tmpUsers();
  try {
    const store = createNovelFetchStore({ usersDir: t.usersDir });
    store.saveProcessed('tester', { bookId: '724852', platform: 3, platformName: '七猫付费', mode: 'induce', text: '优化后正文', report: '报告', gender: '女', style: '现代虐文' });
    const saved = store.read('tester', '724852');
    assert.equal(saved.text, '优化后正文');
    assert.equal(saved.meta.gender, '女');
    assert.equal(saved.meta.style, '现代虐文');
    const list = store.list('tester');
    assert.equal(list.length, 1);
    assert.equal(list[0].bookId, '724852');
    assert.equal(list[0].hasTxt, true);
  } finally { t.cleanup(); }
});

test('saveEdited updates text and updatedAt, keeps gender/style', () => {
  const t = tmpUsers();
  try {
    const store = createNovelFetchStore({ usersDir: t.usersDir });
    store.saveProcessed('tester', { bookId: '1', platform: 2, platformName: '番茄付费', mode: 'hook', text: '原', gender: '男', style: '男频都市' });
    const first = store.read('tester', '1').meta.updatedAt;
    store.saveEdited('tester', '1', '编辑后正文');
    const saved = store.read('tester', '1');
    assert.equal(saved.text, '编辑后正文');
    assert.equal(saved.meta.gender, '男');
    assert.equal(saved.meta.style, '男频都市');
    assert.ok(saved.meta.updatedAt >= first);
  } finally { t.cleanup(); }
});

test('saveEdited without existing meta and no mode throws', () => {
  const t = tmpUsers();
  try {
    const store = createNovelFetchStore({ usersDir: t.usersDir });
    assert.throws(() => store.saveEdited('tester', '9', '正文'), /尚未处理/);
  } finally { t.cleanup(); }
});

test('session set/get roundtrip', () => {
  const t = tmpUsers();
  try {
    const store = createNovelFetchStore({ usersDir: t.usersDir });
    assert.equal(store.getSession('tester'), null);
    store.setSession('tester', 'PHPSESSID=abc123');
    assert.equal(store.getSession('tester').cookie, 'PHPSESSID=abc123');
  } finally { t.cleanup(); }
});
