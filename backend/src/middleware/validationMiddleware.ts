import { Request, Response, NextFunction } from 'express';
import { validationResult, ValidationChain } from 'express-validator';
import { logger } from '../utils/logger';

/**
 * Validation middleware for Nova Check EHR
 * Handles request validation and error formatting
 */

/**
 * Main validation middleware that processes validation results
 */
export function validationMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
      const errorDetails = errors.array().map(error => ({
        field: error.type === 'field' ? error.path : error.type,
        message: error.msg,
        value: error.type === 'field' ? error.value : undefined,
        location: error.type === 'field' ? error.location : undefined,
      }));
      
      logger.warn('Validation failed', {
        path: req.path,
        method: req.method,
        errors: errorDetails,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      
      return res.status(400).json({
        error: 'Validation Error',
        message: 'The request contains invalid data',
        details: errorDetails,
        timestamp: new Date().toISOString(),
      });
    }
    
    next();
  };
}

/**
 * Validation middleware that runs validation chains and then checks results
 */
export function validate(validations: ValidationChain[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Run all validations
    await Promise.all(validations.map(validation => validation.run(req)));
    
    // Check for validation errors
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
      const errorDetails = errors.array().map(error => ({
        field: error.type === 'field' ? error.path : error.type,
        message: error.msg,
        value: error.type === 'field' ? error.value : undefined,
        location: error.type === 'field' ? error.location : undefined,
      }));
      
      logger.warn('Validation failed', {
        path: req.path,
        method: req.method,
        errors: errorDetails,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      
      return res.status(400).json({
        error: 'Validation Error',
        message: 'The request contains invalid data',
        details: errorDetails,
        timestamp: new Date().toISOString(),
      });
    }
    
    next();
  };
}

/**
 * Sanitize request data middleware
 */
export function sanitizeRequest() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Sanitize query parameters
    if (req.query) {
      for (const key in req.query) {
        if (typeof req.query[key] === 'string') {
          req.query[key] = (req.query[key] as string).trim();
        }
      }
    }
    
    // Sanitize body parameters
    if (req.body && typeof req.body === 'object') {
      sanitizeObject(req.body);
    }
    
    next();
  };
}

/**
 * Recursively sanitize object properties
 */
function sanitizeObject(obj: any): void {
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      if (typeof obj[key] === 'string') {
        obj[key] = obj[key].trim();
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitizeObject(obj[key]);
      }
    }
  }
}

/**
 * Validation error formatter
 */
export function formatValidationErrors(errors: any[]) {
  return errors.map(error => ({
    field: error.path || error.param,
    message: error.msg,
    value: error.value,
    location: error.location,
  }));
}

/**
 * Check if request has validation errors
 */
export function hasValidationErrors(req: Request): boolean {
  const errors = validationResult(req);
  return !errors.isEmpty();
}

/**
 * Get validation errors from request
 */
export function getValidationErrors(req: Request) {
  const errors = validationResult(req);
  return errors.array();
}

/**
 * Middleware to handle file upload validation
 */
export function validateFileUpload(options: {
  maxSize?: number;
  allowedTypes?: string[];
  required?: boolean;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const { maxSize = 10 * 1024 * 1024, allowedTypes = [], required = false } = options;
    
    // Check if file is required
    if (required && (!req.file && !req.files)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'File upload is required',
        timestamp: new Date().toISOString(),
      });
    }
    
    // If no file uploaded and not required, continue
    if (!req.file && !req.files) {
      return next();
    }
    
    const files = req.files ? (Array.isArray(req.files) ? req.files : [req.file]) : [req.file];
    
    for (const file of files) {
      if (!file) continue;
      
      // Check file size
      if (file.size > maxSize) {
        return res.status(400).json({
          error: 'Validation Error',
          message: `File size exceeds maximum allowed size of ${maxSize} bytes`,
          details: {
            filename: file.originalname,
            size: file.size,
            maxSize,
          },
          timestamp: new Date().toISOString(),
        });
      }
      
      // Check file type
      if (allowedTypes.length > 0 && !allowedTypes.includes(file.mimetype)) {
        return res.status(400).json({
          error: 'Validation Error',
          message: `File type not allowed. Allowed types: ${allowedTypes.join(', ')}`,
          details: {
            filename: file.originalname,
            mimetype: file.mimetype,
            allowedTypes,
          },
          timestamp: new Date().toISOString(),
        });
      }
    }
    
    next();
  };
}

// Default export
export default validationMiddleware;