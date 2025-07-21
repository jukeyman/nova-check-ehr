/**
 * ============================================================================
 * NOVA CHECK EHR - VALIDATION UTILITIES
 * ============================================================================
 */

import { z } from 'zod';
import { UserRole, Gender, BloodType, AppointmentType, AppointmentStatus, Priority } from '@prisma/client';
import { isValidPhoneNumber } from 'libphonenumber-js';
import validator from 'validator';

// ============================================================================
// COMMON VALIDATION SCHEMAS
// ============================================================================

export const emailSchema = z.string().email('Invalid email address');

export const phoneSchema = z.string().refine(
  (phone) => {
    try {
      return isValidPhoneNumber(phone, 'US');
    } catch {
      return false;
    }
  },
  { message: 'Invalid phone number' }
);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
    'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
  );

export const nameSchema = z
  .string()
  .min(2, 'Name must be at least 2 characters')
  .max(50, 'Name must not exceed 50 characters')
  .regex(/^[a-zA-Z\s'-]+$/, 'Name can only contain letters, spaces, hyphens, and apostrophes');

export const dateSchema = z.string().refine(
  (date) => {
    const parsed = new Date(date);
    return !isNaN(parsed.getTime());
  },
  { message: 'Invalid date format' }
);

export const futureDateSchema = z.string().refine(
  (date) => {
    const parsed = new Date(date);
    return !isNaN(parsed.getTime()) && parsed > new Date();
  },
  { message: 'Date must be in the future' }
);

export const pastDateSchema = z.string().refine(
  (date) => {
    const parsed = new Date(date);
    return !isNaN(parsed.getTime()) && parsed < new Date();
  },
  { message: 'Date must be in the past' }
);

export const uuidSchema = z.string().uuid('Invalid UUID format');

export const positiveNumberSchema = z.number().positive('Must be a positive number');

export const nonNegativeNumberSchema = z.number().min(0, 'Must be non-negative');

// ============================================================================
// USER VALIDATION SCHEMAS
// ============================================================================

export const userRegistrationSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  role: z.nativeEnum(UserRole),
  facilityId: uuidSchema.optional(),
  phone: phoneSchema.optional(),
  department: z.string().max(100).optional(),
});

export const userLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional(),
});

export const userUpdateSchema = z.object({
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  phone: phoneSchema.optional(),
  department: z.string().max(100).optional(),
  bio: z.string().max(500).optional(),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
  confirmPassword: z.string(),
}).refine(
  (data) => data.newPassword === data.confirmPassword,
  {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  }
);

