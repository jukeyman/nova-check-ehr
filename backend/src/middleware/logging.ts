/**
 * ============================================================================
 * NOVA CHECK EHR - LOGGING MIDDLEWARE
 * ============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import morgan from 'morgan';
import { v4 as uuidv4 } from 'uuid';
import logger from '../config/logger';
import { config } from '../config/config';
import { AuthenticatedRequest } from './auth';
import { performance } from 'perf_hooks';

/**
 * Request context interface
 */
interface RequestContext {
  requestId: string;
  startTime: number;
  userId?: string;
  userRole?: string;
  ipAddress: string;
  userAgent: string;
  method: string;
  path: string;
  query: any;
  body?: any;
  responseTime?: number;
  statusCode?: number;
  contentLength?: number;
  error?: any;
}

/**
 * Sensitive fields to redact from logs
 */
const SENSITIVE_FIELDS = [
  'password',
  'token',
  'authorization',
  'cookie',
  'session',
  'secret',
  'key',
  'ssn',
  'socialSecurityNumber',
  'creditCard',
  'bankAccount',
  'pin',
  'otp',
  'refreshToken',
  'accessToken',
];

/**
 * PHI (Protected Health Information) fields
 */
const PHI_FIELDS = [
  'firstName',
  'lastName',
  'fullName',
  'dateOfBirth',
  'dob',
  'address',
  'phone',
  'email',
  'mrn',
  'medicalRecordNumber',
  'diagnosis',
  'medication',
  'allergies',
  'notes',
  'comments',
];

/**
 * Redact sensitive information from objects
 */
function redactSensitiveData(obj: any, redactPHI: boolean = false): any {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveData(item, redactPHI));
  }

  const redacted: any = {};
  const fieldsToRedact = redactPHI ? [...SENSITIVE_FIELDS, ...PHI_FIELDS] : SENSITIVE_FIELDS;

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    
    if (fieldsToRedact.some(field => lowerKey.includes(field.toLowerCase()))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitiveData(value, redactPHI);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

/**
 * Check if request contains PHI
 */
function containsPHI(req: Request): boolean {
  const phiEndpoints = [
    '/api/v1/patients',
    '/api/v1/clinical',
    '/api/v1/encounters',
    '/api/v1/documents',
    '/api/v1/prescriptions',
    '/api/v1/lab-results',
    '/api/v1/imaging',
  ];

  return phiEndpoints.some(endpoint => req.path.startsWith(endpoint));
}

/**
 * Request ID middleware
 */
export function requestIdMiddleware() {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const requestId = req.headers['x-request-id'] as string || uuidv4();
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
  };
}

/**
 * Request context middleware
 */
export function requestContextMiddleware() {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const startTime = performance.now();
    const isPHI = containsPHI(req);
    
    const context: RequestContext = {
      requestId: req.requestId || uuidv4(),
      startTime,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || 'Unknown',
      method: req.method,
      path: req.path,
      query: redactSensitiveData(req.query, isPHI),
      body: req.method !== 'GET' ? redactSensitiveData(req.body, isPHI) : undefined,
    };

    // Store context in request
    (req as any).context = context;

    // Log request start
    logger.http('Request started', {
      requestId: context.requestId,
      method: context.method,
      path: context.path,
      query: context.query,
      body: context.body,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      timestamp: new Date().toISOString(),
    });

    next();
  };
}

/**
 * Response logging middleware
 */
export function responseLoggingMiddleware() {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const originalSend = res.send;
    const originalJson = res.json;
    let responseBody: any;

    // Intercept response body
    res.send = function(body: any) {
      responseBody = body;
      return originalSend.call(this, body);
    };

    res.json = function(body: any) {
      responseBody = body;
      return originalJson.call(this, body);
    };

    // Log response when finished
    res.on('finish', () => {
      const context = (req as any).context as RequestContext;
      if (!context) return;

      const endTime = performance.now();
      const responseTime = endTime - context.startTime;
      const isPHI = containsPHI(req);

      const logData = {
        requestId: context.requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        responseTime: Math.round(responseTime * 100) / 100, // Round to 2 decimal places
        contentLength: res.get('content-length'),
        userId: req.user?.id,
        userRole: req.user?.role,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        timestamp: new Date().toISOString(),
        responseBody: config.logging.logResponseBody 
          ? redactSensitiveData(responseBody, isPHI) 
          : undefined,
      };

      // Choose log level based on status code
      if (res.statusCode >= 500) {
        logger.error('Request completed with server error', logData);
      } else if (res.statusCode >= 400) {
        logger.warn('Request completed with client error', logData);
      } else {
        logger.info('Request completed successfully', logData);
      }

      // Log performance metrics
      if (responseTime > config.logging.slowRequestThreshold) {
        logger.performance('Slow request detected', {
          ...logData,
          threshold: config.logging.slowRequestThreshold,
          severity: responseTime > config.logging.slowRequestThreshold * 2 ? 'high' : 'medium',
        });
      }
    });

    next();
  };
}

