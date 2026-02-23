import { createClient, RedisClientType } from "redis";
import { logger } from "./logger.js";

/**
 * Redis error type
 */
interface RedisError extends Error {
  code?: string;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  url: string;
  prefix: string;
  defaultTtl: number;
  enabled: boolean;
  maxRetries: number;
  retryDelayMs: number;
}

/**
 * Default cache configuration
 */
export const DEFAULT_CACHE_CONFIG: Partial<CacheConfig> = {
  prefix: "atomic-crm:",
  defaultTtl: 300, // 5 minutes
  enabled: true,
  maxRetries: 3,
  retryDelayMs: 100,
};

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  errors: number;
  hitRate: number;
}

/**
 * Redis-based caching service
 */
export class CacheService {
  private client: RedisClientType | null = null;
  private config: CacheConfig;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    errors: 0,
    hitRate: 0,
  };
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;

  constructor(config: Partial<CacheConfig> & { url: string }) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config } as CacheConfig;
  }

  /**
   * Initialize the Redis connection
   */
  async connect(): Promise<void> {
    if (!this.config.enabled) {
      logger.info("Cache is disabled, skipping connection");
      return;
    }

    try {
      this.client = createClient({
        url: this.config.url,
        socket: {
          reconnectStrategy: (retries: number) => {
            if (retries > this.config.maxRetries) {
              logger.error("Redis max reconnection attempts reached", undefined, { retries });
              return new Error("Max reconnection attempts reached");
            }
            this.reconnectAttempts = retries;
            logger.warn("Redis reconnecting", { attempt: retries });
            return Math.min(retries * this.config.retryDelayMs, 3000);
          },
        },
      });

      this.client.on("connect", () => {
        this.isConnected = true;
        logger.info("Redis connected");
      });

      this.client.on("disconnect", () => {
        this.isConnected = false;
        logger.warn("Redis disconnected");
      });

      this.client.on("error", (err: RedisError) => {
        logger.error("Redis error", err);
        this.stats.errors++;
      });

      await this.client.connect();
    } catch (error) {
      logger.error("Failed to connect to Redis", error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
      logger.info("Redis disconnected");
    }
  }

  /**
   * Build cache key with prefix
   */
  private buildKey(key: string): string {
    return `${this.config.prefix}${key}`;
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.config.enabled || !this.client || !this.isConnected) {
      this.stats.misses++;
      return null;
    }

    try {
      const fullKey = this.buildKey(key);
      const value = await this.client.get(fullKey);

      if (value === null) {
        this.stats.misses++;
        this.updateHitRate();
        return null;
      }

      this.stats.hits++;
      this.updateHitRate();
      return JSON.parse(value) as T;
    } catch (error) {
      this.stats.errors++;
      logger.error("Cache get error", error instanceof Error ? error : undefined, { key });
      return null;
    }
  }

  /**
   * Set a value in cache
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<boolean> {
    if (!this.config.enabled || !this.client || !this.isConnected) {
      return false;
    }

    try {
      const fullKey = this.buildKey(key);
      const serialized = JSON.stringify(value);
      const actualTtl = ttl ?? this.config.defaultTtl;

      await this.client.setEx(fullKey, actualTtl, serialized);
      this.stats.sets++;
      return true;
    } catch (error) {
      this.stats.errors++;
      logger.error("Cache set error", error instanceof Error ? error : undefined, { key });
      return false;
    }
  }

  /**
   * Delete a value from cache
   */
  async delete(key: string): Promise<boolean> {
    if (!this.config.enabled || !this.client || !this.isConnected) {
      return false;
    }

    try {
      const fullKey = this.buildKey(key);
      await this.client.del(fullKey);
      this.stats.deletes++;
      return true;
    } catch (error) {
      this.stats.errors++;
      logger.error("Cache delete error", error instanceof Error ? error : undefined, { key });
      return false;
    }
  }

  /**
   * Delete all keys matching a pattern
   */
  async deletePattern(pattern: string): Promise<number> {
    if (!this.config.enabled || !this.client || !this.isConnected) {
      return 0;
    }

    try {
      const fullPattern = this.buildKey(pattern);
      const keys = await this.client.keys(fullPattern);
      
      if (keys.length === 0) {
        return 0;
      }

      await this.client.del(keys);
      this.stats.deletes += keys.length;
      return keys.length;
    } catch (error) {
      this.stats.errors++;
      logger.error("Cache deletePattern error", error instanceof Error ? error : undefined, { pattern });
      return 0;
    }
  }

  /**
   * Get or set a value (cache-aside pattern)
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, ttl);
    return value;
  }

  /**
   * Check if cache is healthy
   */
  async isHealthy(): Promise<boolean> {
    if (!this.config.enabled) {
      return true; // Disabled cache is considered healthy
    }

    if (!this.client || !this.isConnected) {
      return false;
    }

    try {
      const result = await this.client.ping();
      return result === "PONG";
    } catch {
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      hitRate: 0,
    };
  }

  /**
   * Update hit rate calculation
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? Math.round((this.stats.hits / total) * 100) : 0;
  }
}

/**
 * Singleton cache instance
 */
let cacheInstance: CacheService | null = null;

/**
 * Initialize the cache service
 */
export async function initializeCache(url: string, config?: Partial<CacheConfig>): Promise<CacheService> {
  if (cacheInstance) {
    return cacheInstance;
  }

  cacheInstance = new CacheService({ url, ...config });
  await cacheInstance.connect();
  return cacheInstance;
}

/**
 * Get the cache service instance
 */
export function getCache(): CacheService | null {
  return cacheInstance;
}

/**
 * Shutdown the cache service
 */
export async function shutdownCache(): Promise<void> {
  if (cacheInstance) {
    await cacheInstance.disconnect();
    cacheInstance = null;
  }
}
