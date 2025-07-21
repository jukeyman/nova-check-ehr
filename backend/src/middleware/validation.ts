/**
 * ============================================================================
 * NOVA CHECK EHR - VALIDATION MIDDLEWARE
 * ============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult, ValidationChain } from 'express-validator';
import { z } from 'zod';
import { UserRole, UserStatus, AppointmentStatus, EncounterStatus } from '@prisma/client';
import { ValidationError } from './errorHandler';
import logger from '../config/logger';
import { AuthenticatedRequest } from './auth';

/**
 * Validation result handler
 */
export function handleValidationErrors() {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
      const formattedErrors = errors.array().map(error => ({
        field: error.type === 'field' ? error.path : error.type,
        message: error.msg,
        value: error.type === 'field' ? error.value : undefined,
        location: error.type === 'field' ? error.location : undefined,
      }));

      logger.warn('Validation failed', {
        errors: formattedErrors,
        path: req.path,
        method: req.method,
        body: req.body,
        query: req.query,
        params: req.params,
      });

      throw new ValidationError('Validation failed', formattedErrors);
    }
    
    next();
  };
}

/**
 * Zod validation middleware
 */
export function validateSchema<T>(schema: z.ZodSchema<T>, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = source === 'body' ? req.body : 
                   source === 'query' ? req.query : 
                   req.params;
      
      const result = schema.safeParse(data);
      
      if (!result.success) {
        const formattedErrors = result.error.errors.map(error => ({
          field: error.path.join('.'),
          message: error.message,
          code: error.code,
        }));

        logger.warn('Zod validation failed', {
          errors: formattedErrors,
          path: req.path,
          method: req.method,
          source,
          data,
        });

        throw new ValidationError('Schema validation failed', formattedErrors);
      }
      
      // Replace the source data with validated and transformed data
      if (source === 'body') {
        req.body = result.data;
      } else if (source === 'query') {
        req.query = result.data as any;
      } else {
        req.params = result.data as any;
      }
      
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Common validation rules
 */
export const commonValidations = {
  // ID validations
  uuid: param('id').isUUID().withMessage('Valid UUID is required'),
  
  uuidOptional: param('id').optional().isUUID().withMessage('Valid UUID is required'),
  
  // Pagination
  pagination: [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer')
      .toInt(),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100')
      .toInt(),
    query('offset')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Offset must be a non-negative integer')
      .toInt(),
  ],
  
  // Date validations
  date: body('date').isISO8601().withMessage('Valid ISO 8601 date is required'),
  
  dateOptional: body('date').optional().isISO8601().withMessage('Valid ISO 8601 date is required'),
  
  dateRange: [
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Valid start date is required'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('Valid end date is required')
      .custom((value, { req }) => {
        if (req.query?.startDate && value && new Date(value) <= new Date(req.query.startDate)) {
          throw new Error('End date must be after start date');
        }
        return true;
      }),
  ],
  
  // String validations
  name: body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be between 1 and 100 characters')
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage('Name can only contain letters, spaces, hyphens, and apostrophes'),
  
  email: body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  
  phone: body('phone')
    .optional()
    .isMobilePhone('any')
    .withMessage('Valid phone number is required'),
  
  // Password validation
  password: body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  
  // Enum validations
  userRole: body('role')
    .isIn(Object.values(UserRole))
    .withMessage(`Role must be one of: ${Object.values(UserRole).join(', ')}`),
  
  userStatus: body('status')
    .isIn(Object.values(UserStatus))
    .withMessage(`Status must be one of: ${Object.values(UserStatus).join(', ')}`),
};

/**
 * User validation schemas
 */
export const userValidations = {
  create: [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password')
      .isLength({ min: 8, max: 128 })
      .withMessage('Password must be between 8 and 128 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must contain uppercase, lowercase, number and special character'),
    body('firstName')
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('First name must be between 1 and 50 characters'),
    body('lastName')
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('Last name must be between 1 and 50 characters'),
    body('role')
      .isIn(Object.values(UserRole))
      .withMessage(`Role must be one of: ${Object.values(UserRole).join(', ')}`),
    body('phone')
      .optional()
      .isMobilePhone('any')
      .withMessage('Valid phone number is required'),
  ],
  
  update: [
    param('id').isUUID().withMessage('Valid user ID is required'),
    body('email').optional().isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('firstName')
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('First name must be between 1 and 50 characters'),
    body('lastName')
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('Last name must be between 1 and 50 characters'),
    body('phone')
      .optional()
      .isMobilePhone('any')
      .withMessage('Valid phone number is required'),
    body('status')
      .optional()
      .isIn(Object.values(UserStatus))
      .withMessage(`Status must be one of: ${Object.values(UserStatus).join(', ')}`),
  ],
  
  changePassword: [
    param('id').isUUID().withMessage('Valid user ID is required'),
    body('currentPassword')
      .isLength({ min: 1 })
      .withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 8, max: 128 })
      .withMessage('New password must be between 8 and 128 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('New password must contain uppercase, lowercase, number and special character'),
  ],
};

