/**
 * ============================================================================
 * NOVA CHECK EHR - MODELS INDEX
 * ============================================================================
 * 
 * Central export file for all data models in the EHR system.
 * This file provides a single import point for all models and their types.
 */

// ============================================================================
// MODEL IMPORTS
// ============================================================================

// Core Models
export { UserModel } from './User';
export { PatientModel } from './Patient';
export { AppointmentModel } from './Appointment';
export { ClinicalModel } from './Clinical';

// Communication & Notifications
export { NotificationModel } from './Notification';

// Financial & Billing
export { InvoiceModel } from './Invoice';
export { InsuranceModel } from './Insurance';

// File Management
export { FileModel } from './File';

// Reporting & Analytics
export { ReportModel } from './Report';
export { AnalyticsModel } from './Analytics';

// System & Configuration
export { AuditModel } from './Audit';
export { SettingsModel } from './Settings';

// ============================================================================
// TYPE EXPORTS - USER MODEL
// ============================================================================

export type {
  UserWithRelations,
  UserSearchFilters,
  UserStats,
  CreateUserData,
  UpdateUserData,
} from './User';

// ============================================================================
// TYPE EXPORTS - PATIENT MODEL
// ============================================================================

export type {
  PatientWithRelations,
  PatientSearchFilters,
  PatientStats,
  PatientSummary,
} from './Patient';

// ============================================================================
// TYPE EXPORTS - APPOINTMENT MODEL
// ============================================================================

export type {
  AppointmentWithRelations,
  AppointmentSearchFilters,
  AppointmentStats,
  ProviderSchedule,
  TimeSlot,
  AppointmentConflict,
} from './Appointment';

// ============================================================================
// TYPE EXPORTS - CLINICAL MODEL
// ============================================================================

export type {
  EncounterWithRelations,
  EncounterSearchFilters,
  EncounterStats,
  VitalSignsData,
  DiagnosisData,
  ProcedureData,
  PrescriptionData,
  PatientClinicalSummary,
} from './Clinical';

// ============================================================================
// TYPE EXPORTS - NOTIFICATION MODEL
// ============================================================================

export type {
  NotificationWithRelations,
  NotificationSearchFilters,
  NotificationStats,
  NotificationTemplate,
  NotificationPreferences,
  BulkNotificationRequest,
} from './Notification';

// ============================================================================
// TYPE EXPORTS - INVOICE MODEL
// ============================================================================

export type {
  InvoiceWithRelations,
  InvoiceSearchFilters,
  InvoiceStats,
  InvoiceItem,
  PaymentRecord,
  InvoiceSummary,
  AgingReport,
} from './Invoice';

// ============================================================================
// TYPE EXPORTS - INSURANCE MODEL
// ============================================================================

export type {
  InsuranceWithRelations,
  InsuranceSearchFilters,
  InsuranceStats,
  ClaimData,
  AuthorizationData,
  EligibilityData,
} from './Insurance';

// ============================================================================
// TYPE EXPORTS - FILE MODEL
// ============================================================================

export type {
  FileWithRelations,
  FileSearchFilters,
  FileStats,
  FileUploadResult,
  FileBatch,
  FileVersion,
  FileShare,
  FileMetadata,
} from './File';

// ============================================================================
// TYPE EXPORTS - REPORT MODEL
// ============================================================================

export type {
  ReportWithRelations,
  ReportSearchFilters,
  ReportStats,
  ReportTemplate,
  ReportParameter,
  ReportData,
  ClinicalReport,
  AnalyticsReport,
  ComplianceReport,
} from './Report';

// ============================================================================
// TYPE EXPORTS - ANALYTICS MODEL
// ============================================================================

export type {
  AnalyticsFilters,
  DashboardMetrics,
  PatientAnalytics,
  ProviderAnalytics,
  FinancialAnalytics,
  OperationalAnalytics,
  ClinicalAnalytics,
  QualityMetrics,
  TrendAnalysis,
} from './Analytics';

// ============================================================================
// TYPE EXPORTS - AUDIT MODEL
// ============================================================================

export type {
  AuditLogWithRelations,
  AuditSearchFilters,
  AuditStats,
  AuditEvent,
  ComplianceReport as AuditComplianceReport,
  SecurityAlert,
} from './Audit';

