# cc-bridge

Claude Code 双向多通道 I/O 桥接器。

将 Claude Code 包装在伪终端（PTY）中，检测交互式提示（选项、确认、邀请），并将其广播到多个通道（终端、飞书、Telegram、企业微信）。任意通道的第一个回复会被写回 Claude，其余通道会收到“已处理”通知。

## 功能

- **PTY 包装器**：通过 `node-pty` 在伪终端中启动 Claude Code
- **提示检测**：启发式识别确认（`[Y/n]`）、选项（`1. foo`）、邀请（`我将修改`）以及忽略模式（`Reading...`）
- **ANSI UI 检测**：通过 ANSI 转义序列（光标定位、反色、加粗）检测 Claude Code 的交互式审阅/批准界面
- **多通道路由**：同时将提示广播到所有已启用的通道
- **先到先得**：任意通道的第一个回复胜出；其他晚到的通道会收到“已处理”通知
- **状态机**：管理 `idle -> awaiting_input -> processing -> idle` 生命周期，支持可配置的超时
- **交接模式**：可选的交互式会话控制交接

## 环境要求

- Node.js >= 20.0.0
- 已安装 Claude Code CLI（`claude`）
- **仅限 Windows**：`node-pty` 需要本地编译。安装以下任一环境：
  - Visual Studio 2022 Build Tools（含“使用 C++ 的桌面开发”工作负载）
  - Visual Studio 2022 Community/Professional（含 C++ 工作负载）
  - 或者如果你有旧版本 VS，设置 `npm config set msvs_version 2022`

## 快速开始

1. 安装依赖：
   ```bash
   npm install
   ```

2. 复制示例配置：
   ```bash
   cp cc-bridge.config.example.json cc-bridge.config.json
   ```

3. 编辑 `cc-bridge.config.json`，填入你的凭据并启用需要的通道。

4. 以开发模式运行：
   ```bash
   npm run dev
   ```

   或构建后运行：
   ```bash
   npm run build
   node dist/index.js
   ```

   为 Claude Code 指定工作目录：
   ```bash
   npm run dev -- --dir D:\projects\my-app
   ```

   向 Claude Code 传递额外参数（所有未知标志都会直接透传）：
   ```bash
   npm run dev -- --dir D:\projects\my-app -p "fix bug"
   ```

## 部署

### 生产构建

```bash
npm ci
npm run build
node dist/index.js
```

### 进程管理器（PM2）

生产环境建议使用 PM2，以保持桥接器持续运行并在崩溃时自动重启。

```bash
npm install -g pm2
pm2 start dist/index.js --name cc-bridge
pm2 save
pm2 startup
```

使用 PM2 生态配置文件（`ecosystem.config.cjs`）：

```javascript
module.exports = {
  apps: [{
    name: 'cc-bridge',
    script: './dist/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
    },
    // 可选：日志重定向
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }],
};
```

然后使用 `pm2 start ecosystem.config.cjs` 启动。

### Linux（systemd）

创建 `/etc/systemd/system/cc-bridge.service`：

```ini
[Unit]
Description=cc-bridge
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/cc-bridge
ExecStart=/usr/bin/node /opt/cc-bridge/dist/index.js
Restart=on-failure
RestartSec=5
Environment="NODE_ENV=production"

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable cc-bridge
sudo systemctl start cc-bridge
sudo journalctl -u cc-bridge -f
```

### Windows

在 Windows 上，你可以在持久终端中运行桥接器，或使用任务计划程序 / PM2。

使用 PM2（与上文相同）：
```bash
pm2 start dist/index.js --name cc-bridge
pm2 save
```

要在 Windows 登录时自动启动 PM2，运行 `pm2 startup windows` 并按照说明操作。

## 架构

```
+-------------+     +----------------+     +----------------+
|  PtyManager | --> |  InputDetector | --> | ChannelRouter  |
| (node-pty)  |     | (启发式检测)    |     | (广播)         |
+-------------+     +----------------+     +----------------+
       ^                                            |
       |                                            v
       +----------------+----------------+     +----------------+
                        |  StateMachine  | <-- |   Adapters     |
                        | (事件驱动)      |     | (Terminal/     |
                        +----------------+     |  Feishu/...)   |
                                               +----------------+
```

