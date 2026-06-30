# Claude Code 默认 Agent 改造设计

> 状态：草稿 | 日期：2026-06-30

## 目标

保留项目中其他 agent 的代码，但将默认行为改为只使用 Claude Code CLI 作为 agent。

## 背景

项目当前支持多种 agent 后端：
- **Claude Code** — 通过 ACP 协议与 `@anthropic-ai/claude-agent-sdk` 通信
- **Codex** — OpenAI 的 CLI agent
- **Gemini** — Google 的 ACP agent
- **Aionrs** — 内置的 Rust agent
- **Remote** — 远程 agent（WebSocket 连接）
- **Nanobot / OpenClaw** — 其他扩展 agent

每种 agent 都有独立的检测、启动、会话管理逻辑。本设计将 Claude Code 设为默认，其他 agent 保留代码但默认不展示。

## 架构现状

### 三层架构

```
Electron Renderer (React UI)
  ↓ HTTP / WebSocket
AionCore (Rust 后端, ACP Server)
  ↓ JSON-RPC over stdio
Claude Code CLI (子进程)
```

### 关键文件

| 层级 | 文件 | 作用 |
|------|------|------|
| 类型定义 | `common/types/agent/detectedAgent.ts` | `DetectedAgentKind` 定义所有 agent 类型 |
| 类型定义 | `common/types/agent/detectedAgent.ts` | `DetectedAgent<K>` 泛型类型 |
| Agent 检测 | `renderer/utils/model/agentTypes.ts` | `AgentType`, `ManagedAgent`, `fetchManagedAgents()` |
| 默认选择 | `renderer/pages/guid/hooks/useGuidAssistantSelection.ts` | `pickDefaultAssistantSelectionKey()` |
| 过滤器 | `renderer/pages/settings/AgentSettings/agentFilters.ts` | `filterAgentsByAvailability()` |
| Team 模式 | `renderer/pages/team/components/teamCreateModelResolver.ts` | Team 创建时的模型解析 |
| 进程管理 | `web-host/src/agent-process-registry.ts` | 子进程注册表（通用，无需改动） |
| 会话预热 | `renderer/pages/conversation/utils/warmupConversation.ts` | 按需启动子进程 |

## 改动方案

### P0 — 默认助手选择

**文件**: `packages/desktop/src/renderer/pages/guid/hooks/useGuidAssistantSelection.ts`

**当前逻辑** (L88-95):
```typescript
export function pickDefaultAssistantSelectionKey(assistants: Assistant[]): string | null {
  const enabledAssistants = assistants.filter((assistant) => assistant.enabled !== false);
  const preferred =
    enabledAssistants.find((assistant) => assistant.source === 'generated' && isAionrsAssistant(assistant)) ??
    enabledAssistants.find((assistant) => isAionrsAssistant(assistant)) ??
    enabledAssistants[0];
  return preferred?.id ?? null;
}
```

**改为**:
```typescript
export function pickDefaultAssistantSelectionKey(assistants: Assistant[]): string | null {
  const enabledAssistants = assistants.filter((assistant) => assistant.enabled !== false);
  const preferred =
    enabledAssistants.find((assistant) => assistant.backend === 'claude') ??
    enabledAssistants[0];
  return preferred?.id ?? null;
}
```

### P1 — Agent 过滤器

**文件**: `packages/desktop/src/renderer/pages/settings/AgentSettings/agentFilters.ts`

增加 Claude-only 过滤模式：

```typescript
export type AgentAvailabilityFilter = 'all' | 'available' | 'unavailable' | 'claude-only';

export const filterAgentsByAvailability = (
  agents: ManagedAgent[],
  filter: AgentAvailabilityFilter
): ManagedAgent[] => {
  if (filter === 'claude-only') {
    return agents.filter((agent) => agent.backend === 'claude');
  }
  // ... 原有逻辑
};
```

### P2 — Team 模式默认后端

**文件**: `packages/desktop/src/renderer/pages/team/components/teamCreateModelResolver.ts`

确保 `assistant_backend` 为空或未知时默认走 Claude 分支。当前逻辑 (L69-77):

```typescript
if (assistant_backend === 'gemini') { ... }
if (assistant_backend === 'aionrs') { ... }
// 默认走 ACP (claude) 分支
```

此处已经默认走 ACP 分支，无需改动，但需确认 Claude Code 在 `agent_metadata` 表中的 `backend` 字段为 `'claude'`。

### P3 — 设置页 UI（可选）

**文件**: `packages/desktop/src/renderer/pages/settings/AgentSettings/LocalAgents.tsx`

在 Agent 管理列表中，默认只显示 `backend === 'claude'` 的 agent，其他 agent 折叠或隐藏。

## 不需要改动的地方

