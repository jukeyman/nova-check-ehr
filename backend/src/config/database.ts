/**
 * ============================================================================
 * NOVA CHECK EHR - DATABASE CONFIGURATION
 * ============================================================================
 */

import { PrismaClient } from '@prisma/client';
import { config } from './config';
import logger from './logger';

/**
 * Prisma client configuration options
 */
const prismaOptions = {
  log: config.isDevelopment 
    ? ['query', 'info', 'warn', 'error'] as const
    : ['warn', 'error'] as const,
  
  datasources: {
    db: {
      url: config.database.url,
    },
  },
  
  errorFormat: 'pretty' as const,
};

/**
 * Global Prisma client instance
 */
class DatabaseManager {
  private static instance: DatabaseManager;
  private _prisma: PrismaClient | null = null;
  private _isConnected = false;
  private _connectionAttempts = 0;
  private readonly _maxRetries = 5;
  private readonly _retryDelay = 5000; // 5 seconds

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  /**
   * Get Prisma client instance
   */
  public get prisma(): PrismaClient {
    if (!this._prisma) {
      this._prisma = new PrismaClient(prismaOptions);
      this.setupEventHandlers();
    }
    return this._prisma;
  }

  /**
   * Check if database is connected
   */
  public get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Setup Prisma event handlers
   */
  private setupEventHandlers(): void {
    if (!this._prisma) return;

    // Log queries in development
    if (config.isDevelopment) {
      this._prisma.$on('query', (e) => {
        logger.debug('Database Query', {
          query: e.query,
          params: e.params,
          duration: `${e.duration}ms`,
          timestamp: e.timestamp,
        });
      });
    }

    // Log info events
    this._prisma.$on('info', (e) => {
      logger.info('Database Info', {
        message: e.message,
        timestamp: e.timestamp,
      });
    });

    // Log warnings
    this._prisma.$on('warn', (e) => {
      logger.warn('Database Warning', {
        message: e.message,
        timestamp: e.timestamp,
      });
    });

    // Log errors
    this._prisma.$on('error', (e) => {
      logger.error('Database Error', {
        message: e.message,
        timestamp: e.timestamp,
      });
    });
  }