- **`PtyManager`**（`src/core/PtyManager.ts`）：在 PTY 中启动 Claude Code，将输出镜像到 stdout，并转发用户按键
- **`InputDetector`**（`src/core/InputDetector.ts`）：扫描 PTY 输出行以匹配提示模式
- **`StateMachine`**（`src/core/StateMachine.ts`）：编排 idle、awaiting_input 和 processing 状态之间的转换
- **`ChannelRouter`**（`src/channels/ChannelRouter.ts`）：使用处理锁将检测到的提示广播到所有已启用的通道适配器
- **`AdapterRegistry`**（`src/channels/AdapterRegistry.ts`）：动态发现并初始化通道适配器

## 支持的通道

| 通道       | 状态      | 说明                                           |
|-----------|----------|-----------------------------------------------|
| 终端       | 可用      | 本地终端透传（默认）                             |
| 飞书       | 可用      | 自建应用：WebSocket / HTTP Webhook / Webhook URL |
| Telegram  | 计划中    | 占位适配器                                      |
| 企业微信   | 计划中    | 占位适配器                                      |

### 飞书配置

`cc-bridge` 支持三种接收飞书消息的模式：

#### A. WebSocket 长连接（推荐 — 无需公网 IP）

最适合本地开发或没有公网 IP 的机器。

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "mode": "websocket",
      "appId": "cli_xxx",
      "appSecret": "xxx",
      "encryptKey": "xxx"
    }
  }
}
```

- `cc-bridge` **主动连接**飞书的 WebSocket 网关
- 无需配置 webhook URL 或端口转发
- 可在 NAT、家庭路由器、企业防火墙后工作
- 断线自动重连；tenant access token 自动刷新

#### B. HTTP Webhook（需要公网 IP 或内网穿透）

如果你偏好传统 webhook 或已有公网服务器，可使用此模式。

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "mode": "self-built",
      "appId": "cli_xxx",
      "appSecret": "xxx",
      "encryptKey": "xxx",
      "webhookPort": 3000,
      "webhookPath": "/feishu/webhook"
    }
  }
}
```

- 将飞书事件订阅 URL 设置为 `http://<你的主机>:3000/feishu/webhook`
- 要求主机可从公网访问

#### C. Webhook URL（简单推送 — 无需服务器）

