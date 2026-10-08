# dsh-qqbot-dafeiyu

基于 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) 的 QQ Bot IM 插件，将 QQ 消息平台作为 dsh agent 的前端协议驱动。

中文 | [English](./README_EN.md)

## 架构

```
QQ 用户 → QQ WebSocket → dsh-im-qqbot → ctx.agents → dsh agent loop → LLM
                                 ↑                           │
                                 └── session/event ──────────┘
                                       (assistant reply → QQ sendMarkdown)
```

## 安装

### 方式一：手动执行

```bash
# 安装到 profile
dsh plugin --profile qqbot add github:cheesewoo/dsh-qqbot-dafeiyu

# 启动
dsh --profile qqbot
```

首次启动时，插件检测到凭据未配置会自动进入扫码引导：终端输出二维码 → 手机 QQ 扫码绑定 → 凭据自动保存到 profile，后续启动无需再次扫码。

### 方式二：本地路径安装

```bash
# 构建
cd /path/to/dsh-qqbot
pnpm install && pnpm build

# 安装到 profile（本地路径）
dsh plugin --profile qqbot add /path/to/dsh-qqbot

# 启动
export QQBOT_APPID="你的AppID" QQBOT_SECRET="你的AppSecret"
dsh --profile qqbot
```

### 方式三：--patch 开发模式

```bash
cd /path/to/deepseek-harness
export QQBOT_APPID="你的AppID" QQBOT_SECRET="你的AppSecret"
pnpm dsh web --patch /path/to/dsh-qqbot/cordis.dev.yml
```

## 配置项

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `appId` | string | **必填** | QQ Bot AppID（或通过 `QQBOT_APPID` 环境变量） |
| `appSecret` | string | **必填** | QQ Bot AppSecret（或通过 `QQBOT_SECRET` 环境变量） |
| `provider` | string | `deepseek-official` | LLM 提供商名称 |
| `model` | string | `deepseek-chat` | 模型名称 |
| `preset` | string | - | Agent preset id |
| `cwd` | string | `process.cwd()` | Agent 工作目录 |
| `requireMention` | boolean | `true` | 群聊是否需要 @bot 才触发 |
| `groupPrompt` | string | - | 群聊额外 system prompt |
| `directPrompt` | string | - | 私聊额外 system prompt |
| `textChunkLimit` | number | `4500` | 单条消息最大字符数 |
| `sessionIdleTimeout` | number | `1800000` | 会话闲置超时(ms)，默认 30 分钟 |
| `access.c2cMode` | `open` \| `allowlist` \| `disabled` | **`allowlist`** | 私聊访问模式（`disabled` = 不响应私聊） |
| `access.c2cAllow` | string[] | `[]` | 私聊白名单（对方 openid） |
| `access.groupMode` | `open` \| `allowlist` \| `disabled` | **`allowlist`** | 群聊访问模式（`disabled` = 不响应群聊） |
| `access.groupAllow` | string[] | `[]` | 群聊白名单（群 openid） |
| `debug` | boolean | `false` | 调试模式 |

## 访问控制（安全相关）

默认是**白名单模式 + 空名单 = 全部拒绝**：刚装好的机器人不响应任何人，先把允许的 openid 填进去它才会说话。

| 模式 | 行为 |
|------|------|
| `allowlist`（默认） | 只响应白名单里的 openid；名单为空时**拒绝所有人** |
| `open` | 响应所有人 / 所有群，**任何能找到这个机器人的人都能用**；启动时会打一条 warning |
| `disabled` | 完全关闭该场景（私聊或群聊） |

```yaml
access:
  c2cMode: allowlist
  c2cAllow: ['对方的 openid']
  groupMode: allowlist
  groupAllow: ['群的 group_openid']
```

⚠️ `open` 模式下 IM 消息会直接驱动 agent，而 agent 带工具（含 shell / 文件读写），等于把宿主机能力开放给任何能私聊或 @ 到该机器人的人。对外暴露前请用 `allowlist`（或 `disabled`）。空名单**不会**被当成"放行所有人"，而是放行零个人。

## 内置命令

| 命令 | 说明 |
|------|------|
| `/bot-reset` | 重置当前会话（清除上下文） |
| `/bot-model` | 查看或切换模型 |
| `/bot-status` | 查看当前会话状态 |
| `/bot-help` | 查看所有指令 |

## 核心模块

```
src/
├── index.ts                    # Cordis 插件入口（async apply）
├── config.ts                   # 配置 Schema
├── types.ts                    # 全局类型定义
├── setup.ts                    # 凭据绑定（扫码）
├── transport/                  # 传输层
│   ├── inbound.ts              # QQ 入站消息 → agent.followup()
│   ├── outbound.ts             # session/event → QQ sendMarkdown
│   ├── outbound-buffer.ts      # 流式缓冲
│   └── chunker.ts              # Markdown 文本切分
├── session/                    # 会话管理层
│   ├── session-manager.ts      # QQ peer → Agent 映射
│   └── idle-evictor.ts         # 闲置回收
├── model/                      # 模型路由层
│   ├── model-resolver.ts       # 路由解析
│   ├── prefs-store.ts          # per-peer 偏好持久化
│   └── settings-reader.ts      # settings.yaml 只读
├── shared/                     # 共享工具
│   ├── utils.ts                # 通用函数
│   ├── scope.ts                # scope/peer 提取
│   └── send-helper.ts          # 分块发送
├── commands/                   # 斜杠命令
└── typings/                    # 外部模块声明
```

## 会话路由

sessionKey: `qqbot:${appId}:${scope}:${peerId}`，由 SHA-256 确定性派生 SessionId，重启后可恢复。

解析策略：进程内复用 → 持久化恢复 → 全新创建。

## 设计原则

- **纯 Cordis 插件** — 遵循 dsh "Plugins, not loop changes" 原则
- **声明式依赖** — `inject = ['agents']`，不直接耦合其他插件
- **会话隔离** — 每个 QQ 私聊用户/群聊各一个独立 Agent
- **Preset 支持** — 可通过 `agent-presets` 服务挂载预设（工具集、prompt 等）
- **闲置回收** — 超时自动 dispose Agent，防止内存泄漏
- **Markdown 输出** — 回复以 Markdown 格式发送，支持代码块/表格感知切分

## 本地开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 开发模式（watch）
pnpm dev

# 用 --patch 方式调试（在 dsh monorepo 中）
cd /path/to/deepseek-harness
export QQBOT_APPID="xxx" QQBOT_SECRET="xxx"
pnpm dsh web --patch /path/to/dsh-qqbot/cordis.dev.yml
```

## License

[MIT](./LICENSE)
