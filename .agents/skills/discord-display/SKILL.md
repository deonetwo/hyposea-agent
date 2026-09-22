---
name: discord-display
description: Guidelines and best practices for formatting agent responses for Discord chat readability. Activates whenever formatting output, summaries, code snippets, or status updates for Discord channels like #mainframe-channel.
---

# Discord Display & Chat Formatting Guidelines

When communicating through Discord (such as `#mainframe-channel`), follow these formatting principles to ensure messages are clean, readable, and visually engaging.

---

## 1. Visual Hierarchy & Formatting

* **Headers**: Avoid giant `# Header` and `## Header` (they appear excessively large on mobile devices). Use `### Header` or **Bold text with emoji bullets** instead:
  * Good: `### 🚀 Deployment Status` or `**Deployment Status:**`
  * Avoid: `# DEPLOYMENT STATUS`
* **Bullet Points**: Use emoji indicators to structure sections clearly:
  * `•` or `-` for regular list items
  * `✅` for completed tasks / passing checks
  * `⚠️` for warnings / caveats
  * `❌` for errors / failed checks
  * `🔍` for investigation / research points
  * `⚡` for quick tips or performance stats

---

## 2. Tables vs. Lists

> [!IMPORTANT]
> **Discord does not support markdown tables natively.** Markdown tables (`| Col1 | Col2 |`) wrap unpredictably and become unreadable on mobile screens.

* **Replace Tables with Key-Value Bullets**:
  ```text
  • **Repository:** `deonetwo/moon-link-discord-mcp`
  • **Branch:** `main` (commit `8fd60bd`)
  • **Build Status:** Passing (20/20 tests)
  ```
* If tabular data is strictly necessary, wrap it inside a code block (` ```text `) or format it as aligned columns:
  ```text
  ```text
  SERVICE           PORT    STATUS
  moon-link         3000    Active
  cloudflared       -       Active
  ```
  ```

---

## 3. Code Blocks & Syntax Highlighting

* **Always specify the language identifier** on code blocks (e.g. ` ```typescript `, ` ```bash `, ` ```json `).
* **Keep Code Snippets Compact**: On Discord, long code blocks flood the channel. Highlight only the relevant lines or diffs rather than entire multi-hundred line files.
* **Inline Code**: Use single backticks (`` `code` ``) for filenames, commands, environment variables, and IDs.

---

## 4. Message Length & Tone

* **Concise & Direct**: Discord is an interactive chat medium. Deliver the answer directly first, followed by concise supporting details.
* **No Unnecessary Filler**: Avoid verbose conversational filler like *"Certainly! As an AI language model, I would be delighted to assist you with..."*. Start directly with the result or action.
* **Sanitize Mentions**: Never output literal `@everyone` or `@here` without escaping.
