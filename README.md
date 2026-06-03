# cc-bridge

Claude Code bidirectional multi-channel I/O bridge.

Wraps Claude Code in a PTY, detects interactive prompts (selections, confirmations, invitations), and broadcasts them to multiple channels (Terminal, Feishu, Telegram, WeCom). First reply from any channel wins and is written back to Claude.

## Features

- **PTY Wrapper**: Spawns Claude Code in a pseudo-terminal via `node-pty`
- **Prompt Detection**: Heuristics for confirmations (`[Y/n]`), selections (`1. foo`), invitations (`How can I help`), and ignore patterns (`Reading...`)
- **ANSI UI Detection**: Detects Claude Code's interactive review/approval screens via ANSI escape sequences (cursor positioning, reverse video, bold)
- **Multi-Channel Routing**: Broadcast prompts to all enabled channels simultaneously
- **First-Come-First-Serve**: First reply from any channel wins; late channels receive a "already handled" notification
- **State Machine**: Manages `idle -> awaiting_input -> processing -> idle` lifecycle with configurable timeouts
- **Handover Mode**: Optional handover for interactive session control

## Requirements

- Node.js >= 20.0.0
- Claude Code CLI installed (`claude`)
- **Windows only**: `node-pty` requires native compilation. Install one of:
  - Visual Studio 2022 Build Tools (with "Desktop development with C++" workload)
  - Visual Studio 2022 Community/Professional (with C++ workload)
  - Or set `npm config set msvs_version 2022` if you have an older VS version

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy example config:
   ```bash
   cp cc-bridge.config.example.json cc-bridge.config.json
   ```

3. Edit `cc-bridge.config.json` with your credentials and enable desired channels.

4. Run in development mode:
   ```bash
   npm run dev
   ```

   Or build and run:
   ```bash
   npm run build
   node dist/index.js
   ```

   Specify a working directory for Claude Code:
   ```bash
   npm run dev -- --dir D:\projects\my-app
   ```

   Pass extra arguments to Claude Code (all unknown flags are forwarded):
   ```bash
   npm run dev -- --dir D:\projects\my-app -p "fix bug"
   ```

## Deployment

### Production Build

```bash
npm ci
npm run build
node dist/index.js
```

### Process Manager (PM2)

Recommended for production to keep the bridge running and auto-restart on crash.

```bash
npm install -g pm2
pm2 start dist/index.js --name cc-bridge
pm2 save
pm2 startup
```

With a PM2 ecosystem file (`ecosystem.config.cjs`):

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
    // Optional: log redirection
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }],
};
```

Then start with `pm2 start ecosystem.config.cjs`.

### Linux (systemd)

Create `/etc/systemd/system/cc-bridge.service`:

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

On Windows you can run the bridge in a persistent terminal, or use Task Scheduler / PM2.

With PM2 on Windows (same as above):
```bash
pm2 start dist/index.js --name cc-bridge
pm2 save
```

To auto-start PM2 on Windows login, run `pm2 startup windows` and follow the instructions.

## Architecture

```
+-------------+     +----------------+     +----------------+
|  PtyManager | --> |  InputDetector | --> | ChannelRouter  |
| (node-pty)  |     | (heuristics)   |     | (broadcast)    |
+-------------+     +----------------+     +----------------+
       ^                                            |
       |                                            v
       +----------------+----------------+     +----------------+
                        |  StateMachine  | <-- |   Adapters     |
                        | (event-driven) |     | (Terminal/     |
                        +----------------+     |  Feishu/...)   |
                                               +----------------+
```

- **`PtyManager`** (`src/core/PtyManager.ts`): Spawns Claude Code in a PTY, mirrors output to stdout, and forwards user keystrokes
- **`InputDetector`** (`src/core/InputDetector.ts`): Scans PTY output lines for prompt patterns
- **`StateMachine`** (`src/core/StateMachine.ts`): Orchestrates transitions between idle, awaiting_input, and processing states
- **`ChannelRouter`** (`src/channels/ChannelRouter.ts`): Broadcasts detected prompts to all enabled channel adapters using a processing lock
- **`AdapterRegistry`** (`src/channels/AdapterRegistry.ts`): Discovers and initializes channel adapters dynamically

## Supported Channels

| Channel    | Status     | Notes                                     |
|-----------|------------|-------------------------------------------|
| Terminal  | Ready      | Local terminal passthrough (default)      |
| Feishu    | Ready      | Self-built app: WebSocket / HTTP Webhook / Webhook URL |
| Telegram  | Planned    | Placeholder adapter                       |
| WeCom     | Planned    | Placeholder adapter                       |

### Feishu Setup

`cc-bridge` supports three modes for receiving messages from Feishu:

#### A. WebSocket Long Connection (Recommended — no public IP needed)

Best for local development or machines without a public IP.

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

- `cc-bridge` connects **outbound** to Feishu's WebSocket gateway
- No webhook URL or port forwarding required
- Works behind NAT, home routers, corporate firewalls
- Auto-reconnect on disconnect; tenant access token is auto-refreshed

#### B. HTTP Webhook (Requires public IP or tunnel)

Use if you prefer traditional webhooks or already have a public server.

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

- Set Feishu event subscription URL to `http://<your-host>:3000/feishu/webhook`
- Requires the host to be reachable from the public internet