如果你已有飞书自定义机器人的 webhook URL，可直接使用，无需运行本地服务器。

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "mode": "webhook",
      "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/xxxx"
    }
  }
}
```

- 仅支持向外推送消息；此模式单独无法接收用户回复
- 建议与其他通道（如终端）配合使用，或结合自建应用来接收回复

所有能发送回复的模式（`websocket` 和 `self-built`）都使用飞书开放 API（`/im/v1/messages`）并自动管理 tenant token。

#### 交互式卡片

当 `FeishuAdapter` 发送提示时：
- **选项**提示会渲染为带选项按钮的交互式卡片
- **确认**提示会渲染为带“确认”（Y）和“取消”（n）按钮的卡片
- 普通**问题**提示会回退为文本消息

卡片在单聊和群聊中均可使用。适配器会记住最新的上下文（用户或群聊），并将回复发送到同一会话。

## 配置

### 配置文件位置

`cc-bridge` 使用 [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) 按以下优先级搜索配置：

1. 作为第一个 CLI 参数传入的路径：`node dist/index.js ./my-config.json`
2. `package.json` 中的 `cc-bridge` 属性
3. `.cc-bridgerc`（JSON 或 YAML）
4. `.cc-bridgerc.json`、`.cc-bridgerc.yaml`、`.cc-bridgerc.yml`、`.cc-bridgerc.js`、`.cc-bridgerc.cjs`
5. `cc-bridge.config.js` 或 `cc-bridge.config.cjs`
6. `cc-bridge.config.json`（当未发现其他配置时的默认值）

### 配置优先级

值按以下顺序合并（后面的覆盖前面的）：

1. 内置默认值
2. 配置文件中的值
3. CLI 标志（`--dir` 覆盖 `claude.cwd`）

### 顶层配置段

| 配置段          | 说明                                          |
|----------------|-----------------------------------------------|
| `claude`       | Claude Code 启动设置                           |
| `stateMachine` | 暂停阈值、超时时间和锁定时长                    |
| `detector`     | 提示检测和忽略过滤的正则表达式模式              |
| `channels`     | 各通道适配器设置                               |
| `handover`     | 交互式会话交接控制                             |

### Claude 选项

**`claude`**
| 字段       | 类型     | 默认值    | 说明                                      |
|-----------|---------|----------|------------------------------------------|
| `command` | string  | `claude` | 要启动的可执行文件（如 `claude`）           |
| `args`    | string[]| `[]`     | 额外的 CLI 参数                            |
| `env`     | object  | `{}`     | 额外的环境变量                             |
| `cwd`     | string  | —        | Claude Code 的工作目录（可选）              |

如果省略 `cwd`，Claude Code 会在当前进程目录中启动（通常是你运行 `npm run dev` 的地方）。将其设置为希望 Claude 处理的项目目录。

你也可以通过 `--dir` CLI 标志按次运行覆盖 `cwd`，该标志优先级高于配置文件。

### 状态机选项

**`stateMachine`**
| 字段                | 类型   | 默认值 | 说明                                              |
|--------------------|--------|--------|---------------------------------------------------|
| `pauseThresholdMs` | number | 800    | PTY 输出静默多少毫秒后开始扫描提示                 |
| `inputTimeoutSec`  | number | 300    | 等待用户输入多少秒后自动重置为 idle 状态            |
| `processingLockMs` | number | 3000   | 第一个回复被接受后，锁定其他通道多少毫秒             |

- `pauseThresholdMs`：值越低，提示检测越灵敏，但在快速输出时可能产生误报。值越高可减少误报但会增加延迟。
- `inputTimeoutSec`：如果在此时间内未收到输入，状态机将重置为 `idle`，以便后续输出可被重新评估。
- `processingLockMs`：防止多个通道几乎同时回复时的竞态条件。

### 检测器选项

**`detector`**
| 字段                    | 类型     | 说明                                              |
|------------------------|----------|---------------------------------------------------|
| `confirmationPatterns` | string[] | 匹配是/否或批准提示的正则字符串（如 `[Y/n]`）       |
| `selectionPatterns`    | string[] | 匹配编号选项列表的正则字符串（如 `1. foo`、`(2) bar`）|
| `invitationPatterns`   | string[] | 匹配开放式邀请的正则字符串（如 `我将修改`）          |
| `ignorePatterns`       | string[] | 应从提示检测中排除的输出行的正则字符串               |

所有模式都作为正则表达式进行求值。默认模式覆盖了中英两种语言中常见的 Claude Code 提示样式。你可以扩展或覆盖它们以匹配自定义工具的行为。

**忽略模式**适用于过滤临时的状态行，如 `Reading...`、`Searching...` 或 `Analyzing...`，这些不应被当作交互式提示。

### 交接选项

**`handover`**
| 字段       | 类型    | 默认值 | 说明                          |
|-----------|---------|--------|------------------------------|
| `enabled` | boolean | true   | 允许临时交互式会话控制          |

启用后，桥接器可以将控制权交回本地终端，以便处理难以通过远程通道操作的复杂交互式会话。

### 日志

`cc-bridge` 使用 [pino](https://github.com/pinojs/pino) 进行结构化 JSON 日志记录。开发时安装 `pino-pretty` 可获得人类可读的输出：

```bash
npm run dev 2>&1 | npx pino-pretty
```

生产环境中，日志默认以换行分隔的 JSON（NDJSON）格式输出到 `stderr`。通过管道或捕获 `stderr` 可将其接入你的日志聚合系统（ELK、Loki、CloudWatch 等）。

### CLI 用法

```bash
node dist/index.js [config-path] [options] [-- <claude-args>]
```

**cc-bridge 选项：**

| 选项           | 说明                                          |
|---------------|-----------------------------------------------|
| `--dir <dir>` | Claude Code 的工作目录（覆盖配置）               |
| `-h, --help`  | 显示帮助                                       |

**所有其他标志都会直接透传给 Claude Code**（包括 `-w`、`-p`、`--verbose` 等）。你也可以使用 `--` 显式分隔 cc-bridge 选项和 Claude 参数。

示例：
```bash
# 默认配置，默认目录
node dist/index.js

# 在指定目录中运行
node dist/index.js --dir D:\projects\my-app

# 自定义配置 + 目录
node dist/index.js ./my-config.json --dir D:\projects\my-app

# 将 -w 传给 Claude（git worktree）—— 不会被 cc-bridge 消费
node dist/index.js -w my-worktree

