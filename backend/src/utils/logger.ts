// ============================================================================
// NOVA CHECK EHR - LOGGER UTILITY
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

// ============================================================================
// LOGGER CONFIGURATION
// ============================================================================

// Get log configuration from environment
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_FORMAT = process.env.LOG_FORMAT || 'json';
const LOG_FILE_ENABLED = process.env.LOG_FILE_ENABLED === 'true';
const LOG_FILE_PATH = process.env.LOG_FILE_PATH || './logs';
const LOG_MAX_SIZE = process.env.LOG_MAX_SIZE || '20m';
const LOG_MAX_FILES = process.env.LOG_MAX_FILES || '14d';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Ensure log directory exists
if (LOG_FILE_ENABLED && !fs.existsSync(LOG_FILE_PATH)) {
  fs.mkdirSync(LOG_FILE_PATH, { recursive: true });
}

// ============================================================================
// CUSTOM FORMATS
// ============================================================================

/**
 * Custom format for development environment
 */
const developmentFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, component, ...meta }) => {
    const componentStr = component ? `[${component}]` : '';
    const metaStr = Object.keys(meta).length > 0 ? `\n${JSON.stringify(meta, null, 2)}` : '';
    return `${timestamp} ${level} ${componentStr} ${message}${metaStr}`;
  })
);

/**
 * Custom format for production environment
 */
const productionFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf((info) => {
    // Add additional context for production logs
    const logEntry = {
      timestamp: info.timestamp,
      level: info.level,
      message: info.message,
      component: info.component || 'app',
      environment: NODE_ENV,
      pid: process.pid,
      ...info,
    };
    
    // Remove winston-specific fields
    delete logEntry.level;
    delete logEntry.message;
    delete logEntry.timestamp;
    
    return JSON.stringify({
      '@timestamp': info.timestamp,
      level: info.level,
      message: info.message,
      ...logEntry,
    });
  })
);

/**
 * Simple format for testing
 */
const testFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, component }) => {
    const componentStr = component ? `[${component}]` : '';
    return `${timestamp} ${level} ${componentStr} ${message}`;
  })
);

// ============================================================================
// TRANSPORTS
// ============================================================================

const transports: winston.transport[] = [];

// Console transport
if (NODE_ENV !== 'test') {
  transports.push(
    new winston.transports.Console({
      level: LOG_LEVEL,
      format: NODE_ENV === 'development' ? developmentFormat : productionFormat,
      handleExceptions: true,
      handleRejections: true,
    })
  );
}

// File transports (only if enabled)
if (LOG_FILE_ENABLED) {
  // Combined log file
  transports.push(
    new DailyRotateFile({
      filename: path.join(LOG_FILE_PATH, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: LOG_MAX_SIZE,
      maxFiles: LOG_MAX_FILES,
      level: LOG_LEVEL,
      format: LOG_FORMAT === 'json' ? productionFormat : developmentFormat,
      handleExceptions: true,
      handleRejections: true,
    })
  );

  // Error log file
  transports.push(
    new DailyRotateFile({
      filename: path.join(LOG_FILE_PATH, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: LOG_MAX_SIZE,
      maxFiles: LOG_MAX_FILES,
      level: 'error',
      format: LOG_FORMAT === 'json' ? productionFormat : developmentFormat,
      handleExceptions: true,
      handleRejections: true,
    })
  );

  // HTTP access log file
  transports.push(
    new DailyRotateFile({
      filename: path.join(LOG_FILE_PATH, 'access-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: LOG_MAX_SIZE,
      maxFiles: LOG_MAX_FILES,
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    })
  );

  // Audit log file
  transports.push(
    new DailyRotateFile({
      filename: path.join(LOG_FILE_PATH, 'audit-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: LOG_MAX_SIZE,
      maxFiles: LOG_MAX_FILES,
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    })
  );
}

// ============================================================================
// LOGGER INSTANCE
// ============================================================================

export const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: NODE_ENV === 'test' ? testFormat : 
          NODE_ENV === 'development' ? developmentFormat : productionFormat,
  transports,
  exitOnError: false,
  silent: NODE_ENV === 'test' && process.env.LOG_SILENT === 'true',
});

// ============================================================================
// SPECIALIZED LOGGERS
// ============================================================================

/**
 * HTTP access logger
 */
export const httpLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: LOG_FILE_ENABLED ? [
    new DailyRotateFile({
      filename: path.join(LOG_FILE_PATH, 'access-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: LOG_MAX_SIZE,
      maxFiles: LOG_MAX_FILES,
    })
  ] : [],
});

/**
 * Audit logger for compliance and security events
 */
export const auditLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
    winston.format.printf((info) => {
      return JSON.stringify({
        '@timestamp': info.timestamp,
        event_type: 'audit',
        level: info.level,
        message: info.message,
        user_id: info.userId,
        action: info.action,
        resource: info.resource,
        ip_address: info.ipAddress,
        user_agent: info.userAgent,
        session_id: info.sessionId,
        correlation_id: info.correlationId,
        ...info,
      });
    })
  ),
  transports: LOG_FILE_ENABLED ? [
    new DailyRotateFile({
      filename: path.join(LOG_FILE_PATH, 'audit-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: LOG_MAX_SIZE,
      maxFiles: LOG_MAX_FILES,
    })
  ] : [],
});

