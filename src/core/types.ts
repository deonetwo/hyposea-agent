export interface RunRequest {
  prompt: string;
  sessionId?: string;
  cwd?: string;
  signal?: AbortSignal;
  dangerouslySkipPermissions?: boolean;
}

export interface RunResult {
  response: string;
  conversationId?: string;
  durationSeconds?: number;
  tokensUsed?: number;
  error?: string;
  aborted?: boolean;
}

export interface ProbeResult {
  status: 'ok' | 'not_logged_in' | 'unknown';
  reason?: string;
  version?: string;
}

export interface SessionRecord {
  id: string;
  conversationId: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  metadata?: Record<string, any>;
}

export interface ModelQuotaBucket {
  id: string;
  name: string;
  description?: string;
  window?: string;
  remaining_fraction: number;
  reset_time?: string;
}

export interface ModelQuotaGroup {
  name: string;
  description?: string;
  buckets: ModelQuotaBucket[];
}

export interface ModelQuotaData {
  description?: string;
  groups: ModelQuotaGroup[];
}

export interface ModelQuotaResult {
  success: boolean;
  data?: ModelQuotaData;
  rawText?: string;
  error?: string;
}
