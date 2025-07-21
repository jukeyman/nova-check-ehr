/**
 * ============================================================================
 * NOVA CHECK EHR - HIPAA COMPLIANCE MIDDLEWARE
 * ============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';
import { AuthenticatedRequest } from './auth';
import { config } from '../config/config';

/**
 * HIPAA compliance middleware
 * Ensures all requests comply with HIPAA requirements
 */
export function hipaaMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  // Add HIPAA-compliant headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  // Remove server information
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');

  // Log PHI access attempts
  const phiEndpoints = [
    '/api/patients',
    '/api/clinical',
    '/api/encounters',
    '/api/documents',
    '/api/billing',
  ];

  const isPHIEndpoint = phiEndpoints.some(endpoint => req.path.startsWith(endpoint));
  
  if (isPHIEndpoint) {
    logger.audit('PHI access attempt', {
      userId: req.user?.id,
      method: req.method,
      path: req.path,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    });

    // Ensure user is authenticated for PHI access
    if (!req.user) {
      logger.security('Unauthorized PHI access attempt', {
        method: req.method,
        path: req.path,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        severity: 'high',
        timestamp: new Date().toISOString(),
      });
      
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Access to protected health information requires authentication',
        code: 'HIPAA_AUTH_REQUIRED',
      });
    }
  }

  // Add audit trail for sensitive operations
  const sensitiveOperations = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (sensitiveOperations.includes(req.method) && isPHIEndpoint) {
    res.on('finish', () => {
      logger.audit('PHI modification', {
        userId: req.user?.id,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
        success: res.statusCode < 400,
      });
    });
  }

  next();
}

export default hipaaMiddleware;