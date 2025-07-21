/**
 * ============================================================================
 * NOVA CHECK EHR - SECURITY MIDDLEWARE
 * ============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import { body, param, query, validationResult } from 'express-validator';
import { config } from '../config/config';
import logger from '../config/logger';
import { cache } from '../config/redis';
import { AuthenticatedRequest } from './auth';
import crypto from 'crypto';
import { UserRole } from '@prisma/client';

/**
 * CORS configuration
 */
export function configureCORS() {
  const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);
      
      if (config.cors.allowedOrigins.includes(origin) || 
          config.cors.allowedOrigins.includes('*')) {
        callback(null, true);
      } else {
        logger.security('CORS origin blocked', {
          origin,
          severity: 'medium',
          action: 'cors_blocked',
        });
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: config.cors.allowedMethods,
    allowedHeaders: config.cors.allowedHeaders,
    credentials: config.cors.credentials,
    maxAge: config.cors.maxAge,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  };

  return cors(corsOptions);
}

/**
 * Helmet security headers configuration
 */
export function configureHelmet() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", 'https://api.openai.com'],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    noSniff: true,
    frameguard: { action: 'deny' },
    xssFilter: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
}

/**
 * Rate limiting configurations
 */
export const rateLimiters = {
  // General API rate limiting
  general: rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    message: {
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.security('Rate limit exceeded', {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        path: req.path,
        severity: 'medium',
        action: 'rate_limit_exceeded',
      });
      
      res.status(429).json({
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
      });
    },
  }),

  // Strict rate limiting for authentication endpoints
  auth: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    skipSuccessfulRequests: true,
    message: {
      error: 'Too many authentication attempts',
      message: 'Too many login attempts. Please try again later.',
    },
    handler: (req, res) => {
      logger.security('Auth rate limit exceeded', {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        severity: 'high',
        action: 'auth_rate_limit_exceeded',
      });
      
      res.status(429).json({
        error: 'Too many authentication attempts',
        message: 'Too many login attempts. Please try again later.',
      });
    },
  }),

  // API key rate limiting
  apiKey: rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    keyGenerator: (req) => {
      return req.headers['x-api-key'] as string || req.ip;
    },
  }),

  // File upload rate limiting
  upload: rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 uploads per minute
    message: {
      error: 'Too many upload attempts',
      message: 'Upload rate limit exceeded. Please try again later.',
    },
  }),
};

/**
 * Request ID middleware
 */
export function requestId() {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const requestId = req.headers['x-request-id'] as string || 
                     crypto.randomUUID();
    
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    
    next();
  };
}

/**
 * Request size limiting
 */
export function requestSizeLimit() {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = parseInt(req.headers['content-length'] || '0');
    const maxSize = config.security.maxRequestSize;
    
    if (contentLength > maxSize) {
      logger.security('Request size limit exceeded', {
        contentLength,
        maxSize,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        severity: 'medium',
        action: 'request_size_exceeded',
      });
      
      return res.status(413).json({
        error: 'Request too large',
        message: `Request size exceeds maximum allowed size of ${maxSize} bytes`,
      });
    }
    
    next();
  };
}

/**
 * IP whitelist/blacklist middleware
 */
export function ipFilter() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const clientIP = req.ip;
    
    try {
      // Check if IP is blacklisted
      const isBlacklisted = await cache.exists(`blacklist:ip:${clientIP}`);
      if (isBlacklisted) {
        logger.security('Blacklisted IP access attempt', {
          ipAddress: clientIP,
          userAgent: req.headers['user-agent'],
          path: req.path,
          severity: 'high',
          action: 'blacklisted_ip_access',
        });
        
        return res.status(403).json({
          error: 'Access denied',
          message: 'Your IP address has been blocked',
        });
      }
      
      // Check whitelist if configured
      if (config.security.ipWhitelist.length > 0) {
        const isWhitelisted = config.security.ipWhitelist.includes(clientIP);
        if (!isWhitelisted) {
          logger.security('Non-whitelisted IP access attempt', {
            ipAddress: clientIP,
            userAgent: req.headers['user-agent'],
            path: req.path,
            severity: 'medium',
            action: 'non_whitelisted_ip_access',
          });
          
          return res.status(403).json({
            error: 'Access denied',
            message: 'Your IP address is not authorized',
          });
        }
      }
      
      next();
    } catch (error) {
      logger.error('IP filter middleware error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: clientIP,
      });
      
      // Continue on error to avoid blocking legitimate requests
      next();
    }
  };
}

