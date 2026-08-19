# 独立模型连接测试设计

## 目标

设置页的文本模型和 OpenAI 兼容生图模型分别测试各自未保存的 Base URL、API Key 和模型名称。文本测试维持现有最小 Chat Completions 请求；生图测试默认只验证网络、鉴权和模型目录，不生成图片，不产生图片生成费用。

## 范围

- 文本服务保留独立的“测试文本连接”按钮和加载状态。
- 生图服务新增独立的“测试生图连接”按钮和加载状态。
- 两个测试都只使用当前表单中的对应字段，不保存配置，也不读取另一个服务的 URL、Key 或模型名称。
- 生图测试请求 OpenAI 兼容的 `GET /v1/models`：
  - HTTP 2xx 表示网关、TLS、代理和鉴权连接可用；
  - 若响应包含模型列表，返回当前模型是否出现在列表中；
  - 若网关不提供模型列表，返回明确的上游状态，不把它误报为“生图成功”。
- 不新增“生成测试图”。该操作会消耗额度，必须另行确认需求后才加入。

## 接口

### `POST /api/test/text`

输入仅包含文本服务字段：`provider`、`baseUrl`、`model`、`apiKey`。服务端沿用 Chat Completions 测试，响应为 `{ ok, kind: 'text', message }`。原 `POST /api/test` 保留为该接口的兼容别名。

### `POST /api/test/image`

输入仅包含 `image` 对象：`provider`、`mode`、`displayName`、`baseUrl`、`model`、`apiKey`。服务端验证 OpenAI 兼容配置后请求规范化的 `/v1/models`，响应为 `{ ok, kind: 'image', modelListed, message }`。密钥不得出现在响应、日志或错误中。

## 请求与错误处理

- 复用 `lib/shared.js` 的代理选择和 TLS 兼容策略，文本和生图都经过同一上游传输层。
- 将上游请求构造拆为“Chat Completions URL”和“Models URL”，避免把生图测试错误发送到 Chat Completions。
- `EPROTO`、超时、非 JSON、401/403、模型目录不支持以及模型未列出分别映射为清晰的用户提示；不关闭 TLS 校验，也不回退到文本配置。

## 前端交互

- 文本按钮放在文本模型区，生图按钮放在生图区；二者各自显示加载状态，互不影响。
- 测试时只校验本服务必填字段。填写临时 Key 后可直接测试，测试结束不会把 Key 写入配置。
- 保存操作仍是唯一写入当前账号配置的操作。

## 测试

- Node 路由测试覆盖：文本测试只读取文本字段，生图测试只读取 `image` 字段；两条请求均走代理配置。
- URL 构造单测覆盖 `/v1/models`、已有 `/v1` 结尾和非法 Base URL。
- 前端契约测试覆盖两个独立按钮、两个 loading 状态、以及各自的 API 调用参数。
- 手动冒烟：使用无效测试 Key 预期收到上游 401，确认不会出现 `EPROTO`；不调用真实生图生成接口。
