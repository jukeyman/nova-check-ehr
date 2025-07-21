/**
 * ============================================================================
 * NOVA CHECK EHR - ERROR HANDLING UTILITIES
 * ============================================================================
 */

import { Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { logger } from './logger';

// ============================================================================
// ERROR TYPES AND INTERFACES
// ============================================================================

export interface ErrorDetails {
  code: string;
  message: string;
  field?: string;
  value?: any;
  context?: Record<string, any>;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ErrorDetails[];
    timestamp: string;
    requestId?: string;
    path?: string;
  };
}

export interface ValidationErrorDetail {
  field: string;
  message: string;
  value?: any;
}

// ============================================================================
// CUSTOM ERROR CLASSES
// ============================================================================

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly details?: ErrorDetails[];
  public readonly context?: Record<string, any>;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = 'INTERNAL_ERROR',
    isOperational: boolean = true,
    details?: ErrorDetails[],
    context?: Record<string, any>
  ) {
    super(message);
    
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.details = details;
    this.context = context;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: ErrorDetails[]) {
    super(message, 400, 'VALIDATION_ERROR', true, details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message?: string) {
    super(
      message || `External service ${service} is unavailable`,
      503,
      'EXTERNAL_SERVICE_ERROR',
      true,
      undefined,
      { service }
    );
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, originalError?: Error) {
    super(message, 500, 'DATABASE_ERROR', true, undefined, {
      originalError: originalError?.message,
    });
  }
}

export class FileUploadError extends AppError {
  constructor(message: string) {
    super(message, 400, 'FILE_UPLOAD_ERROR');
  }
}

export class BusinessLogicError extends AppError {
  constructor(message: string, code: string = 'BUSINESS_LOGIC_ERROR') {
    super(message, 422, code);
  }
}

// ============================================================================
// ERROR HANDLING FUNCTIONS
// ============================================================================

/**
 * Handle Zod validation errors
 */
export function handleZodError(error: ZodError): ValidationError {
  const details: ErrorDetails[] = error.errors.map((err) => ({
    code: 'VALIDATION_ERROR',
    message: err.message,
    field: err.path.join('.'),
    value: err.code === 'invalid_type' ? undefined : err.input,
  }));

  return new ValidationError('Validation failed', details);
}

/**
 * Handle Prisma errors
 */
export function handlePrismaError(error: any): AppError {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        // Unique constraint violation
        const field = error.meta?.target as string[] | undefined;
        const fieldName = field ? field[0] : 'field';
        return new ConflictError(`${fieldName} already exists`);
      
      case 'P2025':
        // Record not found
        return new NotFoundError('Record');
      
      case 'P2003':
        // Foreign key constraint violation
        return new ValidationError('Invalid reference to related record');
      
      case 'P2014':
        // Required relation violation
        return new ValidationError('Required relation is missing');
      
      case 'P2021':
        // Table does not exist
        return new DatabaseError('Database table does not exist');
      
      case 'P2022':
        // Column does not exist
        return new DatabaseError('Database column does not exist');
      
      default:
        logger.error('Unhandled Prisma error', {
          code: error.code,
          message: error.message,
          meta: error.meta,
        });
        return new DatabaseError('Database operation failed');
    }
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    logger.error('Unknown Prisma error', { message: error.message });
    return new DatabaseError('Unknown database error occurred');
  }

  if (error instanceof Prisma.PrismaClientRustPanicError) {
    logger.error('Prisma client panic', { message: error.message });
    return new DatabaseError('Database client error');
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    logger.error('Prisma initialization error', { message: error.message });
    return new DatabaseError('Database connection failed');
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    logger.error('Prisma validation error', { message: error.message });
    return new ValidationError('Invalid database query parameters');
  }

  // Fallback for unknown Prisma errors
  logger.error('Unknown Prisma error type', {
    name: error.constructor.name,
    message: error.message,
  });
  return new DatabaseError('Database operation failed');
}

/**
 * Handle JWT errors
 */
export function handleJWTError(error: any): AppError {
  if (error.name === 'JsonWebTokenError') {
    return new AuthenticationError('Invalid token');
  }
  
  if (error.name === 'TokenExpiredError') {
    return new AuthenticationError('Token expired');
  }
  
  if (error.name === 'NotBeforeError') {
    return new AuthenticationError('Token not active');
  }
  
  return new AuthenticationError('Token validation failed');
}

/**
 * Handle file upload errors
 */
export function handleMulterError(error: any): AppError {
  if (error.code === 'LIMIT_FILE_SIZE') {
    return new FileUploadError('File size exceeds limit');
  }
  
  if (error.code === 'LIMIT_FILE_COUNT') {
    return new FileUploadError('Too many files uploaded');
  }
  
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return new FileUploadError('Unexpected file field');
  }
  
  return new FileUploadError('File upload failed');
}

/**
 * Create standardized error response
 */
export function createErrorResponse(
  error: AppError,
  requestId?: string,
  path?: string
): ErrorResponse {
  return {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
      timestamp: new Date().toISOString(),
      requestId,
      path,
    },
  };
}

