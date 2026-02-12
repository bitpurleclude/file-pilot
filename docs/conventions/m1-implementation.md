# M1 实现约定

- 分层保持：Renderer -> IPC Client -> Preload -> Main Handler -> UseCase -> Infra。
- IPC 返回统一结构：`{ ok: true, data } | { ok: false, error }`。
- 配置禁止写死在业务逻辑，统一放在 `apps/desktop/shared/config`。
- M1 执行默认 `dry-run`，手动确认后才允许真实移动/复制。
- 白名单是执行前置条件，非白名单路径直接拒绝。
- LLM API 必须使用模板化接入：通过 `nunjucks` 渲染提示词模板（Jinja2 风格），禁止在业务代码拼接长字符串 prompt。
- 模板需要版本化：每次请求记录 `prompt_version`，便于回放与问题定位。
- 模板变量必须做 schema 校验，缺失变量直接失败并返回统一错误码。
