import { logger } from "./logger.js";

/**
 * Queued request item
 */
interface QueuedRequest<T> {
  id: string;
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  priority: number;
  timestamp: number;
  retries: number;
}

/**
 * Request queue configuration
 */
export interface RequestQueueConfig {
  maxConcurrent: number;
  maxQueueSize: number;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  priorityLevels: number;
}

/**
 * Default queue configuration
 */
export const DEFAULT_QUEUE_CONFIG: RequestQueueConfig = {
  maxConcurrent: 10,
  maxQueueSize: 1000,
  timeoutMs: 30000, // 30 seconds
  maxRetries: 3,
  retryDelayMs: 1000,
  priorityLevels: 3,
};

/**
 * Queue statistics
 */
export interface QueueStats {
  queueLength: number;
  activeRequests: number;
  completedRequests: number;
  failedRequests: number;
  timedOutRequests: number;
  averageWaitTimeMs: number;
  averageProcessTimeMs: number;
}

/**
 * Priority-based request queue for handling high-load scenarios
 */
export class RequestQueue {
  private queue: QueuedRequest<unknown>[] = [];
  private activeRequests: number = 0;
  private stats: QueueStats = {
    queueLength: 0,
    activeRequests: 0,
    completedRequests: 0,
    failedRequests: 0,
    timedOutRequests: 0,
    averageWaitTimeMs: 0,
    averageProcessTimeMs: 0,
  };
  private waitTimes: number[] = [];
  private processTimes: number[] = [];
  private isProcessing: boolean = false;
  private requestIdCounter: number = 0;

  constructor(private config: RequestQueueConfig = DEFAULT_QUEUE_CONFIG) {}

  /**
   * Add a request to the queue
   */
  async enqueue<T>(
    task: () => Promise<T>,
    priority: number = 0
  ): Promise<T> {
    // Check if queue is full
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error("Request queue is full");
    }

