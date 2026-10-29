# CI 语言切换用例根因跟进记录（2026-10-29）

## 现象（不变）

`ui-settings.spec.ts:160 › language switch through the settings UI select persists` 在 GitHub windows runner 上确定性失败；所有开发机本地恒过。API 版持久化用例（settings API 写入 + 重启回显）在 CI 绿。当前 CI-only skip（`test.skip(process.env.CI !== undefined)`）。

## 本次新增的取证（来自 run 40170218832，be558b8）

从 CI 失败日志定位到确切失败点：

1. **通过**：`ui-settings.spec.ts:190` `combobox.click()` —— 触发器点开正常；
2. **通过**：`ui-settings.spec.ts:191` `option "English" toBeVisible` —— radix Select 列表打开且选项可见（10s 内）；
3. **失败**：`ui-settings.spec.ts:189`（键盘 ArrowDown+Enter 之后）`heading "Settings" toBeVisible` 20s 超时 —— **语言状态从未变为 en**，界面停留中文；
4. 无 pageerror、无 console error（be558b8 专门注入的捕获均空）；renderer 健康。

## 根因收敛

排除项（基于上述证据 + API 版用例 CI 绿）：

- 不是持久化/回显管线问题（API 版用例通过）；
- 不是 i18n 渲染崩溃或 IPC 断链（无错误、renderer 健康）；
- 不是选项列表打不开（191 行通过）。

**收敛后的未知**：radix Select 的「选中提交」事件在 CI runner 上从未触发——列表能开、选项可见，但键盘提交（及此前试验的鼠标点击）都不产生 `onValueChange`。即：事件监听本身可达性正常，是**提交路径的输入事件语义**在无头 runner 上失效。radix Select 内部对 `pointerup`/键盘的处理与 Electron 多窗口 + 无头环境的组合是首要嫌疑（此前鼠标与键盘两种驱动均复现）。

## 下一步探针（按性价比排序）

1. 在诊断分支上恢复该用例并注入探针：给 Select 的 `onValueChange`/`onOpenChange` 挂 `console.log`，CI 跑一次即可区分「事件未派发」vs「事件派发但状态未提交」；
2. 若事件未派发：改用 `dispatchEvent` 直发 `pointerdown/up`（绕过 hit-testing 与 pointerType 判定）验证是否为无头 pointer 语义差异；
3. 若事件派发但未提交：检查 Electron settings 窗口在 CI 上的焦点/激活状态（`win.isFocused()` 打点）——多窗口焦点丢失会吞键盘提交。

每步一轮 CI（改用例 → 推诊断分支 → 看日志）。在根因确认前保持 CI-only skip，不影响其余门禁。

## 关联

- 用例内注释：`apps/desktop/tests/e2e/ui-settings.spec.ts:160-169`
- 原跟进待办：`docs/release/update-maintenance/2026-10-25-branch-convergence.md`（E2E Core 小节）
