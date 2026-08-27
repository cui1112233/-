import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../frontend/src/user/pages/BatchFactoryPreviewPage.jsx", import.meta.url),
  "utf8",
);

test("V6 production settings are grouped into three setting cards", () => {
  assert.match(source, /基础生产设置/);
  assert.match(source, /高级生产设置/);
  assert.match(source, /提示词与生成约束/);
  assert.match(source, /本次修改将影响/);
});

test("V6 publish settings drawer exposes product, publish parameters, and preview", () => {
  assert.match(source, /function PublishSettingsDrawer/);
  assert.match(source, /上传视频/);
  assert.match(source, /滚屏数量/);
  assert.match(source, /解压倍速/);
  assert.match(source, /自动上传.*bookId.*txt/);
  assert.match(source, /保存发布统一设置/);
});

test("publish settings button opens the drawer and saves through batch settings API", () => {
  assert.match(source, /setPublishSettingsOpen\(true\)/);
  assert.match(source, /updateBatchFactorySettings\(batch\.id, settings\)/);
  assert.match(source, /<PublishSettingsDrawer/);
});
