/**
 * ============================================================================
 * NOVA CHECK EHR - CORS MIDDLEWARE
 * ============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config } from '../config/config';
import logger from '../config/logger';

/**
 * CORS middleware configuration
 */
export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      return callback(null, true);
    }
    
    const allowedOrigins = config.cors.allowedOrigins;
    
    // Check if origin is allowed
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    
    // Log CORS violation
    logger.security('CORS policy violation', {
      origin,
      allowedOrigins,
      severity: 'medium',
      action: 'cors_violation',
      timestamp: new Date().toISOString(),
    });
    
    const error = new Error(`CORS policy violation: Origin ${origin} not allowed`);
    return callback(error, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'Cache-Control',
    'Pragma',
    'X-API-Key',
    'X-Client-Version',
    'X-Request-ID',
  ],
  exposedHeaders: [
    'X-Total-Count',
    'X-Page-Count',
    'X-Current-Page',
    'X-Per-Page',
    'X-Rate-Limit-Limit',
    'X-Rate-Limit-Remaining',
    'X-Rate-Limit-Reset',
    'X-Request-ID',
  ],
  maxAge: 86400, // 24 hours
  optionsSuccessStatus: 200, // Some legacy browsers choke on 204
});

/**
 * Custom CORS handler for specific routes
 */
export function customCorsHandler(allowedOrigins: string[] = []) {
  return cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        return callback(null, true);
      }
      
      logger.warn('Custom CORS rejection', {
        origin,
        allowedOrigins,
        timestamp: new Date().toISOString(),
      });
      
      const error = new Error(`Origin ${origin} not allowed by custom CORS policy`);
      return callback(error, false);
    },
    credentials: true,
  });
}

export default corsMiddleware;