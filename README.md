# Hyposea Agent 🤖🌊

**Hyposea Agent** is an interactive Discord bot that bridges Discord messages and threads directly to the **AGY (Google Antigravity)** CLI assistant.

It enables team members and autonomous workflows to issue prompts, execute tasks, and receive clean, formatted engineering output directly inside `#mainframe-channel` or dedicated discussion threads.

---

## 🏗️ Architecture

```text
  Discord User (#mainframe-channel / thread)
                     │
                     ▼
           [ Hyposea Agent Daemon ]
                     │  (Command parsing, Auth whitelist, Guardrails)
                     ▼
         [ SQLite Session Store & Queue ] (Per-session serialization & persistence)
                     │
                     ▼
           [ AGY CLI Subprocess ]  (src/runners/agy.ts)
                     │
                     ▼
           [ Output Formatter ]    (discord-display skill & Markdown chunking)
                     │
                     ▼
      Discord Response (Threaded / Message Chunks <= 1900 chars)
```

---

## ✨ Features

- **Bidirectional Discord ↔ AGY Bridge**: Listens for `!agy` commands, bot @mentions, and replies within active threads.
- **SQLite Session Persistence**: Preserves conversation history (`conversationId`) per thread/channel across bot restarts using SQLite WAL mode.
- **Per-Session Execution Queue**: Enforces strict FIFO serialization so concurrent requests in the same session never collide.
- **Process Tree Cancellation (`stop`)**: Cleanly cancels active running AGY subprocess trees via OS process groups when commanded, keeping the conversation session intact.
- **Model Quota & Limits Command**: Instantly inspect model quota (Gemini, Claude, GPT), weekly/5-hour remaining capacity, and dynamic refresh timers via `!agy quota`.
- **Security & Authorization Whitelist**:
  - Restricts command execution strictly to authorized Discord User IDs defined in `MAINFRAME_AUTHORIZED_USERS`.
  - Sanitizes subprocess environment variables, stripping sensitive system tokens from leaking to child processes.
  - Destructive action guardrails with interactive Discord confirmation buttons.
- **Discord-Optimized Formatting**: Programmatic Markdown filtering following the `discord-display` skill (see [.agents/skills/discord-display/SKILL.md](.agents/skills/discord-display/SKILL.md) and [AGENTS.md](AGENTS.md)). Converts complex tables into readable key-value bullets and splits large messages cleanly without breaking code blocks.

---

## ⌨️ Bot Commands

Inside `#mainframe-channel` (or in threads under it, or via @mention):

• **`!agy <prompt>`** — Execute a prompt or coding task against AGY CLI (maintains session context in thread)  
• **`!agy stop`** (or `stop`, `abort`) — Abort the currently running AGY task in this thread/session  
• **`!agy quota`** (or `!agy model-quota`, `usage`) — View model quota status, visual progress bars, remaining percentage, and Discord countdown timers for limit resets  
• **`!agy quota --json`** — Return raw JSON payload from AGY CLI quota endpoint  
• **`!agy status`** — Inspect active bridge status, target channel, conversation ID, and operator ID  
• **`!agy reset`** / **`!agy new`** — Clear current channel thread session and begin a fresh AGY conversation  
• **`!agy help`** — Show command list and usage tips  

*Note: Inside any thread created under `#mainframe-channel`, authorized users can run `quota`, `stop`, `status`, `help`, or prompts directly without the `!agy` prefix.*

---

## 🚀 Quickstart

### Prerequisites

- **Node.js**: v20 or higher
- **Antigravity CLI (`agy`)**: Installed and authenticated on the host machine (e.g. `~/.local/bin/agy`)
- **Discord Bot**: A registered Discord application bot with `Guilds`, `GuildMessages`, and `MessageContent` Gateway Intents enabled.

### 1. Installation

```bash
git clone https://github.com/deonetwo/hyposea-agent.git
cd hyposea-agent
npm install
```

### 2. Environment Configuration

Copy the example configuration:
```bash
cp .env.example .env
chmod 600 .env
```

Edit `.env`:
```ini
# Discord bot token for the AGY Mainframe Bridge agent
DISCORD_BOT_TOKEN=your_discord_bot_token_here

# Enable/disable the interactive AGY Mainframe bridge
MAINFRAME_ENABLED=true

# Channel name where the bot listens for mainframe prompts
MAINFRAME_CHANNEL=mainframe-channel

# Comma-separated list of authorized Discord User IDs (required for command authorization)
MAINFRAME_AUTHORIZED_USERS=123456789012345678,987654321098765432

# Prefix required to trigger AGY (mentions and thread replies also work)
MAINFRAME_PREFIX=!agy

# Absolute path to the AGY CLI executable
AGY_BIN_PATH=/home/ubuntu/.local/bin/agy

# Working directory for AGY commands (defaults to project directory)
HYPOSEA_WORKDIR=

# Optional SQLite database path (defaults to ./data/hyposea.db)
HYPOSEA_DB_PATH=
```

> [!IMPORTANT]
> `MAINFRAME_AUTHORIZED_USERS` must contain explicit Discord user snowflake IDs. If left empty, no users will be authorized to trigger the AGY bridge.

### 3. Build & Test

```bash
npm run build
npm test
```

### 4. Running the Agent

- **Development mode** (auto-transpile via tsx):
  ```bash
  npm run dev
  ```
- **Production mode**:
  ```bash
  npm run build
  npm start
  ```

---

## 🎨 Discord Display Conventions

All responses generated by Hyposea Agent follow the standards defined in:
- [AGENTS.md](AGENTS.md)
- [.agents/skills/discord-display/SKILL.md](.agents/skills/discord-display/SKILL.md)

Key formatting rules:
- **No giant headers**: Use `###` or bold text instead of `#` or `##`.
- **No markdown tables**: Converted to key-value bullet lists (`• **Key:** Value`) for mobile friendliness.
- **Syntax highlighting**: All code snippets include explicit language tags.
- **Message bounding**: Long outputs are automatically chunked into < 1900 character blocks while maintaining open/close code blocks.

---

## 📜 License

MIT