/**
 * Audit logging middleware for sensitive operations
 */
export function auditLoggingMiddleware() {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const auditableOperations = [
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
    ];

    const auditableEndpoints = [
      '/api/v1/patients',
      '/api/v1/clinical',
      '/api/v1/encounters',
      '/api/v1/documents',
      '/api/v1/prescriptions',
      '/api/v1/users',
      '/api/v1/admin',
      '/api/v1/billing',
    ];

    const shouldAudit = auditableOperations.includes(req.method) &&
                       auditableEndpoints.some(endpoint => req.path.startsWith(endpoint));

    if (shouldAudit) {
      const originalSend = res.send;
      const originalJson = res.json;
      let responseBody: any;

      res.send = function(body: any) {
        responseBody = body;
        return originalSend.call(this, body);
      };

      res.json = function(body: any) {
        responseBody = body;
        return originalJson.call(this, body);
      };

      res.on('finish', () => {
        const isPHI = containsPHI(req);
        
        logger.audit('Sensitive operation performed', {
          requestId: req.requestId,
          userId: req.user?.id,
          userRole: req.user?.role,
          action: `${req.method} ${req.path}`,
          resource: req.path,
          method: req.method,
          statusCode: res.statusCode,
          success: res.statusCode < 400,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          requestBody: redactSensitiveData(req.body, isPHI),
          responseBody: res.statusCode < 400 
            ? redactSensitiveData(responseBody, isPHI)
            : undefined,
          timestamp: new Date().toISOString(),
          compliance: {
            hipaa: isPHI,
            gdpr: true, // Assuming GDPR compliance is always required
          },
        });
      });
    }

    next();
  };
}

/**
 * Security event logging middleware
 */
export function securityLoggingMiddleware() {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const securityEvents = {
      '/api/v1/auth/login': 'login_attempt',
      '/api/v1/auth/logout': 'logout',
      '/api/v1/auth/refresh': 'token_refresh',
      '/api/v1/auth/reset-password': 'password_reset_request',
      '/api/v1/auth/change-password': 'password_change',
      '/api/v1/users': 'user_management',
      '/api/v1/admin': 'admin_operation',
    };

    const eventType = Object.entries(securityEvents)
      .find(([endpoint]) => req.path.startsWith(endpoint))?.[1];

    if (eventType) {
      res.on('finish', () => {
        const severity = res.statusCode >= 400 ? 'medium' : 'low';
        
        logger.security('Security event', {
          requestId: req.requestId,
          eventType,
          userId: req.user?.id,
          userRole: req.user?.role,
          action: `${req.method} ${req.path}`,
          statusCode: res.statusCode,
          success: res.statusCode < 400,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          timestamp: new Date().toISOString(),
          severity,
          details: {
            method: req.method,
            path: req.path,
            query: redactSensitiveData(req.query),
          },
        });
      });
    }

    next();
  };
}

/**
 * Database operation logging middleware
 */
export function databaseLoggingMiddleware() {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const startTime = performance.now();
    
    // This would be integrated with Prisma middleware
    // For now, we'll log based on endpoints that typically involve database operations
    const dbOperationEndpoints = [
      '/api/v1/patients',
      '/api/v1/providers',
      '/api/v1/appointments',
      '/api/v1/clinical',
      '/api/v1/billing',
      '/api/v1/documents',
    ];

    const isDbOperation = dbOperationEndpoints.some(endpoint => 
      req.path.startsWith(endpoint)
    );

    if (isDbOperation) {
      res.on('finish', () => {
        const endTime = performance.now();
        const duration = endTime - startTime;

        logger.database('Database operation', {
          requestId: req.requestId,
          operation: `${req.method} ${req.path}`,
          duration: Math.round(duration * 100) / 100,
          statusCode: res.statusCode,
          success: res.statusCode < 400,
          userId: req.user?.id,
          timestamp: new Date().toISOString(),
        });
      });
    }

    next();
  };
}

/**
 * API integration logging middleware
 */
export function integrationLoggingMiddleware() {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const integrationEndpoints = [
      '/api/v1/fhir',
      '/api/v1/integrations',
      '/api/v1/webhooks',
      '/api/v1/external',
    ];

    const isIntegration = integrationEndpoints.some(endpoint => 
      req.path.startsWith(endpoint)
    );

    if (isIntegration) {
      const startTime = performance.now();
      
      res.on('finish', () => {
        const endTime = performance.now();
        const duration = endTime - startTime;

        logger.integration('External integration', {
          requestId: req.requestId,
          integration: req.path.split('/')[3] || 'unknown',
          operation: `${req.method} ${req.path}`,
          duration: Math.round(duration * 100) / 100,
          statusCode: res.statusCode,
          success: res.statusCode < 400,
          userId: req.user?.id,
          ipAddress: req.ip,
          timestamp: new Date().toISOString(),
        });
      });
    }

    next();
  };
}