export const passwordResetSchema = z.object({
  email: emailSchema,
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine(
  (data) => data.password === data.confirmPassword,
  {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  }
);

// ============================================================================
// PATIENT VALIDATION SCHEMAS
// ============================================================================

export const addressSchema = z.object({
  street: z.string().min(1, 'Street address is required').max(200),
  city: z.string().min(1, 'City is required').max(100),
  state: z.string().min(2, 'State is required').max(50),
  zipCode: z.string().regex(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code format'),
  country: z.string().max(50).optional(),
});

export const emergencyContactSchema = z.object({
  name: nameSchema,
  relationship: z.string().min(1, 'Relationship is required').max(50),
  phone: phoneSchema,
  email: emailSchema.optional(),
  address: addressSchema.optional(),
});

export const insuranceSchema = z.object({
  provider: z.string().min(1, 'Insurance provider is required').max(100),
  policyNumber: z.string().min(1, 'Policy number is required').max(50),
  groupNumber: z.string().max(50).optional(),
  subscriberId: z.string().min(1, 'Subscriber ID is required').max(50),
  subscriberName: z.string().min(1, 'Subscriber name is required').max(100),
  relationship: z.string().min(1, 'Relationship is required').max(50),
  effectiveDate: dateSchema,
  expirationDate: dateSchema.optional(),
  copay: nonNegativeNumberSchema.optional(),
  deductible: nonNegativeNumberSchema.optional(),
});

export const allergySchema = z.object({
  allergen: z.string().min(1, 'Allergen is required').max(100),
  reaction: z.string().min(1, 'Reaction is required').max(200),
  severity: z.enum(['MILD', 'MODERATE', 'SEVERE', 'LIFE_THREATENING']),
  notes: z.string().max(500).optional(),
});

export const medicationSchema = z.object({
  name: z.string().min(1, 'Medication name is required').max(100),
  dosage: z.string().min(1, 'Dosage is required').max(50),
  frequency: z.string().min(1, 'Frequency is required').max(100),
  route: z.string().min(1, 'Route is required').max(50),
  startDate: dateSchema,
  endDate: dateSchema.optional(),
  prescribedBy: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});

export const socialHistorySchema = z.object({
  smoking: z.object({
    status: z.enum(['NEVER', 'FORMER', 'CURRENT']),
    packsPerDay: positiveNumberSchema.optional(),
    yearsSmoked: positiveNumberSchema.optional(),
    quitDate: dateSchema.optional(),
  }).optional(),
  alcohol: z.object({
    status: z.enum(['NEVER', 'OCCASIONAL', 'REGULAR', 'HEAVY']),
    drinksPerWeek: nonNegativeNumberSchema.optional(),
  }).optional(),
  drugs: z.object({
    status: z.enum(['NEVER', 'FORMER', 'CURRENT']),
    substances: z.array(z.string()).optional(),
  }).optional(),
  exercise: z.object({
    frequency: z.enum(['NEVER', 'RARELY', 'SOMETIMES', 'REGULARLY']),
    type: z.string().max(100).optional(),
  }).optional(),
  occupation: z.string().max(100).optional(),
  maritalStatus: z.string().max(50).optional(),
  education: z.string().max(100).optional(),
});

export const patientCreateSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  dateOfBirth: pastDateSchema,
  gender: z.nativeEnum(Gender),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  address: addressSchema.optional(),
  emergencyContact: emergencyContactSchema.optional(),
  insurance: z.array(insuranceSchema).optional(),
  medicalHistory: z.string().max(2000).optional(),
  allergies: z.array(allergySchema).optional(),
  medications: z.array(medicationSchema).optional(),
  socialHistory: socialHistorySchema.optional(),
  familyHistory: z.string().max(2000).optional(),
});

export const patientUpdateSchema = patientCreateSchema.partial();

// ============================================================================
// APPOINTMENT VALIDATION SCHEMAS
// ============================================================================

export const appointmentCreateSchema = z.object({
  patientId: uuidSchema,
  providerId: uuidSchema,
  type: z.nativeEnum(AppointmentType),
  scheduledAt: futureDateSchema,
  duration: z.number().min(15, 'Duration must be at least 15 minutes').max(480, 'Duration cannot exceed 8 hours'),
  reason: z.string().min(1, 'Reason is required').max(500),
  notes: z.string().max(1000).optional(),
  priority: z.nativeEnum(Priority).optional(),
  isTelemedicine: z.boolean().optional(),
  location: z.string().max(200).optional(),
  reminderPreferences: z.object({
    email: z.boolean().optional(),
    sms: z.boolean().optional(),
    push: z.boolean().optional(),
    reminderTimes: z.array(z.number().min(1).max(168)).optional(), // 1 hour to 1 week
  }).optional(),
});

export const appointmentUpdateSchema = z.object({
  scheduledAt: futureDateSchema.optional(),
  duration: z.number().min(15).max(480).optional(),
  reason: z.string().min(1).max(500).optional(),
  notes: z.string().max(1000).optional(),
  status: z.nativeEnum(AppointmentStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
  location: z.string().max(200).optional(),
});

// ============================================================================
// CLINICAL VALIDATION SCHEMAS
// ============================================================================

export const vitalSignsSchema = z.object({
  temperature: z.number().min(90).max(110).optional(), // Fahrenheit
  temperatureUnit: z.enum(['F', 'C']).optional(),
  bloodPressureSystolic: z.number().min(50).max(300).optional(),
  bloodPressureDiastolic: z.number().min(30).max(200).optional(),
  heartRate: z.number().min(30).max(250).optional(),
  respiratoryRate: z.number().min(5).max(60).optional(),
  oxygenSaturation: z.number().min(70).max(100).optional(),
  weight: positiveNumberSchema.optional(),
  weightUnit: z.enum(['lbs', 'kg']).optional(),
  height: positiveNumberSchema.optional(),
  heightUnit: z.enum(['in', 'cm']).optional(),
  bmi: z.number().min(10).max(100).optional(),
  painLevel: z.number().min(0).max(10).optional(),
});

export const diagnosisSchema = z.object({
  code: z.string().min(1, 'Diagnosis code is required').max(20),
  description: z.string().min(1, 'Description is required').max(500),
  type: z.enum(['PRIMARY', 'SECONDARY']),
  status: z.enum(['ACTIVE', 'RESOLVED', 'INACTIVE']),
  onsetDate: dateSchema.optional(),
  notes: z.string().max(1000).optional(),
});

export const procedureSchema = z.object({
  code: z.string().min(1, 'Procedure code is required').max(20),
  description: z.string().min(1, 'Description is required').max(500),
  performedAt: dateSchema,
  performedBy: uuidSchema,
  location: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
});

export const prescriptionSchema = z.object({
  medicationName: z.string().min(1, 'Medication name is required').max(100),
  dosage: z.string().min(1, 'Dosage is required').max(50),
  frequency: z.string().min(1, 'Frequency is required').max(100),
  route: z.string().min(1, 'Route is required').max(50),
  quantity: positiveNumberSchema,
  refills: nonNegativeNumberSchema,
  instructions: z.string().min(1, 'Instructions are required').max(500),
  startDate: dateSchema,
  endDate: dateSchema.optional(),
});

export const orderSchema = z.object({
  type: z.enum(['LABORATORY', 'IMAGING', 'PROCEDURE', 'REFERRAL']),
  description: z.string().min(1, 'Description is required').max(500),
  urgency: z.nativeEnum(Priority),
  instructions: z.string().max(1000).optional(),
  scheduledFor: futureDateSchema.optional(),
});

export const encounterCreateSchema = z.object({
  patientId: uuidSchema,
  providerId: uuidSchema,
  appointmentId: uuidSchema.optional(),
  type: z.string().min(1, 'Encounter type is required').max(50),
  chiefComplaint: z.string().min(1, 'Chief complaint is required').max(500),
  historyOfPresentIllness: z.string().max(2000).optional(),
  reviewOfSystems: z.string().max(2000).optional(),
  physicalExam: z.string().max(2000).optional(),
  assessment: z.string().max(2000).optional(),
  plan: z.string().max(2000).optional(),
  vitals: vitalSignsSchema.optional(),
  diagnoses: z.array(diagnosisSchema).optional(),
  procedures: z.array(procedureSchema).optional(),
  medications: z.array(prescriptionSchema).optional(),
  orders: z.array(orderSchema).optional(),
});

// ============================================================================
// FILE VALIDATION SCHEMAS
// ============================================================================

export const fileUploadSchema = z.object({
  patientId: uuidSchema.optional(),
  encounterId: uuidSchema.optional(),
  type: z.string().min(1, 'File type is required').max(50),
  category: z.string().max(50).optional(),
  description: z.string().max(500).optional(),
  tags: z.array(z.string().max(50)).optional(),
});

// ============================================================================
// NOTIFICATION VALIDATION SCHEMAS
// ============================================================================

export const notificationCreateSchema = z.object({
  userId: uuidSchema,
  type: z.string().min(1, 'Notification type is required').max(50),
  title: z.string().min(1, 'Title is required').max(200),
  message: z.string().min(1, 'Message is required').max(1000),
  data: z.record(z.any()).optional(),
  actionUrl: z.string().url().optional(),
  expiresAt: futureDateSchema.optional(),
});

export const emailSchema2 = z.object({
  to: z.union([emailSchema, z.array(emailSchema)]),
  cc: z.union([emailSchema, z.array(emailSchema)]).optional(),
  bcc: z.union([emailSchema, z.array(emailSchema)]).optional(),
  subject: z.string().min(1, 'Subject is required').max(200),
  template: z.string().max(100).optional(),
  html: z.string().optional(),
  text: z.string().optional(),
  data: z.record(z.any()).optional(),
});

export const smsSchema = z.object({
  to: phoneSchema,
  message: z.string().min(1, 'Message is required').max(1600), // SMS character limit
  from: phoneSchema.optional(),
});

// ============================================================================
// SEARCH AND PAGINATION SCHEMAS
// ============================================================================

export const paginationSchema = z.object({
  page: z.number().min(1).optional().default(1),
  limit: z.number().min(1).max(100).optional().default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const searchSchema = z.object({
  q: z.string().max(200).optional(),
  filters: z.record(z.any()).optional(),
}).merge(paginationSchema);

// ============================================================================
// ANALYTICS VALIDATION SCHEMAS
// ============================================================================

export const analyticsQuerySchema = z.object({
  startDate: dateSchema,
  endDate: dateSchema,
  granularity: z.enum(['day', 'week', 'month', 'year']).optional().default('day'),
  filters: z.record(z.any()).optional(),
}).refine(
  (data) => new Date(data.startDate) <= new Date(data.endDate),
  {
    message: 'Start date must be before or equal to end date',
    path: ['endDate'],
  }
);

// ============================================================================
// SYSTEM CONFIGURATION SCHEMAS
// ============================================================================

export const systemConfigSchema = z.object({
  key: z.string().min(1, 'Key is required').max(100),
  value: z.any(),
  description: z.string().max(500).optional(),
  category: z.string().max(50).optional(),
  isEncrypted: z.boolean().optional().default(false),
  validationRules: z.record(z.any()).optional(),
});

// ============================================================================
// VALIDATION HELPER FUNCTIONS
// ============================================================================

/**
 * Validate data against a schema and return formatted errors
 */
export function validateData<T>(schema: z.ZodSchema<T>, data: unknown): {
  success: boolean;
  data?: T;
  errors?: Array<{ field: string; message: string }>;
} {
  try {
    const result = schema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      }));
      return { success: false, errors };
    }
    return {
      success: false,
      errors: [{ field: 'unknown', message: 'Validation failed' }],
    };
  }
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  return validator.isEmail(email);
}

