import fs from 'node:fs';
import path from 'node:path';
import { InboundAttachment } from '../../channels/channel.js';

export interface AttachmentManagerOptions {
  workDir?: string;
  maxSizeBytes?: number;
}

export class AttachmentManager {
  private baseDir: string;
  private maxSizeBytes: number;

  constructor(options: AttachmentManagerOptions = {}) {
    this.baseDir = options.workDir || process.cwd();
    this.maxSizeBytes = options.maxSizeBytes || 25 * 1024 * 1024; // 25 MB Discord limit
  }

  /**
   * Downloads attachments from Discord to a temporary workspace directory for AGY to read
   */
  public async downloadAttachments(
    attachments: InboundAttachment[],
    turnId: string
  ): Promise<string[]> {
    if (!attachments || attachments.length === 0) return [];

    const targetDir = path.resolve(this.baseDir, '.hyposea-attachments', turnId);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const downloadedPaths: string[] = [];

    for (const att of attachments) {
      if (att.size > this.maxSizeBytes) {
        console.warn(`[AttachmentManager] Skipping oversized attachment ${att.name} (${att.size} bytes)`);
        continue;
      }

      try {
        const safeName = att.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const destPath = path.join(targetDir, safeName);

        const res = await fetch(att.url);
        if (!res.ok) {
          console.warn(`[AttachmentManager] Failed to download ${att.name}: HTTP ${res.status}`);
          continue;
        }

        const buffer = await res.arrayBuffer();
        fs.writeFileSync(destPath, Buffer.from(buffer));
        downloadedPaths.push(destPath);
      } catch (err: any) {
        console.error(`[AttachmentManager] Error saving attachment ${att.name}:`, err.message);
      }
    }

    return downloadedPaths;
  }

  /**
   * Appends local file descriptions to prompt so AGY can access and inspect them
   */
  public enrichPrompt(prompt: string, localPaths: string[]): string {
    if (!localPaths || localPaths.length === 0) return prompt;

    const list = localPaths.map((p) => `• ${path.basename(p)}: \`${p}\``).join('\n');
    const attachmentNote = `\n\n[📎 Inbound User Attachments Available on Disk:\n${list}\nYou can view, read, or analyze these files using your tools.]`;

    return `${prompt}${attachmentNote}`;
  }

  /**
   * Detects generated output files specified by AGY to attach to Discord response.
   * Recognizes syntax:
   * [send_file: /path/to/file.ext]
   * [attachment: /path/to/file.ext]
   * <attachment>/path/to/file.ext</attachment>
   */
  public detectOutboundAttachments(response: string): { cleanedResponse: string; files: string[] } {
    const files: string[] = [];
    let cleaned = response;

    const regexPatterns = [
      /\[(?:send_file|attachment):\s*([^\s\]]+)\]/gi,
      /<attachment>([^<]+)<\/attachment>/gi
    ];

    for (const regex of regexPatterns) {
      cleaned = cleaned.replace(regex, (_, filePath) => {
        const trimmed = filePath.trim();
        const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(this.baseDir, trimmed);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          files.push(resolved);
        }
        return '';
      });
    }

    return {
      cleanedResponse: cleaned.trim(),
      files
    };
  }

  /**
   * Cleans up temporary inbound attachments for a turn
   */
  public cleanup(turnId: string): void {
    const targetDir = path.resolve(this.baseDir, '.hyposea-attachments', turnId);
    if (fs.existsSync(targetDir)) {
      try {
        fs.rmSync(targetDir, { recursive: true, force: true });
      } catch {}
    }
  }
}