/**
 * Business logic logging middleware
 */
export function businessLoggingMiddleware() {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const businessEvents = {
      'POST /api/v1/appointments': 'appointment_created',
      'PUT /api/v1/appointments': 'appointment_updated',
      'DELETE /api/v1/appointments': 'appointment_cancelled',
      'POST /api/v1/patients': 'patient_registered',
      'POST /api/v1/encounters': 'encounter_created',
      'POST /api/v1/prescriptions': 'prescription_created',
      'POST /api/v1/billing/invoices': 'invoice_created',
      'POST /api/v1/billing/payments': 'payment_processed',
    };

    const eventKey = `${req.method} ${req.path}`;
    const businessEvent = businessEvents[eventKey as keyof typeof businessEvents];

    if (businessEvent) {
      res.on('finish', () => {
        if (res.statusCode < 400) {
          logger.business('Business event', {
            requestId: req.requestId,
            event: businessEvent,
            userId: req.user?.id,
            userRole: req.user?.role,
            resource: req.path,
            method: req.method,
            timestamp: new Date().toISOString(),
            metadata: {
              patientId: req.body?.patientId || req.params?.patientId,
              providerId: req.body?.providerId || req.params?.providerId,
              appointmentId: req.body?.appointmentId || req.params?.appointmentId,
            },
          });
        }
      });
    }

    next();
  };
}

/**
 * Health check logging middleware
 */
export function healthLoggingMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/health') || req.path.startsWith('/api/health')) {
      res.on('finish', () => {
        logger.health('Health check', {
          path: req.path,
          statusCode: res.statusCode,
          healthy: res.statusCode === 200,
          timestamp: new Date().toISOString(),
        });
      });
    }

    next();
  };
}

/**
 * Morgan HTTP logger configuration
 */
export function configureMorgan() {
  // Custom token for request ID
  morgan.token('id', (req: AuthenticatedRequest) => req.requestId || 'unknown');
  
  // Custom token for user ID
  morgan.token('user', (req: AuthenticatedRequest) => req.user?.id || 'anonymous');
  
  // Custom token for response time in milliseconds
  morgan.token('response-time-ms', (req, res) => {
    const responseTime = morgan['response-time'](req, res);
    return responseTime ? `${responseTime}ms` : 'unknown';
  });

  const format = config.app.env === 'production'
    ? ':id :user :method :url :status :res[content-length] - :response-time-ms'
    : ':id :user :method :url :status :res[content-length] - :response-time-ms ":user-agent"';

  return morgan(format, {
    stream: {
      write: (message: string) => {
        logger.http(message.trim());
      },
    },
    skip: (req: Request) => {
      // Skip health checks and static assets
      return req.path.startsWith('/health') || 
             req.path.startsWith('/static') ||
             req.path.startsWith('/favicon');
    },
  });
}

/**
 * Error logging middleware
 */
export function errorLoggingMiddleware() {
  return (error: Error, req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const context = (req as any).context as RequestContext;
    
    logger.error('Request error', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      timestamp: new Date().toISOString(),
      context,
    });

    next(error);
  };
}

/**
 * Combine all logging middleware
 */
export function setupLoggingMiddleware() {
  return [
    requestIdMiddleware(),
    requestContextMiddleware(),
    configureMorgan(),
    responseLoggingMiddleware(),
    auditLoggingMiddleware(),
    securityLoggingMiddleware(),
    databaseLoggingMiddleware(),
    integrationLoggingMiddleware(),
    businessLoggingMiddleware(),
    healthLoggingMiddleware(),
  ];
}

/**
 * Log sanitization utility
 */
export function sanitizeLogData(data: any): any {
  return redactSensitiveData(data, true);
}

/**
 * Performance monitoring
 */
export function performanceMonitoring() {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const startTime = process.hrtime.bigint();
    
    res.on('finish', () => {
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
      
      // Log slow requests
      if (duration > config.logging.slowRequestThreshold) {
        logger.performance('Slow request detected', {
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          duration,
          threshold: config.logging.slowRequestThreshold,
          userId: req.user?.id,
          timestamp: new Date().toISOString(),
        });
      }
      
      // Memory usage monitoring
      const memUsage = process.memoryUsage();
      if (memUsage.heapUsed > 100 * 1024 * 1024) { // 100MB threshold
        logger.performance('High memory usage detected', {
          requestId: req.requestId,
          memoryUsage: {
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
            external: Math.round(memUsage.external / 1024 / 1024),
            rss: Math.round(memUsage.rss / 1024 / 1024),
          },
          timestamp: new Date().toISOString(),
        });
      }
    });
    
    next();
  };
}