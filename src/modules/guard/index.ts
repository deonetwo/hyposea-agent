import path from 'node:path';

export interface GuardOptions {
  allowedDirectories?: string[];
  strictMode?: boolean;
}

export interface GuardEvaluation {
  isDangerous: boolean;
  requiresConfirmation: boolean;
  isBypassed: boolean;
  reason?: string;
}

/**
 * Checks if the user provided an explicit force or confirmation flag
 */
export function hasExplicitConfirmationFlag(prompt: string): boolean {
  return /(--force|-f|--confirm|--yes|-y)\b/i.test(prompt);
}

/**
 * Legacy & compatible deletion intent detection.
 * Evaluates whether a prompt contains destructive filesystem, database, or resource removal operations.
 *
 * Known Heuristic Limits:
 * - Regex keyword matching cannot detect semantic destruction (e.g. overwriting files with empty text).
 * - Innocuous language ("clean up code style", "format table") can trigger false positives if unconstrained.
 * - True boundary enforcement requires OS sandbox and directory allowlisting.
 */
export function isDeletionIntent(prompt: string): boolean {
  const DELETION_REGEX = /\b(delete|del|rm|remove|drop|truncate|purge|destroy|unlink|wipe|erase|clear|clean|flush|prune|empty|shred|format|discard)\b/i;
  return DELETION_REGEX.test(prompt);
}

export class GuardModule {
  public readonly name = 'guard';
  private allowedDirectories: string[];
  private strictMode: boolean;

  constructor(options: GuardOptions = {}) {
    this.allowedDirectories = (options.allowedDirectories || [process.cwd()]).map((d) => path.resolve(d));
    this.strictMode = options.strictMode ?? false;
  }

  /**
   * Evaluates a prompt against safety policies, directory boundaries, and destructive operations.
   */
  public evaluate(prompt: string, cwd = process.cwd()): GuardEvaluation {
    const isBypassed = hasExplicitConfirmationFlag(prompt);

    // 1. Check directory escape attempts if path references outside allowed directories are found
    const targetPathMatch = prompt.match(/(?:\/|[A-Za-z]:\\)[^\s"']+/g);
    if (targetPathMatch) {
      for (const rawPath of targetPathMatch) {
        // Exclude common safe command flags or URLs
        if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) continue;

        const resolved = path.resolve(cwd, rawPath);
        const isAllowed = this.allowedDirectories.some(
          (allowed) => resolved === allowed || resolved.startsWith(allowed + path.sep)
        );

        if (!isAllowed) {
          return {
            isDangerous: true,
            requiresConfirmation: true,
            isBypassed,
            reason: `Target path '${rawPath}' resolves outside allowed workspace directory`
          };
        }
      }
    }

    // 2. Check destructive intent
    if (isDeletionIntent(prompt)) {
      return {
        isDangerous: true,
        requiresConfirmation: !isBypassed,
        isBypassed,
        reason: 'Prompt contains a destructive or deletion operation request'
      };
    }

    return {
      isDangerous: false,
      requiresConfirmation: false,
      isBypassed: false
    };
  }

  /**
   * Verifies if a given directory path is within allowed boundaries
   */
  public isDirectoryAllowed(dirPath: string): boolean {
    const resolved = path.resolve(dirPath);
    return this.allowedDirectories.some(
      (allowed) => resolved === allowed || resolved.startsWith(allowed + path.sep)
    );
  }
}
