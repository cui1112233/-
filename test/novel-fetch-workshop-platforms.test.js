const test = require('node:test');
const assert = require('node:assert/strict');
const { visibleWorkshopPlatforms } = require('../routes/novel-fetch-workshop');

test('visibleWorkshopPlatforms exposes only selectable Novel Fetch platforms', () => {
  const platforms = visibleWorkshopPlatforms({
    getPlatforms: () => [
      { id: 2, name: '番茄付费' },
      { id: 15, name: '知乎付费', visible: false },
      { id: '', name: '无编号' },
      { id: 7, name: '   ' }
    ]
  });

  assert.deepEqual(platforms, [{ id: '2', name: '番茄付费' }]);
});