// ============================================================================
// TYPE EXPORTS - SETTINGS MODEL
// ============================================================================

export type {
  SettingWithRelations,
  SettingsSearchFilters,
  UserPreferences,
  SystemSettings,
  SettingValidationRule,
  SettingTemplate,
  SettingsExport,
} from './Settings';

// ============================================================================
// MODEL FACTORY FUNCTION
// ============================================================================

import { PrismaClient } from '@prisma/client';
import { CacheService } from '../services/cacheService';

/**
 * Factory function to create all model instances with shared dependencies
 */
export function createModels(prisma: PrismaClient, cacheService: CacheService) {
  return {
    // Core Models
    user: new UserModel(prisma),
    patient: new PatientModel(prisma),
    appointment: new AppointmentModel(prisma),
    clinical: new ClinicalModel(prisma),

    // Communication & Notifications
    notification: new NotificationModel(prisma),

    // Financial & Billing
    invoice: new InvoiceModel(prisma),
    insurance: new InsuranceModel(prisma),

    // File Management
    file: new FileModel(prisma),

    // Reporting & Analytics
    report: new ReportModel(prisma),
    analytics: new AnalyticsModel(prisma, cacheService),

    // System & Configuration
    audit: new AuditModel(prisma),
    settings: new SettingsModel(prisma, cacheService),
  };
}

// ============================================================================
// MODEL TYPES
// ============================================================================

/**
 * Type representing all available models
 */
export type Models = ReturnType<typeof createModels>;

/**
 * Individual model types for type safety
 */
export type UserModelType = UserModel;
export type PatientModelType = PatientModel;
export type AppointmentModelType = AppointmentModel;
export type ClinicalModelType = ClinicalModel;
export type NotificationModelType = NotificationModel;
export type InvoiceModelType = InvoiceModel;
export type InsuranceModelType = InsuranceModel;
export type FileModelType = FileModel;
export type ReportModelType = ReportModel;
export type AnalyticsModelType = AnalyticsModel;
export type AuditModelType = AuditModel;
export type SettingsModelType = SettingsModel;

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Common pagination parameters
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Common search parameters
 */
export interface SearchParams {
  search?: string;
  filters?: Record<string, any>;
}

/**
 * Combined pagination and search parameters
 */
export interface QueryParams extends PaginationParams, SearchParams {}

/**
 * Standard API response format
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Bulk operation result
 */
export interface BulkOperationResult {
  success: number;
  failed: number;
  errors: Array<{
    index: number;
    error: string;
  }>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default pagination limits
 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Common date formats
 */
export const DATE_FORMATS = {
  ISO: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
  DATE_ONLY: 'YYYY-MM-DD',
  TIME_ONLY: 'HH:mm:ss',
  DISPLAY: 'MM/DD/YYYY',
  DISPLAY_WITH_TIME: 'MM/DD/YYYY HH:mm',
} as const;

/**
 * Common status values
 */
export const COMMON_STATUSES = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  DELETED: 'DELETED',
} as const;

/**
 * Priority levels
 */
export const PRIORITY_LEVELS = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
  CRITICAL: 'CRITICAL',
} as const;

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate pagination parameters
 */
export function validatePagination(params: PaginationParams): PaginationParams {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, params.limit || DEFAULT_PAGE_SIZE));
  
  return {
    ...params,
    page,
    limit,
  };
}

/**
 * Calculate pagination metadata
 */
export function calculatePagination(total: number, page: number, limit: number) {
  const totalPages = Math.ceil(total / limit);
  
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/**
 * Generate standard API response
 */
export function createApiResponse<T>(
  data: T,
  success = true,
  message?: string,
  pagination?: any
): ApiResponse<T> {
  return {
    success,
    data,
    message,
    ...(pagination && { pagination }),
  };
}

/**
 * Generate error API response
 */
export function createErrorResponse(error: string, message?: string): ApiResponse<null> {
  return {
    success: false,
    data: null,
    error,
    message,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  createModels,
  validatePagination,
  calculatePagination,
  createApiResponse,
  createErrorResponse,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  DATE_FORMATS,
  COMMON_STATUSES,
  PRIORITY_LEVELS,
};