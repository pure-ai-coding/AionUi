# Claude Code 模型配置覆盖机制分析

> 状态：研究结论 | 日期：2026-07-01

## 目标

AionUi 需要能够预定义/动态切换 Claude Code CLI（后端 `claude`）实际使用的模型配置
（`ANTHROPIC_MODEL` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` 等），以替代厂商默认值，
且**不修改 AionCore 任何代码**。

本文档记录在 AionCore 代码库（`../AionCore`）中验证过的现有机制，供实现时参考。
与 [claude-code-default-agent.md](./claude-code-default-agent.md)（把 Claude Code 设为默认
agent）是相关但独立的问题：那份文档解决"选哪个 agent"，本文档解决"选定的 agent 用什么模型配置"。

## 结论先行

AionCore 已经内置了完整的、生产可用的动态覆盖链路，AionUi 只需要调用现成的 HTTP API，
**无需 AionCore 任何代码改动**：

```
PUT /api/agents/{id}/overrides
```

针对 Claude Code 这一行（`agent_metadata.id = '2d23ff1c'`，见
`AionCore/crates/aionui-db/migrations/001_initial_schema.sql`）设置 `env_override`，
下一次新建的 Claude Code 会话即会带上新的环境变量；已经在跑的旧会话子进程不受影响。

但有一个**关键前提**必须确认：目标机器是否安装并配置了第三方工具 `cc-switch`
（`~/.cc-switch/`）。如果装了，它的配置优先级**高于**本文档提到的 `env_override`，会覆盖掉
AionUi 通过 API 设置的值。详见下方"环境变量优先级"一节。

## 环境变量注入链路

Claude Code 子进程最终环境变量的拼装顺序（从早到晚，晚覆盖早，
`tokio::process::Command::envs()` 语义）：

```
env_clear()
  → agent_process_env()      // aioncore 自身进程继承的环境变量（AionUi 启动 aioncore 时传入的那份，全程不变）
  → agent_spawn_env(data_dir) // BUN_INSTALL_CACHE_DIR / BUN_TMPDIR 等，与模型配置无关
  → config.env                // = meta.env(base) ++ env_override(DB) ++ cc_switch_env
```

`config.env` 内部的拼接顺序（`AionCore/crates/aionui-ai-agent/src/factory/acp.rs:52-66`）：

```rust
let mut command_spec = resolve_agent_command_spec(&meta, ...).await?;
// command_spec.env 此时已包含 meta.env（base env ++ env_override，在 registry.rs 里合并好）

if meta.backend.as_deref() == Some("claude") {
    let cc_switch_env = crate::cc_switch::read_claude_provider_env();
    for (name, value) in &cc_switch_env {
        command_spec.env.push(...);   // 追加在最后，优先级最高
    }
}
```

### 环境变量优先级（从高到低）

```
1. cc-switch（若已安装且配置了 active provider）
2. env_override（DB 列，通过 PUT /api/agents/{id}/overrides 动态设置）
3. meta.env（agent_metadata.env 基础列，Claude Code 这行默认是空 '[]'）
4. aioncore 进程自身继承的环境变量（AionUi 用 child_process.spawn 启动 aioncore 时给的那份）
```

同名 key（如 `ANTHROPIC_MODEL`）以最后一次 `.envs()` 调用为准，因此 cc-switch 若激活
会覆盖 AionUi 通过 API 设置的值。这不是缺陷，是合理的降级设计：

- **用户机器装了 cc-switch** → 用户自己在管理多套 provider，aioncore 尊重它、不越权覆盖。
- **用户机器没装 cc-switch** → `env_override` 这一层就是唯一生效的配置源，行为完全可控。

因此 AionUi 不需要另外部署/维护一个 cc-switch 实例；cc-switch 装了则让位给用户的选择，
没装则由 `env_override`（或者更基础的"启动 aioncore 时固定环境变量"）兜底。

## 方案对比

|                       | 方案 A：`env_override`（HTTP API）                      | 方案 B：模拟 cc-switch 文件                                                            |
| --------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 生效时机              | 下一次新会话立即生效（写入即触发内存缓存刷新）          | 下一次会话构建时（每次都重新读文件）                                                   |
| 覆盖粒度              | per-agent-row（`agent_metadata.id`），天然按 agent 区分 | 全局单一 active provider，不区分 agent                                                 |
| 需要的接口            | AionCore 已有的一等公民 HTTP API，有 schema、有鉴权     | 需要精确复刻第三方工具的私有 SQLite + JSON 格式（未文档化，可能随 cc-switch 升级漂移） |
| 与真实 cc-switch 共存 | 不冲突，且优先级低于 cc-switch（符合预期的降级顺序）    | **会与用户机器上真实的 cc-switch 数据打架**（同一份 `~/.cc-switch/` 文件，互相覆盖）   |
| 推荐度                | ✅ 推荐                                                 | ❌ 不推荐，仅作备选                                                                    |

**结论：优先采用方案 A。** 方案 B 依赖未文档化的外部私有格式，还要处理 SQLite 并发写入，
且会与用户真实安装的 cc-switch 产生数据冲突，脆弱度明显更高。

## 方案 A 实现细节：`env_override` HTTP API

### 生效机制验证

1. `PUT /api/agents/{id}/overrides` → `AgentService::set_agent_overrides()`
   （`AionCore/crates/aionui-ai-agent/src/services/agent.rs:137-176`）
   → `repo.update_agent_overrides(id, command_override, env_json)` 写入 DB 的
   `agent_metadata.env_override` 列。
2. 同一请求内紧接着调用 `self.availability.run_manual_health_check(id)`
   （`services/agent.rs:176`）。
3. `run_manual_health_check` 第一步是
   `self.registry.invalidate_and_rehydrate().await?`
   （`AionCore/crates/aionui-ai-agent/src/services/availability/mod.rs:61`）——
   重新从 DB 拉取所有行，重新执行 `registry.rs:463-505` 的合并逻辑
   （`env_override` 追加进 `meta.env`），并整体替换内存缓存
   （`registry.rs:183`：`*self.by_id.write().await = map`）。

结论：**PUT 请求返回 200 的那一刻，内存缓存已经是最新的合并结果**，无需重启
aioncore，也不存在缓存滞后问题。之后任何新会话通过
`deps.agent_registry.get(agent_id)`（`factory/acp.rs:34`）读到的就是新值；已经在跑的旧
会话子进程 env 早已固定，不受影响。

### 边界条件

- **Key 黑名单**（`registry.rs:787-796`：`is_blocked_override_env_key`）：
  `AIONUI_*` 前缀 + `HOME`/`PATH`/`USER`/`SHELL`/`TERM`/`CODEX_HOME` 会被过滤掉。
  `ANTHROPIC_MODEL` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` /
  `ANTHROPIC_DEFAULT_SONNET_MODEL` / `ANTHROPIC_DEFAULT_OPUS_MODEL` /
  `ANTHROPIC_DEFAULT_HAIKU_MODEL` 均不在黑名单内，可正常下发。
