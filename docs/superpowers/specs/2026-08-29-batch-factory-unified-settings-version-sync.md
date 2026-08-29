# Batch Factory Unified Settings Version Sync Spec

## Goal

把批量工厂的「生产统一设置」升级成可版本冻结、可同步后台最新配置、可按批次/单书/单 VIDEO 分层覆盖的真实生产配置系统。

## Approved behavior

1. 配置优先级固定为 `system < batch < book < video`。
2. 批次创建/保存后必须冻结后台批量工厂 system preset 的版本快照；后台后续发布新版本不能静默改变旧批次。
3. 「版本配置」可选择当前可用的历史配置快照；每个快照由当时全部 `batch-factory` 已发布 preset 的版本号组成。
4. 「同步批量后台配置」只把当前批次的 system preset 快照切到后台最新发布状态；单书和单 VIDEO 手动 override 必须保留。
5. 生产统一设置继续保存视频模型、画幅、固定单 VIDEO、前缀模式、剧本/资产 Prompt 选择、字幕策略以及约束设置。
6. 约束设置不进入第二层设置页：开关直接启用/禁用；点击编辑项用轻量浮层编辑内容。
7. 约束设置包含：画面前缀、人物 Prompt、场景 Prompt、道具 Prompt、画质约束、画面限制、负面提示词；字幕策略独立保留。
8. 当前小说设置必须可用，显示继承/覆盖状态，并允许恢复继承。保存使用已有 item override 接口。
9. 单 VIDEO prompt 约束拥有最高优先级，并持久化到 item 的 video override map；编译和正式视频生产都使用同一份有效设置。
10. `visualPrompt/video_desc` 只保存当前 VIDEO 的剧情和画面描述；人物/场景/道具/前缀/画质/限制/负面词在编译时动态注入。
11. 固定单 VIDEO 仍然允许内部多个 shot；固定的是 storyboard 只输出一个 VIDEO，不是单 shot。
12. 不修改 master；所有实现进入 `08-batch-factory-unified-settings-version-sync`。

## Version snapshot model

- 后台以 `presetStore.listAll('batch-factory')` 为事实来源。
- 每次 preset 发布形成一个版本事件；当所有当前批量工厂 preset 都已有版本后，可以形成完整历史快照。
- 快照包含 `revision`、`label`、`publishedAt`、`presetVersions: { [presetId]: version }`。
- 当前后台发布状态始终额外生成一个 latest snapshot，并与历史快照按 revision 去重。
- 批次 settings 持久化 `systemConfigRevision`、`systemConfigLabel`、`systemConfigSyncedAt`、`systemPresetVersions`。
- 运行时读取 system preset 时优先使用 `systemPresetVersions[presetId]` 对应的历史版本；缺失或无效时才回退当前 published。

## Override model

### Batch

批次 settings 保存完整生产设置和 system version snapshot。

### Book

`item.settingsOverride` 只保存用户实际覆盖的字段。未保存的字段继续继承 batch。

### Video

`item.videoSettingsOverrides[videoId]` 只保存当前 VIDEO 覆盖的 prompt/画幅相关字段；未保存字段继承 book/batch。

恢复继承通过删除对应 override key，而不是复制父级当前值。

## Safety / compatibility

- 已绑定的视频模型 ID、version ID、max duration 仍由服务端能力校验，不能由版本同步改写。
- 历史批次没有 version snapshot 时自动按当前 published 运行，首次保存/同步后获得 snapshot。
- 旧字段兼容读取；新 UI 统一使用后端真实字段名 `injectCharacterPrompt / injectScenePrompt / injectPropPrompt`。