/**
 * User agent validation
 */
export function validateUserAgent() {
  return (req: Request, res: Response, next: NextFunction) => {
    const userAgent = req.headers['user-agent'];
    
    if (!userAgent) {
      logger.security('Request without user agent', {
        ipAddress: req.ip,
        path: req.path,
        severity: 'low',
        action: 'missing_user_agent',
      });
    }
    
    // Block known malicious user agents
    const maliciousPatterns = [
      /sqlmap/i,
      /nikto/i,
      /nessus/i,
      /burp/i,
      /nmap/i,
      /masscan/i,
    ];
    
    if (userAgent && maliciousPatterns.some(pattern => pattern.test(userAgent))) {
      logger.security('Malicious user agent detected', {
        userAgent,
        ipAddress: req.ip,
        path: req.path,
        severity: 'high',
        action: 'malicious_user_agent',
      });
      
      return res.status(403).json({
        error: 'Access denied',
        message: 'Suspicious user agent detected',
      });
    }
    
    next();
  };
}

/**
 * API key validation middleware
 */
export function validateApiKey() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'] as string;
    
    if (!apiKey) {
      return res.status(401).json({
        error: 'API key required',
        message: 'X-API-Key header is required',
      });
    }
    
    try {
      // Check if API key exists and is valid
      const keyData = await cache.get(`api_key:${apiKey}`);
      
      if (!keyData) {
        logger.security('Invalid API key used', {
          apiKey: apiKey.substring(0, 8) + '...',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          severity: 'medium',
          action: 'invalid_api_key',
        });
        
        return res.status(401).json({
          error: 'Invalid API key',
          message: 'The provided API key is not valid',
        });
      }
      
      // Add API key info to request
      (req as any).apiKey = keyData;
      
      next();
    } catch (error) {
      logger.error('API key validation error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: req.ip,
      });
      
      return res.status(500).json({
        error: 'Internal server error',
        message: 'API key validation failed',
      });
    }
  };
}

/**
 * Input sanitization middleware
 */
export function sanitizeInput() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Sanitize common XSS patterns
    const sanitize = (obj: any): any => {
      if (typeof obj === 'string') {
        return obj
          .replace(/<script[^>]*>.*?<\/script>/gi, '')
          .replace(/<[^>]*>/g, '')
          .replace(/javascript:/gi, '')
          .replace(/on\w+=/gi, '');
      }
      
      if (Array.isArray(obj)) {
        return obj.map(sanitize);
      }
      
      if (obj && typeof obj === 'object') {
        const sanitized: any = {};
        for (const [key, value] of Object.entries(obj)) {
          sanitized[key] = sanitize(value);
        }
        return sanitized;
      }
      
      return obj;
    };
    
    if (req.body) {
      req.body = sanitize(req.body);
    }
    
    if (req.query) {
      req.query = sanitize(req.query);
    }
    
    next();
  };
}

/**
 * SQL injection detection
 */
export function detectSQLInjection() {
  return (req: Request, res: Response, next: NextFunction) => {
    const sqlPatterns = [
      /('|(\-\-)|(;)|(\||\|)|(\*|\*))/i,
      /(union|select|insert|delete|update|drop|create|alter|exec|execute)/i,
      /(script|javascript|vbscript|onload|onerror|onclick)/i,
    ];
    
    const checkForSQLInjection = (obj: any, path: string = ''): boolean => {
      if (typeof obj === 'string') {
        return sqlPatterns.some(pattern => pattern.test(obj));
      }
      
      if (Array.isArray(obj)) {
        return obj.some((item, index) => 
          checkForSQLInjection(item, `${path}[${index}]`)
        );
      }
      
      if (obj && typeof obj === 'object') {
        return Object.entries(obj).some(([key, value]) => 
          checkForSQLInjection(value, path ? `${path}.${key}` : key)
        );
      }
      
      return false;
    };
    
    const suspicious = [
      checkForSQLInjection(req.body, 'body'),
      checkForSQLInjection(req.query, 'query'),
      checkForSQLInjection(req.params, 'params'),
    ].some(Boolean);
    
    if (suspicious) {
      logger.security('SQL injection attempt detected', {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        path: req.path,
        method: req.method,
        body: req.body,
        query: req.query,
        params: req.params,
        severity: 'high',
        action: 'sql_injection_attempt',
      });
      
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Suspicious input detected',
      });
    }
    
    next();
  };
}

