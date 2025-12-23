import { createLogger } from '../services/logger.js';

const log = createLogger('request-queue');

/**
 * A request queue that limits concurrent requests to prevent overwhelming APIs.
 * Implements a simple semaphore pattern with configurable concurrency.
 */
export class RequestQueue {
  private queue: Array<{
    fn: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }> = [];
  private activeCount = 0;
  private readonly maxConcurrent: number;
  private readonly name: string;

  // Metrics
  private totalRequests = 0;
  private completedRequests = 0;
  private failedRequests = 0;
  private totalWaitTime = 0;
  private totalExecutionTime = 0;

  constructor(maxConcurrent: number = 5, name: string = 'default') {
    this.maxConcurrent = maxConcurrent;
    this.name = name;
    log.debug({ name, maxConcurrent }, 'Request queue initialized');
  }

  /**
   * Add a request to the queue and wait for it to complete.
   * @param fn - The async function to execute
   * @returns The result of the function
   */
  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const enqueueTime = Date.now();
    this.totalRequests++;

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.processQueue(enqueueTime);
    });
  }

  private async processQueue(enqueueTime?: number): Promise<void> {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.activeCount++;
    const startTime = Date.now();

    if (enqueueTime) {
      this.totalWaitTime += startTime - enqueueTime;
    }

    try {
      const result = await item.fn();
      this.completedRequests++;
      this.totalExecutionTime += Date.now() - startTime;
      item.resolve(result);
    } catch (error) {
      this.failedRequests++;
      this.totalExecutionTime += Date.now() - startTime;
      item.reject(error);
    } finally {
      this.activeCount--;
      // Process next item in queue
      if (this.queue.length > 0) {
        this.processQueue();
      }
    }
  }

  /**
   * Get current queue statistics
   */
  getStats(): {
    name: string;
    queueLength: number;
    activeCount: number;
    maxConcurrent: number;
    totalRequests: number;
    completedRequests: number;
    failedRequests: number;
    avgWaitTimeMs: number;
    avgExecutionTimeMs: number;
  } {
    const completed = this.completedRequests + this.failedRequests;
    return {
      name: this.name,
      queueLength: this.queue.length,
      activeCount: this.activeCount,
      maxConcurrent: this.maxConcurrent,
      totalRequests: this.totalRequests,
      completedRequests: this.completedRequests,
      failedRequests: this.failedRequests,
      avgWaitTimeMs: completed > 0 ? Math.round(this.totalWaitTime / completed) : 0,
      avgExecutionTimeMs: completed > 0 ? Math.round(this.totalExecutionTime / completed) : 0,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.totalRequests = 0;
    this.completedRequests = 0;
    this.failedRequests = 0;
    this.totalWaitTime = 0;
    this.totalExecutionTime = 0;
  }

  /**
   * Get current queue length
   */
  get length(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is empty and no requests are active
   */
  get isIdle(): boolean {
    return this.queue.length === 0 && this.activeCount === 0;
  }

  /**
   * Wait for all queued requests to complete
   */
  async drain(): Promise<void> {
    while (!this.isIdle) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Clear the queue (pending requests will be rejected)
   */
  clear(): void {
    const error = new Error('Queue cleared');
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
        item.reject(error);
      }
    }
  }
}

/**
 * Default request queue for Dispatcharr API calls.
 * Limits to 5 concurrent requests to prevent overwhelming the server.
 */
export const dispatcharrQueue = new RequestQueue(5, 'dispatcharr');
