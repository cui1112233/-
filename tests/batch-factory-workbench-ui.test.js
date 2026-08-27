const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const page = [
  fs.readFileSync("frontend/src/user/pages/BatchFactoryPage.jsx", "utf8"),
  fs.readFileSync(
    "frontend/src/user/pages/BatchFactoryPreviewPage.jsx",
    "utf8",
  ),
].join("\n");
const layout = fs.readFileSync(
  "frontend/src/shared/layouts/UserLayout.jsx",
  "utf8",
);
const shuihuo = fs.readFileSync(
  "frontend/src/user/pages/shuihuo/ProjectsView.jsx",
  "utf8",
);
const novelFetchFrame = fs.readFileSync(
  "frontend/public/batch-rewrite/app.js",
  "utf8",
);
const novelFetchFrameHtml = fs.readFileSync(
  "frontend/public/batch-rewrite/index.html",
  "utf8",
);
const novelFetchHost = fs.readFileSync(
  "frontend/src/user/pages/NovelFetchPage.jsx",
  "utf8",
);

test("screenshot workbench title bar exposes title and return action", () => {
  assert.match(page, /批量工厂/);
  assert.match(page, /返回水货生产/);
  assert.match(
    page,
    /href:\s*['\"]\/shuihuo-production['\"]|location(?:\.href)?\s*=\s*['\"]\/shuihuo-production['\"]/,
  );
  assert.match(page, /batch-factory-page-header|batch-factory-topbar/);
});

test("screenshot frame loads real batch data instead of only fixed sample rows", () => {
  const source = fs.readFileSync(
    "frontend/src/user/pages/BatchFactoryPreviewPage.jsx",
    "utf8",
  );
  assert.match(source, /getBatchFactoryBatch/);
  assert.match(source, /listBatchFactoryBatches/);
  assert.match(source, /const \[batch, setBatch\]/);
  assert.match(source, /mapItems\(batch, byProjectId\)/);
  assert.match(source, /暂无小说/);
  assert.doesNotMatch(source, /return items\.length \? items : samples/);
});

test("production settings and individual overrides are persisted instead of being fake controls", () => {
  const source = fs.readFileSync("frontend/src/user/pages/BatchFactoryPreviewPage.jsx", "utf8");
  assert.match(source, /ProductionSettingsDrawer/);
  assert.match(source, /updateBatchFactorySettings/);
  assert.match(source, /updateBatchFactoryItem/);
  assert.match(source, /个别小说/);
  assert.match(source, /settingOverrides/);
});

test("new batch stays inside the workbench and creates an imported pending batch", () => {
  const source = fs.readFileSync(
    "frontend/src/user/pages/BatchFactoryPreviewPage.jsx",
    "utf8",
  );
  assert.match(source, /BatchIntakeDrawer/);
  assert.match(source, /createBatchFactoryBatch/);
  assert.match(source, /parseManualNovels/);
  assert.match(source, /上传 TXT \/ MD/);
  assert.match(source, /创建批次/);
  assert.match(
    source,
    /disabled=\{\s*!items\.length \|\|\s*!modelId \|\|\s*inspectedItems\.some/,
  );
});

test("batch intake includes built-in video adapters instead of filtering them out", () => {
  const intake = fs.readFileSync(
    "frontend/src/user/pages/BatchFactoryPreviewPage.jsx",
    "utf8",
  );
  const controls = fs.readFileSync(
    "frontend/src/user/pages/batch-factory/BatchFactoryProductionControls.jsx",
    "utf8",
  );
  assert.match(intake, /batchFactorySelectableVideoModels/);
  assert.match(intake, /defaultBatchFactoryVideoModel/);
  assert.match(controls, /yd_video:\s*1/);
  assert.match(controls, /local_executor_video:\s*10/);
  assert.match(controls, /requiresImageInput !== true/);
  assert.match(controls, /图生 · 固定/);
  assert.match(controls, /文生 · 最长/);
});

test("current-book fold headers use the dark workbench button style", () => {
  const stylesheet = fs.readFileSync(
    "frontend/src/user/pages/batch-factory-preview.css",
    "utf8",
  );
  assert.match(stylesheet, /\.bf-preview-folds > div > button\s*\{/);
  assert.match(stylesheet, /\.bf-preview-folds > div > button\s*\{[\s\S]*?background:\s*#102033/);
});

test("batch factory defines matching light-theme surface tokens", () => {
  const stylesheet = fs.readFileSync(
    "frontend/src/user/pages/batch-factory-preview.css",
    "utf8",
  );
  assert.match(stylesheet, /--bf-page:/);
  assert.match(stylesheet, /\[data-theme="light"\] \.bf-preview-page\s*\{/);
  assert.match(stylesheet, /--bf-panel:/);
  assert.match(stylesheet, /--bf-text:/);
});

test("batch intake detects invalid files and exposes editable duplicate draft fields", () => {
  const source = fs.readFileSync(
    "frontend/src/user/pages/BatchFactoryPreviewPage.jsx",
    "utf8",
  );
  assert.match(source, /超过 2 MB/);
  assert.match(source, /文件正文不能为空/);
  assert.match(source, /Book ID 只能填写数字/);
  assert.match(source, /duplicateFields/);
  assert.match(source, /更新书名/);
  assert.match(source, /更新 Book ID/);
});

test("batch factory entry is gold and the workbench has no duplicate brand title", () => {
  const styles = fs.readFileSync(
    "frontend/src/user/pages/shuihuo-production.css",
    "utf8",
  );
  const source = fs.readFileSync(
    "frontend/src/user/pages/BatchFactoryPreviewPage.jsx",
    "utf8",
  );
  assert.match(styles, /\.shuihuo-create-batch[^{]*\{[^}]*#d9a441/);
  assert.doesNotMatch(source, /className="bf-preview-brand"/);
});

test("start director uses the active batch API and refreshes the workbench state", () => {
  const source = fs.readFileSync(
    "frontend/src/user/pages/BatchFactoryPreviewPage.jsx",
    "utf8",
  );
  assert.match(source, /startBatchFactoryBatch/);
  assert.match(source, /function startDirector\(\)/);
  assert.match(source, /setBatch\(result\.batch\)/);
});

test("generate pending videos uses the batch model binding and refreshes the workbench", () => {
  const source = fs.readFileSync(
    "frontend/src/user/pages/BatchFactoryPreviewPage.jsx",
    "utf8",
  );
  assert.match(source, /generateBatchFactoryBatch/);
  assert.match(source, /function generatePendingVideos\(\)/);
  assert.match(source, /batch\.settings\?\.videoModelId/);
});

test("fixed frame exposes actual VIDEO prefix information when inspecting prompts", () => {
  const source = fs.readFileSync("frontend/src/user/pages/BatchFactoryPreviewPage.jsx", "utf8");
  assert.match(source, /prefix_key/);
  assert.match(source, /result\.prefix\?\.key/);
  assert.match(source, /compileBatchFactoryVideo/);
});

test("VIDEO cards keep editable visual prompts separate from compiled submission prompts", () => {
  const source = fs.readFileSync("frontend/src/user/pages/BatchFactoryPreviewPage.jsx", "utf8");
  const api = fs.readFileSync("frontend/src/shared/api/batchFactory.js", "utf8");
  const router = fs.readFileSync("routes/batch-factory.js", "utf8");
  assert.match(source, /本书 VIDEO 画面提示词/);
  assert.match(source, /编辑画面提示词/);
  assert.match(source, /提交时动态编译/);
  assert.match(api, /updateBatchFactoryVideoVisualPrompt/);
  assert.match(router, /videos\/:videoId\/visual-prompt/);
});

test("single VIDEO settings persist an explicit override and retain a follow-batch reset", () => {
  const source = fs.readFileSync("frontend/src/user/pages/BatchFactoryPreviewPage.jsx", "utf8");
  const production = fs.readFileSync("routes/batch-factory-production.js", "utf8");
  assert.match(source, /VIDEO .*单独设置/);
  assert.match(source, /跟随批次/);
  assert.match(source, /videoOverrides/);
  assert.match(production, /item\.videoOverrides/);
  assert.match(production, /settingSource/);
});

test("fixed frame only enables merge through the existing merge capability contract", () => {
  const source = fs.readFileSync("frontend/src/user/pages/BatchFactoryPreviewPage.jsx", "utf8");
  assert.match(source, /getBatchFactoryMergeCapability/);
  assert.match(source, /mergeBatchFactoryVideos/);
  assert.match(source, /resolveBatchFactoryVideoProduction/);
  assert.match(source, /合并当前小说/);
});

test("screenshot workbench batch action bar exposes production and publish tabs", () => {
  assert.match(page, /batch-factory-action-bar/);
  assert.match(page, /生产统一设置/);
  assert.match(page, /发布统一设置/);
  assert.match(page, /production[^\n]*tab|tab[^\n]*production/i);
  assert.match(page, /publish[^\n]*tab|tab[^\n]*publish/i);
});

test("screenshot workbench status center includes abnormal summary", () => {
  assert.match(page, /batch-factory-status-center/);
  assert.match(page, /异常/);
  assert.match(page, /batch-factory-abnormal-summary/);
});

test("status center locates matching novels without filtering the book list", () => {
  const source = fs.readFileSync(
    "frontend/src/user/pages/BatchFactoryPreviewPage.jsx",
    "utf8",
  );
  assert.match(source, /function locateStatus\(label\)/);
  assert.match(source, /scrollIntoView/);
  assert.match(source, /currentFilter/);
  assert.doesNotMatch(
    source,
    /filter\(item\s*=>\s*item\.status\s*===\s*currentFilter/,
  );
});

test("screenshot workbench keeps three-column regions", () => {
  assert.match(page, /batch-factory-workbench-grid/);
  assert.match(page, /batch-factory-novel-list/);
  assert.match(page, /batch-factory-center/);
  assert.match(page, /batch-factory-right-rail/);
});

test("screenshot workbench right rail exposes video progress ring", () => {
  assert.match(page, /视频生成进度/);
  assert.match(page, /batch-factory-video-progress-ring/);
  assert.match(page, /VIDEO/);
});

test("screenshot workbench right rail exposes bulk merge section", () => {
  assert.match(page, /batch-factory-bulk-merge/);
  assert.match(page, /批量合并|合并待合并/);
});

test("batch factory exposes the four-zone workbench shell", () => {
  for (const marker of [
    "batch-factory-workbench",
    "batch-factory-status-center",
    "batch-factory-novel-list",
    "batch-factory-right-rail",
    "待合并",
    "已合并",
  ])
    assert.match(page, new RegExp(marker));
});

test("batch factory stays out of global navigation", () => {
  const shuihuoIndex = layout.indexOf("href: '/shuihuo-production'");
  const batchIndex = layout.indexOf("href: '/batch-factory'");
  assert.ok(shuihuoIndex >= 0);
  assert.equal(batchIndex, -1);
});

test("batch factory automatically collapses the global navigation for the workbench", () => {
  const source = fs.readFileSync(
    "frontend/src/shared/layouts/UserLayout.jsx",
    "utf8",
  );
  assert.match(source, /pathname === '\/batch-factory'/);
  assert.match(source, /setSidebarCollapsed\(true\)/);
});

test("shuihuo creation header exposes batch factory beside comic creation", () => {
  assert.match(shuihuo, /创作漫剧/);
  assert.match(shuihuo, /onOpenBatchFactory/);
  assert.match(shuihuo, /批量工厂/);
});

test("completed novel-fetch tasks transfer into the batch factory frame", () => {
  assert.match(novelFetchFrameHtml, /进入批量工厂/);
  assert.match(novelFetchFrame, /\/api\/batch-factory\/intakes\/novel-fetch/);
  assert.match(novelFetchFrame, /qiantie:batch-factory-intake/);
  assert.match(novelFetchHost, /qiantie:batch-factory-intake/);
  assert.match(novelFetchHost, /redirectTo/);
  const preview = fs.readFileSync("frontend/src/user/pages/BatchFactoryPreviewPage.jsx", "utf8");
  assert.match(preview, /getBatchFactoryIntake/);
  assert.match(preview, /sourceIntakeId/);
  assert.match(preview, /URLSearchParams\(window\.location\.search\)\.get\("intake"\)/);
});