/**
 * Validate phone number format
 */
export function isValidPhone(phone: string, country: string = 'US'): boolean {
  try {
    return isValidPhoneNumber(phone, country as any);
  } catch {
    return false;
  }
}

/**
 * Validate URL format
 */
export function isValidUrl(url: string): boolean {
  return validator.isURL(url);
}

/**
 * Validate UUID format
 */
export function isValidUuid(uuid: string): boolean {
  return validator.isUUID(uuid);
}

/**
 * Validate date format and range
 */
export function isValidDate(date: string, options?: {
  min?: Date;
  max?: Date;
  future?: boolean;
  past?: boolean;
}): boolean {
  const parsed = new Date(date);
  
  if (isNaN(parsed.getTime())) {
    return false;
  }
  
  const now = new Date();
  
  if (options?.future && parsed <= now) {
    return false;
  }
  
  if (options?.past && parsed >= now) {
    return false;
  }
  
  if (options?.min && parsed < options.min) {
    return false;
  }
  
  if (options?.max && parsed > options.max) {
    return false;
  }
  
  return true;
}

/**
 * Validate file type
 */
export function isValidFileType(filename: string, allowedTypes: string[]): boolean {
  const extension = filename.split('.').pop()?.toLowerCase();
  return extension ? allowedTypes.includes(extension) : false;
}

