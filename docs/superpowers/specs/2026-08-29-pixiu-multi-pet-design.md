# 貔貅多宠物系统设计

## 目标

在保留现有 CM/Stacky 桌面宠物能力的前提下，新增第二只「貔貅」宠物，并允许当前账号在用户端设置页切换宠物形象。第一阶段复用现有行为状态机，长期架构允许每只宠物拥有独立视觉、行为与台词配置。

## 产品边界

- API/接口端以 Golang 为唯一权威来源，负责保存与读取当前账号选择的宠物 ID。
- 用户端为 React + Ant Design，设置页展示宠物列表、预览与保存。
- 管理端为 React + Ant Design，本阶段不增加宠物管理后台；宠物目录先随版本发布。
- Node/Express 旧配置层不再负责宠物选择持久化，避免双写和配置漂移。
- 默认宠物继续为 `stacky`；第二只为 `pixiu`。

## 架构

### Go API

新增独立用户偏好存储 `user_preferences`，不把宠物选择塞进 API Key/模型连接配置表。偏好记录以 `user_id` 为主键，保存 `pet_id`，默认值 `stacky`。

`GET /api/config` 继续作为设置页聚合读取接口，在原有公开模型配置之外返回 `pet: "stacky" | "pixiu"`。`POST /api/config` 接受 `pet` 字符串；服务端只允许已注册宠物 ID，非法值回退到旧值，旧值也无效时回退 `stacky`。

这样用户端无需增加额外请求，同时宠物偏好在数据库层仍与 API 密钥配置解耦。

### React 用户端

`frontend/src/shared/pet/petCatalog.js` 是纯展示注册表，包含每只宠物的：

- `id`
- `displayName`
- `description`
- `spritesheetPath`
- `spriteVersionNumber`
- `atlasProfile`
- `behaviorProfile`
- `speechProfile`
- `renderMode`

设置页保存时只向 Go API 发送宠物 ID，不发送完整客户端宠物对象。服务端返回宠物 ID 后，React 再通过本地注册表解析为视觉定义。

`StackyPet` 第一阶段保留现有组件与聊天任务生命周期，只动态读取宠物定义，因此 CM ↔ 貔貅切换不会清空聊天、Agent 任务、拖拽位置或主动说话状态。

### 资源

- `pets/stacky/` 保留现有资源。
- `pets/pixiu/` 保存貔貅资源。
- 第一阶段貔貅遵守 `stacky-v2` atlas contract，从而直接复用 `idle / working / success / error / mouse-look` 行为。
- 后续若增加 `sleep / scratch / wealth / greet` 等独立动作，只新增新的 atlas/behavior profile，不破坏第一阶段接口。

## 兼容与回退

- 老账号没有 `user_preferences` 记录时返回 `stacky`。
- 请求携带未知宠物 ID 时保留已有合法选择；没有合法旧值时使用 `stacky`。
- 前端遇到未知宠物 ID 时使用 `stacky`。
- 宠物切换失败不得破坏已有模型连接配置。

## 验证

- Go 单元测试覆盖宠物 ID 规范化、默认值、非法值回退。
- migration 测试覆盖 `user_preferences` 表、外键和默认 `pet_id`。
- HTTP handler 测试覆盖 GET 返回宠物、POST 保存 `pixiu`、非法 ID 回退。
- React 单元测试覆盖两只宠物注册和前端未知 ID 回退。
- 前端构建通过；Go `go test ./...` 通过。
- 完成后删除开发期间临时 pet feature CI workflow。