/**
 * Send error response
 */
export function sendErrorResponse(
  res: Response,
  error: AppError,
  requestId?: string
): void {
  const errorResponse = createErrorResponse(error, requestId, res.req?.path);
  
  // Log error for monitoring
  if (error.statusCode >= 500) {
    logger.error('Server error', {
      error: {
        message: error.message,
        code: error.code,
        stack: error.stack,
        context: error.context,
      },
      requestId,
      path: res.req?.path,
      method: res.req?.method,
      userAgent: res.req?.get('User-Agent'),
      ip: res.req?.ip,
    });
  } else {
    logger.warn('Client error', {
      error: {
        message: error.message,
        code: error.code,
        details: error.details,
      },
      requestId,
      path: res.req?.path,
      method: res.req?.method,
      ip: res.req?.ip,
    });
  }
  
  res.status(error.statusCode).json(errorResponse);
}

/**
 * Global error handler middleware
 */
export function globalErrorHandler(
  error: any,
  req: any,
  res: Response,
  next: any
): void {
  let appError: AppError;
  
  // Handle known error types
  if (error instanceof AppError) {
    appError = error;
  } else if (error instanceof ZodError) {
    appError = handleZodError(error);
  } else if (error.name?.includes('Prisma')) {
    appError = handlePrismaError(error);
  } else if (error.name?.includes('JsonWebToken') || error.name?.includes('Token')) {
    appError = handleJWTError(error);
  } else if (error.code?.startsWith('LIMIT_')) {
    appError = handleMulterError(error);
  } else {
    // Unknown error
    logger.error('Unknown error', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      requestId: req.requestId,
      path: req.path,
      method: req.method,
    });
    
    appError = new AppError(
      'An unexpected error occurred',
      500,
      'INTERNAL_ERROR',
      false
    );
  }
  
  sendErrorResponse(res, appError, req.requestId);
}

/**
 * Async error wrapper for route handlers
 */
export function asyncHandler(
  fn: (req: any, res: Response, next: any) => Promise<any>
) {
  return (req: any, res: Response, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Validate and throw error if validation fails
 */
export function validateOrThrow<T>(
  schema: any,
  data: unknown,
  errorMessage?: string
): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof ZodError) {
      throw handleZodError(error);
    }
    throw new ValidationError(errorMessage || 'Validation failed');
  }
}

/**
 * Assert condition or throw error
 */
export function assert(
  condition: any,
  message: string,
  statusCode: number = 400,
  code: string = 'ASSERTION_ERROR'
): asserts condition {
  if (!condition) {
    throw new AppError(message, statusCode, code);
  }
}

/**
 * Assert resource exists or throw NotFoundError
 */
export function assertExists<T>(
  resource: T | null | undefined,
  resourceName: string = 'Resource'
): asserts resource is T {
  if (!resource) {
    throw new NotFoundError(resourceName);
  }
}

/**
 * Assert user has permission or throw AuthorizationError
 */
export function assertPermission(
  hasPermission: boolean,
  message: string = 'Insufficient permissions'
): asserts hasPermission {
  if (!hasPermission) {
    throw new AuthorizationError(message);
  }
}

/**
 * Wrap database operations with error handling
 */
export async function withDatabaseErrorHandling<T>(
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw handlePrismaError(error);
  }
}

/**
 * Create business logic error with context
 */
export function createBusinessError(
  message: string,
  code: string,
  context?: Record<string, any>
): BusinessLogicError {
  const error = new BusinessLogicError(message, code);
  if (context) {
    (error as any).context = context;
  }
  return error;
}

/**
 * Error codes enum for consistency
 */
export const ErrorCodes = {
  // Authentication & Authorization
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  
  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  
  // Resources
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  CONFLICT: 'CONFLICT',
  
  // Business Logic
  APPOINTMENT_CONFLICT: 'APPOINTMENT_CONFLICT',
  INVALID_APPOINTMENT_TIME: 'INVALID_APPOINTMENT_TIME',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PATIENT_NOT_ELIGIBLE: 'PATIENT_NOT_ELIGIBLE',
  PRESCRIPTION_EXPIRED: 'PRESCRIPTION_EXPIRED',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  
  // External Services
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  EMAIL_SERVICE_ERROR: 'EMAIL_SERVICE_ERROR',
  SMS_SERVICE_ERROR: 'SMS_SERVICE_ERROR',
  PAYMENT_SERVICE_ERROR: 'PAYMENT_SERVICE_ERROR',
  
  // File Operations
  FILE_UPLOAD_ERROR: 'FILE_UPLOAD_ERROR',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  
  // Database
  DATABASE_ERROR: 'DATABASE_ERROR',
  CONNECTION_ERROR: 'CONNECTION_ERROR',
  TRANSACTION_ERROR: 'TRANSACTION_ERROR',
  
  // Rate Limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  
  // System
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  MAINTENANCE_MODE: 'MAINTENANCE_MODE',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];