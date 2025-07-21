// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Comprehensive validation utilities for forms, data, and user input
 * Includes medical-specific validations for EHR system
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
}

export interface FieldValidation {
  field: string;
  isValid: boolean;
  error?: string;
  warning?: string;
}

export interface ValidationRule {
  name: string;
  validator: (value: any) => boolean;
  message: string;
  severity?: 'error' | 'warning';
}

export interface ValidationSchema {
  [field: string]: ValidationRule[];
}

// Medical-specific types
export interface VitalSignsValidation {
  temperature?: number;
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  heartRate?: number;
  respiratoryRate?: number;
  oxygenSaturation?: number;
  weight?: number;
  height?: number;
  bmi?: number;
}

export interface MedicationValidation {
  name: string;
  dosage: string;
  frequency: string;
  route: string;
  startDate: string;
  endDate?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PHONE_REGEX = /^[\+]?[1-9][\d]{0,3}[\s\-\(\)]?[\d\s\-\(\)]{7,14}$/;
const SSN_REGEX = /^\d{3}-?\d{2}-?\d{4}$/;
const ZIP_CODE_REGEX = /^\d{5}(-\d{4})?$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
const MRN_REGEX = /^[A-Z0-9]{6,12}$/; // Medical Record Number
const NPI_REGEX = /^\d{10}$/; // National Provider Identifier
const ICD10_REGEX = /^[A-Z]\d{2}(\.\d{1,3})?$/; // ICD-10 diagnosis codes
const CPT_REGEX = /^\d{5}$/; // CPT procedure codes
const NDC_REGEX = /^\d{4,5}-\d{3,4}-\d{1,2}$/; // National Drug Code

// Medical reference ranges
const VITAL_SIGNS_RANGES = {
  temperature: { min: 95, max: 110, unit: 'F' }, // Fahrenheit
  bloodPressureSystolic: { min: 70, max: 250, unit: 'mmHg' },
  bloodPressureDiastolic: { min: 40, max: 150, unit: 'mmHg' },
  heartRate: { min: 30, max: 220, unit: 'bpm' },
  respiratoryRate: { min: 8, max: 60, unit: 'breaths/min' },
  oxygenSaturation: { min: 70, max: 100, unit: '%' },
  weight: { min: 1, max: 1000, unit: 'lbs' },
  height: { min: 12, max: 96, unit: 'inches' },
  bmi: { min: 10, max: 80, unit: 'kg/m²' },
};

// ============================================================================
// BASIC VALIDATION FUNCTIONS
// ============================================================================

/**
 * Check if value is required and not empty
 */
export const required = (value: any): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
};

/**
 * Check minimum length
 */
export const minLength = (min: number) => (value: string): boolean => {
  return typeof value === 'string' && value.length >= min;
};

/**
 * Check maximum length
 */
export const maxLength = (max: number) => (value: string): boolean => {
  return typeof value === 'string' && value.length <= max;
};

/**
 * Check if value is within range
 */
export const range = (min: number, max: number) => (value: number): boolean => {
  return typeof value === 'number' && value >= min && value <= max;
};

/**
 * Check if value matches pattern
 */
export const pattern = (regex: RegExp) => (value: string): boolean => {
  return typeof value === 'string' && regex.test(value);
};

/**
 * Check if value is a valid email
 */
export const email = (value: string): boolean => {
  return EMAIL_REGEX.test(value);
};

/**
 * Check if value is a valid phone number
 */
export const phone = (value: string): boolean => {
  return PHONE_REGEX.test(value.replace(/\s/g, ''));
};

/**
 * Check if value is a valid URL
 */
export const url = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

/**
 * Check if value is a valid date
 */
export const date = (value: string): boolean => {
  const dateObj = new Date(value);
  return !isNaN(dateObj.getTime());
};

/**
 * Check if date is in the past
 */
export const pastDate = (value: string): boolean => {
  const dateObj = new Date(value);
  return dateObj < new Date();
};

/**
 * Check if date is in the future
 */
export const futureDate = (value: string): boolean => {
  const dateObj = new Date(value);
  return dateObj > new Date();
};

/**
 * Check if value is a valid number
 */
export const number = (value: any): boolean => {
  return !isNaN(parseFloat(value)) && isFinite(value);
};

/**
 * Check if value is a positive number
 */
export const positiveNumber = (value: number): boolean => {
  return number(value) && value > 0;
};

/**
 * Check if value is an integer
 */
export const integer = (value: any): boolean => {
  return Number.isInteger(Number(value));
};

// ============================================================================
// MEDICAL-SPECIFIC VALIDATIONS
// ============================================================================

/**
 * Validate Medical Record Number (MRN)
 */