/**
 * Security logger for security-related events
 */
export const securityLogger = winston.createLogger({
  level: 'warn',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
    winston.format.printf((info) => {
      return JSON.stringify({
        '@timestamp': info.timestamp,
        event_type: 'security',
        level: info.level,
        message: info.message,
        threat_level: info.threatLevel || 'medium',
        ip_address: info.ipAddress,
        user_agent: info.userAgent,
        user_id: info.userId,
        session_id: info.sessionId,
        correlation_id: info.correlationId,
        ...info,
      });
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    ...(LOG_FILE_ENABLED ? [
      new DailyRotateFile({
        filename: path.join(LOG_FILE_PATH, 'security-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: LOG_MAX_SIZE,
        maxFiles: LOG_MAX_FILES,
      })
    ] : []),
  ],
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a child logger with additional context
 */
export const createChildLogger = (context: Record<string, any>) => {
  return logger.child(context);
};

/**
 * Log performance metrics
 */
export const logPerformance = (operation: string, duration: number, metadata?: Record<string, any>) => {
  logger.info('Performance metric', {
    component: 'performance',
    operation,
    duration_ms: duration,
    ...metadata,
  });
};

/**
 * Log database operations
 */
export const logDatabase = (operation: string, table: string, duration?: number, metadata?: Record<string, any>) => {
  logger.debug('Database operation', {
    component: 'database',
    operation,
    table,
    duration_ms: duration,
    ...metadata,
  });
};

/**
 * Log API requests
 */
export const logApiRequest = (method: string, url: string, statusCode: number, duration: number, metadata?: Record<string, any>) => {
  const level = statusCode >= 400 ? 'warn' : 'info';
  logger.log(level, 'API request', {
    component: 'api',
    method,
    url,
    status_code: statusCode,
    duration_ms: duration,
    ...metadata,
  });
};

/**
 * Log authentication events
 */
export const logAuth = (event: string, userId?: string, metadata?: Record<string, any>) => {
  auditLogger.info('Authentication event', {
    action: event,
    userId,
    ...metadata,
  });
};

/**
 * Log security events
 */
export const logSecurity = (event: string, threatLevel: 'low' | 'medium' | 'high' | 'critical' = 'medium', metadata?: Record<string, any>) => {
  securityLogger.warn('Security event', {
    event,
    threatLevel,
    ...metadata,
  });
};

/**
 * Log business events
 */
export const logBusiness = (event: string, metadata?: Record<string, any>) => {
  logger.info('Business event', {
    component: 'business',
    event,
    ...metadata,
  });
};

// ============================================================================
// ERROR HANDLING
// ============================================================================

// Handle logger errors
logger.on('error', (error) => {
  console.error('Logger error:', error);
});

// Handle file transport errors
if (LOG_FILE_ENABLED) {
  transports.forEach(transport => {
    if (transport instanceof DailyRotateFile) {
      transport.on('error', (error) => {
        console.error('Log file transport error:', error);
      });
      
      transport.on('rotate', (oldFilename, newFilename) => {
        console.log('Log file rotated:', { oldFilename, newFilename });
      });
    }
  });
}

// ============================================================================
// EXPORTS
// ============================================================================

export default logger;

// Export logger types for TypeScript
export type Logger = typeof logger;
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';