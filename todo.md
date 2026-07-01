# TODO

## 1. 本仓库分支目标

本 fork（pure-ai-coding）将默认 agent 从内置引擎改为 **Claude Code CLI**，并隐藏 Team 模式入口，
以提供更简化的使用体验。不删除其他 agent 相关代码，只调整默认行为。
（见 `readme.md:21`）

## 2. 相关设计文档

- [docs/design/claude-code-default-agent.md](./docs/design/claude-code-default-agent.md) — 把 Claude Code 设为默认 agent、隐藏 Team 模式的设计方案与验收清单
- [docs/design/claude-code-model-config-override.md](./docs/design/claude-code-model-config-override.md) — Claude Code 模型配置（`ANTHROPIC_MODEL`/`ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`）动态覆盖机制研究结论

## 3. 已发现的 Bug / Gap（自 commit 4465f7e80 起）

- [x] **BUG A（高危，已修复）** `resolveCronAgentConfig.ts:58` 用 `isAionrsAssistant()` 判断是否需要 aionrs provider/model 校验；该函数现在对 Claude Code 也返回 `true`，但 `CreateTaskDialog.tsx` 只在 `resolvedBackend === 'aionrs'` 时才收集 `selectedAionrsProvider`/`model_id`。结果：给 Claude Code 助手创建/编辑定时任务会抛出 `aionrsModelRequiredMessage`，功能不可用。
  - 修复：`resolveCronAgentConfig.ts` 改用 `assistantRuntimeKey(assistant) === 'aionrs'`（与 `CreateTaskDialog.tsx` 判断口径一致）替代 `isAionrsAssistant()`，未改动 `isAionrsAssistant` 本身语义，避免影响其余调用点。已验证：`bunx tsc --noEmit` 无报错；`resolveCronAgentConfig.test.ts` + `CreateTaskDialog.dom.test.tsx` 共 13 项测试全部通过。
- [x] **BUG B（高危，已修复）** `CreateTaskDialog.tsx:520`：`disabled = isAionrsAssistant(assistant) && !hasAionrsProvider`。用户未配置 aionrs provider 时，Claude Code 选项会被错误置灰，并提示不相关的 "aionrsNoProvider" 文案。
  - 修复：改用 `runtimeKey === 'aionrs' && !hasAionrsProvider`（复用同段代码已算出的 `assistantRuntimeKey` 结果），移除不再使用的 `isAionrsAssistant` 导入，未改动 `isAionrsAssistant` 本身语义。已验证：`bunx tsc --noEmit` 无报错；`CreateTaskDialog.dom.test.tsx` 新增用例覆盖"无 aionrs provider 时 Claude Code 选项不置灰"，全部 8 项测试通过；`lint:fix` 对改动文件无新增警告。
- [x] **BUG C（中危，已修复）** `TelegramConfigForm.tsx:307` 及 Lark/DingTalk/Wecom/Weixin 四个 ConfigForm 中同样的 `showModelSelector = isAionrsAssistant(selectedAssistant)`。选中 Claude Code 助手会错误展示 Gemini/aionrs 专属的 `GoogleModelSelector`，而非"跟随 CLI 自动选择模型"占位文案。
  - 修复：5 个 ConfigForm 中的 `showModelSelector` 计算及助手切换时的 provider/model 初始化逻辑，均改用 `assistantRuntimeKey(x) === 'aionrs'` 替代 `isAionrsAssistant(x)`，未改动 `isAionrsAssistant` 本身语义与 `assistantBinding.ts` 中不相关的调用点。已验证：`bunx tsc --noEmit` 无报错；新增 `tests/unit/renderer/channels/TelegramConfigForm.dom.test.tsx`（3 项测试，覆盖 Claude Code 助手显示占位文案、aionrs 助手显示真实模型下拉、切换助手后选择器状态联动）全部通过；`bun run test` 全量 1899+ 项通过，仅剩 4 项与本次改动无关的既存失败（BUG D/E 已在本文件跟踪）；`lint:fix` 对改动文件无新增警告（仅既存警告）。
- [ ] **BUG D（测试回归）** `tests/unit/renderer/guidAgentSelection.test.ts` 中 `'defaults to the generated aionrs assistant when available'` 期望 `'bare-aionrs'`，按新 `pickDefaultAssistantSelectionKey` 逻辑实际会返回 `'builtin-writer'`。未随 4465f7e80 同步更新。
- [ ] **BUG E（未提交工作区改动的回归）** `AgentRepairPanel.tsx` 当前未提交的 diff 删除了 `isInternalAionCli` 判断（原属 6904dc090），导致内置 Aion CLI agent 的 override 编辑 UI（路径/环境变量/保存按钮）被无条件暴露，与后端"内置 Aion CLI 行拒绝写 override"的保护矛盾；`tests/unit/renderer/AgentRepairPanel.dom.test.tsx` 中对应测试会失败。
- [ ] **共同根因（A/B/C）**：`isAionrsAssistant`（`assistantTypes.ts`）语义从"是否为内置 Aionrs CLI"被扩展为同时包含"是否为 Claude Code"，但该函数有 15+ 处调用点（cron 任务、渠道绑定、渠道设置表单），语义一改就全部跟着变。应改为单独用 `acp_backend === 'claude'` 判断"优先选 Claude"，不动 `isAionrsAssistant` 本身。
- [ ] **GAP F（设计文档 P1，未实现，可选）** `agentFilters.ts` 仍只有 `'all' | 'available' | 'unavailable'`，设计文档计划的 `claude-only` 过滤模式未实现。
- [ ] **GAP G（设计文档验收清单未达成）** `Sider/index.tsx:190` 无条件渲染 `TeamSiderSection`（团队创建/列表/改名/删除/置顶），全文件搜索确认无任何 `TEAM_MODE_ENABLED` 判断。用户仍可从侧边栏创建团队并跳转到 `/team/:id`，才被 `Router.tsx` 重定向回 `/guid`，流程割裂，与设计文档验收清单"Team 模式入口完全隐藏（侧边栏、路由、标题栏）"矛盾。

## 4. 其他待办

- [ ] **Windows 打包**：确认/补充 Windows 平台的打包配置与验证（当前 fork 说明中平台徽章包含 macOS / Windows / Linux，需要确认 Windows 打包产物在改为 Claude Code 默认 agent、隐藏 Team 模式后仍能正常构建与运行，覆盖签名、安装包生成等打包流程）。