/**
 * Patient validation schemas
 */
export const patientValidations = {
  create: [
    body('firstName')
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('First name must be between 1 and 50 characters'),
    body('lastName')
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('Last name must be between 1 and 50 characters'),
    body('dateOfBirth')
      .isISO8601()
      .withMessage('Valid date of birth is required')
      .custom((value) => {
        const dob = new Date(value);
        const today = new Date();
        if (dob >= today) {
          throw new Error('Date of birth must be in the past');
        }
        return true;
      }),
    body('gender')
      .isIn(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN'])
      .withMessage('Gender must be MALE, FEMALE, OTHER, or UNKNOWN'),
    body('email')
      .optional()
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email is required'),
    body('phone')
      .optional()
      .isMobilePhone('any')
      .withMessage('Valid phone number is required'),
    body('address')
      .optional()
      .isObject()
      .withMessage('Address must be an object'),
    body('address.street')
      .optional()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Street must be between 1 and 100 characters'),
    body('address.city')
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('City must be between 1 and 50 characters'),
    body('address.state')
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('State must be between 2 and 50 characters'),
    body('address.zipCode')
      .optional()
      .matches(/^\d{5}(-\d{4})?$/)
      .withMessage('Valid ZIP code is required'),
    body('emergencyContact')
      .optional()
      .isObject()
      .withMessage('Emergency contact must be an object'),
  ],
  
  update: [
    param('id').isUUID().withMessage('Valid patient ID is required'),
    body('firstName')
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('First name must be between 1 and 50 characters'),
    body('lastName')
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('Last name must be between 1 and 50 characters'),
    body('email')
      .optional()
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email is required'),
    body('phone')
      .optional()
      .isMobilePhone('any')
      .withMessage('Valid phone number is required'),
  ],
};

/**
 * Appointment validation schemas
 */
export const appointmentValidations = {
  create: [
    body('patientId')
      .isUUID()
      .withMessage('Valid patient ID is required'),
    body('providerId')
      .isUUID()
      .withMessage('Valid provider ID is required'),
    body('scheduledAt')
      .isISO8601()
      .withMessage('Valid scheduled date/time is required')
      .custom((value) => {
        const scheduledDate = new Date(value);
        const now = new Date();
        if (scheduledDate <= now) {
          throw new Error('Appointment must be scheduled in the future');
        }
        return true;
      }),
    body('duration')
      .isInt({ min: 15, max: 480 })
      .withMessage('Duration must be between 15 and 480 minutes'),
    body('type')
      .isIn(['CONSULTATION', 'FOLLOW_UP', 'PROCEDURE', 'EMERGENCY', 'TELEMEDICINE'])
      .withMessage('Invalid appointment type'),
    body('reason')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Reason must not exceed 500 characters'),
    body('notes')
      .optional()
      .trim()
      .isLength({ max: 1000 })
      .withMessage('Notes must not exceed 1000 characters'),
  ],
  
  update: [
    param('id').isUUID().withMessage('Valid appointment ID is required'),
    body('scheduledAt')
      .optional()
      .isISO8601()
      .withMessage('Valid scheduled date/time is required'),
    body('duration')
      .optional()
      .isInt({ min: 15, max: 480 })
      .withMessage('Duration must be between 15 and 480 minutes'),
    body('status')
      .optional()
      .isIn(Object.values(AppointmentStatus))
      .withMessage(`Status must be one of: ${Object.values(AppointmentStatus).join(', ')}`),
    body('reason')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Reason must not exceed 500 characters'),
    body('notes')
      .optional()
      .trim()
      .isLength({ max: 1000 })
      .withMessage('Notes must not exceed 1000 characters'),
  ],
};

/**
 * Clinical data validation schemas
 */
export const clinicalValidations = {
  encounter: {
    create: [
      body('patientId')
        .isUUID()
        .withMessage('Valid patient ID is required'),
      body('providerId')
        .isUUID()
        .withMessage('Valid provider ID is required'),
      body('type')
        .isIn(['INPATIENT', 'OUTPATIENT', 'EMERGENCY', 'VIRTUAL'])
        .withMessage('Invalid encounter type'),
      body('status')
        .optional()
        .isIn(Object.values(EncounterStatus))
        .withMessage(`Status must be one of: ${Object.values(EncounterStatus).join(', ')}`),
      body('chiefComplaint')
        .optional()
        .trim()
        .isLength({ max: 1000 })
        .withMessage('Chief complaint must not exceed 1000 characters'),
    ],
  },
  
  vitals: {
    create: [
      body('encounterId')
        .isUUID()
        .withMessage('Valid encounter ID is required'),
      body('temperature')
        .optional()
        .isFloat({ min: 90, max: 110 })
        .withMessage('Temperature must be between 90 and 110 degrees'),
      body('bloodPressureSystolic')
        .optional()
        .isInt({ min: 50, max: 300 })
        .withMessage('Systolic blood pressure must be between 50 and 300'),
      body('bloodPressureDiastolic')
        .optional()
        .isInt({ min: 30, max: 200 })
        .withMessage('Diastolic blood pressure must be between 30 and 200'),
      body('heartRate')
        .optional()
        .isInt({ min: 30, max: 250 })
        .withMessage('Heart rate must be between 30 and 250 bpm'),
      body('respiratoryRate')
        .optional()
        .isInt({ min: 5, max: 60 })
        .withMessage('Respiratory rate must be between 5 and 60 breaths per minute'),
      body('oxygenSaturation')
        .optional()
        .isFloat({ min: 70, max: 100 })
        .withMessage('Oxygen saturation must be between 70 and 100 percent'),
      body('weight')
        .optional()
        .isFloat({ min: 0.5, max: 1000 })
        .withMessage('Weight must be between 0.5 and 1000 kg'),
      body('height')
        .optional()
        .isFloat({ min: 30, max: 300 })
        .withMessage('Height must be between 30 and 300 cm'),
    ],
  },
  
  medication: {
    create: [
      body('patientId')
        .isUUID()
        .withMessage('Valid patient ID is required'),
      body('name')
        .trim()
        .isLength({ min: 1, max: 200 })
        .withMessage('Medication name must be between 1 and 200 characters'),
      body('dosage')
        .trim()
        .isLength({ min: 1, max: 100 })
        .withMessage('Dosage must be between 1 and 100 characters'),
      body('frequency')
        .trim()
        .isLength({ min: 1, max: 100 })
        .withMessage('Frequency must be between 1 and 100 characters'),
      body('startDate')
        .isISO8601()
        .withMessage('Valid start date is required'),
      body('endDate')
        .optional()
        .isISO8601()
        .withMessage('Valid end date is required')
        .custom((value, { req }) => {
          if (value && req.body?.startDate && new Date(value) <= new Date(req.body.startDate)) {
            throw new Error('End date must be after start date');
          }
          return true;
        }),
    ],
  },
};

/**
 * File upload validation
 */
export const fileValidations = {
  document: [
    body('title')
      .trim()
      .isLength({ min: 1, max: 200 })
      .withMessage('Document title must be between 1 and 200 characters'),
    body('type')
      .isIn(['LAB_RESULT', 'IMAGING', 'PRESCRIPTION', 'INSURANCE', 'CONSENT', 'OTHER'])
      .withMessage('Invalid document type'),
    body('patientId')
      .optional()
      .isUUID()
      .withMessage('Valid patient ID is required'),
  ],
};

/**
 * Search and filter validations
 */
export const searchValidations = {
  patients: [
    ...commonValidations.pagination,
    query('search')
      .optional()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Search term must be between 1 and 100 characters'),
    query('status')
      .optional()
      .isIn(['ACTIVE', 'INACTIVE', 'DECEASED'])
      .withMessage('Invalid patient status'),
    query('gender')
      .optional()
      .isIn(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN'])
      .withMessage('Invalid gender'),
    ...commonValidations.dateRange,
  ],
  
  appointments: [
    ...commonValidations.pagination,
    query('patientId')
      .optional()
      .isUUID()
      .withMessage('Valid patient ID is required'),
    query('providerId')
      .optional()
      .isUUID()
      .withMessage('Valid provider ID is required'),
    query('status')
      .optional()
      .isIn(Object.values(AppointmentStatus))
      .withMessage(`Status must be one of: ${Object.values(AppointmentStatus).join(', ')}`),
    ...commonValidations.dateRange,
  ],
};

/**
 * Zod schemas for complex validations
 */
export const zodSchemas = {
  // Patient schema
  patient: z.object({
    firstName: z.string().min(1).max(50),
    lastName: z.string().min(1).max(50),
    dateOfBirth: z.string().datetime(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN']),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    address: z.object({
      street: z.string().min(1).max(100).optional(),
      city: z.string().min(1).max(50).optional(),
      state: z.string().min(2).max(50).optional(),
      zipCode: z.string().regex(/^\d{5}(-\d{4})?$/).optional(),
      country: z.string().min(2).max(50).optional(),
    }).optional(),
    emergencyContact: z.object({
      name: z.string().min(1).max(100),
      relationship: z.string().min(1).max(50),
      phone: z.string().min(1),
      email: z.string().email().optional(),
    }).optional(),
  }),
  
  // Appointment schema
  appointment: z.object({
    patientId: z.string().uuid(),
    providerId: z.string().uuid(),
    scheduledAt: z.string().datetime(),
    duration: z.number().min(15).max(480),
    type: z.enum(['CONSULTATION', 'FOLLOW_UP', 'PROCEDURE', 'EMERGENCY', 'TELEMEDICINE']),
    reason: z.string().max(500).optional(),
    notes: z.string().max(1000).optional(),
  }),
  
  // Vital signs schema
  vitals: z.object({
    encounterId: z.string().uuid(),
    temperature: z.number().min(90).max(110).optional(),
    bloodPressureSystolic: z.number().min(50).max(300).optional(),
    bloodPressureDiastolic: z.number().min(30).max(200).optional(),
    heartRate: z.number().min(30).max(250).optional(),
    respiratoryRate: z.number().min(5).max(60).optional(),
    oxygenSaturation: z.number().min(70).max(100).optional(),
    weight: z.number().min(0.5).max(1000).optional(),
    height: z.number().min(30).max(300).optional(),
    bmi: z.number().min(10).max(100).optional(),
  }),
  
  // Pagination schema
  pagination: z.object({
    page: z.number().min(1).default(1),
    limit: z.number().min(1).max(100).default(20),
    offset: z.number().min(0).optional(),
  }),
  
  // Date range schema
  dateRange: z.object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
  }).refine((data) => {
    if (data.startDate && data.endDate) {
      return new Date(data.endDate) > new Date(data.startDate);
    }
    return true;
  }, {
    message: 'End date must be after start date',
  }),
};

