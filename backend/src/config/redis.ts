/**
 * ============================================================================
 * NOVA CHECK EHR - REDIS CONFIGURATION
 * ============================================================================
 */

import Redis, { RedisOptions } from 'ioredis';
import { config } from './config';
import logger from './logger';

/**
 * Redis client configuration
 */
const redisOptions: RedisOptions = {
  host: new URL(config.redis.url).hostname,
  port: parseInt(new URL(config.redis.url).port) || 6379,
  password: config.redis.password,
  db: config.redis.db,
  keyPrefix: config.redis.keyPrefix,
  
  // Connection settings
  connectTimeout: 10000,
  commandTimeout: 5000,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  
  // Reconnection settings
  retryDelayOnClusterDown: 300,
  enableReadyCheck: true,
  maxRetriesPerRequest: null,
  
  // Lazy connection
  lazyConnect: true,
  
  // Keep alive
  keepAlive: 30000,
  
  // Family preference
  family: 4,
};

/**
 * Redis connection manager
 */
class RedisManager {
  private static instance: RedisManager;
  private _client: Redis | null = null;
  private _subscriber: Redis | null = null;
  private _publisher: Redis | null = null;
  private _isConnected = false;
  private _connectionAttempts = 0;
  private readonly _maxRetries = 5;
  private readonly _retryDelay = 5000;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): RedisManager {
    if (!RedisManager.instance) {
      RedisManager.instance = new RedisManager();
    }
    return RedisManager.instance;
  }

  /**
   * Get Redis client
   */
  public get client(): Redis {
    if (!this._client) {
      this._client = new Redis(redisOptions);
      this.setupEventHandlers(this._client, 'client');
    }
    return this._client;
  }

  /**
   * Get Redis subscriber client
   */
  public get subscriber(): Redis {
    if (!this._subscriber) {
      this._subscriber = new Redis(redisOptions);
      this.setupEventHandlers(this._subscriber, 'subscriber');
    }
    return this._subscriber;
  }

  /**
   * Get Redis publisher client
   */
  public get publisher(): Redis {
    if (!this._publisher) {
      this._publisher = new Redis(redisOptions);
      this.setupEventHandlers(this._publisher, 'publisher');
    }
    return this._publisher;
  }

  /**
   * Check if Redis is connected
   */
  public get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Setup Redis event handlers
   */
  private setupEventHandlers(client: Redis, clientType: string): void {
    client.on('connect', () => {
      logger.info(`Redis ${clientType} connecting...`);
    });

    client.on('ready', () => {
      this._isConnected = true;
      this._connectionAttempts = 0;
      logger.info(`Redis ${clientType} connected and ready`, {
        host: redisOptions.host,
        port: redisOptions.port,
        db: redisOptions.db,
      });
    });

    client.on('error', (error) => {
      this._isConnected = false;
      logger.error(`Redis ${clientType} error`, {
        error: error.message,
        clientType,
      });
    });

    client.on('close', () => {
      this._isConnected = false;
      logger.warn(`Redis ${clientType} connection closed`);
    });

    client.on('reconnecting', (delay) => {
      logger.info(`Redis ${clientType} reconnecting in ${delay}ms`);
    });

    client.on('end', () => {
      this._isConnected = false;
      logger.info(`Redis ${clientType} connection ended`);
    });
  }

  /**
   * Connect to Redis
   */
  public async connect(): Promise<void> {
    if (this._isConnected) {
      logger.info('Redis already connected');
      return;
    }

    while (this._connectionAttempts < this._maxRetries) {
      try {
        this._connectionAttempts++;
        
        logger.info(`Attempting to connect to Redis (attempt ${this._connectionAttempts}/${this._maxRetries})`);
        
        // Connect main client
        await this.client.connect();
        
        // Test the connection
        await this.client.ping();
        
        logger.info('Redis connected successfully');
        return;
      } catch (error) {
        logger.error(`Redis connection attempt ${this._connectionAttempts} failed`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          attempt: this._connectionAttempts,
          maxRetries: this._maxRetries,
        });

        if (this._connectionAttempts >= this._maxRetries) {
          throw new Error(`Failed to connect to Redis after ${this._maxRetries} attempts: ${error}`);
        }

        await this.delay(this._retryDelay);
      }
    }
  }

  /**
   * Disconnect from Redis
   */
  public async disconnect(): Promise<void> {
    const clients = [this._client, this._subscriber, this._publisher].filter(Boolean);
    
    if (clients.length === 0) {
      logger.info('No Redis clients to disconnect');
      return;
    }

    try {
      await Promise.all(clients.map(client => client!.quit()));
      
      this._client = null;
      this._subscriber = null;
      this._publisher = null;
      this._isConnected = false;
      
      logger.info('All Redis clients disconnected successfully');
    } catch (error) {
      logger.error('Error disconnecting Redis clients', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Check Redis health
   */
  public async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    latency?: number;
    error?: string;
    info?: any;
  }> {
    try {
      const start = Date.now();
      const pong = await this.client.ping();
      const latency = Date.now() - start;
      
      if (pong !== 'PONG') {
        throw new Error('Invalid ping response');
      }
      
      // Get Redis info
      const info = await this.client.info();
      const parsedInfo = this.parseRedisInfo(info);
      
      return {
        status: 'healthy',
        latency,
        info: parsedInfo,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Parse Redis INFO command output
   */
  private parseRedisInfo(info: string): Record<string, any> {
    const result: Record<string, any> = {};
    const lines = info.split('\r\n');
    
    let currentSection = '';
    
    for (const line of lines) {
      if (line.startsWith('#')) {
        currentSection = line.substring(2).toLowerCase();
        result[currentSection] = {};
      } else if (line.includes(':') && currentSection) {
        const [key, value] = line.split(':');
        result[currentSection][key] = value;
      }
    }
    
    return result;
  }

  /**
   * Get Redis memory usage
   */
  public async getMemoryUsage(): Promise<{
    used: number;
    peak: number;
    total: number;
    percentage: number;
  }> {
    try {
      const info = await this.client.info('memory');
      const memoryInfo = this.parseRedisInfo(info).memory;
      
      const used = parseInt(memoryInfo.used_memory) || 0;
      const peak = parseInt(memoryInfo.used_memory_peak) || 0;
      const total = parseInt(memoryInfo.total_system_memory) || 0;
      const percentage = total > 0 ? (used / total) * 100 : 0;
      
      return { used, peak, total, percentage };
    } catch (error) {
      logger.error('Failed to get Redis memory usage', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Clear all data from current database
   */
  public async flushDatabase(): Promise<void> {
    try {
      await this.client.flushdb();
      logger.info('Redis database flushed successfully');
    } catch (error) {
      logger.error('Failed to flush Redis database', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get database size
   */
  public async getDatabaseSize(): Promise<number> {
    try {
      return await this.client.dbsize();
    } catch (error) {
      logger.error('Failed to get Redis database size', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Graceful shutdown
   */
  public async gracefulShutdown(): Promise<void> {
    logger.info('Initiating Redis graceful shutdown...');
    
    try {
      await Promise.race([
        this.disconnect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Redis shutdown timeout')), 10000)
        ),
      ]);
      
      logger.info('Redis graceful shutdown completed');
    } catch (error) {
      logger.error('Error during Redis graceful shutdown', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}

// Create singleton instance
const redisManager = RedisManager.getInstance();

/**
 * Cache service with TTL support
 */
export class CacheService {
  private redis: Redis;

  constructor(redisClient?: Redis) {
    this.redis = redisClient || redisManager.client;
  }

  /**
   * Set cache value with TTL
   */
  async set(key: string, value: any, ttl?: number): Promise<void> {
    try {
      const serializedValue = JSON.stringify(value);
      
      if (ttl) {
        await this.redis.setex(key, ttl, serializedValue);
      } else {
        await this.redis.set(key, serializedValue);
      }
    } catch (error) {
      logger.error('Cache set failed', {
        key,
        ttl,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get cache value
   */
  async get<T = any>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Cache get failed', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Delete cache value
   */
  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      logger.error('Cache delete failed', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Cache exists check failed', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Set TTL for existing key
   */
  async expire(key: string, ttl: number): Promise<void> {
    try {
      await this.redis.expire(key, ttl);
    } catch (error) {
      logger.error('Cache expire failed', {
        key,
        ttl,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get TTL for key
   */
  async ttl(key: string): Promise<number> {
    try {
      return await this.redis.ttl(key);
    } catch (error) {
      logger.error('Cache TTL check failed', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return -1;
    }
  }

  /**
   * Get multiple cache values
   */
  async mget<T = any>(keys: string[]): Promise<(T | null)[]> {
    try {
      const values = await this.redis.mget(...keys);
      return values.map(value => value ? JSON.parse(value) : null);
    } catch (error) {
      logger.error('Cache mget failed', {
        keys,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return keys.map(() => null);
    }
  }

  /**
   * Set multiple cache values
   */
  async mset(keyValuePairs: Record<string, any>, ttl?: number): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      
      for (const [key, value] of Object.entries(keyValuePairs)) {
        const serializedValue = JSON.stringify(value);
        
        if (ttl) {
          pipeline.setex(key, ttl, serializedValue);
        } else {
          pipeline.set(key, serializedValue);
        }
      }
      
      await pipeline.exec();
    } catch (error) {
      logger.error('Cache mset failed', {
        keys: Object.keys(keyValuePairs),
        ttl,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Delete multiple cache values
   */
  async mdel(keys: string[]): Promise<void> {
    try {
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      logger.error('Cache mdel failed', {
        keys,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Clear cache by pattern
   */
  async clearByPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      logger.error('Cache clear by pattern failed', {
        pattern,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}

// Export Redis manager and cache service
export const redis = redisManager;
export const cache = new CacheService();
export default redisManager;

/**
 * Redis middleware for Express
 */
export function redisMiddleware() {
  return async (req: any, res: any, next: any) => {
    if (!redisManager.isConnected) {
      logger.warn('Redis not available, continuing without cache');
    }
    next();
  };
}

/**
 * Initialize Redis connection
 */
export async function initializeRedis(): Promise<void> {
  try {
    await redisManager.connect();
    logger.info('Redis initialization completed');
  } catch (error) {
    logger.error('Redis initialization failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    
    // Don't throw error - Redis is optional for basic functionality
    logger.warn('Continuing without Redis cache');
  }
}

/**
 * Cleanup Redis connections on process exit
 */
process.on('beforeExit', async () => {
  await redisManager.gracefulShutdown();
});

process.on('SIGINT', async () => {
  await redisManager.gracefulShutdown();
});

process.on('SIGTERM', async () => {
  await redisManager.gracefulShutdown();
});