export const mrn = (value: string): boolean => {
  return MRN_REGEX.test(value.toUpperCase());
};

/**
 * Validate National Provider Identifier (NPI)
 */
export const npi = (value: string): boolean => {
  if (!NPI_REGEX.test(value)) return false;
  
  // Luhn algorithm check for NPI
  const digits = value.split('').map(Number);
  let sum = 0;
  let isEven = false;
  
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits[i];
    
    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    
    sum += digit;
    isEven = !isEven;
  }
  
  return sum % 10 === 0;
};

/**
 * Validate Social Security Number
 */
export const ssn = (value: string): boolean => {
  const cleanSSN = value.replace(/-/g, '');
  if (!SSN_REGEX.test(value)) return false;
  
  // Check for invalid patterns
  const invalidPatterns = [
    '000000000', '111111111', '222222222', '333333333',
    '444444444', '555555555', '666666666', '777777777',
    '888888888', '999999999', '123456789'
  ];
  
  return !invalidPatterns.includes(cleanSSN);
};

/**
 * Validate ICD-10 diagnosis code
 */
export const icd10 = (value: string): boolean => {
  return ICD10_REGEX.test(value.toUpperCase());
};

/**
 * Validate CPT procedure code
 */
export const cpt = (value: string): boolean => {
  return CPT_REGEX.test(value);
};

/**
 * Validate National Drug Code (NDC)
 */
export const ndc = (value: string): boolean => {
  return NDC_REGEX.test(value);
};

/**
 * Validate ZIP code
 */
export const zipCode = (value: string): boolean => {
  return ZIP_CODE_REGEX.test(value);
};

/**
 * Validate strong password
 */
export const strongPassword = (value: string): boolean => {
  return PASSWORD_REGEX.test(value);
};

/**
 * Validate date of birth (must be in the past and reasonable)
 */
export const dateOfBirth = (value: string): boolean => {
  if (!date(value)) return false;
  
  const dob = new Date(value);
  const now = new Date();
  const age = now.getFullYear() - dob.getFullYear();
  
  // Must be in the past and reasonable age (0-150 years)
  return dob < now && age >= 0 && age <= 150;
};

/**
 * Validate age
 */
export const age = (value: number): boolean => {
  return integer(value) && value >= 0 && value <= 150;
};

// ============================================================================
// VITAL SIGNS VALIDATION
// ============================================================================

/**
 * Validate vital signs
 */