# 组合 cc-bridge --dir 与 Claude 标志
node dist/index.js --dir D:\projects\my-app -w my-worktree -p "fix bug"

# 使用 -- 显式分隔
node dist/index.js --dir D:\projects\my-app -- -p "fix bug" --verbose
```

### 通道选项

**`channels.terminal`**
| 字段      | 类型    | 默认值  | 说明                |
|----------|---------|--------|--------------------|
| `enabled`| boolean | `true` | 本地终端透传         |

**`channels.feishu`**
| 字段          | 类型    | 必需      | 说明                                      |
|--------------|---------|----------|------------------------------------------|
| `enabled`    | boolean | 是       | 启用飞书通道                               |
| `mode`       | string  | 是       | `self-built`、`webhook` 或 `websocket`    |
| `appId`      | string  | WS/API   | 飞书应用 ID（WS 和 self-built 模式必需）    |
| `appSecret`  | string  | WS/API   | 飞书应用密钥（WS 和 self-built 模式必需）   |
| `encryptKey` | string  | 否       | 事件订阅加密密钥                            |
| `webhookPort`| number  | 否       | HTTP 服务器端口（仅 self-built，默认 3000） |
| `webhookPath`| string  | 否       | Webhook 端点路径（仅 self-built）           |
| `webhookUrl` | string  | 否       | 自定义机器人 Webhook URL（仅 webhook 模式） |
| `instanceId` | string  | 否       | 多实例路由的实例标识符                       |

### 多实例路由

当多个 `cc-bridge` 实例共用同一个飞书应用时，为每个实例设置唯一的 `instanceId` 以防止串扰：

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "mode": "websocket",
      "appId": "cli_xxx",
      "appSecret": "xxx",
      "instanceId": "instance-a"
    }
  }
}
```

工作原理：
- **卡片操作**：每个按钮将 `instanceId` 嵌入到 `value` 中。只有匹配的实例会处理点击。
- **文本回复**：当用户回复某个实例发送的提示时，回复会携带原始 `message_id` 作为 `parent_id`。只有发送了原始消息的实例才会接受该回复。
- 如果省略 `instanceId` 且尚未跟踪任何消息，适配器会回退到接受所有消息（向后兼容行为）。

**重要**：`webhook` 模式无法跟踪发送的 `message_id`，因此不支持文本回复过滤。运行多实例时请使用 `self-built` 或 `websocket` 模式。

## 开发

```bash
npm run build       # 编译 TypeScript
npm run dev         # 使用 tsx 运行（支持热重载）
npm test            # 运行所有测试
npm run test:watch  # 监听模式
```

## 故障排查

### Windows 上 `node-pty` 构建失败

安装带有“使用 C++ 的桌面开发”工作负载的 Visual Studio Build Tools，然后重新安装：

```bash
npm rebuild node-pty
```

### 找不到配置文件

如果未发现配置，CLI 会退出并提示 `Config file not found`。请确保存在 [支持的配置位置](#配置文件位置) 之一，或传入显式路径：

```bash
node dist/index.js ./my-config.json
```

### 飞书消息未收到

- 确认 `appId` 和 `appSecret` 正确
- `self-built` 模式：确保事件订阅 URL 可从飞书服务器访问
- `websocket` 模式：检查防火墙规则是否允许出站连接到 `open.feishu.cn`
- 确认机器人已被添加到会话中（单聊或群聊）

### 提示未被检测到

- 如果 Claude 在提示前输出大量 diff，增加 `stateMachine.pauseThresholdMs`
- 如果你的工作流使用非标准提示，向 `detector.confirmationPatterns` 或 `detector.selectionPatterns` 添加自定义模式
- 查看日志中的状态转换；设置 `NODE_ENV=development` 以获取更详细的输出

### 终端输入不工作

- 确保 `process.stdin.isTTY` 为 true（在真实终端中运行，而非非 TTY 管道）
- 在 Windows Terminal / PowerShell 中，如果原始模式行为异常，可尝试使用 `cmd.exe` 或 Git Bash

## 项目结构

```
src/
  channels/         # 通道适配器和路由器
  config/           # 配置加载和 Zod 校验
  core/             # PtyManager、InputDetector、StateMachine
  types/            # 共享领域类型
  utils/            # 日志工厂
  index.ts          # 入口（CcBridgeApp）
```
