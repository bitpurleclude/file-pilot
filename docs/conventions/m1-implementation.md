# M1 实现约定

- 分层保持：Renderer -> IPC Client -> Preload -> Main Handler -> UseCase -> Infra。
- IPC 返回统一结构：`{ ok: true, data } | { ok: false, error }`。
- 配置禁止写死在业务逻辑，统一放在 `apps/desktop/shared/config`。
- M1 执行默认 `dry-run`，手动确认后才允许真实移动/复制。
- 白名单是执行前置条件，非白名单路径直接拒绝。
