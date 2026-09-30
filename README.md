# Hyposea Agent 🤖🌊

**Hyposea Agent** is a modular personal AI assistant harness built on top of **Google Antigravity (`agy` CLI)**. It turns the headless AGY CLI into a persistent, multi-channel personal assistant for a single owner, with persistent memory, natural language scheduling, safe file exchange, and Discord integration.

Deployable on your own server as a managed `systemd` user service.

---

## 🏗️ Architecture (Ports & Adapters)

```text
src/
  core/        pipeline.ts, events.ts, session-store.ts, queue.ts, context-builder.ts, types.ts
  runners/     runner.ts (interface), agy.ts (AgyRunner + probe + quota)
  channels/    channel.ts (interface), discord/ (DiscordChannel adapter)
  modules/     attachments/, audit/, formatter/, guard/ (Event bus subscribers)
  scheduler/   cron.ts (emits 'job.due', outbox dispatcher)
  mcp/         memory-server/, scheduler-server/, notify-server/ (Stdio MCP servers for AGY)
  cli/         index.ts + commands (setup, start, stop, restart, status, logs, doctor, backup, restore, chat)
  config/      paths.ts, schema.ts (zod), load.ts
```

```text
   Inbound (Discord Channel / DM)
                 │
                 ▼
     [ Auth & Allowlist Check ]
                 │
                 ▼
        [ Command Router ] ────► (stop, quota, reset, status, help)
                 │
                 ▼
         [ Safety Guard ]  ────► (Interactive Deletion Confirmation)
                 │
                 ▼
       [ Attachment Manager ] ──► (Inbound files downloaded for AGY)
                 │
                 ▼
     [ SQLite Session & Queue ] ─► (Per-session FIFO serialization & WAL persistence)
                 │
                 ▼
     [ Context & Memory Builder ] (MEMORY.md + USER.md + FTS5 conversation search)
                 │
                 ▼
        [ AGY Runner Subprocess ] (Exclusive LLM runtime, abortable process tree)
                 │
                 ▼
       [ Post-Processing ] ────► (Secret redaction, discord-display formatter, file detection)
                 │
                 ▼
        Outbound Message & Files (Safe chunking <= 1900 chars + file attachments)
```

---

## ✨ Features

- **AGY-Native LLM Runtime**: Communicates solely through the local `agy` CLI binary—no external LLM provider SDKs or API keys needed.
- **Strict Single-User Security**:
  - Restricts execution strictly to authorized Discord User IDs defined in `MAINFRAME_AUTHORIZED_USERS`.
  - Silent drops for unauthorized DMs; explicit access denied in guild channels.
  - Subprocess environment sanitization to prevent API token leaks.
  - Interactive deletion confirmation buttons via Discord Action Rows.
- **Direct Message (DM) & Channel Support**:
  - **Private DMs**: Talk 1-on-1 with AGY privately; maintains isolated persistent context per owner (`dm-<userId>`).
  - **Guild Mainframe Channel**: Shared channel discussion (`#mainframe-channel`) and dedicated discussion threads.
- **Inbound & Outbound File Attachments**:
  - **Inbound**: Upload logs, code, PDFs, or images in Discord; Hyposea downloads them to temporary scratch space and enriches the AGY prompt with local paths.
  - **Outbound**: AGY can send files back to Discord using `[send_file: /path]`, `[attachment: /path]`, or `<attachment>/path</attachment>`.
- **Persistent Memory & Context (MCP)**:
  - `MEMORY.md`: Long-term project facts and decisions.
  - `USER.md`: Owner preferences and working habits.
  - Built-in SQLite FTS5 full-text search over previous conversation turns (`search_sessions`).
- **Quota-Guarded Scheduler (MCP)**:
  - Natural language task scheduling (`schedule_task`, `list_jobs`, `cancel_job`).
  - Strict quotas: Minimum 15-minute intervals, max 10 jobs/day to protect model limits.