| 组件 | 原因 |
|------|------|
| AionCore 后端 (Rust) | agent 检测由后端控制，前端只是展示过滤后的结果 |
| ACP 协议层 | Claude Code 已走 ACP，`acpTypes.ts` 无需修改 |
| 进程注册表 | `agent-process-registry.ts` 是通用逻辑，与 agent 类型无关 |
| 消息流 | `responseStream` 按 `conversation_id` 路由，与 agent 类型无关 |
| 会话预热 | `warmupConversation()` 按需启动，不关心具体 agent 类型 |
| API 客户端 | `AnthropicRotatingClient` 等是直接调用 API 的，与 CLI agent 无关 |

## 风险点

1. **后端 agent 检测** — AionCore 后端会检测所有已安装的 CLI 工具并返回给前端。如果用户安装了 Codex，后端仍会返回 Codex agent。前端过滤只是 UI 层面的，后端仍会为非 Claude agent 创建会话。

2. **Team 模式** — Team 模式支持多 agent 并行（如 Leader 用 Claude，Member 用 Codex）。默认只用 Claude 会限制 Team 的能力。

3. **内置助手迁移** — `migrateAssistants.ts` 中的内置助手快照可能需要更新，确保 Claude Code 助手排在列表前面。

4. **测试用例** — 多个 E2E 测试使用 `'claude'` 作为 backend，需确认改动后测试仍通过。

## 验证清单

- [ ] 新用户首次打开应用，默认选中 Claude Code 助手
- [ ] Guid 页面只显示 Claude Code agent pill（其他 agent 隐藏或置灰）
- [ ] 设置页 Agent 管理默认只展示 Claude Code
- [ ] Team 模式默认使用 Claude Code
- [ ] 历史对话（非 Claude）仍可正常打开和使用
- [ ] `bun run test` 通过
- [ ] `bun run lint:fix && bun run format` 通过

---

## 非 Claude Agent 检测扩展分析

### 背景

当前 `isAionrsAssistant` 函数（`packages/desktop/src/common/types/agent/assistantTypes.ts:24-26`）仅识别 `type === 'aionrs'` 的助手：

```typescript
export function isAionrsAssistant(assistant?: Pick<Assistant, 'agent'> | null): boolean {
  return assistant?.agent?.type === 'aionrs';
}
```

### 为什么要扩展？

1. **新默认策略一致性** — `pickDefaultAssistantSelectionKey` 通过 `backend === 'claude'` 选首选助手，但类型识别逻辑仍只识别 `aionrs`，导致助手选择与类型识别不一致。

2. **Team 模式兼容性** — Team 模式内部使用 `isAionrsAssistant` 判断助手类型，若不扩展，Claude Code 助手会被当作非特定类型，可能导致模式切换、助手 UI 状态异常。

3. **UI 组件依赖** — `AgentModeSelector`、`AgentBadge` 等组件根据助手类型识别结果渲染不同 UI，识别失败会导致 UI 异常。

### 不扩展的后果

- 助手类型识别不一致，前端识别出的助手与内部类型判断冲突
- Team 模式下 Claude 助手无法被正确识别，导致模式切换或助手状态异常
- 某些助手组件 UI 渲染异常（如模式选择器、助手徽标）

### 扩展方案

```typescript
// packages/desktop/src/common/types/agent/assistantTypes.ts:24-26
export function isAionrsAssistant(assistant?: Pick<Assistant, 'agent'> | null): boolean {
  return assistant?.agent?.acp_backend === 'claude' || assistant?.agent?.type === 'aionrs';
}
```

---

## Windows 打包与部署考量

### 现有打包架构

| 组件 | 配置文件 | 关键点 |
|------|----------|--------|
| Electron 打包 | `packages/desktop/electron-builder.yml` | 包含 `claude.exe` 和 `codex-acp.exe` 作为 extraResources |
| NSIS 安装程序 | `resources/windows-installer-x64.nsh` / `arm64.nsh` | 安装后验证 `aioncore.exe`、`claude.exe`、`codex-acp.exe` |
| CI/CD | `.github/workflows/build-and-release.yml` | Windows x64/ARM64 并行构建，生成 `.exe` 和 `.msi` |

### 关键打包文件引用

1. **electron-builder.yml (L83-84)** — 排除 `@anthropic-ai/claude-code/vendor/**` 和 `@anthropic-ai/claude-agent-sdk/vendor/**` 防止未签名二进制
2. **verify-bundled-aioncore-resources.js (L119-131)** — 验证打包后存在 `aioncore.exe`、`node.exe`、`codex-acp.exe`、`claude.exe`
3. **windows-installer-x64.nsh (L211-224)** — 安装后 PowerShell 验证脚本检查所有必需二进制
4. **verify-bundled-aioncore-install.ps1 (L145-154)** — 定义 ACP 工具：`codex-acp.exe`、`claude.exe`