#### C. Webhook URL (Simple push — no server needed)

If you already have a Feishu custom bot webhook URL, you can use it directly without running a local server.

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

- Only outbound pushes; cannot receive user replies back through this mode alone
- Best used alongside another channel (e.g., Terminal) or combined with a self-built app for replies

All modes that can send replies (`websocket` and `self-built`) use the Feishu Open API (`/im/v1/messages`) with automatic tenant token management.

#### Interactive Cards

When `FeishuAdapter` sends a prompt:
- **Selection** prompts render as an interactive card with option buttons
- **Confirmation** prompts render as a card with "确认" (Y) and "取消" (n) buttons
- Plain **question** prompts fall back to text messages

Cards work in both P2P and group chat contexts. The adapter remembers the latest context (user or chat) and sends replies back to the same conversation.

## Configuration

### Config File Locations

`cc-bridge` uses [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) to search for configuration in the following places (in order of priority):

1. A path passed as the first CLI argument: `node dist/index.js ./my-config.json`
2. `cc-bridge` property in `package.json`
3. `.cc-bridgerc` (JSON or YAML)
4. `.cc-bridgerc.json`, `.cc-bridgerc.yaml`, `.cc-bridgerc.yml`, `.cc-bridgerc.js`, `.cc-bridgerc.cjs`
5. `cc-bridge.config.js` or `cc-bridge.config.cjs`
6. `cc-bridge.config.json` (default when no other config is found)

### Configuration Priority

Values are merged in this order (later overrides earlier):

1. Built-in defaults
2. Config file values
3. CLI flags (`--dir` overrides `claude.cwd`)

### Top-Level Sections

| Section       | Description                                               |
|--------------|-----------------------------------------------------------|
| `claude`     | Claude Code spawn settings                                |
| `stateMachine` | Pause thresholds, timeouts, and lock durations           |
| `detector`   | Regex patterns for prompt detection and ignore filtering  |
| `channels`   | Per-channel adapter settings                              |
| `handover`   | Interactive session handover control                      |

### Claude Options

**`claude`**
| Field     | Type    | Default  | Description                                      |
|-----------|---------|----------|--------------------------------------------------|
| `command` | string  | `claude` | Executable to spawn (e.g. `claude`)              |
| `args`    | string[]| `[]`     | Additional CLI arguments                         |
| `env`     | object  | `{}`     | Extra environment variables                      |
| `cwd`     | string  | —        | Working directory for Claude Code (optional)     |

If `cwd` is omitted, Claude Code starts in the current process directory (usually where you run `npm run dev`). Set it to point at the project you want Claude to work on.

You can also override `cwd` per-run via the `--dir` CLI flag, which takes precedence over the config file.

### State Machine Options

**`stateMachine`**
| Field             | Type   | Default | Description                                                                  |
|-------------------|--------|---------|------------------------------------------------------------------------------|
| `pauseThresholdMs`| number | 800     | Milliseconds of PTY output silence before scanning for prompts               |
| `inputTimeoutSec` | number | 300     | Seconds to wait for user input before auto-resetting to idle                 |
| `processingLockMs`| number | 3000    | Milliseconds to lock out other channels after the first reply is accepted    |

- `pauseThresholdMs`: Lower values make prompt detection more responsive but may cause false positives during fast output. Higher values reduce false positives but add latency.
- `inputTimeoutSec`: If no input is received within this window, the state machine resets to `idle` so subsequent output can be re-evaluated.
- `processingLockMs`: Prevents race conditions when multiple channels reply around the same time.

### Detector Options

**`detector`**
| Field                  | Type     | Description                                                                    |
|------------------------|----------|--------------------------------------------------------------------------------|
| `confirmationPatterns` | string[] | Regex strings matching yes/no or approval prompts (e.g. `[Y/n]`)              |
| `selectionPatterns`    | string[] | Regex strings matching numbered option lists (e.g. `1. foo`, `(2) bar`)       |
| `invitationPatterns`   | string[] | Regex strings matching open-ended invitations (e.g. `How can I help`)         |
| `ignorePatterns`       | string[] | Regex strings for output lines to exclude from prompt detection               |

All patterns are evaluated as regular expressions. The default patterns cover common Claude Code prompt styles in both English and Chinese. You can extend or override them to match custom tool behavior.

