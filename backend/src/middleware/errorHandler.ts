/**
 * ============================================================================
 * NOVA CHECK EHR - ERROR HANDLING MIDDLEWARE
 * ============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import logger from '../config/logger';
import { config } from '../config/config';
import { AuthenticatedRequest } from './auth';

/**
 * Custom error classes
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly errorCode?: string;
  public readonly details?: any;

  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    errorCode?: string,
    details?: any
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.errorCode = errorCode;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 400, true, 'VALIDATION_ERROR', details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401, true, 'AUTHENTICATION_ERROR');
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Access denied') {
    super(message, 403, true, 'AUTHORIZATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, true, 'NOT_FOUND_ERROR');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, true, 'CONFLICT_ERROR');
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 429, true, 'RATE_LIMIT_ERROR');
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message?: string) {
    super(
      message || `External service ${service} is unavailable`,
      503,
      true,
      'EXTERNAL_SERVICE_ERROR',
      { service }
    );
  }
}

export class HIPAAViolationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 403, true, 'HIPAA_VIOLATION_ERROR', details);
  }
}

/**
 * Error response interface
 */
interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  timestamp: string;
  path: string;
  requestId?: string;
  errorCode?: string;
  details?: any;
  stack?: string;
}

/**
 * Format error response
 */
function formatErrorResponse(
  error: Error,
  req: Request,
  statusCode: number = 500
): ErrorResponse {
  const response: ErrorResponse = {
    error: error.name || 'Internal Server Error',
    message: error.message || 'An unexpected error occurred',
    statusCode,
    timestamp: new Date().toISOString(),
    path: req.path,
    requestId: (req as AuthenticatedRequest).requestId,
  };

  if (error instanceof AppError) {
    response.errorCode = error.errorCode;
    response.details = error.details;
  }

  // Include stack trace in development
  if (config.app.env === 'development') {
    response.stack = error.stack;
  }

  return response;
}

/**
 * Handle Prisma errors
 */
function handlePrismaError(error: Prisma.PrismaClientKnownRequestError): AppError {
  switch (error.code) {
    case 'P2002':
      // Unique constraint violation
      const field = error.meta?.target as string[];
      return new ConflictError(
        `A record with this ${field?.join(', ') || 'value'} already exists`
      );
    
    case 'P2025':
      // Record not found
      return new NotFoundError('Record');
    
    case 'P2003':
      // Foreign key constraint violation
      return new ValidationError(
        'Cannot perform this operation due to related records'
      );
    
    case 'P2014':
      // Required relation violation
      return new ValidationError(
        'The change you are trying to make would violate the required relation'
      );
    
    case 'P2021':
      // Table does not exist
      return new AppError(
        'Database table does not exist',
        500,
        false,
        'DATABASE_ERROR'
      );
    
    case 'P2022':
      // Column does not exist
      return new AppError(
        'Database column does not exist',
        500,
        false,
        'DATABASE_ERROR'
      );
    
    default:
      return new AppError(
        'Database operation failed',
        500,
        false,
        'DATABASE_ERROR',
        { code: error.code, meta: error.meta }
      );
  }
}

/**
 * Handle JWT errors
 */
function handleJWTError(error: JsonWebTokenError): AppError {
  if (error instanceof TokenExpiredError) {
    return new AuthenticationError('Token has expired');
  }
  
  return new AuthenticationError('Invalid token');
}

/**
 * Handle Multer errors
 */
function handleMulterError(error: MulterError): AppError {
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return new ValidationError('File size too large');
    
    case 'LIMIT_FILE_COUNT':
      return new ValidationError('Too many files');
    
    case 'LIMIT_UNEXPECTED_FILE':
      return new ValidationError('Unexpected file field');
    
    case 'LIMIT_PART_COUNT':
      return new ValidationError('Too many parts');
    
    case 'LIMIT_FIELD_KEY':
      return new ValidationError('Field name too long');
    
    case 'LIMIT_FIELD_VALUE':
      return new ValidationError('Field value too long');
    
    case 'LIMIT_FIELD_COUNT':
      return new ValidationError('Too many fields');
    
    default:
      return new ValidationError('File upload error');
  }
}

