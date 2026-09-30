# Hyposea Deployment & Operations Guide 🚀

Hyposea is a personal AI assistant harness designed to be self-hosted by its single owner on a Linux server or development machine. It connects Discord (Channels & DMs) to Google's Antigravity (`agy`) CLI runtime.

---

## 📋 1. Prerequisites

• **Operating System:** Linux (Ubuntu 22.04+ or Debian recommended, non-root user).  
• **Node.js:** v20.x or higher (`node -v`).  
• **Antigravity CLI (`agy`):** Installed and authenticated on the server as the OS user that will run the assistant daemon.  
• **Discord Bot:** A Discord Application bot with `Guilds`, `GuildMessages`, `DirectMessages`, and `MessageContent` Gateway Intents enabled.

---

## 🔐 2. Step 1: Manual AGY Login (Mandatory Prerequisite)

AGY login is a manual prerequisite that must be executed directly on the server before starting Hyposea.

1. Log into your server terminal as the non-root user who will run the daemon (e.g. `ubuntu`).
2. Run `agy` interactively:
   ```bash
   agy
   ```
3. Follow the CLI login prompt or browser authorization link to complete authentication.
4. Verify non-interactive execution works:
   ```bash
   agy -p "OK"
   ```
   If it responds with `OK` and exits with code 0, AGY authentication is verified.

---

## ⚙️ 3. Step 2: Automated Setup

Run the idempotent setup wizard:

```bash
git clone https://github.com/deonetwo/hyposea-agent.git
cd hyposea-agent
npm install
npm run build

# Run the setup wizard
./bin/hyposea setup
```

The setup script:
1. Verifies Node.js and executes an AGY authentication probe.
2. Creates the `~/.hyposea/` directory tree:
   • `~/.hyposea/config.yaml` (non-secret configuration)  
   • `~/.hyposea/secrets.env` (permissions strictly enforced to `0600`)  
   • `~/.hyposea/db/` (SQLite database for persistent sessions and audit logs)  
   • `~/.hyposea/memory/` (assistant memory context)  
   • `~/.hyposea/logs/`  
3. Generates and registers the `hyposea.service` systemd user service.
4. Runs full health checks with `doctor`.

---

## 🩺 4. Health Checks & Diagnostics

Run the diagnostics doctor anytime to inspect configuration, tokens, permissions, and daemon status:

```bash
./bin/hyposea doctor
```

Output checks:
• `Node.js Version` — Must be v20+  
• `AGY Binary` — Resolves executable path and version  
• `AGY Probe & Authentication` — Verifies live communication with models  
• `Discord Token` — Verifies presence and structure  
• `Owner Allowlist` — Ensures snowflake ID allowlist is non-empty  
• `Secrets Permissions` — Ensures `secrets.env` is mode `0600`  
• `Systemd Service` — Inspects active service state  

---

## 🔄 5. Managing the Service

Use standard systemd user controls or the `hyposea` CLI:

```bash
# Start the service
./bin/hyposea start
# (or systemctl --user start hyposea.service)

# Check status
./bin/hyposea status

# Inspect live logs
./bin/hyposea logs -f

# Restart
./bin/hyposea restart

# Stop
./bin/hyposea stop
```

To enable systemd lingering so the user service keeps running even when you log out of SSH:
```bash
loginctl enable-linger $USER
```

---

## ⬆️ 6. Updating the Assistant

To pull new improvements and restart the daemon:

```bash
cd /path/to/hyposea-agent
git pull
npm install
npm run build
systemctl --user restart hyposea.service
```

---

## 📦 7. Backup and Disaster Recovery

All state, SQLite databases, and configurations are stored under `~/.hyposea/`.

### Create Backup:
```bash
./bin/hyposea backup
# Creates hyposea-backup-<timestamp>.tar.gz
```

### Restore Backup:
```bash
./bin/hyposea restore /path/to/hyposea-backup-<timestamp>.tar.gz
systemctl --user restart hyposea.service
```

---

## 🔑 8. Re-Login Procedure (When AGY Auth Expires)

If your AGY token or session expires:
1. Hyposea will notify you once in Discord: `❌ AGY needs re-login on the server`.
2. SSH into your server:
   ```bash
   agy
   ```
3. Complete the interactive sign-in turn.
4. Test:
   ```bash
   agy -p "OK"
   ```
5. Resume chatting in Discord; no service restart is required.
