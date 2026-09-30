import { ProbeResult, RunRequest, RunResult } from '../core/types.js';

export interface AgentRunner {
  run(req: RunRequest): Promise<RunResult>;
  probe(): Promise<ProbeResult>;
}