    return new Promise<T>((resolve, reject) => {
      const request: QueuedRequest<unknown> = {
        id: `req-${++this.requestIdCounter}`,
        task: task as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject: reject as (error: Error) => void,
        priority: Math.min(priority, this.config.priorityLevels - 1),
        timestamp: Date.now(),
        retries: 0,
      };

      // Insert in priority order
      this.insertByPriority(request);
      this.stats.queueLength = this.queue.length;

      logger.debug("Request enqueued", {
        requestId: request.id,
        priority: request.priority,
        queueLength: this.queue.length,
      });

      // Start processing if not already
      this.processQueue();
    });
  }

  /**
   * Insert request by priority (higher priority first)
   */
  private insertByPriority<T>(request: QueuedRequest<T>): void {
    let insertIndex = this.queue.length;
    
    for (let i = 0; i < this.queue.length; i++) {
      if (request.priority > this.queue[i].priority) {
        insertIndex = i;
        break;
      }
    }

    this.queue.splice(insertIndex, 0, request as QueuedRequest<unknown>);
  }

  /**
   * Process the queue
   */
  private processQueue(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;

    this.processNext();
  }

  /**
   * Process next request in queue
   */
  private processNext(): void {
    // Check if we can process more
    while (
      this.activeRequests < this.config.maxConcurrent &&
      this.queue.length > 0
    ) {
      const request = this.queue.shift();
      if (!request) break;

      this.stats.queueLength = this.queue.length;
      this.activeRequests++;
      this.stats.activeRequests = this.activeRequests;

      this.executeRequest(request);
    }

    // Update processing state
    this.isProcessing = this.activeRequests > 0 || this.queue.length > 0;
  }

  /**
   * Execute a single request
   */
  private async executeRequest(request: QueuedRequest<unknown>): Promise<void> {
    const waitTime = Date.now() - request.timestamp;
    this.waitTimes.push(waitTime);
    this.updateAverageWaitTime();

    logger.debug("Executing request", {
      requestId: request.id,
      waitTimeMs: waitTime,
      retries: request.retries,
    });

    const startTime = Date.now();

    try {
      // Set up timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Request ${request.id} timed out after ${this.config.timeoutMs}ms`));
        }, this.config.timeoutMs);
      });

      // Execute with timeout
      const result = await Promise.race([
        request.task(),
        timeoutPromise,
      ]);

      const processTime = Date.now() - startTime;
      this.processTimes.push(processTime);
      this.updateAverageProcessTime();

      this.stats.completedRequests++;
      request.resolve(result);

      logger.debug("Request completed", {
        requestId: request.id,
        processTimeMs: processTime,
      });
    } catch (error) {
      const processTime = Date.now() - startTime;

      // Check if we should retry
      if (request.retries < this.config.maxRetries && this.isRetryableError(error)) {
        request.retries++;
        logger.warn("Request failed, retrying", {
          requestId: request.id,
          error: error instanceof Error ? error.message : String(error),
          retries: request.retries,
        });

        // Re-queue with delay
        setTimeout(() => {
          request.timestamp = Date.now();
          this.insertByPriority(request);
          this.stats.queueLength = this.queue.length;
          this.processQueue();
        }, this.config.retryDelayMs * request.retries);
      } else {
        // Request failed permanently
        this.stats.failedRequests++;
        
        if (error instanceof Error && error.message.includes("timed out")) {
          this.stats.timedOutRequests++;
        }

        logger.error("Request failed", error instanceof Error ? error : undefined, {
          requestId: request.id,
          processTimeMs: processTime,
          retries: request.retries,
        });

        request.reject(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this.activeRequests--;
      this.stats.activeRequests = this.activeRequests;
      this.processNext();
    }
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    // Network errors, timeouts, and 5xx errors are retryable
    const retryablePatterns = [
      /ECONNRESET/i,
      /ETIMEDOUT/i,
      /ENOTFOUND/i,
      /EAI_AGAIN/i,
      /network/i,
      /timeout/i,
      /503/i,
      /502/i,
      /504/i,
    ];

    return retryablePatterns.some(pattern => pattern.test(error.message));
  }

  /**
   * Update average wait time
   */
  private updateAverageWaitTime(): void {
    // Keep last 100 samples
    if (this.waitTimes.length > 100) {
      this.waitTimes.shift();
    }
    this.stats.averageWaitTimeMs = Math.round(
      this.waitTimes.reduce((a, b) => a + b, 0) / this.waitTimes.length
    );
  }

  /**
   * Update average process time
   */
  private updateAverageProcessTime(): void {
    // Keep last 100 samples
    if (this.processTimes.length > 100) {
      this.processTimes.shift();
    }
    this.stats.averageProcessTimeMs = Math.round(
      this.processTimes.reduce((a, b) => a + b, 0) / this.processTimes.length
    );
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    return { ...this.stats };
  }

  /**
   * Get queue length
   */
  get length(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is empty
   */
  get isEmpty(): boolean {
    return this.queue.length === 0 && this.activeRequests === 0;
  }

  /**
   * Clear the queue (reject all pending requests)
   */
  clear(): void {
    const error = new Error("Queue cleared");
    for (const request of this.queue) {
      request.reject(error);
    }
    this.queue = [];
    this.stats.queueLength = 0;
    logger.info("Request queue cleared");
  }
}

/**
 * Singleton request queue instance
 */
let queueInstance: RequestQueue | null = null;

/**
 * Initialize the request queue
 */
export function initializeRequestQueue(config?: Partial<RequestQueueConfig>): RequestQueue {
  if (!queueInstance) {
    queueInstance = new RequestQueue({ ...DEFAULT_QUEUE_CONFIG, ...config });
  }
  return queueInstance;
}

/**
 * Get the request queue instance
 */
export function getRequestQueue(): RequestQueue | null {
  return queueInstance;
}

/**
 * Enqueue a request using the singleton queue
 */
export async function enqueueRequest<T>(
  task: () => Promise<T>,
  priority?: number
): Promise<T> {
  const queue = queueInstance;
  if (!queue) {
    throw new Error("Request queue not initialized");
  }
  return queue.enqueue(task, priority);
}
