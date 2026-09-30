interface QueueItem<T = any> {
  task: (signal: AbortSignal) => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  controller: AbortController;
}

export class PerKeyQueue {
  private queues = new Map<string, QueueItem[]>();
  private activeControllers = new Map<string, AbortController>();

  /**
   * Enqueues a task for a given key (e.g. thread or channel ID).
   * Ensures tasks for the same key execute strictly sequentially.
   */
  public enqueue<T>(key: string, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      const item: QueueItem<T> = { task, resolve, reject, controller };

      const queue = this.queues.get(key) || [];
      queue.push(item);
      this.queues.set(key, queue);

      if (queue.length === 1) {
        this.processNext(key);
      }
    });
  }

  private async processNext(key: string): Promise<void> {
    const queue = this.queues.get(key);
    if (!queue || queue.length === 0) {
      this.queues.delete(key);
      this.activeControllers.delete(key);
      return;
    }

    const current = queue[0];
    this.activeControllers.set(key, current.controller);

    try {
      const result = await current.task(current.controller.signal);
      current.resolve(result);
    } catch (err) {
      current.reject(err);
    } finally {
      // Remove finished item
      queue.shift();
      this.activeControllers.delete(key);

      if (queue.length > 0) {
        this.processNext(key);
      } else {
        this.queues.delete(key);
      }
    }
  }

  /**
   * Aborts the active running task for a key.
   * Returns true if an active task was aborted, false otherwise.
   */
  public abort(key: string, reason = 'Execution aborted by user'): boolean {
    const controller = this.activeControllers.get(key);
    if (controller) {
      controller.abort(new Error(reason));
      return true;
    }
    return false;
  }

  /**
   * Checks if an execution is currently active for this key.
   */
  public isBusy(key: string): boolean {
    return this.activeControllers.has(key);
  }

  /**
   * Gets current queue depth for a key.
   */
  public depth(key: string): number {
    return this.queues.get(key)?.length || 0;
  }
}