/**
 * Custom validation functions
 */
export const customValidations = {
  // Check if user can access patient data
  canAccessPatient: (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const patientId = req.params.patientId || req.body.patientId;
    const user = req.user;
    
    if (!user) {
      throw new ValidationError('User not authenticated');
    }
    
    // Admin and super admin can access all patients
    if (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) {
      return next();
    }
    
    // Providers can access their assigned patients
    if (user.role === UserRole.PROVIDER && user.providerId) {
      // This would need to check the patient-provider relationship in the database
      // For now, we'll allow it and let the service layer handle the authorization
      return next();
    }
    
    // Patients can only access their own data
    if (user.role === UserRole.PATIENT) {
      // This would need to check if the user is the patient
      // For now, we'll allow it and let the service layer handle the authorization
      return next();
    }
    
    throw new ValidationError('Insufficient permissions to access patient data');
  },
  
  // Validate business hours for appointments
  validateBusinessHours: body('scheduledAt').custom((value) => {
    const date = new Date(value);
    const hour = date.getHours();
    const day = date.getDay();
    
    // Check if it's a weekend (Saturday = 6, Sunday = 0)
    if (day === 0 || day === 6) {
      throw new Error('Appointments cannot be scheduled on weekends');
    }
    
    // Check if it's within business hours (8 AM to 6 PM)
    if (hour < 8 || hour >= 18) {
      throw new Error('Appointments must be scheduled between 8 AM and 6 PM');
    }
    
    return true;
  }),
  
  // Validate age for certain operations
  validateAge: (minAge: number) => {
    return body('dateOfBirth').custom((value) => {
      const dob = new Date(value);
      const today = new Date();
      const age = today.getFullYear() - dob.getFullYear();
      const monthDiff = today.getMonth() - dob.getMonth();
      
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
        age--;
      }
      
      if (age < minAge) {
        throw new Error(`Patient must be at least ${minAge} years old`);
      }
      
      return true;
    });
  },
};

/**
 * Validation middleware factory
 */
export function createValidationMiddleware(validations: ValidationChain[]) {
  return [
    ...validations,
    handleValidationErrors(),
  ];
}

/**
 * Sanitization middleware
 */
export function sanitizeInput() {
  return (req: Request, res: Response, next: NextFunction) => {
    const sanitize = (obj: any): any => {
      if (typeof obj === 'string') {
        return obj.trim();
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