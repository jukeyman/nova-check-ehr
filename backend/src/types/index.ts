/**
 * ============================================================================
 * NOVA CHECK EHR - TYPE DEFINITIONS
 * ============================================================================
 */

import { Request } from 'express';
import { UserRole, UserStatus, Gender, BloodType, AppointmentStatus, AppointmentType, Priority } from '@prisma/client';

// ============================================================================
// AUTHENTICATION & USER TYPES
// ============================================================================

export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  facilityId?: string;
  permissions?: string[];
  lastLoginAt?: Date;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export interface JWTPayload {
  id: string;
  email: string;
  role: UserRole;
  facilityId?: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  facilityId?: string;
  phone?: string;
  department?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  data?: {
    user: AuthenticatedUser;
    tokens: TokenPair;
  };
  error?: string;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  errors?: ValidationError[];
  meta?: PaginationMeta;
}

export interface ValidationError {
  field: string;
  message: string;
  code?: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ============================================================================
// PATIENT TYPES
// ============================================================================

export interface PatientCreateData {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: Gender;
  email?: string;
  phone?: string;
  address?: PatientAddress;
  emergencyContact?: EmergencyContact;
  insurance?: InsuranceInfo[];
  medicalHistory?: string;
  allergies?: AllergyData[];
  medications?: MedicationData[];
  socialHistory?: SocialHistory;
  familyHistory?: string;
}

export interface PatientAddress {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country?: string;
}

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  email?: string;
  address?: PatientAddress;
}

export interface InsuranceInfo {
  provider: string;
  policyNumber: string;
  groupNumber?: string;
  subscriberId: string;
  subscriberName: string;
  relationship: string;
  effectiveDate: string;
  expirationDate?: string;
  copay?: number;
  deductible?: number;
}

export interface AllergyData {
  allergen: string;
  reaction: string;
  severity: 'MILD' | 'MODERATE' | 'SEVERE' | 'LIFE_THREATENING';
  notes?: string;
}

export interface MedicationData {
  name: string;
  dosage: string;
  frequency: string;
  route: string;
  startDate: string;
  endDate?: string;
  prescribedBy?: string;
  notes?: string;
}

export interface SocialHistory {
  smoking?: {
    status: 'NEVER' | 'FORMER' | 'CURRENT';
    packsPerDay?: number;
    yearsSmoked?: number;
    quitDate?: string;
  };
  alcohol?: {
    status: 'NEVER' | 'OCCASIONAL' | 'REGULAR' | 'HEAVY';
    drinksPerWeek?: number;
  };
  drugs?: {
    status: 'NEVER' | 'FORMER' | 'CURRENT';
    substances?: string[];
  };
  exercise?: {
    frequency: 'NEVER' | 'RARELY' | 'SOMETIMES' | 'REGULARLY';
    type?: string;
  };
  occupation?: string;
  maritalStatus?: string;
  education?: string;
}

// ============================================================================
// APPOINTMENT TYPES
// ============================================================================

export interface AppointmentCreateData {
  patientId: string;
  providerId: string;
  type: AppointmentType;
  scheduledAt: string;
  duration: number;
  reason: string;
  notes?: string;
  priority?: Priority;
  isTelemedicine?: boolean;
  location?: string;
  reminderPreferences?: ReminderPreferences;
}

export interface ReminderPreferences {
  email?: boolean;
  sms?: boolean;
  push?: boolean;
  reminderTimes?: number[]; // Hours before appointment
}

export interface AppointmentUpdateData {
  scheduledAt?: string;
  duration?: number;
  reason?: string;
  notes?: string;
  status?: AppointmentStatus;
  priority?: Priority;
  location?: string;
}

// ============================================================================
// CLINICAL TYPES
// ============================================================================

export interface VitalSigns {
  temperature?: number;
  temperatureUnit?: 'F' | 'C';
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  heartRate?: number;
  respiratoryRate?: number;
  oxygenSaturation?: number;
  weight?: number;
  weightUnit?: 'lbs' | 'kg';
  height?: number;
  heightUnit?: 'in' | 'cm';
  bmi?: number;
  painLevel?: number; // 0-10 scale
}

export interface EncounterData {
  patientId: string;
  providerId: string;
  appointmentId?: string;
  type: string;
  chiefComplaint: string;
  historyOfPresentIllness?: string;
  reviewOfSystems?: string;
  physicalExam?: string;
  assessment?: string;
  plan?: string;
  vitals?: VitalSigns;
  diagnoses?: DiagnosisData[];
  procedures?: ProcedureData[];
  medications?: PrescriptionData[];
  orders?: OrderData[];
}

