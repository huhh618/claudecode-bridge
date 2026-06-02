# ccbridge — Claude Code 双向多通道 I/O 桥接服务

## 1. 项目概述

`ccbridge` 是一个 Node.js/TypeScript 代理服务，用于将 Claude Code CLI 的终端交互扩展为双向多通道 I/O。用户在终端执行 `claude` 操作时，当 Claude 给出选项需要用户确认、补充或选择，这些交互操作可以同时扩展到飞书（未来可扩展至微信、Telegram、企业微信）等消息平台。用户既可以在终端直接回复，也可以在飞书上回复，两者同步互斥。

## 2. 架构总览

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   终端      │◄────►│  ccbridge   │◄────►│  Claude Code│
│  (TTY/PTY)  │      │  (Node.js)  │      │  (子进程)   │
└─────────────┘      └──────┬──────┘      └─────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
         ┌────────┐   ┌────────┐   ┌──────────┐
         │ 飞书   │   │ Telegram│  │  企业微信 │
         │ Feishu │   │        │   │  WeCom   │
         └────────┘   └────────┘   └──────────┘
```

`ccbridge` 作为代理层：
- 向下通过 **PTY** 启动并管理 Claude Code 子进程
- 向上提供 **多通道 I/O 适配器**（终端始终直通，消息平台按需接入）
- 内部通过 **状态机** 识别 Claude 何时在等待用户决策，仅将决策内容推送至消息平台
- 任一通道的输入通过 **先到先得的竞争机制** 回写给 Claude，其他通道同步通知"已由 XX 处理"

## 3. 核心组件

| 组件 | 职责 |
|------|------|
| **`PtyManager`** | 通过 `node-pty` 启动 `claude`，管理子进程生命周期，捕获 stdout/stderr，向 stdin 写入 |
| **`StateMachine`** | 维护会话状态：`IDLE` → `BUSY` → `AWAITING_INPUT` → `PROCESSING_INPUT` → `IDLE` |
| **`InputDetector`** | 启发式规则引擎：检测 ANSI 菜单序列、选项列表、`[Y/n]` 模式、输出停顿超时 |
| **`ChannelRouter`** | 多路复用器：管理所有注册通道，广播决策请求，接收首个有效输入 |
| **`AdapterRegistry`** | 通道适配器注册表：加载对应平台的 SDK 适配器，统一接口 |
| **`ConfigManager`** | 管理 `ccbridge.config.json`：平台配置、超时阈值、过滤规则 |
| **`HandoverManager`** | （高级功能）处理 `/handover` 命令，显式切换终端与消息平台之间的主控权 |

## 4. 状态机与数据流

```text
用户启动 ccbridge
    │
    ▼
┌─────────┐    PTY stdout 输出    ┌─────────┐
│  IDLE   │ ────────────────────► │  BUSY   │
│ (待命)  │                       │ (Claude │
└─────────┘                       │ 工作中) │
    ▲                             └────┬────┘
    │                                  │
    │         输出停顿/检测到提示       │
    │         ┌────────────────────────┘
    │         ▼
    │    ┌───────────┐     飞书/终端输入     ┌──────────────┐
    └─── │AWAITING   │ ◄─────────────────── │ PROCESSING   │
         │_INPUT     │                      │ _INPUT        │
         │(等待决策) │ ───────────────────► │ (处理中,     │
         └───────────┘   输入写回PTY+广播    │  锁定其他通道) │
                                              └──────────────┘
                                                    │
                                                    ▼
                                              输出变化/超时
                                                    │
                                                    ▼
                                              ┌─────────┐
                                              │  BUSY   │
                                              └─────────┘
