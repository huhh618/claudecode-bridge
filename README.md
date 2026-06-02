# ccbridge

Claude Code bidirectional multi-channel I/O bridge.

## Quick Start

1. Copy example config:
   ```bash
   cp ccbridge.config.example.json ccbridge.config.json
   ```

2. Edit `ccbridge.config.json` with your Feishu credentials.

3. Run:
   ```bash
   npm run dev
   ```

## Architecture

- `PtyManager` wraps Claude Code in a PTY
- `InputDetector` identifies prompts (selections, confirmations) via heuristics
- `ChannelRouter` broadcasts prompts to all enabled channels (Terminal, Feishu, ...)
- First reply from any channel wins and is written back to Claude

## Configuration

See `ccbridge.config.example.json` for all options.

## Development

```bash
npm test        # run all tests
npm run test:watch   # watch mode
```
