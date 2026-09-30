import { spawn } from 'node:child_process';
import { AgentRunner } from './runner.js';
import {
  ModelQuotaBucket,
  ModelQuotaData,
  ModelQuotaGroup,
  ModelQuotaResult,
  ProbeResult,
  RunRequest,
  RunResult
} from '../core/types.js';

export interface AgyRunnerOptions {
  binPath?: string;
  defaultCwd?: string;
  dangerouslySkipPermissions?: boolean;
  timeoutMs?: number;
}

export function getSanitizedEnvironment(): NodeJS.ProcessEnv {
  const SENSITIVE_KEYS = new Set([
    'DISCORD_BOT_TOKEN',
    'MCP_AUTH_TOKEN',
    'GITHUB_PAT',
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY'
  ]);

  const sanitized: NodeJS.ProcessEnv = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (val === undefined) continue;
    const lowerKey = key.toLowerCase();
    if (
      SENSITIVE_KEYS.has(key) ||
      lowerKey.includes('token') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('password') ||
      lowerKey.includes('auth')
    ) {
      continue;
    }
    sanitized[key] = val;
  }

  sanitized['PAGER'] = 'cat';
  sanitized['TERM'] = 'xterm-256color';
  return sanitized;
}

export class AgyRunner implements AgentRunner {
  private binPath: string;
  private defaultCwd: string;
  private dangerouslySkipPermissions: boolean;
  private timeoutMs: number;

  constructor(options: AgyRunnerOptions = {}) {
    this.binPath = options.binPath || process.env.AGY_BIN_PATH || '/home/ubuntu/.local/bin/agy';
    this.defaultCwd = options.defaultCwd || process.cwd();
    this.dangerouslySkipPermissions = options.dangerouslySkipPermissions ?? false;
    this.timeoutMs = options.timeoutMs ?? 300000; // 5 min default
  }

  /**
   * Executes a prompt against the AGY CLI non-interactively in json output mode.
   * Isolates all AGY-specific flags and process control.
   */
  public async run(req: RunRequest): Promise<RunResult> {
    const cwd = req.cwd || this.defaultCwd;
    const skipPermissions = req.dangerouslySkipPermissions ?? this.dangerouslySkipPermissions;

    const args: string[] = [];

    if (skipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    args.push('--add-dir', cwd);
    args.push('--output-format', 'json');

    if (req.sessionId) {
      args.push('--conversation', req.sessionId);
    }

    args.push('-p', req.prompt);

    return new Promise<RunResult>((resolve) => {
      let isSettled = false;
      let stdoutData = '';
      let stderrData = '';

      const child = spawn(this.binPath, args, {
        cwd,
        env: getSanitizedEnvironment(),
        detached: process.platform !== 'win32'
      });

      const killProcessTree = () => {
        if (!child.pid) return;
        try {
          if (process.platform !== 'win32') {
            process.kill(-child.pid, 'SIGTERM');
            setTimeout(() => {
              try {
                if (child.pid) process.kill(-child.pid, 'SIGKILL');
              } catch {}
            }, 1000).unref();
          } else {
            child.kill('SIGKILL');
          }
        } catch {}
      };

      const timer = setTimeout(() => {
        if (isSettled) return;
        isSettled = true;
        killProcessTree();
        resolve({
          response: '',
          error: `AGY execution timed out after ${Math.round(this.timeoutMs / 1000)}s`
        });
      }, this.timeoutMs);

      if (req.signal) {
        if (req.signal.aborted) {
          isSettled = true;
          clearTimeout(timer);
          killProcessTree();
          return resolve({
            response: '',
            aborted: true,
            error: 'AGY execution aborted before starting'
          });
        }

        req.signal.addEventListener(
          'abort',
          () => {
            if (isSettled) return;
            isSettled = true;
            clearTimeout(timer);
            killProcessTree();
            resolve({
              response: '',
              aborted: true,
              error: 'AGY execution aborted by user'
            });
          },
          { once: true }
        );
      }

      child.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderrData += chunk.toString();
      });

      child.on('error', (err) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);
        resolve({
          response: '',
          error: err.message
        });
      });

      child.on('close', (code) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);

        const rawOutput = stdoutData.trim();
        const rawErr = stderrData.trim();

        if (code !== 0 && !rawOutput) {
          // Detect authentication errors
          const isAuthError =
            rawErr.toLowerCase().includes('login') ||
            rawErr.toLowerCase().includes('unauthorized') ||
            rawErr.toLowerCase().includes('authenticated');

          return resolve({
            response: '',
            error: isAuthError
              ? 'AGY authentication failed or expired. Please re-login on the server.'
              : rawErr || `AGY exited with code ${code}`
          });
        }