export interface DiagnosisData {
  code: string;
  description: string;
  type: 'PRIMARY' | 'SECONDARY';
  status: 'ACTIVE' | 'RESOLVED' | 'INACTIVE';
  onsetDate?: string;
  notes?: string;
}

export interface ProcedureData {
  code: string;
  description: string;
  performedAt: string;
  performedBy: string;
  location?: string;
  notes?: string;
}

export interface PrescriptionData {
  medicationName: string;
  dosage: string;
  frequency: string;
  route: string;
  quantity: number;
  refills: number;
  instructions: string;
  startDate: string;
  endDate?: string;
}

export interface OrderData {
  type: 'LABORATORY' | 'IMAGING' | 'PROCEDURE' | 'REFERRAL';
  description: string;
  urgency: Priority;
  instructions?: string;
  scheduledFor?: string;
}

// ============================================================================
// FILE & DOCUMENT TYPES
// ============================================================================

export interface FileUploadData {
  file: Express.Multer.File;
  patientId?: string;
  encounterId?: string;
  type: string;
  category?: string;
  description?: string;
  tags?: string[];
}

export interface DocumentMetadata {
  name: string;
  type: string;
  category?: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
  isEncrypted: boolean;
  tags: string[];
  metadata: Record<string, any>;
}

// ============================================================================
// NOTIFICATION TYPES
// ============================================================================

export interface NotificationData {
  userId: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, any>;
  actionUrl?: string;
  expiresAt?: string;
}

export interface EmailData {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  template?: string;
  html?: string;
  text?: string;
  data?: Record<string, any>;
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  path?: string;
}

export interface SMSData {
  to: string;
  message: string;
  from?: string;
}

// ============================================================================
// ANALYTICS TYPES
// ============================================================================

export interface AnalyticsQuery {
  startDate: string;
  endDate: string;
  granularity?: 'day' | 'week' | 'month' | 'year';
  filters?: Record<string, any>;
}

export interface MetricData {
  name: string;
  value: number;
  unit?: string;
  change?: number;
  changePercent?: number;
  trend?: 'up' | 'down' | 'stable';
}

export interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string | string[];
  }[];
}

// ============================================================================
// AUDIT & COMPLIANCE TYPES
// ============================================================================

export interface AuditLogData {
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  outcome?: 'SUCCESS' | 'FAILURE' | 'WARNING';
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  patientId?: string;
  phi?: boolean;
  reason?: string;
  metadata?: Record<string, any>;
}

// ============================================================================
// SEARCH & FILTER TYPES
// ============================================================================

export interface SearchQuery {
  q?: string;
  filters?: Record<string, any>;
  sort?: {
    field: string;
    order: 'asc' | 'desc';
  }[];
  page?: number;
  limit?: number;
}

export interface SearchResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  facets?: Record<string, any>;
}

// ============================================================================
// INTEGRATION TYPES
// ============================================================================

export interface FHIRResource {
  resourceType: string;
  id?: string;
  meta?: {
    versionId?: string;
    lastUpdated?: string;
    profile?: string[];
  };
  [key: string]: any;
}

export interface HL7Message {
  messageType: string;
  sendingApplication: string;
  sendingFacility: string;
  receivingApplication: string;
  receivingFacility: string;
  timestamp: string;
  messageControlId: string;
  processingId: string;
  versionId: string;
  segments: HL7Segment[];
}

export interface HL7Segment {
  type: string;
  fields: string[];
}

// ============================================================================
// SYSTEM TYPES
// ============================================================================

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  services: {
    database: ServiceHealth;
    redis: ServiceHealth;
    email: ServiceHealth;
    storage: ServiceHealth;
  };
}

export interface ServiceHealth {
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime?: number;
  lastCheck: string;
  error?: string;
}

export interface SystemConfig {
  key: string;
  value: any;
  description?: string;
  category?: string;
  isEncrypted: boolean;
  validationRules?: Record<string, any>;
}

// ============================================================================
// ERROR TYPES
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
    type: string;
    message: string;
    code?: string;
    details?: ErrorDetails[];
    stack?: string;
    requestId?: string;
    timestamp: string;
  };
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = Pick<T, Exclude<keyof T, Keys>> &
  {
    [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>;
  }[Keys];

export type Nullable<T> = T | null;

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type WithTimestamps<T> = T & {
  createdAt: Date;
  updatedAt: Date;
};

export type WithAudit<T> = T & {
  createdBy: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
};