- **Model Quota Inspection**:
  - Check live Gemini, Claude, and GPT quotas, remaining capacity percentages, and reset countdown timers via `!agy quota`.
- **Process Cancellation (`stop`)**:
  - Cleanly kills the running AGY process tree on demand via OS process groups (`kill(-pid)`), keeping the conversation context intact.
- **Discord-Optimized Formatting**:
  - Follows [.agents/skills/discord-display/SKILL.md](.agents/skills/discord-display/SKILL.md) and [AGENTS.md](AGENTS.md).
  - No wide markdown tables (automatically converted to clean key-value bullets).
  - Demotes oversized `#` headers and chunks responses cleanly without breaking code blocks.

---

## ⌨️ Bot Commands

Inside `#mainframe-channel` (or in threads, or via private DM):

• **`!agy <prompt>`** — Execute a prompt or task in AGY (maintains continuous context)  
• **`!agy stop`** (or `stop`, `abort`, `cancel`) — Abort the active AGY process for this session  
• **`!agy quota`** (or `usage`, `model-quota`) — View model quota, limits, and reset countdowns  
• **`!agy quota --json`** — View raw model quota JSON data  
• **`!agy status`** — View active session info, conversation ID, message count, and queue state  
• **`!agy reset`** (or `new`) — Start a fresh AGY conversation session  
• **`!agy help`** — Show command list and usage tips  

*Tip: In threads and private DMs, commands and prompts can be sent directly without typing `!agy`.*

---

## 🛠️ CLI Control Plane (`hyposea`)

Hyposea includes an administrative CLI tool for server management:

```bash
# Interactive setup wizard (validates AGY login, initializes ~/.hyposea/, creates service)
npm run setup
# or after installing global bin:
hyposea setup

# Run diagnostic health check (Node, AGY probe, Discord token, permissions, storage)
npm run doctor
# or
hyposea doctor

# Service control (systemd user service)
hyposea start
hyposea stop
hyposea restart
hyposea status

# View live application logs
hyposea logs -f

# Backup and restore configuration, memory, and SQLite database
hyposea backup -o ./my-backup.tar.gz
hyposea restore -i ./my-backup.tar.gz

# Launch interactive AGY pass-through terminal session
hyposea chat
```

---

## 🚀 Deployment & Installation

Detailed server setup and systemd instructions are provided in [docs/DEPLOY.md](docs/DEPLOY.md).

### Prerequisites

1. **Node.js**: v20 or higher.
2. **Google Antigravity CLI (`agy`)**: Installed and authenticated by running `agy` interactively on the server.
3. **Discord Bot Token**: With `Guilds`, `GuildMessages`, `DirectMessages`, and `MessageContent` Gateway Intents enabled.

### Quick Start

```bash
# 1. Clone repository
git clone https://github.com/deonetwo/hyposea-agent.git
cd hyposea-agent

# 2. Install dependencies & build
npm ci
npm run build

# 3. Run interactive setup
npm run setup

# 4. Run doctor checks
npm run doctor

# 5. Start service
npm start
```

---

## 📂 Configuration & Data Layout

Hyposea stores all state under `~/.hyposea/` (override with `HYPOSEA_HOME`):

```text
~/.hyposea/
├── config.yaml          # Non-secret settings (channel, prefix, paths, limits)
├── secrets.env          # Sensitive credentials (DISCORD_BOT_TOKEN) [chmod 600]
├── db/
│   └── hyposea.db       # SQLite WAL database (sessions, audit log, jobs, FTS5 turns)
├── memory/
│   ├── MEMORY.md        # Long-term knowledge base
│   └── USER.md          # Personal user preferences
├── skills/              # Custom agent skills
└── logs/                # System log files
```

---

## 🧪 Testing

Hyposea has comprehensive automated test suites covering all modules, runners, queues, formatting, and safety policies:

```bash
npm test
```

---

## 📜 License

MIT