**Ignore patterns** are useful for filtering transient status lines like `Reading...`, `Searching...`, or `Analyzing...` that should not be treated as interactive prompts.

### Handover Options

**`handover`**
| Field     | Type    | Default | Description                                          |
|-----------|---------|---------|------------------------------------------------------|
| `enabled` | boolean | true    | Allow temporary interactive session control          |

When enabled, the bridge can hand control back to the local terminal for complex interactive sessions that are difficult to handle via remote channels.

### Logging

`cc-bridge` uses [pino](https://github.com/pinojs/pino) for structured JSON logging. In development, install `pino-pretty` for human-readable output:

```bash
npm run dev 2>&1 | npx pino-pretty
```

In production, logs are emitted as newline-delimited JSON (NDJSON) to `stderr` by default. Integrate with your log aggregator (ELK, Loki, CloudWatch, etc.) by piping or capturing `stderr`.

### CLI Usage

```bash
node dist/index.js [config-path] [options] [-- <claude-args>]
```

**cc-bridge options:**

| Option        | Description                                           |
|---------------|-------------------------------------------------------|
| `--dir <dir>` | Working directory for Claude Code (overrides config)  |
| `-h, --help`  | Show help                                             |

**All other flags are forwarded directly to Claude Code** (including `-w`, `-p`, `--verbose`, etc.). You can also use `--` to explicitly separate cc-bridge options from Claude args.

Examples:
```bash
# Default config, default directory
node dist/index.js

# Run in a specific directory
node dist/index.js --dir D:\projects\my-app

# Custom config + directory
node dist/index.js ./my-config.json --dir D:\projects\my-app

# Pass -w to Claude (git worktree) — NOT consumed by cc-bridge
node dist/index.js -w my-worktree

# Combine cc-bridge --dir with Claude flags
node dist/index.js --dir D:\projects\my-app -w my-worktree -p "fix bug"

# Explicit separation with --
node dist/index.js --dir D:\projects\my-app -- -p "fix bug" --verbose
```

### Channel Options

**`channels.terminal`**
| Field    | Type    | Default | Description                |
|----------|---------|---------|----------------------------|
| `enabled`| boolean | `true`  | Pass through local terminal |

**`channels.feishu`**
| Field        | Type   | Required | Description                                      |
|--------------|--------|----------|--------------------------------------------------|
| `enabled`    | boolean| Yes      | Enable Feishu channel                            |
| `mode`       | string | Yes      | `self-built`, `webhook`, or `websocket`          |
| `appId`      | string | WS/API   | Feishu app ID (required for WS and self-built)   |
| `appSecret`  | string | WS/API   | Feishu app secret (required for WS and self-built) |
| `encryptKey` | string | No       | Event subscription encrypt key                   |
| `webhookPort`| number | No       | HTTP server port (self-built only, default 3000) |
| `webhookPath`| string | No       | Webhook endpoint path (self-built only)          |
| `webhookUrl` | string | No       | Custom bot webhook URL (webhook mode only)       |

## Development

```bash
npm run build       # compile TypeScript
npm run dev         # run with tsx (watch-friendly)
npm test            # run all tests
npm run test:watch  # watch mode
```

## Troubleshooting

### `node-pty` build fails on Windows

Install Visual Studio Build Tools with the "Desktop development with C++" workload, then reinstall:

```bash
npm rebuild node-pty
```

### Config file not found

The CLI exits with `Config file not found` if no configuration is discovered. Ensure one of the [supported config locations](#config-file-locations) exists, or pass an explicit path:

```bash
node dist/index.js ./my-config.json
```

### Feishu messages not received

- Verify `appId` and `appSecret` are correct
- For `self-built` mode: ensure the event subscription URL is reachable from Feishu's servers
- For `websocket` mode: check firewall rules allowing outbound connections to `open.feishu.cn`
- Confirm the bot has been added to the conversation (P2P or group chat)

### Prompts not detected

- Increase `stateMachine.pauseThresholdMs` if Claude outputs large diffs before prompting
- Add custom patterns to `detector.confirmationPatterns` or `detector.selectionPatterns` if your workflow uses non-standard prompts
- Check logs for the detected state transitions; set `NODE_ENV=development` for more verbose output

### Terminal input not working

- Ensure `process.stdin.isTTY` is true (running in a real terminal, not a non-TTY pipe)
- On Windows Terminal / PowerShell, try using `cmd.exe` or Git Bash if raw mode behaves unexpectedly

## Project Structure

```
src/
  channels/         # Channel adapters and router
  config/           # Configuration loading and Zod schema
  core/             # PtyManager, InputDetector, StateMachine
  types/            # Shared domain types
  utils/            # Logger factory
  index.ts          # Entry point (CcBridgeApp)
```