/**
 * Handle Zod validation errors
 */
function handleZodError(error: ZodError): AppError {
  const details = error.errors.map(err => ({
    field: err.path.join('.'),
    message: err.message,
    code: err.code,
  }));

  return new ValidationError('Validation failed', details);
}

/**
 * Handle MongoDB errors (if using MongoDB)
 */
function handleMongoError(error: any): AppError {
  if (error.code === 11000) {
    // Duplicate key error
    const field = Object.keys(error.keyPattern)[0];
    return new ConflictError(`A record with this ${field} already exists`);
  }
  
  return new AppError('Database operation failed', 500, false, 'DATABASE_ERROR');
}

/**
 * Log error with appropriate level
 */
function logError(error: Error, req: Request, statusCode: number): void {
  const logData = {
    error: error.message,
    stack: error.stack,
    statusCode,
    method: req.method,
    path: req.path,
    query: req.query,
    body: req.method !== 'GET' ? req.body : undefined,
    headers: {
      'user-agent': req.headers['user-agent'],
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'authorization': req.headers.authorization ? '[REDACTED]' : undefined,
    },
    ipAddress: req.ip,
    requestId: (req as AuthenticatedRequest).requestId,
    userId: (req as AuthenticatedRequest).user?.id,
    timestamp: new Date().toISOString(),
  };

  if (statusCode >= 500) {
    logger.error('Server error', logData);
  } else if (statusCode >= 400) {
    logger.warn('Client error', logData);
  } else {
    logger.info('Request completed with error', logData);
  }

  // Log security-related errors
  if (error instanceof AuthenticationError || 
      error instanceof AuthorizationError ||
      error instanceof HIPAAViolationError) {
    logger.security('Security error', {
      ...logData,
      severity: statusCode >= 500 ? 'high' : 'medium',
      action: 'security_error',
    });
  }
}

/**
 * Main error handling middleware
 */
export function errorHandler() {
  return (error: Error, req: Request, res: Response, next: NextFunction) => {
    let appError: AppError;

    // Convert known errors to AppError
    if (error instanceof AppError) {
      appError = error;
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      appError = handlePrismaError(error);
    } else if (error instanceof Prisma.PrismaClientValidationError) {
      appError = new ValidationError('Invalid data provided to database');
    } else if (error instanceof JsonWebTokenError) {
      appError = handleJWTError(error);
    } else if (error instanceof MulterError) {
      appError = handleMulterError(error);
    } else if (error instanceof ZodError) {
      appError = handleZodError(error);
    } else if (error.name === 'MongoError') {
      appError = handleMongoError(error);
    } else if (error.name === 'CastError') {
      appError = new ValidationError('Invalid ID format');
    } else if (error.name === 'ValidationError') {
      appError = new ValidationError(error.message);
    } else {
      // Unknown error
      appError = new AppError(
        config.app.env === 'production' 
          ? 'Something went wrong' 
          : error.message,
        500,
        false
      );
    }

    // Log the error
    logError(appError, req, appError.statusCode);

    // Send error response
    const errorResponse = formatErrorResponse(appError, req, appError.statusCode);
    
    // Remove sensitive information in production
    if (config.app.env === 'production') {
      delete errorResponse.stack;
      
      // Generic message for 5xx errors
      if (appError.statusCode >= 500 && !appError.isOperational) {
        errorResponse.message = 'Internal server error';
        delete errorResponse.details;
      }
    }

    res.status(appError.statusCode).json(errorResponse);
  };
}

/**
 * 404 handler for unmatched routes
 */
export function notFoundHandler() {
  return (req: Request, res: Response, next: NextFunction) => {
    const error = new NotFoundError(`Route ${req.method} ${req.path}`);
    next(error);
  };
}

/**
 * Async error wrapper
 */
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: T, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Global exception handlers
 */
