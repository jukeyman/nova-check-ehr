/**
 * ============================================================================
 * NOVA CHECK EHR - REQUEST LOGGER MIDDLEWARE
 * ============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import logger from '../config/logger';
import { AuthenticatedRequest } from './auth';

/**
 * Request logger middleware
 */
export function requestLogger(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] as string || uuidv4();
  
  // Add request ID to request object
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  // Log request start
  logger.info('Request started', {
    requestId,
    method: req.method,
    url: req.originalUrl,
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip,
    userId: req.user?.id,
    timestamp: new Date().toISOString(),
  });

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
    
    logger[logLevel]('Request completed', {
      requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
      userId: req.user?.id,
      timestamp: new Date().toISOString(),
    });
  });

  next();
}

export default requestLogger;