/**
 * ============================================================================
 * NOVA CHECK EHR - LOGGING CONFIGURATION
 * ============================================================================
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';
import { config } from './config';

/**
 * Ensure log directory exists
 */
function ensureLogDirectory(): void {
  if (!fs.existsSync(config.logging.file.path)) {
    fs.mkdirSync(config.logging.file.path, { recursive: true });
  }
}

/**
 * Custom log format for development
 */
const developmentFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    
    // Add stack trace for errors
    if (stack) {
      log += `\n${stack}`;
    }
    
    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      log += `\n${JSON.stringify(meta, null, 2)}`;
    }
    
    return log;
  })
);

/**
 * Custom log format for production
 */
const productionFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf((info) => {
    // Add request ID and user context if available
    const logEntry = {
      timestamp: info.timestamp,
      level: info.level,
      message: info.message,
      service: 'nova-ehr-backend',
      environment: config.env,
      ...info,
    };
    
    // Remove duplicate timestamp
    delete logEntry.timestamp;
    
    return JSON.stringify({
      '@timestamp': info.timestamp,
      ...logEntry,
    });
  })
);

/**
 * Create transports based on environment
 */
function createTransports(): winston.transport[] {
  const transports: winston.transport[] = [];
  
  // Console transport (always enabled)
  transports.push(
    new winston.transports.Console({
      level: config.logging.level,
      format: config.isDevelopment ? developmentFormat : productionFormat,
      handleExceptions: true,
      handleRejections: true,
    })
  );
  
  // File transports (if enabled)
  if (config.logging.file.enabled) {
    ensureLogDirectory();
    
    // Combined log file
    transports.push(
      new DailyRotateFile({
        filename: path.join(config.logging.file.path, 'combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: config.logging.file.maxSize,
        maxFiles: config.logging.file.maxFiles,
        level: config.logging.level,
        format: productionFormat,
        handleExceptions: true,
        handleRejections: true,
      })
    );
    
    // Error log file
    transports.push(
      new DailyRotateFile({
        filename: path.join(config.logging.file.path, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: config.logging.file.maxSize,
        maxFiles: config.logging.file.maxFiles,
        level: 'error',
        format: productionFormat,
        handleExceptions: true,
        handleRejections: true,
      })
    );
    
    // Audit log file (for HIPAA compliance)
    transports.push(
      new DailyRotateFile({
        filename: path.join(config.logging.file.path, 'audit-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: config.logging.file.maxSize,
        maxFiles: config.hipaa.auditLogRetentionDays,
        level: 'info',
        format: productionFormat,
      })
    );
    
    // Security log file
    transports.push(
      new DailyRotateFile({
        filename: path.join(config.logging.file.path, 'security-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: config.logging.file.maxSize,
        maxFiles: config.logging.file.maxFiles,
        level: 'warn',
        format: productionFormat,
      })
    );
  }
  
  return transports;
}

/**
 * Create Winston logger instance
 */
const logger = winston.createLogger({
  level: config.logging.level,
  format: config.isDevelopment ? developmentFormat : productionFormat,
  defaultMeta: {
    service: 'nova-ehr-backend',
    environment: config.env,
    version: process.env.npm_package_version || '1.0.0',
  },
  transports: createTransports(),
  exitOnError: false,
});

/**
 * Enhanced logger with additional methods
 */
class EnhancedLogger {
  private winston: winston.Logger;
  
  constructor(winstonLogger: winston.Logger) {
    this.winston = winstonLogger;
  }
  
  /**
   * Debug level logging
   */
  debug(message: string, meta?: any): void {
    this.winston.debug(message, meta);
  }
  
  /**
   * Info level logging
   */
  info(message: string, meta?: any): void {
    this.winston.info(message, meta);
  }
  
  /**
   * Warning level logging
   */
  warn(message: string, meta?: any): void {
    this.winston.warn(message, meta);
  }
  
  /**
   * Error level logging
   */
  error(message: string, meta?: any): void {
    this.winston.error(message, meta);
  }
  
  /**
   * HTTP request logging
   */
  http(message: string, meta?: any): void {
    this.winston.http(message, meta);
  }
  
  /**
   * Audit logging for HIPAA compliance
   */
  audit(event: string, meta: {
    userId?: string;
    patientId?: string;
    action: string;
    resource?: string;
    ipAddress?: string;
    userAgent?: string;
    timestamp?: Date;
    success?: boolean;
    details?: any;
  }): void {
    this.winston.info(`AUDIT: ${event}`, {
      ...meta,
      timestamp: meta.timestamp || new Date(),
      auditEvent: true,
    });
  }
  
  /**
   * Security event logging
   */
  security(event: string, meta: {
    userId?: string;
    ipAddress?: string;
    userAgent?: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    action: string;
    details?: any;
  }): void {
    this.winston.warn(`SECURITY: ${event}`, {
      ...meta,
      timestamp: new Date(),
      securityEvent: true,
    });
  }
  
  /**
   * Performance logging
   */
  performance(operation: string, meta: {
    duration: number;
    userId?: string;
    endpoint?: string;
    method?: string;
    statusCode?: number;
    details?: any;
  }): void {
    this.winston.info(`PERFORMANCE: ${operation}`, {
      ...meta,
      timestamp: new Date(),
      performanceEvent: true,
    });
  }
  
  /**
   * Database operation logging
   */
  database(operation: string, meta: {
    table?: string;
    query?: string;
    duration?: number;
    rowsAffected?: number;
    userId?: string;
    error?: any;
  }): void {
    this.winston.debug(`DATABASE: ${operation}`, {
      ...meta,
      timestamp: new Date(),
      databaseEvent: true,
    });
  }
  
  /**
   * API request/response logging
   */
  api(message: string, meta: {
    method: string;
    url: string;
    statusCode: number;
    duration: number;
    userId?: string;
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
    requestBody?: any;
    responseBody?: any;
  }): void {
    const level = meta.statusCode >= 400 ? 'warn' : 'info';
    
    this.winston.log(level, `API: ${message}`, {
      ...meta,
      timestamp: new Date(),
      apiEvent: true,
    });
  }
  
  /**
   * External service integration logging
   */
  integration(service: string, meta: {
    operation: string;
    duration?: number;
    success: boolean;
    statusCode?: number;
    error?: any;
    requestId?: string;
  }): void {
    const level = meta.success ? 'info' : 'error';
    
    this.winston.log(level, `INTEGRATION: ${service}`, {
      ...meta,
      timestamp: new Date(),
      integrationEvent: true,
    });
  }
  
  /**
   * Business logic logging
   */
  business(event: string, meta: {
    userId?: string;
    patientId?: string;
    providerId?: string;
    action: string;
    result: 'success' | 'failure' | 'partial';
    details?: any;
  }): void {
    this.winston.info(`BUSINESS: ${event}`, {
      ...meta,
      timestamp: new Date(),
      businessEvent: true,
    });
  }
  
  /**
   * System health logging
   */
  health(component: string, meta: {
    status: 'healthy' | 'unhealthy' | 'degraded';
    latency?: number;
    error?: any;
    details?: any;
  }): void {
    const level = meta.status === 'healthy' ? 'info' : 'warn';
    
    this.winston.log(level, `HEALTH: ${component}`, {
      ...meta,
      timestamp: new Date(),
      healthEvent: true,
    });
  }
  
  /**
   * Create child logger with additional context
   */
  child(meta: any): EnhancedLogger {
    const childLogger = this.winston.child(meta);
    return new EnhancedLogger(childLogger);
  }
  
  /**
   * Log with custom level
   */
  log(level: string, message: string, meta?: any): void {
    this.winston.log(level, message, meta);
  }
  
  /**
   * Get Winston logger instance
   */
  getWinstonLogger(): winston.Logger {
    return this.winston;
  }
}

// Create enhanced logger instance
const enhancedLogger = new EnhancedLogger(logger);

/**
 * Request logging middleware
 */
export function requestLogger() {
  return (req: any, res: any, next: any) => {
    const start = Date.now();
    const requestId = req.headers['x-request-id'] || req.id || Math.random().toString(36).substr(2, 9);
    
    // Add request ID to request object
    req.requestId = requestId;
    
    // Log request start
    enhancedLogger.api('Request started', {
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: 0,
      duration: 0,
      userId: req.user?.id,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      requestId,
      requestBody: req.method !== 'GET' ? req.body : undefined,
    });
    
    // Override res.end to log response
    const originalEnd = res.end;
    res.end = function(chunk: any, encoding: any) {
      const duration = Date.now() - start;
      
      enhancedLogger.api('Request completed', {
        method: req.method,
        url: req.originalUrl || req.url,
        statusCode: res.statusCode,
        duration,
        userId: req.user?.id,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.headers['user-agent'],
        requestId,
      });
      
      originalEnd.call(this, chunk, encoding);
    };
    
    next();
  };
}

/**
 * Error logging middleware
 */
export function errorLogger() {
  return (error: any, req: any, res: any, next: any) => {
    enhancedLogger.error('Request error', {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
      method: req.method,
      url: req.originalUrl || req.url,
      userId: req.user?.id,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
      requestBody: req.body,
    });
    
    next(error);
  };
}

/**
 * Stream for Morgan HTTP logger
 */
export const morganStream = {
  write: (message: string) => {
    enhancedLogger.http(message.trim());
  },
};

/**
 * Log application startup
 */
export function logStartup(): void {
  enhancedLogger.info('Nova Check EHR Backend Starting', {
    environment: config.env,
    port: config.server.port,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    timestamp: new Date(),
  });
}

/**
 * Log application shutdown
 */
export function logShutdown(signal?: string): void {
  enhancedLogger.info('Nova Check EHR Backend Shutting Down', {
    signal,
    uptime: process.uptime(),
    timestamp: new Date(),
  });
}

/**
 * Handle uncaught exceptions
 */
process.on('uncaughtException', (error) => {
  enhancedLogger.error('Uncaught Exception', {
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name,
    },
    timestamp: new Date(),
  });
  
  // Give logger time to write before exiting
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

/**
 * Handle unhandled promise rejections
 */
process.on('unhandledRejection', (reason, promise) => {
  enhancedLogger.error('Unhandled Promise Rejection', {
    reason,
    promise: promise.toString(),
    timestamp: new Date(),
  });
});

/**
 * Handle process warnings
 */
process.on('warning', (warning) => {
  enhancedLogger.warn('Process Warning', {
    name: warning.name,
    message: warning.message,
    stack: warning.stack,
    timestamp: new Date(),
  });
});

export default enhancedLogger;
export { EnhancedLogger };