### 打包版本控制

**脚本**: `scripts/prepare-managed-acp-tools.sh` (L62-63, L77-78)

| Agent | npm 包 | 默认版本 | 环境变量覆盖 |
|-------|--------|----------|-------------|
| **Codex** | `@zed-industries/codex-acp` | **0.14.0** | `CODEX_ACP_VERSION` |
| **Claude Code** | `@anthropic-ai/claude-agent-sdk` | **0.39.0** | `CLAUDE_ACP_VERSION` |

构建时从 npm 下载对应版本的预编译二进制（按平台分发），打包进 `resources/bundled-aioncore/`。

CI/CD 中可通过环境变量指定版本：
```bash
CLAUDE_ACP_VERSION=0.40.0 CODEX_ACP_VERSION=0.15.0 ./scripts/prepare-managed-acp-tools.sh
```

### 只打包 Claude 和 Codex 的原因

- **打包范围**：仅 `claude-agent-acp` 和 `codex-acp` 两个 ACP 工具（验证脚本 `verify-bundled-aioncore-resources.js:145-154` 只定义这两个）
- **不打包**：OpenClaw、Hermes、Nanobot 等小众/扩展 agent —— 体积大、更新快、用户少，不值得打包
- **运行时策略**：本机 PATH 检测优先，打包版本仅作兜底（用户未自行安装时使用）

### 需要调整的打包配置

1. **移除 Codex 相关二进制**（可选，减小包体积）
   - `electron-builder.yml` — 移除 `codex-acp` 相关 extraResources
   - `verify-bundled-aioncore-resources.js` — 移除 `codex-acp.exe` 验证
   - NSIS 脚本 — 移除 `codex-acp.exe` 验证

2. **保留 Claude Code 二进制** — 必须保留 `claude.exe` 相关打包和验证逻辑

---

## 功能开关与 UI 控制点汇总

### 核心功能开关

| 常量/配置 | 文件 | 控制范围 |
|-----------|------|----------|
| `TEAM_MODE_ENABLED = false` | `common/config/constants.ts:61` | 隐藏 Team 侧边栏、路由、标题栏 Team 入口 |
| `assistant.enabled !== false` | `guid/components/AssistantSelectionArea.tsx:35` | 按助手级别控制 pill 显示 |
| `assistant.backend === 'claude'` | 逻辑层过滤 | 运行时按 backend 过滤 |

### UI 控制点

| 组件 | 文件 | 过滤逻辑 |
|------|------|----------|
| GUID 助手 pill 栏 | `guid/components/AssistantSelectionArea.tsx` | `enabledAssistants` → `visibleAssistants` (最多 4 个) |
| 助手选择下拉 | 同上 | `overflowAssistants` → `filteredOverflowAssistants` (搜索) |
| 设置页 Agent 列表 | `settings/AgentSettings/LocalAgents.tsx` | 受 `agentFilters.ts` 过滤器控制 |
| 侧边栏 Team 区域 | `layout/Sider/TeamSiderSection.tsx` | 受 `TEAM_MODE_ENABLED` 控制 |
| 路由 `/team/:id` | `layout/Router.tsx:58-61` | 受 `TEAM_MODE_ENABLED` 控制，否则重定向到 `/guid` |

---

## 完整改动清单（按优先级）

| 优先级 | 文件 | 改动类型 | 说明 |
|--------|------|----------|------|
| **P0** | `renderer/pages/guid/hooks/useGuidAssistantSelection.ts:88-95` | 逻辑修改 | `pickDefaultAssistantSelectionKey` 优先选 `claude` |
| **P0** | `common/types/agent/assistantTypes.ts:24-26` | 逻辑扩展 | `isAionrsAssistant` 增加 `claude` 识别 |
| **P0** | `common/config/constants.ts:61` | 常量修改 | `TEAM_MODE_ENABLED = false` 隐藏 Team 入口 |
| **P1** | `renderer/pages/settings/AgentSettings/agentFilters.ts` | 功能增强 | 增加 `claude-only` 过滤模式 |
| **P2** | 打包配置 | 配置精简 | 移除 Codex 相关二进制（可选，减小包体积） |

---

## 验证清单（更新）

- [ ] 新用户首次打开应用，默认选中 Claude Code 助手
- [ ] Guid 页面只显示 Claude Code agent pill（其他 agent 隐藏或置灰）
- [ ] 设置页 Agent 管理默认只展示 Claude Code（通过 `claude-only` 过滤器）
- [ ] Team 模式入口完全隐藏（侧边栏、路由、标题栏）
- [ ] 历史对话（非 Claude）仍可正常打开和使用
- [ ] Windows 打包验证：`claude.exe` 存在，`codex-acp.exe` 可选移除
- [ ] `bun run test` 通过
- [ ] `bun run lint:fix && bun run format` 通过