```

**状态定义：**

| 状态 | 说明 |
|------|------|
| `IDLE` | 初始状态，等待用户启动 Claude 或自动恢复 |
| `BUSY` | Claude 正在工作，输出工作日志（`Reading...`、`Thinking...` 等），这些**不推送**到消息平台，只在终端显示 |
| `AWAITING_INPUT` | 检测到 Claude 正在等待用户决策，向所有通道广播精简提示 |
| `PROCESSING_INPUT` | 已收到首个通道的输入，锁定其他通道，将输入写回 PTY |

**`AWAITING_INPUT` 触发条件（满足其一即可）：**

1. 检测到选项列表（正则：`^\s*[\[\(]\d+[\\)\]]\s+` 多行匹配，至少两行匹配）
2. 检测到确认模式（`[Y/n]`、`(yes/no)`、`Confirm?` 等关键字）
3. ANSI 光标定位序列 + 反色/高亮属性（交互式菜单特征，如 `\x1b[7m` 反色）
4. 输出停顿超过阈值（默认 800ms）且最后 5 行包含选项特征或问号/冒号结尾

**`PROCESSING_INPUT` 锁定机制：**

- 一旦任一通道有输入，立即进入 `PROCESSING_INPUT`
- 其他通道的输入被静默丢弃，返回轻量通知：`"已由 [终端] 处理，无需回复"`
- 如果两个通道在毫秒级同时到达，以内部 `process.hrtime.bigint()` 时间戳为准
- 锁定持续直到 PTY 有新输出或超过 3 秒安全超时，自动回到 `BUSY`

## 5. 通道适配器抽象

```typescript
interface IChannelAdapter {
  name: string;                        // 'feishu' | 'telegram' | 'wecom' | 'terminal'
  async initialize(config: any): void;
  async send(message: PromptMessage): void;   // 向该通道推送决策请求
  onReply(handler: (text: string) => void): void; // 注册输入回调
  async close(): void;
}

interface PromptMessage {
  type: 'selection' | 'confirmation' | 'question' | 'raw';
  title?: string;       // 精简标题，如 "Claude 请求确认"
  body: string;         // 核心内容，过滤掉工作日志
  options?: string[];   // 选项列表，如 ["[1] 同意", "[2] 拒绝"]
  timeout?: number;     // 该提示的超时时间（秒）
}
```

### 5.1 Terminal Adapter

- 直接透传 PTY 的 stdout/stdin，不做额外格式化
- 当仅启用终端通道（无其他消息平台）时，输入直接通过 PTY stdin 到达 Claude
- 当同时启用其他消息平台通道时，终端输入也注册到 `ChannelRouter`，参与 FCFS 竞争

### 5.2 Feishu Adapter

支持两种模式，运行时根据配置切换：

**自建应用模式（企业级）：**
- 使用飞书开放平台机器人，支持私聊和群聊
- 接收事件：通过 HTTP webhook 接收用户回复
- 发送消息：调用飞书消息 API，推送富文本卡片
- 配置项：`appId`、`appSecret`、`encryptKey`、可选的 `verificationToken`

**Webhook 机器人模式（轻量级）：**
- 使用群聊自定义机器人 webhook
- 仅支持发送文本消息到指定群
- 接收回复：依赖自建应用或无法直接接收（此模式下双向能力受限，适合单向通知）

### 5.3 预留适配器

- `TelegramAdapter`：基于 `node-telegram-bot-api`，支持 webhook 和 polling
- `WeComAdapter`：基于企业微信 API
- 通过 `AdapterRegistry` 热插拔加载，未配置的适配器不初始化

## 6. 输入竞争与冲突解决

### 6.1 默认策略：先到先得（FCFS）

- 当状态机进入 `AWAITING_INPUT` 时，`ChannelRouter` 向所有在线通道广播精简后的提示
- 第一个返回有效输入的通道获胜
- 其他通道收到轻量通知：`"已由 [终端] 处理，无需回复"`

### 6.2 高级功能：主控权切换（Handover）

- 用户可在终端输入 `/handover feishu`，将控制权交给飞书
- 也可在飞书发送 `/handover terminal` 切回终端
- 主控模式下，非主控通道的输入被静默丢弃或返回"当前由 XX 控制"
- 主控权切换仅影响输入方向，终端始终可以实时查看 Claude 的输出

## 7. 消息过滤与格式化

### 7.1 默认过滤策略

Claude Code 的终端输出包含大量工作日志，默认**不推送**到消息平台：

```
Reading files...
Searching codebase...
Thinking...
Updating file...
```

### 7.2 推送内容

当检测到 `AWAITING_INPUT` 时，推送到飞书的消息只包含：

1. **决策标题**：如 "Claude 请求确认"、"Claude 需要你选择"
2. **核心内容**：检测到的选项列表、确认请求、问题文本
3. **可选项**：提取出的选项按钮/文本

**示例：**

终端实际输出（节选）：
```
Reading files...
Searching...
I'll help you update the nginx configuration. Here's what I plan to do:

1. Modify /etc/nginx/nginx.conf to add gzip compression
2. Restart nginx service

Is this okay?

[1] Yes, proceed
[2] No, cancel
[3] Show me the diff first

> 
```

飞书收到的推送：
```
Claude 请求确认

我将进行以下操作：
1. 修改 /etc/nginx/nginx.conf，添加 gzip 压缩
2. 重启 nginx 服务

请选择：
[1] 同意，继续执行
[2] 拒绝，取消操作
[3] 先查看 diff
```

### 7.3 ANSI 处理

- `InputDetector` 在分析时需要处理 ANSI 转义序列（颜色、光标位置、清屏等）
- 使用 `strip-ansi` 库提取纯文本用于正则匹配
- 保留 ANSI 序列用于终端透传（Terminal Adapter 不做处理）

## 8. 配置管理

配置文件 `ccbridge.config.json`：

```json
{
  "claude": {
    "command": "claude",
    "args": [],
    "env": {}
  },
  "stateMachine": {
    "pauseThresholdMs": 800,
    "inputTimeoutSec": 300,
    "processingLockMs": 3000
  },
  "detector": {
    "confirmationPatterns": [
      "\\[Y/n\\]",
      "\\(yes/no\\)",
      "Confirm\\?",
      "Is this okay\\?",
      "Proceed\\?"
    ],
    "selectionPatterns": [
      "^\\s*[\\[\\(]\\d+[\\)\\]]\\s+"
    ],
    "ignorePatterns": [
      "^Reading\\.",
      "^Searching\\.",
      "^Thinking\\.",
      "^Updating\\.",
      "^Analyzing\\."
    ]
  },
  "channels": {
    "terminal": {
      "enabled": true
    },
    "feishu": {
      "enabled": true,
      "mode": "self-built",
      "appId": "cli_xxx",
      "appSecret": "xxx",
      "encryptKey": "xxx",
      "webhookPort": 3000,
      "webhookPath": "/feishu/webhook"
    },
    "telegram": {
      "enabled": false
    },
    "wecom": {
      "enabled": false
    }
  },
  "handover": {
    "enabled": true
  }
}
```

## 9. 错误处理与边界情况

| 场景 | 处理策略 |
|------|----------|
| Claude 进程崩溃/退出 | `PtyManager` 监听 `exit` 事件，广播所有通道"会话已结束"，自动尝试重启（最多 3 次）或提示用户手动重连 |
| 飞书网络断开/请求失败 | 适配器进入重试队列（指数退避，最大间隔 60 秒），终端继续可用；恢复后同步当前状态 |
| 消息平台输入超时 | 如果 `AWAITING_INPUT` 超过 `inputTimeoutSec`（默认 5 分钟），向所有通道发送"操作已超时，请在终端继续"，状态机回到 `BUSY` |
| 状态机误判（把工作日志当选项） | 配置中的 `ignorePatterns` 可自定义过滤；未来可支持用户一键"这不是问题"反馈，动态学习 |
| 多开 Claude 会话 | v1 仅支持单会话；`PtyManager` 设计为单例，未来可扩展为 `SessionManager` |
| 飞书消息乱序 | 每个 `PromptMessage` 生成唯一 `promptId`，回复时携带 `promptId` 匹配；过期的 `promptId` 回复被丢弃 |

## 10. 技术栈

- **运行时**：Node.js 18+（推荐 20 LTS）
- **语言**：TypeScript 5.x
- **PTY 库**：`node-pty`
- **ANSI 处理**：`strip-ansi`、`ansi-regex`
- **HTTP 服务**：`fastify` 或 `express`（飞书 webhook）
- **配置**：`cosmiconfig` 支持多格式配置
- **日志**：`pino` 结构化日志
- **测试**：`vitest` + `@vitest/coverage-v8`

## 11. 目录结构（v1）

```
ccbridge/
├── src/
│   ├── index.ts              # 入口
│   ├── core/
│   │   ├── PtyManager.ts
│   │   ├── StateMachine.ts
│   │   └── InputDetector.ts
│   ├── channels/
│   │   ├── ChannelRouter.ts
│   │   ├── AdapterRegistry.ts
│   │   ├── TerminalAdapter.ts
│   │   ├── FeishuAdapter.ts
│   │   ├── TelegramAdapter.ts
│   │   └── WeComAdapter.ts
│   ├── config/
│   │   ├── ConfigManager.ts
│   │   └── schema.ts         # JSON Schema / Zod 校验
│   ├── types/
│   │   └── index.ts          # 共享类型定义
│   └── utils/
│       └── logger.ts
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-06-02-ccbridge-design.md
├── tests/
│   ├── unit/
│   └── integration/
├── ccbridge.config.example.json
├── package.json
├── tsconfig.json
└── README.md
```

## 12. 里程碑与范围

### v1.0 MVP
- [ ] PTY 启动和管理 Claude Code 子进程
- [ ] 状态机：`IDLE` / `BUSY` / `AWAITING_INPUT` / `PROCESSING_INPUT`
- [ ] `InputDetector`：选项列表、确认模式、停顿超时检测
- [ ] Terminal Adapter：终端透传
- [ ] Feishu Adapter：自建应用模式，支持私聊/群聊回复
- [ ] ChannelRouter：FCFS 竞争机制
- [ ] 配置管理：JSON 配置文件
- [ ] 基础日志和错误处理

### v1.1
- [ ] Feishu Webhook 轻量模式
- [ ] Telegram Adapter
- [ ] Handover 主控权切换

### v1.2
- [ ] 企业微信 Adapter
- [ ] 多会话支持（SessionManager）
- [ ] 状态机误判用户反馈与动态学习