/**
 * Validate file size
 */
export function isValidFileSize(size: number, maxSize: number): boolean {
  return size > 0 && size <= maxSize;
}

/**
 * Sanitize and validate input string
 */
export function sanitizeString(input: string, options?: {
  maxLength?: number;
  allowHtml?: boolean;
  trim?: boolean;
}): string {
  let sanitized = input;
  
  if (options?.trim !== false) {
    sanitized = sanitized.trim();
  }
  
  if (!options?.allowHtml) {
    sanitized = validator.escape(sanitized);
  }
  
  if (options?.maxLength) {
    sanitized = sanitized.substring(0, options.maxLength);
  }
  
  return sanitized;
}

/**
 * Validate password strength
 */
export function validatePasswordStrength(password: string): {
  isValid: boolean;
  score: number;
  feedback: string[];
} {
  const feedback: string[] = [];
  let score = 0;
  
  if (password.length >= 8) {
    score += 1;
  } else {
    feedback.push('Password should be at least 8 characters long');
  }
  
  if (/[a-z]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Password should contain lowercase letters');
  }
  
  if (/[A-Z]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Password should contain uppercase letters');
  }
  
  if (/\d/.test(password)) {
    score += 1;
  } else {
    feedback.push('Password should contain numbers');
  }
  
  if (/[@$!%*?&]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Password should contain special characters');
  }
  
  if (password.length >= 12) {
    score += 1;
  }
  
  return {
    isValid: score >= 4,
    score,
    feedback,
  };
}