export function setupGlobalErrorHandlers(): void {
  // Handle uncaught exceptions
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception', {
      error: error.message,
      stack: error.stack,
      severity: 'critical',
    });
    
    // Graceful shutdown
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    logger.error('Unhandled Rejection', {
      reason: reason instanceof Error ? reason.message : reason,
      stack: reason instanceof Error ? reason.stack : undefined,
      promise: promise.toString(),
      severity: 'critical',
    });
    
    // Graceful shutdown
    process.exit(1);
  });

  // Handle warnings
  process.on('warning', (warning: Error) => {
    logger.warn('Process Warning', {
      name: warning.name,
      message: warning.message,
      stack: warning.stack,
    });
  });
}

/**
 * Health check error
 */
export class HealthCheckError extends AppError {
  constructor(service: string, details?: any) {
    super(
      `Health check failed for ${service}`,
      503,
      true,
      'HEALTH_CHECK_ERROR',
      details
    );
  }
}

/**
 * Rate limit exceeded error
 */
export function createRateLimitError(retryAfter?: number): RateLimitError {
  const error = new RateLimitError('Too many requests, please try again later');
  if (retryAfter) {
    error.details = { retryAfter };
  }
  return error;
}

/**
 * FHIR-specific errors
 */
export class FHIRError extends AppError {
  constructor(message: string, statusCode: number = 400, details?: any) {
    super(message, statusCode, true, 'FHIR_ERROR', details);
  }
}

/**
 * Integration errors
 */
export class IntegrationError extends AppError {
  constructor(integration: string, message: string, details?: any) {
    super(
      `${integration} integration error: ${message}`,
      502,
      true,
      'INTEGRATION_ERROR',
      { integration, ...details }
    );
  }
}

/**
 * File processing errors
 */
export class FileProcessingError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 422, true, 'FILE_PROCESSING_ERROR', details);
  }
}

/**
 * Payment processing errors
 */
export class PaymentError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 402, true, 'PAYMENT_ERROR', details);
  }
}

/**
 * AI/ML service errors
 */
export class AIServiceError extends AppError {
  constructor(service: string, message: string, details?: any) {
    super(
      `AI service ${service} error: ${message}`,
      503,
      true,
      'AI_SERVICE_ERROR',
      { service, ...details }
    );
  }
}

/**
 * Error factory for common scenarios
 */
export const ErrorFactory = {
  validation: (message: string, details?: any) => new ValidationError(message, details),
  authentication: (message?: string) => new AuthenticationError(message),
  authorization: (message?: string) => new AuthorizationError(message),
  notFound: (resource?: string) => new NotFoundError(resource),
  conflict: (message: string) => new ConflictError(message),
  rateLimit: (retryAfter?: number) => createRateLimitError(retryAfter),
  external: (service: string, message?: string) => new ExternalServiceError(service, message),
  hipaa: (message: string, details?: any) => new HIPAAViolationError(message, details),
  fhir: (message: string, statusCode?: number, details?: any) => new FHIRError(message, statusCode, details),
  integration: (integration: string, message: string, details?: any) => new IntegrationError(integration, message, details),
  file: (message: string, details?: any) => new FileProcessingError(message, details),
  payment: (message: string, details?: any) => new PaymentError(message, details),
  ai: (service: string, message: string, details?: any) => new AIServiceError(service, message, details),
};

/**
 * Error monitoring and alerting
 */
export function shouldAlert(error: AppError): boolean {
  // Alert on server errors, security errors, and critical business errors
  return (
    error.statusCode >= 500 ||
    error instanceof HIPAAViolationError ||
    error instanceof ExternalServiceError ||
    error instanceof PaymentError ||
    !error.isOperational
  );
}

/**
 * Error metrics collection
 */
export function collectErrorMetrics(error: AppError, req: Request): void {
  // This would integrate with your metrics collection system
  // For example, Prometheus, DataDog, etc.
  const metrics = {
    errorType: error.constructor.name,
    statusCode: error.statusCode,
    errorCode: error.errorCode,
    path: req.path,
    method: req.method,
    timestamp: Date.now(),
  };
  
  // Send to metrics collector
  logger.info('Error metrics', metrics);
}