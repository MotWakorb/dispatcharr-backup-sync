import { createLogger } from '../services/logger.js';

const log = createLogger('cache');

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

/**
 * Simple in-memory cache with TTL support.
 * Suitable for caching API responses and other frequently accessed data.
 */
export class Cache<T = unknown> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private readonly defaultTtlMs: number;
  private readonly maxSize: number;
  private readonly name: string;
  private cleanupInterval: NodeJS.Timeout | null = null;

  // Metrics
  private hits = 0;
  private misses = 0;
  private sets = 0;
  private evictions = 0;

  constructor(
    options: { ttlMs?: number; maxSize?: number; name?: string; cleanupIntervalMs?: number } = {}
  ) {
    this.defaultTtlMs = options.ttlMs ?? 60000; // 1 minute default
    this.maxSize = options.maxSize ?? 1000;
    this.name = options.name ?? 'cache';

    // Start periodic cleanup
    const cleanupIntervalMs = options.cleanupIntervalMs ?? 60000;
    this.cleanupInterval = setInterval(() => this.cleanup(), cleanupIntervalMs);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }

    log.debug(
      { name: this.name, ttlMs: this.defaultTtlMs, maxSize: this.maxSize },
      'Cache initialized'
    );
  }

  /**
   * Get a value from cache
   * @returns The cached value or undefined if not found/expired
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    this.hits++;
    return entry.value;
  }

  /**
   * Set a value in cache
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttlMs - Optional TTL in milliseconds (uses default if not provided)
   */
  set(key: string, value: T, ttlMs?: number): void {
    // Enforce max size with LRU-like eviction (delete oldest entries)
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    const now = Date.now();
    this.cache.set(key, {
      value,
      expiresAt: now + (ttlMs ?? this.defaultTtlMs),
      createdAt: now,
    });
    this.sets++;
  }

  /**
   * Get a value from cache, or compute and cache it if not found
   * @param key - Cache key
   * @param factory - Function to compute the value if not cached
   * @param ttlMs - Optional TTL in milliseconds
   */
  async getOrSet(key: string, factory: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, ttlMs);
    return value;
  }

  /**
   * Synchronous version of getOrSet
   */
  getOrSetSync(key: string, factory: () => T, ttlMs?: number): T {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = factory();
    this.set(key, value, ttlMs);
    return value;
  }

  /**
   * Delete a specific key from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Delete all keys matching a pattern (prefix match)
   */
  deleteByPrefix(prefix: string): number {
    let deleted = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Clear all cached values
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    name: string;
    size: number;
    maxSize: number;
    hits: number;
    misses: number;
    sets: number;
    evictions: number;
    hitRate: number;
  } {
    const total = this.hits + this.misses;
    return {
      name: this.name,
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      sets: this.sets,
      evictions: this.evictions,
      hitRate: total > 0 ? Math.round((this.hits / total) * 100) : 0,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
    this.evictions = 0;
  }

  /**
   * Remove expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.debug({ name: this.name, cleaned }, 'Cache cleanup');
    }
  }

  /**
   * Evict oldest entries when max size is reached
   */
  private evictOldest(): void {
    // Find oldest entry
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.evictions++;
    }
  }

  /**
   * Shutdown cache (stop cleanup interval)
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
  }
}

/**
 * Pre-configured caches for common use cases
 */

// Cache for connection test results (5 minute TTL)
export const connectionTestCache = new Cache<{ success: boolean; message?: string }>({
  ttlMs: 5 * 60 * 1000,
  maxSize: 100,
  name: 'connection-test',
});

// Cache for API responses (1 minute TTL)
export const apiResponseCache = new Cache<unknown>({
  ttlMs: 60 * 1000,
  maxSize: 500,
  name: 'api-response',
});

// Cache for frequently accessed configuration (10 minute TTL)
export const configCache = new Cache<unknown>({
  ttlMs: 10 * 60 * 1000,
  maxSize: 50,
  name: 'config',
});