        try {
          const parsed = JSON.parse(rawOutput);
          return resolve({
            response: parsed.response || rawOutput,
            conversationId: parsed.conversation_id,
            durationSeconds: parsed.duration_seconds,
            tokensUsed: parsed.usage?.total_tokens
          });
        } catch {
          // Fallback if stdout was not JSON
          return resolve({
            response: rawOutput || rawErr || '(Empty response)',
            conversationId: req.sessionId
          });
        }
      });
    });
  }

  /**
   * Probes AGY readiness and login status.
   * Returns 'ok', 'not_logged_in', or 'unknown' with reason.
   */
  public async probe(): Promise<ProbeResult> {
    return new Promise<ProbeResult>((resolve) => {
      const child = spawn(this.binPath, ['models'], {
        cwd: this.defaultCwd,
        env: getSanitizedEnvironment()
      });

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {}
        resolve({
          status: 'unknown',
          reason: 'AGY probe timed out after 15s'
        });
      }, 15000);

      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          status: 'unknown',
          reason: `Failed to execute AGY binary at ${this.binPath}: ${err.message}`
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const combined = (stdout + '\n' + stderr).toLowerCase();

        if (
          combined.includes('not logged in') ||
          combined.includes('please log in') ||
          combined.includes('unauthorized') ||
          combined.includes('auth error') ||
          combined.includes('token expired')
        ) {
          return resolve({
            status: 'not_logged_in',
            reason: 'AGY requires authentication. Run "agy" interactively to log in.'
          });
        }

        if (code === 0 && (combined.includes('gemini') || combined.includes('claude') || combined.includes('gpt'))) {
          return resolve({
            status: 'ok',
            reason: 'AGY CLI is installed and authenticated.'
          });
        }

        if (code !== 0) {
          return resolve({
            status: 'unknown',
            reason: stderr.trim() || `AGY returned exit code ${code}`
          });
        }

        return resolve({
          status: 'ok',
          reason: 'AGY CLI responded successfully.'
        });
      });
    });
  }

  /**
   * Fetches model quota directly using AGY CLI
   */
  public async fetchQuota(cwd?: string): Promise<ModelQuotaResult> {
    const targetCwd = cwd || this.defaultCwd;
    const args = ['--output-format', 'json', '-p', '/quota'];

    if (this.dangerouslySkipPermissions) {
      args.unshift('--dangerously-skip-permissions');
    }
    args.unshift('--add-dir', targetCwd);

    return new Promise<ModelQuotaResult>((resolve) => {
      const child = spawn(this.binPath, args, {
        cwd: targetCwd,
        env: getSanitizedEnvironment()
      });

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {}
        resolve({
          success: false,
          error: 'Model quota query timed out after 30s'
        });
      }, 30000);

      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          error: err.message
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const rawOutput = stdout.trim();
        const rawErr = stderr.trim();

        if (code !== 0 && !rawOutput) {
          return resolve({
            success: false,
            error: rawErr || `AGY exited with code ${code}`
          });
        }

        try {
          const parsed = JSON.parse(rawOutput);
          if (parsed.command?.name === 'usage' && parsed.command?.data?.groups) {
            return resolve({
              success: true,
              data: parsed.command.data,
              rawText: parsed.response
            });
          }

          if (parsed.response && typeof parsed.response === 'string') {
            const parsedData = parseTabSeparatedQuota(parsed.response);
            if (parsedData.groups.length > 0) {
              return resolve({
                success: true,
                data: parsedData,
                rawText: parsed.response
              });
            }
          }

          return resolve({
            success: true,
            rawText: parsed.response || rawOutput
          });
        } catch {
          const parsedData = parseTabSeparatedQuota(rawOutput);
          if (parsedData.groups.length > 0) {
            return resolve({
              success: true,
              data: parsedData,
              rawText: rawOutput
            });
          }

          return resolve({
            success: true,
            rawText: rawOutput || rawErr || 'No quota information returned'
          });
        }
      });
    });
  }
}

/**
 * Parses tab-separated or aligned space table output from agy -p "/quota"
 */
export function parseTabSeparatedQuota(text: string): ModelQuotaData {
  const groupsMap = new Map<string, ModelQuotaBucket[]>();
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.toLowerCase().startsWith('quota:')) continue;
    const parts = trimmed.split(/\t+|\s{2,}/);
    if (parts.length >= 3) {
      const groupName = parts[0].trim();
      const bucketName = parts[1].trim();
      const pctMatch = parts[2].match(/(\d+)%/);
      const remaining_fraction = pctMatch ? parseInt(pctMatch[1], 10) / 100 : 1;
      const reset_time = parts[3] ? parts[3].trim() : undefined;

      const bucket: ModelQuotaBucket = {
        id: bucketName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: bucketName,
        remaining_fraction,
        reset_time
      };

      if (!groupsMap.has(groupName)) {
        groupsMap.set(groupName, []);
      }
      groupsMap.get(groupName)!.push(bucket);
    }
  }

  const groups: ModelQuotaGroup[] = Array.from(groupsMap.entries()).map(([name, buckets]) => ({
    name,
    buckets
  }));

  return { groups };
}