export const validateVitalSigns = (vitals: VitalSignsValidation): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  Object.entries(vitals).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    
    const range = VITAL_SIGNS_RANGES[key as keyof typeof VITAL_SIGNS_RANGES];
    if (!range) return;
    
    if (typeof value !== 'number' || isNaN(value)) {
      errors.push(`${key} must be a valid number`);
      return;
    }
    
    if (value < range.min || value > range.max) {
      errors.push(`${key} must be between ${range.min} and ${range.max} ${range.unit}`);
    }
    
    // Add warnings for concerning values
    if (key === 'temperature') {
      if (value < 97 || value > 100.4) {
        warnings.push(`Temperature ${value}°F may indicate fever or hypothermia`);
      }
    } else if (key === 'bloodPressureSystolic') {
      if (value > 140) {
        warnings.push(`Systolic BP ${value} mmHg may indicate hypertension`);
      }
    } else if (key === 'bloodPressureDiastolic') {
      if (value > 90) {
        warnings.push(`Diastolic BP ${value} mmHg may indicate hypertension`);
      }
    } else if (key === 'heartRate') {
      if (value < 60 || value > 100) {
        warnings.push(`Heart rate ${value} bpm is outside normal range (60-100)`);
      }
    } else if (key === 'oxygenSaturation') {
      if (value < 95) {
        warnings.push(`Oxygen saturation ${value}% is below normal (>95%)`);
      }
    }
  });
  
  // Cross-validation
  if (vitals.bloodPressureSystolic && vitals.bloodPressureDiastolic) {
    if (vitals.bloodPressureSystolic <= vitals.bloodPressureDiastolic) {
      errors.push('Systolic blood pressure must be higher than diastolic');
    }
  }
  
  if (vitals.weight && vitals.height) {
    const heightInMeters = vitals.height * 0.0254; // inches to meters
    const weightInKg = vitals.weight * 0.453592; // pounds to kg
    const calculatedBMI = weightInKg / (heightInMeters * heightInMeters);
    
    if (vitals.bmi && Math.abs(vitals.bmi - calculatedBMI) > 1) {
      warnings.push('BMI does not match calculated value from height and weight');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};

// ============================================================================
// MEDICATION VALIDATION
// ============================================================================

/**
 * Validate medication data
 */
export const validateMedication = (medication: MedicationValidation): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Required fields
  if (!required(medication.name)) {
    errors.push('Medication name is required');
  }
  
  if (!required(medication.dosage)) {
    errors.push('Dosage is required');
  }
  
  if (!required(medication.frequency)) {
    errors.push('Frequency is required');
  }
  
  if (!required(medication.route)) {
    errors.push('Route of administration is required');
  }
  
  if (!required(medication.startDate)) {
    errors.push('Start date is required');
  }
  
  // Date validations
  if (medication.startDate && !date(medication.startDate)) {
    errors.push('Start date must be a valid date');
  }
  
  if (medication.endDate) {
    if (!date(medication.endDate)) {
      errors.push('End date must be a valid date');
    } else if (medication.startDate && new Date(medication.endDate) <= new Date(medication.startDate)) {
      errors.push('End date must be after start date');
    }
  }
  
  // Dosage format validation
  if (medication.dosage) {
    const dosagePattern = /^\d+(\.\d+)?\s*(mg|g|ml|mcg|units?|iu|mEq)$/i;
    if (!dosagePattern.test(medication.dosage.trim())) {
      warnings.push('Dosage format may be incorrect (e.g., "10 mg", "5 ml")');
    }
  }
  
  // Frequency validation
  if (medication.frequency) {
    const commonFrequencies = [
      'once daily', 'twice daily', 'three times daily', 'four times daily',
      'every 4 hours', 'every 6 hours', 'every 8 hours', 'every 12 hours',
      'as needed', 'prn', 'bid', 'tid', 'qid', 'q4h', 'q6h', 'q8h', 'q12h'
    ];
    
    const isCommonFrequency = commonFrequencies.some(freq => 
      medication.frequency.toLowerCase().includes(freq)
    );
    
    if (!isCommonFrequency) {
      warnings.push('Frequency format may be non-standard');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};

// ============================================================================
// FORM VALIDATION
// ============================================================================

/**
 * Validate a single field against rules
 */
export const validateField = (value: any, rules: ValidationRule[]): FieldValidation => {
  let isValid = true;
  let error: string | undefined;
  let warning: string | undefined;
  
  for (const rule of rules) {
    if (!rule.validator(value)) {
      if (rule.severity === 'warning') {
        warning = rule.message;
      } else {
        isValid = false;
        error = rule.message;
        break; // Stop at first error
      }
    }
  }
  
  return {
    field: '',
    isValid,
    error,
    warning
  };
};

/**
 * Validate an object against a schema
 */
export const validateSchema = (data: Record<string, any>, schema: ValidationSchema): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  Object.entries(schema).forEach(([field, rules]) => {
    const value = data[field];
    const fieldValidation = validateField(value, rules);
    
    if (!fieldValidation.isValid && fieldValidation.error) {
      errors.push(`${field}: ${fieldValidation.error}`);
    }
    
    if (fieldValidation.warning) {
      warnings.push(`${field}: ${fieldValidation.warning}`);
    }
  });
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};

// ============================================================================
// COMMON VALIDATION SCHEMAS
// ============================================================================

/**
 * User registration validation schema
 */
export const userRegistrationSchema: ValidationSchema = {
  firstName: [
    { name: 'required', validator: required, message: 'First name is required' },
    { name: 'minLength', validator: minLength(2), message: 'First name must be at least 2 characters' },
    { name: 'maxLength', validator: maxLength(50), message: 'First name must be less than 50 characters' }
  ],
  lastName: [
    { name: 'required', validator: required, message: 'Last name is required' },
    { name: 'minLength', validator: minLength(2), message: 'Last name must be at least 2 characters' },
    { name: 'maxLength', validator: maxLength(50), message: 'Last name must be less than 50 characters' }
  ],
  email: [
    { name: 'required', validator: required, message: 'Email is required' },
    { name: 'email', validator: email, message: 'Please enter a valid email address' }
  ],
  password: [
    { name: 'required', validator: required, message: 'Password is required' },
    { name: 'strongPassword', validator: strongPassword, message: 'Password must be at least 8 characters with uppercase, lowercase, number, and special character' }
  ],
  phone: [
    { name: 'phone', validator: phone, message: 'Please enter a valid phone number' }
  ]
};

/**
 * Patient registration validation schema
 */
export const patientRegistrationSchema: ValidationSchema = {
  ...userRegistrationSchema,
  dateOfBirth: [
    { name: 'required', validator: required, message: 'Date of birth is required' },
    { name: 'dateOfBirth', validator: dateOfBirth, message: 'Please enter a valid date of birth' }
  ],
  ssn: [
    { name: 'ssn', validator: ssn, message: 'Please enter a valid Social Security Number' }
  ],
  mrn: [
    { name: 'mrn', validator: mrn, message: 'Please enter a valid Medical Record Number' }
  ]
};

/**
 * Provider registration validation schema
 */
export const providerRegistrationSchema: ValidationSchema = {
  ...userRegistrationSchema,
  npi: [
    { name: 'required', validator: required, message: 'NPI is required' },
    { name: 'npi', validator: npi, message: 'Please enter a valid 10-digit NPI number' }
  ],
  licenseNumber: [
    { name: 'required', validator: required, message: 'License number is required' },
    { name: 'minLength', validator: minLength(5), message: 'License number must be at least 5 characters' }
  ],
  specialty: [
    { name: 'required', validator: required, message: 'Specialty is required' }
  ]
};

/**
 * Appointment validation schema
 */
export const appointmentSchema: ValidationSchema = {
  patientId: [
    { name: 'required', validator: required, message: 'Patient is required' }
  ],
  providerId: [
    { name: 'required', validator: required, message: 'Provider is required' }
  ],
  appointmentDate: [
    { name: 'required', validator: required, message: 'Appointment date is required' },
    { name: 'date', validator: date, message: 'Please enter a valid date' },
    { name: 'futureDate', validator: futureDate, message: 'Appointment date must be in the future' }
  ],
  appointmentTime: [
    { name: 'required', validator: required, message: 'Appointment time is required' }
  ],
  duration: [
    { name: 'required', validator: required, message: 'Duration is required' },
    { name: 'positiveNumber', validator: positiveNumber, message: 'Duration must be a positive number' }
  ]
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Sanitize input string
 */
export const sanitizeInput = (input: string): string => {
  return input
    .trim()
    .replace(/[<>"'&]/g, '') // Remove potentially dangerous characters
    .replace(/\s+/g, ' '); // Normalize whitespace
};

/**
 * Format phone number
 */
export const formatPhoneNumber = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
};

/**
 * Format SSN
 */
export const formatSSN = (ssn: string): string => {
  const cleaned = ssn.replace(/\D/g, '');
  if (cleaned.length === 9) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 5)}-${cleaned.slice(5)}`;
  }
  return ssn;
};

/**
 * Calculate BMI
 */
export const calculateBMI = (weightLbs: number, heightInches: number): number => {
  const weightKg = weightLbs * 0.453592;
  const heightM = heightInches * 0.0254;
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10;
};

/**
 * Calculate age from date of birth
 */
export const calculateAge = (dateOfBirth: string): number => {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  
  return age;
};

/**
 * Validate file upload
 */
export const validateFileUpload = (
  file: File,
  options: {
    maxSize?: number; // in bytes
    allowedTypes?: string[];
    allowedExtensions?: string[];
  } = {}
): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  const {
    maxSize = 10 * 1024 * 1024, // 10MB default
    allowedTypes = ['image/*', 'application/pdf', 'text/*'],
    allowedExtensions = ['.jpg', '.jpeg', '.png', '.pdf', '.txt', '.doc', '.docx']
  } = options;
  
  // Check file size
  if (file.size > maxSize) {
    errors.push(`File size must be less than ${Math.round(maxSize / 1024 / 1024)}MB`);
  }
  
  // Check file type
  const isTypeAllowed = allowedTypes.some(type => {
    if (type.endsWith('/*')) {
      return file.type.startsWith(type.slice(0, -1));
    }
    return file.type === type;
  });
  
  if (!isTypeAllowed) {
    errors.push(`File type ${file.type} is not allowed`);
  }
  
  // Check file extension
  const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
  if (!allowedExtensions.includes(fileExtension)) {
    errors.push(`File extension ${fileExtension} is not allowed`);
  }
  
  // Security warnings
  if (file.name.includes('..') || file.name.includes('/') || file.name.includes('\\')) {
    errors.push('File name contains invalid characters');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  // Basic validators
  required,
  minLength,
  maxLength,
  range,
  pattern,
  email,
  phone,
  url,
  date,
  pastDate,
  futureDate,
  number,
  positiveNumber,
  integer,
  
  // Medical validators
  mrn,
  npi,
  ssn,
  icd10,
  cpt,
  ndc,
  zipCode,
  strongPassword,
  dateOfBirth,
  age,
  
  // Complex validators
  validateVitalSigns,
  validateMedication,
  validateField,
  validateSchema,
  validateFileUpload,
  
  // Schemas
  userRegistrationSchema,
  patientRegistrationSchema,
  providerRegistrationSchema,
  appointmentSchema,
  
  // Utilities
  sanitizeInput,
  formatPhoneNumber,
  formatSSN,
  calculateBMI,
  calculateAge
};