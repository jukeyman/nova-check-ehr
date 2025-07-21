/**
 * ============================================================================
 * NOVA CHECK EHR - CACHE SERVICE
 * ============================================================================
 */

import Redis from 'ioredis';
import logger from '../config/logger';
import { config } from '../config/config';
import { promisify } from 'util';

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  prefix?: string;
  compress?: boolean;
}

interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalKeys: number;
  memoryUsage: string;
}

class CacheService {
  private redis: Redis;
  private isConnected: boolean = false;
  private stats = {
    hits: 0,
    misses: 0,
  };

  constructor() {
    this.initializeRedis();
  }

  private initializeRedis() {
    try {
      this.redis = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        db: config.redis.db || 0,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        keepAlive: 30000,
        connectTimeout: 10000,
        commandTimeout: 5000,
      });

      this.redis.on('connect', () => {
        this.isConnected = true;
        logger.info('Redis connected successfully');
      });

      this.redis.on('error', (error) => {
        this.isConnected = false;
        logger.error('Redis connection error', { error: error.message });
      });

      this.redis.on('close', () => {
        this.isConnected = false;
        logger.warn('Redis connection closed');
      });

      this.redis.on('reconnecting', () => {
        logger.info('Redis reconnecting...');
      });

    } catch (error) {
      logger.error('Failed to initialize Redis', { error: error.message });
    }
  }

  private generateKey(key: string, prefix?: string): string {
    const keyPrefix = prefix || config.redis.keyPrefix || 'nova-ehr';
    return `${keyPrefix}:${key}`;
  }

  private compress(data: any): string {
    // Simple compression using JSON.stringify
    // In production, you might want to use a proper compression library
    return JSON.stringify(data);
  }

  private decompress(data: string): any {
    try {
      return JSON.parse(data);
    } catch (error) {
      logger.error('Failed to decompress cache data', { error: error.message });
      return null;
    }
  }

  async get<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
    if (!this.isConnected) {
      logger.warn('Redis not connected, cache miss', { key });
      this.stats.misses++;
      return null;
    }

    try {
      const cacheKey = this.generateKey(key, options.prefix);
      const cachedData = await this.redis.get(cacheKey);

      if (cachedData === null) {
        this.stats.misses++;
        logger.debug('Cache miss', { key: cacheKey });
        return null;
      }

      this.stats.hits++;
      logger.debug('Cache hit', { key: cacheKey });
      
      return options.compress ? this.decompress(cachedData) : JSON.parse(cachedData);
    } catch (error) {
      logger.error('Cache get error', { error: error.message, key });
      this.stats.misses++;
      return null;
    }
  }

  async set<T>(
    key: string,
    value: T,
    options: CacheOptions = {}
  ): Promise<boolean> {
    if (!this.isConnected) {
      logger.warn('Redis not connected, cache set failed', { key });
      return false;
    }

    try {
      const cacheKey = this.generateKey(key, options.prefix);
      const serializedValue = options.compress 
        ? this.compress(value) 
        : JSON.stringify(value);

      if (options.ttl) {
        await this.redis.setex(cacheKey, options.ttl, serializedValue);
      } else {
        await this.redis.set(cacheKey, serializedValue);
      }

      logger.debug('Cache set', { key: cacheKey, ttl: options.ttl });
      return true;
    } catch (error) {
      logger.error('Cache set error', { error: error.message, key });
      return false;
    }
  }

  async del(key: string, options: CacheOptions = {}): Promise<boolean> {
    if (!this.isConnected) {
      logger.warn('Redis not connected, cache delete failed', { key });
      return false;
    }

    try {
      const cacheKey = this.generateKey(key, options.prefix);
      const result = await this.redis.del(cacheKey);
      
      logger.debug('Cache delete', { key: cacheKey, deleted: result > 0 });
      return result > 0;
    } catch (error) {
      logger.error('Cache delete error', { error: error.message, key });
      return false;
    }
  }

  async exists(key: string, options: CacheOptions = {}): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      const cacheKey = this.generateKey(key, options.prefix);
      const result = await this.redis.exists(cacheKey);
      return result === 1;
    } catch (error) {
      logger.error('Cache exists error', { error: error.message, key });
      return false;
    }
  }

  async expire(key: string, ttl: number, options: CacheOptions = {}): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      const cacheKey = this.generateKey(key, options.prefix);
      const result = await this.redis.expire(cacheKey, ttl);
      return result === 1;
    } catch (error) {
      logger.error('Cache expire error', { error: error.message, key });
      return false;
    }
  }

  async ttl(key: string, options: CacheOptions = {}): Promise<number> {
    if (!this.isConnected) {
      return -1;
    }

    try {
      const cacheKey = this.generateKey(key, options.prefix);
      return await this.redis.ttl(cacheKey);
    } catch (error) {
      logger.error('Cache TTL error', { error: error.message, key });
      return -1;
    }
  }

  async getOrSet<T>(
    key: string,
    fetchFunction: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T | null> {
    // Try to get from cache first
    const cachedValue = await this.get<T>(key, options);
    if (cachedValue !== null) {
      return cachedValue;
    }

    try {
      // Fetch the data
      const freshValue = await fetchFunction();
      
      // Cache the result
      await this.set(key, freshValue, options);
      
      return freshValue;
    } catch (error) {
      logger.error('Cache getOrSet error', { error: error.message, key });
      return null;
    }
  }

  async mget<T>(keys: string[], options: CacheOptions = {}): Promise<(T | null)[]> {
    if (!this.isConnected) {
      return keys.map(() => null);
    }

    try {
      const cacheKeys = keys.map(key => this.generateKey(key, options.prefix));
      const results = await this.redis.mget(...cacheKeys);
      
      return results.map((result, index) => {
        if (result === null) {
          this.stats.misses++;
          return null;
        }
        
        this.stats.hits++;
        try {
          return options.compress ? this.decompress(result) : JSON.parse(result);
        } catch (error) {
          logger.error('Failed to parse cached data', { 
            error: error.message, 
            key: keys[index] 
          });
          return null;
        }
      });
    } catch (error) {
      logger.error('Cache mget error', { error: error.message, keys });
      return keys.map(() => null);
    }
  }

  async mset<T>(keyValuePairs: Array<{ key: string; value: T }>, options: CacheOptions = {}): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      const pipeline = this.redis.pipeline();
      
      for (const { key, value } of keyValuePairs) {
        const cacheKey = this.generateKey(key, options.prefix);
        const serializedValue = options.compress 
          ? this.compress(value) 
          : JSON.stringify(value);
        
        if (options.ttl) {
          pipeline.setex(cacheKey, options.ttl, serializedValue);
        } else {
          pipeline.set(cacheKey, serializedValue);
        }
      }
      
      await pipeline.exec();
      return true;
    } catch (error) {
      logger.error('Cache mset error', { error: error.message });
      return false;
    }
  }

  async deletePattern(pattern: string, options: CacheOptions = {}): Promise<number> {
    if (!this.isConnected) {
      return 0;
    }

    try {
      const searchPattern = this.generateKey(pattern, options.prefix);
      const keys = await this.redis.keys(searchPattern);
      
      if (keys.length === 0) {
        return 0;
      }
      
      const result = await this.redis.del(...keys);
      logger.debug('Cache pattern delete', { pattern: searchPattern, deleted: result });
      return result;
    } catch (error) {
      logger.error('Cache pattern delete error', { error: error.message, pattern });
      return 0;
    }
  }

  async increment(key: string, by: number = 1, options: CacheOptions = {}): Promise<number> {
    if (!this.isConnected) {
      return 0;
    }

    try {
      const cacheKey = this.generateKey(key, options.prefix);
      const result = await this.redis.incrby(cacheKey, by);
      
      if (options.ttl) {
        await this.redis.expire(cacheKey, options.ttl);
      }
      
      return result;
    } catch (error) {
      logger.error('Cache increment error', { error: error.message, key });
      return 0;
    }
  }

  async decrement(key: string, by: number = 1, options: CacheOptions = {}): Promise<number> {
    if (!this.isConnected) {
      return 0;
    }

    try {
      const cacheKey = this.generateKey(key, options.prefix);
      const result = await this.redis.decrby(cacheKey, by);
      
      if (options.ttl) {
        await this.redis.expire(cacheKey, options.ttl);
      }
      
      return result;
    } catch (error) {
      logger.error('Cache decrement error', { error: error.message, key });
      return 0;
    }
  }

  async addToSet(key: string, value: string, options: CacheOptions = {}): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      const cacheKey = this.generateKey(key, options.prefix);
      const result = await this.redis.sadd(cacheKey, value);
      
      if (options.ttl) {
        await this.redis.expire(cacheKey, options.ttl);
      }
      
      return result === 1;
    } catch (error) {
      logger.error('Cache add to set error', { error: error.message, key });
      return false;
    }
  }

  async removeFromSet(key: string, value: string, options: CacheOptions = {}): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      const cacheKey = this.generateKey(key, options.prefix);
      const result = await this.redis.srem(cacheKey, value);
      return result === 1;
    } catch (error) {
      logger.error('Cache remove from set error', { error: error.message, key });
      return false;
    }
  }

  async getSetMembers(key: string, options: CacheOptions = {}): Promise<string[]> {
    if (!this.isConnected) {
      return [];
    }

    try {
      const cacheKey = this.generateKey(key, options.prefix);
      return await this.redis.smembers(cacheKey);
    } catch (error) {
      logger.error('Cache get set members error', { error: error.message, key });
      return [];
    }
  }

  async isSetMember(key: string, value: string, options: CacheOptions = {}): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      const cacheKey = this.generateKey(key, options.prefix);
      const result = await this.redis.sismember(cacheKey, value);
      return result === 1;
    } catch (error) {
      logger.error('Cache is set member error', { error: error.message, key });
      return false;
    }
  }

  async addToList(key: string, value: string, options: CacheOptions = {}): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      const cacheKey = this.generateKey(key, options.prefix);
      await this.redis.lpush(cacheKey, value);
      
      if (options.ttl) {
        await this.redis.expire(cacheKey, options.ttl);
      }
      
      return true;
    } catch (error) {
      logger.error('Cache add to list error', { error: error.message, key });
      return false;
    }
  }

  async getListRange(key: string, start: number = 0, end: number = -1, options: CacheOptions = {}): Promise<string[]> {
    if (!this.isConnected) {
      return [];
    }

    try {
      const cacheKey = this.generateKey(key, options.prefix);
      return await this.redis.lrange(cacheKey, start, end);
    } catch (error) {
      logger.error('Cache get list range error', { error: error.message, key });
      return [];
    }
  }

  async getStats(): Promise<CacheStats> {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? (this.stats.hits / totalRequests) * 100 : 0;
    
    let totalKeys = 0;
    let memoryUsage = '0 B';
    
    if (this.isConnected) {
      try {
        const info = await this.redis.info('memory');
        const memoryMatch = info.match(/used_memory_human:(.+)\r?\n/);
        if (memoryMatch) {
          memoryUsage = memoryMatch[1].trim();
        }
        
        totalKeys = await this.redis.dbsize();
      } catch (error) {
        logger.error('Failed to get cache stats', { error: error.message });
      }
    }
    
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: Math.round(hitRate * 100) / 100,
      totalKeys,
      memoryUsage,
    };
  }

  async flush(): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      await this.redis.flushdb();
      logger.info('Cache flushed successfully');
      return true;
    } catch (error) {
      logger.error('Cache flush error', { error: error.message });
      return false;
    }
  }

  async ping(): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch (error) {
      logger.error('Cache ping error', { error: error.message });
      return false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.redis.disconnect();
      this.isConnected = false;
      logger.info('Redis disconnected');
    } catch (error) {
      logger.error('Redis disconnect error', { error: error.message });
    }
  }

  // Utility methods for common EHR caching patterns
  async cacheUserSession(userId: string, sessionData: any, ttl: number = 3600): Promise<boolean> {
    return this.set(`session:${userId}`, sessionData, { ttl, prefix: 'auth' });
  }

  async getUserSession(userId: string): Promise<any> {
    return this.get(`session:${userId}`, { prefix: 'auth' });
  }

  async invalidateUserSession(userId: string): Promise<boolean> {
    return this.del(`session:${userId}`, { prefix: 'auth' });
  }

  async cachePatientData(patientId: string, data: any, ttl: number = 1800): Promise<boolean> {
    return this.set(`patient:${patientId}`, data, { ttl, prefix: 'patient' });
  }

  async getPatientData(patientId: string): Promise<any> {
    return this.get(`patient:${patientId}`, { prefix: 'patient' });
  }

  async cacheProviderSchedule(providerId: string, date: string, schedule: any, ttl: number = 3600): Promise<boolean> {
    return this.set(`schedule:${providerId}:${date}`, schedule, { ttl, prefix: 'schedule' });
  }

  async getProviderSchedule(providerId: string, date: string): Promise<any> {
    return this.get(`schedule:${providerId}:${date}`, { prefix: 'schedule' });
  }

  async cacheAppointmentData(appointmentId: string, data: any, ttl: number = 1800): Promise<boolean> {
    return this.set(`appointment:${appointmentId}`, data, { ttl, prefix: 'appointment' });
  }

  async getAppointmentData(appointmentId: string): Promise<any> {
    return this.get(`appointment:${appointmentId}`, { prefix: 'appointment' });
  }

  async invalidatePatientCache(patientId: string): Promise<number> {
    return this.deletePattern(`patient:${patientId}*`);
  }

  async invalidateProviderCache(providerId: string): Promise<number> {
    return this.deletePattern(`provider:${providerId}*`);
  }

  isConnected(): boolean {
    return this.isConnected;
  }
}

// Export singleton instance
const cacheService = new CacheService();
export default cacheService;

// Export individual functions for convenience
export const get = <T>(key: string, options?: CacheOptions) => cacheService.get<T>(key, options);
export const set = <T>(key: string, value: T, options?: CacheOptions) => cacheService.set(key, value, options);
export const del = (key: string, options?: CacheOptions) => cacheService.del(key, options);
export const exists = (key: string, options?: CacheOptions) => cacheService.exists(key, options);
export const getOrSet = <T>(key: string, fetchFunction: () => Promise<T>, options?: CacheOptions) => cacheService.getOrSet(key, fetchFunction, options);
export const cacheUserSession = (userId: string, sessionData: any, ttl?: number) => cacheService.cacheUserSession(userId, sessionData, ttl);
export const getUserSession = (userId: string) => cacheService.getUserSession(userId);
export const invalidateUserSession = (userId: string) => cacheService.invalidateUserSession(userId);
export const cachePatientData = (patientId: string, data: any, ttl?: number) => cacheService.cachePatientData(patientId, data, ttl);
export const getPatientData = (patientId: string) => cacheService.getPatientData(patientId);