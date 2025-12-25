import { DispatcharrClient } from './dispatcharrClient.js';
import type { DispatcharrConnection } from '../types/index.js';
import { createLogger } from './logger.js';

const log = createLogger('connection-pool');

// ============ Connection Pool Configuration ============
//
// The connection pool caches authenticated DispatcharrClient instances
// to avoid repeated authentication for the same connection.
//
// Features:
// - Caches clients by connection key (URL + username hash)
// - Automatic TTL-based expiration (default: 5 minutes)
// - Periodic cleanup of expired connections
// - Thread-safe operations
// - Max pool size limit to prevent memory leaks
//
// ========================================================

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute
const MAX_POOL_SIZE = 50; // Maximum number of cached connections

interface PooledConnection {
  client: DispatcharrClient;
  createdAt: number;
  lastUsed: number;
  connectionKey: string;
}

/**
 * Generate a unique key for a connection based on URL and username.
 * Does not include password for security (key is used in logs).
 */
function getConnectionKey(connection: DispatcharrConnection): string {
  // Simple hash to identify the connection without exposing credentials
  const urlHash = Buffer.from(connection.url).toString('base64').slice(0, 16);
  const userHash = Buffer.from(connection.username).toString('base64').slice(0, 8);
  return `${urlHash}:${userHash}`;
}

/**
 * Connection pool manager for DispatcharrClient instances.
 * Reduces authentication overhead by caching authenticated clients.
 */
class ConnectionPool {
  private pool: Map<string, PooledConnection> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
    this.startCleanup();
  }

  /**
   * Get or create a client for the given connection.
   * Returns a cached client if available and not expired.
   */
  async getClient(connection: DispatcharrConnection): Promise<DispatcharrClient> {
    const key = getConnectionKey(connection);

    // Check for existing connection
    const existing = this.pool.get(key);
    if (existing && !this.isExpired(existing)) {
      existing.lastUsed = Date.now();
      log.debug({ connectionKey: key }, 'Reusing pooled connection');
      return existing.client;
    }

    // Remove expired connection if exists
    if (existing) {
      this.pool.delete(key);
      log.debug({ connectionKey: key }, 'Removed expired connection from pool');
    }

    // Enforce max pool size (remove oldest if at limit)
    if (this.pool.size >= MAX_POOL_SIZE) {
      this.evictOldest();
    }

    // Create new client and authenticate
    log.debug({ connectionKey: key }, 'Creating new pooled connection');
    const client = new DispatcharrClient(connection);
    await client.authenticate();

    // Cache the authenticated client
    this.pool.set(key, {
      client,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      connectionKey: key,
    });

    log.debug({ connectionKey: key, poolSize: this.pool.size }, 'Connection added to pool');
    return client;
  }

  /**
   * Remove a specific connection from the pool.
   * Useful when credentials change or connection fails.
   */
  invalidate(connection: DispatcharrConnection): void {
    const key = getConnectionKey(connection);
    if (this.pool.delete(key)) {
      log.debug({ connectionKey: key }, 'Connection invalidated and removed from pool');
    }
  }

  /**
   * Clear all connections from the pool.
   */
  clear(): void {
    const size = this.pool.size;
    this.pool.clear();
    log.info({ clearedConnections: size }, 'Connection pool cleared');
  }

  /**
   * Get current pool statistics.
   */
  getStats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: this.pool.size,
      maxSize: MAX_POOL_SIZE,
      ttlMs: this.ttlMs,
    };
  }

  /**
   * Check if a pooled connection has expired.
   */
  private isExpired(pooled: PooledConnection): boolean {
    return Date.now() - pooled.lastUsed > this.ttlMs;
  }

  /**
   * Evict the oldest (least recently used) connection.
   */
  private evictOldest(): void {
    let oldest: PooledConnection | null = null;
    let oldestKey: string | null = null;

    for (const [key, pooled] of this.pool.entries()) {
      if (!oldest || pooled.lastUsed < oldest.lastUsed) {
        oldest = pooled;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.pool.delete(oldestKey);
      log.debug({ connectionKey: oldestKey }, 'Evicted oldest connection from pool');
    }
  }

  /**
   * Start periodic cleanup of expired connections.
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      let expired = 0;
      for (const [key, pooled] of this.pool.entries()) {
        if (this.isExpired(pooled)) {
          this.pool.delete(key);
          expired++;
        }
      }
      if (expired > 0) {
        log.debug({ expiredConnections: expired, poolSize: this.pool.size }, 'Cleanup completed');
      }
    }, CLEANUP_INTERVAL_MS);

    // Don't prevent process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Stop the cleanup interval and clear the pool.
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
    log.info('Connection pool shutdown complete');
  }
}

// Export singleton instance
export const connectionPool = new ConnectionPool();
