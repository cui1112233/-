const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { merge121BookInfoIntoMeta } = require('../lib/novel-fetch-workshop/121-bookinfo');
const { createNovelFetchWorkshopRouter } = require('../routes/novel-fetch-workshop');

test('121 bookinfo derives gender from an explicit male/female category without using numeric genre', () => {
  const male = merge121BookInfoIntoMeta(
    { gender: '', genderSource: '' },
    { book_name: '港岛雨停，再无爱意', category: '男生生活', genre: 8 }
  );
  assert.equal(male.category, '男生生活');
  assert.equal(male.genre, 8);
  assert.equal(male.bookName, '港岛雨停，再无爱意');
  assert.equal(male.gender, '男频');
  assert.equal(male.genderSource, '121_category');

  const female = merge121BookInfoIntoMeta(
    { gender: '', genderSource: '' },
    { category: '女生言情', genre: 8 }
  );
  assert.equal(female.gender, '女频');
  assert.equal(female.genderSource, '121_category');

  const ambiguous = merge121BookInfoIntoMeta(
    { gender: '', genderSource: '' },
    { category: '都市生活', genre: 8 }
  );
  assert.equal(ambiguous.gender, '');
  assert.equal(ambiguous.genderSource, '');
});

test('121 bookinfo never overwrites a manually supplied gender', () => {
  const merged = merge121BookInfoIntoMeta(
    { bookName: '用户手工书名', gender: '女频', genderSource: 'input' },
    { book_name: '港岛雨停，再无爱意', category: '男生生活', genre: 8 }
  );
  assert.equal(merged.category, '男生生活');
  assert.equal(merged.genre, 8);
  assert.equal(merged.bookName, '用户手工书名');
  assert.equal(merged.gender, '女频');
  assert.equal(merged.genderSource, 'input');
});

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('workshop fetches 121 metadata before AI classifies remaining missing fields', async () => {
  let stored = null;
  let classifierSaw = null;
  const tasks = {
    async saveTasks(_username, rows) {
      for (const row of rows) stored = { ...(stored || {}), ...row };
      return { saved: rows.length, duplicates: 0 };
    },
    async fetchOriginal() {
      stored = {
        ...stored,
        category: '男生生活',
        genre: 8,
        gender: '男频',
        genderSource: '121_category',
        originalStatus: 'done',
        status: 'original_done'
      };
      return { status: 'done' };
    },
    async getTask() { return { meta: { ...stored } }; },
    async listTasks() { return stored ? [{ ...stored }] : []; }
  };
  const configStore = {
    getConfig() {
      return {
        workflow: { auto_classify_missing: true, auto_fetch_original: true, auto_rewrite_after_fetch: false },
        fetch: { default_max_txt: 4000, concurrency: 1 },
        rewrite: { default_ai_count: 1 }
      };
    },
    getPlatforms() { return [{ id: '2', name: '番茄付费' }]; },
    getStyles() { return ['现代通用']; }
  };
  const parse = {
    parseBooks() {
      return {
        tasks: [{ bookId: '7673480334440139800', bookName: '测试书', gender: '', style: '现代通用' }],
        parsed: 1,
        emptyIdCount: 0,
        uniqueTasks: 1,
        duplicateCount: 0
      };
    }
  };
  const classifier = {
    async classifyMissingRows({ tasks: rows }) {
      classifierSaw = rows.map(row => ({ ...row }));
      return { tasks: rows, errors: [] };
    }
  };
  const auth = (req, _res, next) => { req.username = 'writer'; req.auth = { account: { username: 'writer' } }; next(); };
  const router = createNovelFetchWorkshopRouter({ tasks, configStore, parse, classifier, auth });
  const app = express();
  app.use(express.json());
  app.use('/api/novel-fetch-workshop', router);
  const server = await listen(app);

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/novel-fetch-workshop/process`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platformId: '2', inputText: '7673480334440139800' })
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(classifierSaw?.[0]?.gender, '男频');
    assert.equal(classifierSaw?.[0]?.genderSource, '121_category');
    assert.equal(classifierSaw?.[0]?.category, '男生生活');
    assert.equal(payload.fetched, 1);
  } finally {
    await close(server);
  }
});