- **鉴权**：`get_agent_overrides` / `set_agent_overrides` 两个 handler 都带
  `Extension(_user): Extension<CurrentUser>`
  （`AionCore/crates/aionui-ai-agent/src/routes/agent.rs:186,200`），走标准鉴权中间件，
  与 AionUi 已经在调的其它 API 一致，无特殊豁免。
- **内部 Aion CLI 保护**：若目标行是 `is_internal_aion_cli_row`（内置的 Rust agent），
  设置 override 会被拒绝（`services/agent.rs:160-162`）。Claude Code 这行不受此限制。

### 请求/响应契约

**`PUT /api/agents/{id}/overrides`**

请求体（`SetAgentOverridesRequest`，见
`AionCore/crates/aionui-api-types/src/custom_agent.rs:15-20`）：

```json
{
  "command_override": null,
  "env_override": [
    { "name": "ANTHROPIC_MODEL", "value": "your-model-id" },
    { "name": "ANTHROPIC_BASE_URL", "value": "https://your-endpoint" },
    { "name": "ANTHROPIC_API_KEY", "value": "sk-xxx" }
  ]
}
```

`AgentEnvEntry`（`aionui-api-types/src/agent_discovery.rs:34-39`）字段：
`name: String`，`value: String`，`description: Option<String>`（可省略）。
不需要覆盖启动命令时 `command_override` 传 `null`。

响应体：`ApiResponse<AgentManagementRow>`——因为 `set_agent_overrides` 内部会触发
一次健康检查，返回的是检查后的最新整行状态。

**`GET /api/agents/{id}/overrides`**

响应体：`ApiResponse<AgentOverridesResponse>`
（`custom_agent.rs:22-28`）：

```json
{ "command_override": null, "env_override": [{ "name": "ANTHROPIC_MODEL", "value": "..." }] }
```

### Agent id

Claude Code 内置 agent 的固定 id 是 migration 种子里写的 `'2d23ff1c'`
（`AionCore/crates/aionui-db/migrations/001_initial_schema.sql:180-190`）。更稳妥的做法是
不硬编码：先 `GET /api/agents` 按 `backend == "claude"` 查找 id，再调用 overrides 接口。

## 未决事项 / 后续如需实现时注意

- 若部署环境**不确定**是否安装了 cc-switch（例如面向普通用户分发的场景），方案 A 对同名
  key 不是 100% 保证生效的兜底——cc-switch 若激活会覆盖。当前判断是可接受的（因为目标是
  "没装 cc-switch 时由 AionUi 兜底"，装了则让位给用户），但若未来需求变成"无论是否装了
  cc-switch 都要强制生效"，需要重新评估（例如改为读取/清空 cc-switch 配置，而非仅设置
  `env_override`）。
- 本文档未涉及具体 AionUi 侧的实现位置（调用时机、UI 入口等），留待实现阶段设计。