  /**
   * Connect to database with retry logic
   */
  public async connect(): Promise<void> {
    if (this._isConnected) {
      logger.info('Database already connected');
      return;
    }

    while (this._connectionAttempts < this._maxRetries) {
      try {
        this._connectionAttempts++;
        
        logger.info(`Attempting to connect to database (attempt ${this._connectionAttempts}/${this._maxRetries})`);
        
        // Test the connection
        await this.prisma.$connect();
        await this.prisma.$queryRaw`SELECT 1`;
        
        this._isConnected = true;
        this._connectionAttempts = 0;
        
        logger.info('Database connected successfully', {
          url: this.maskDatabaseUrl(config.database.url),
          ssl: config.database.ssl,
        });
        
        return;
      } catch (error) {
        logger.error(`Database connection attempt ${this._connectionAttempts} failed`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          attempt: this._connectionAttempts,
          maxRetries: this._maxRetries,
        });

        if (this._connectionAttempts >= this._maxRetries) {
          throw new Error(`Failed to connect to database after ${this._maxRetries} attempts: ${error}`);
        }

        // Wait before retrying
        await this.delay(this._retryDelay);
      }
    }
  }

  /**
   * Disconnect from database
   */
  public async disconnect(): Promise<void> {
    if (!this._isConnected || !this._prisma) {
      logger.info('Database not connected, skipping disconnect');
      return;
    }

    try {
      await this._prisma.$disconnect();
      this._isConnected = false;
      logger.info('Database disconnected successfully');
    } catch (error) {
      logger.error('Error disconnecting from database', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Check database health
   */
  public async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    latency?: number;
    error?: string;
  }> {
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      const latency = Date.now() - start;
      
      return {
        status: 'healthy',
        latency,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Run database migrations
   */
  public async runMigrations(): Promise<void> {
    try {
      logger.info('Running database migrations...');
      
      // Note: In production, migrations should be run separately
      // This is mainly for development convenience
      if (config.isDevelopment) {
        const { execSync } = require('child_process');
        execSync('npx prisma migrate deploy', { stdio: 'inherit' });
        logger.info('Database migrations completed successfully');
      } else {
        logger.warn('Skipping migrations in production environment');
      }
    } catch (error) {
      logger.error('Database migration failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Seed database with initial data
   */
  public async seedDatabase(): Promise<void> {
    if (!config.development.seedDatabase) {
      logger.info('Database seeding disabled');
      return;
    }

    try {
      logger.info('Seeding database with initial data...');
      
      // Import and run seed script
      const { seedDatabase } = await import('../scripts/seed');
      await seedDatabase(this.prisma);
      
      logger.info('Database seeding completed successfully');
    } catch (error) {
      logger.error('Database seeding failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Execute raw SQL query
   */
  public async executeRaw(sql: string, params: any[] = []): Promise<any> {
    try {
      logger.debug('Executing raw SQL query', { sql, params });
      return await this.prisma.$queryRawUnsafe(sql, ...params);
    } catch (error) {
      logger.error('Raw SQL query failed', {
        sql,
        params,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get database statistics
   */
  public async getStats(): Promise<{
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    version: string;
  }> {
    try {
      const [connectionStats, versionResult] = await Promise.all([
        this.prisma.$queryRaw`
          SELECT 
            count(*) as total_connections,
            count(*) FILTER (WHERE state = 'active') as active_connections,
            count(*) FILTER (WHERE state = 'idle') as idle_connections
          FROM pg_stat_activity 
          WHERE datname = current_database()
        ` as Promise<any[]>,
        this.prisma.$queryRaw`SELECT version()` as Promise<any[]>,
      ]);

      const stats = connectionStats[0] || {};
      const version = versionResult[0]?.version || 'Unknown';

      return {
        totalConnections: parseInt(stats.total_connections) || 0,
        activeConnections: parseInt(stats.active_connections) || 0,
        idleConnections: parseInt(stats.idle_connections) || 0,
        version,
      };
    } catch (error) {
      logger.error('Failed to get database stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Mask sensitive information in database URL
   */
  private maskDatabaseUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      if (urlObj.password) {
        urlObj.password = '***';
      }
      return urlObj.toString();
    } catch {
      return 'Invalid URL';
    }
  }

  /**
   * Delay utility for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Graceful shutdown
   */
  public async gracefulShutdown(): Promise<void> {
    logger.info('Initiating database graceful shutdown...');
    
    try {
      // Wait for ongoing transactions to complete (with timeout)
      await Promise.race([
        this.disconnect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database shutdown timeout')), 10000)
        ),
      ]);
      
      logger.info('Database graceful shutdown completed');
    } catch (error) {
      logger.error('Error during database graceful shutdown', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}

// Create singleton instance
const databaseManager = DatabaseManager.getInstance();

// Export Prisma client and database manager
export const prisma = databaseManager.prisma;
export const db = databaseManager;
export default databaseManager;

/**
 * Database transaction helper
 */
export async function withTransaction<T>(
  callback: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  return await prisma.$transaction(callback);
}

/**
 * Database connection middleware for Express
 */
export function databaseMiddleware() {
  return async (req: any, res: any, next: any) => {
    if (!databaseManager.isConnected) {
      return res.status(503).json({
        error: 'Database not available',
        message: 'Service temporarily unavailable',
      });
    }
    next();
  };
}

/**
 * Initialize database connection
 */
export async function initializeDatabase(): Promise<void> {
  try {
    await databaseManager.connect();
    
    if (config.isDevelopment) {
      await databaseManager.runMigrations();
      await databaseManager.seedDatabase();
    }
    
    logger.info('Database initialization completed');
  } catch (error) {
    logger.error('Database initialization failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Cleanup database connections on process exit
 */
process.on('beforeExit', async () => {
  await databaseManager.gracefulShutdown();
});

process.on('SIGINT', async () => {
  await databaseManager.gracefulShutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await databaseManager.gracefulShutdown();
  process.exit(0);
});