/**
 * HIPAA compliance middleware
 */
export function hipaaCompliance() {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // Add HIPAA-required headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    // Log access to PHI endpoints
    const phiEndpoints = [
      '/api/v1/patients',
      '/api/v1/clinical',
      '/api/v1/encounters',
      '/api/v1/documents',
    ];
    
    const isPHIEndpoint = phiEndpoints.some(endpoint => 
      req.path.startsWith(endpoint)
    );
    
    if (isPHIEndpoint && req.user) {
      logger.audit('PHI access', {
        userId: req.user.id,
        action: 'phi_access',
        resource: req.path,
        method: req.method,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        timestamp: new Date(),
        success: true,
      });
    }
    
    next();
  };
}

/**
 * Validation error handler
 */
export function handleValidationErrors() {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
      logger.warn('Validation errors', {
        errors: errors.array(),
        path: req.path,
        method: req.method,
        ipAddress: req.ip,
      });
      
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Invalid input data',
        details: errors.array().map(error => ({
          field: error.type === 'field' ? error.path : error.type,
          message: error.msg,
          value: error.type === 'field' ? error.value : undefined,
        })),
      });
    }
    
    next();
  };
}

/**
 * Common validation rules
 */
export const validationRules = {
  // User validation
  email: body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  
  password: body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain uppercase, lowercase, number and special character'),
  
  name: body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be between 1 and 100 characters'),
  
  phone: body('phone')
    .optional()
    .isMobilePhone('any')
    .withMessage('Valid phone number is required'),
  
  // ID validation
  uuid: param('id')
    .isUUID()
    .withMessage('Valid UUID is required'),
  
  // Pagination validation
  page: query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  limit: query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  
  // Date validation
  date: body('date')
    .isISO8601()
    .withMessage('Valid ISO 8601 date is required'),
  
  dateRange: [
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Valid start date is required'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('Valid end date is required'),
  ],
};

/**
 * Role-based endpoint protection
 */
export function protectEndpoint(allowedRoles: UserRole[]) {
  return [
    requestId(),
    rateLimiters.general,
    hipaaCompliance(),
    sanitizeInput(),
    detectSQLInjection(),
    // Authentication and authorization will be added by specific route handlers
  ];
}

/**
 * Public endpoint protection (no authentication required)
 */
export function protectPublicEndpoint() {
  return [
    requestId(),
    rateLimiters.general,
    sanitizeInput(),
    detectSQLInjection(),
  ];
}

/**
 * Admin endpoint protection
 */
export function protectAdminEndpoint() {
  return [
    requestId(),
    rateLimiters.general,
    hipaaCompliance(),
    sanitizeInput(),
    detectSQLInjection(),
    // Admin authentication will be added by route handlers
  ];
}

/**
 * Suspicious activity detection
 */
export function detectSuspiciousActivity() {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const key = `suspicious:${req.ip}`;
      const suspiciousCount = await cache.get<number>(key) || 0;
      
      // Increment suspicious activity counter
      await cache.set(key, suspiciousCount + 1, 3600); // 1 hour TTL
      
      // If too many suspicious activities, temporarily block
      if (suspiciousCount > 10) {
        logger.security('Suspicious activity threshold exceeded', {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          suspiciousCount,
          severity: 'high',
          action: 'suspicious_activity_block',
        });
        
        // Temporarily blacklist IP
        await cache.set(`blacklist:ip:${req.ip}`, true, 3600);
        
        return res.status(403).json({
          error: 'Access temporarily restricted',
          message: 'Suspicious activity detected. Access temporarily restricted.',
        });
      }
      
      next();
    } catch (error) {
      logger.error('Suspicious activity detection error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: req.ip,
      });
      
      // Continue on error
      next();
    }
  };
}

/**
 * Combined security middleware
 */
export function securityMiddleware() {
  return [
    requestId(),
    sanitizeInput(),
    detectSQLInjection(),
    detectSuspiciousActivity(),
  ];
}

// Default export for convenience
export default securityMiddleware;