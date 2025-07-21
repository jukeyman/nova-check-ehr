/**
 * ============================================================================
 * NOVA CHECK EHR - REPORT MODEL
 * ============================================================================
 */

import { PrismaClient, Report as PrismaReport, ReportType, ReportStatus, ReportFormat } from '@prisma/client';
import { logger } from '../utils/logger';
import { AppError, NotFoundError, ValidationError } from '../utils/errors';
import { generateUniqueId } from '../utils/generators';
import { formatDate, formatCurrency, calculateAge } from '../utils/helpers';
import { ReportData, ReportGenerationOptions } from '../types';
import path from 'path';
import fs from 'fs/promises';

// ============================================================================
// INTERFACES
// ============================================================================

export interface ReportWithRelations extends PrismaReport {
  generatedBy?: any;
  patient?: any;
  provider?: any;
}

export interface ReportSearchFilters {
  type?: ReportType;
  status?: ReportStatus;
  format?: ReportFormat;
  generatedBy?: string;
  patientId?: string;
  providerId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
}

export interface ReportStats {
  totalReports: number;
  reportsByType: Record<ReportType, number>;
  reportsByStatus: Record<ReportStatus, number>;
  reportsByFormat: Record<ReportFormat, number>;
  recentReports: number;
  averageGenerationTime: number;
  mostRequestedType: ReportType;
  successRate: number;
}

export interface ReportTemplate {
  id: string;
  name: string;
  type: ReportType;
  description: string;
  template: string;
  parameters: ReportParameter[];
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReportParameter {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'select' | 'multiselect';
  label: string;
  description?: string;
  required: boolean;
  defaultValue?: any;
  options?: { value: any; label: string }[];
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

export interface ReportData {
  title: string;
  description?: string;
  type: ReportType;
  format: ReportFormat;
  generatedBy: string;
  patientId?: string;
  providerId?: string;
  parameters?: Record<string, any>;
  templateId?: string;
  scheduledFor?: Date;
  expiresAt?: Date;
}

export interface ClinicalReport {
  patientInfo: {
    patientId: string;
    name: string;
    dateOfBirth: Date;
    age: number;
    gender: string;
    phone?: string;
    email?: string;
    address?: string;
  };
  encounters: {
    id: string;
    date: Date;
    type: string;
    provider: string;
    chiefComplaint?: string;
    diagnosis: string[];
    procedures: string[];
    medications: string[];
  }[];
  vitalSigns: {
    date: Date;
    bloodPressure?: string;
    heartRate?: number;
    temperature?: number;
    weight?: number;
    height?: number;
    bmi?: number;
  }[];
  labResults: {
    date: Date;
    testName: string;
    result: string;
    normalRange?: string;
    status: string;
  }[];
  allergies: string[];
  medications: {
    name: string;
    dosage: string;
    frequency: string;
    startDate: Date;
    endDate?: Date;
    prescriber: string;
  }[];
  immunizations: {
    vaccine: string;
    date: Date;
    provider: string;
    lotNumber?: string;
  }[];
}

export interface AnalyticsReport {
  period: {
    startDate: Date;
    endDate: Date;
  };
  patientMetrics: {
    totalPatients: number;
    newPatients: number;
    activePatients: number;
    patientsByAge: Record<string, number>;
    patientsByGender: Record<string, number>;
  };
  appointmentMetrics: {
    totalAppointments: number;
    completedAppointments: number;
    canceledAppointments: number;
    noShowAppointments: number;
    averageWaitTime: number;
    appointmentsByType: Record<string, number>;
  };
  financialMetrics: {
    totalRevenue: number;
    collectedAmount: number;
    outstandingAmount: number;
    averageClaimAmount: number;
    revenueByService: Record<string, number>;
  };
  providerMetrics: {
    totalProviders: number;
    activeProviders: number;
    appointmentsByProvider: Record<string, number>;
    revenueByProvider: Record<string, number>;
  };
}

export interface ComplianceReport {
  period: {
    startDate: Date;
    endDate: Date;
  };
  auditTrail: {
    totalEvents: number;
    eventsByType: Record<string, number>;
    eventsByUser: Record<string, number>;
    suspiciousActivities: number;
  };
  dataAccess: {
    totalAccesses: number;
    accessesByUser: Record<string, number>;
    accessesByResource: Record<string, number>;
    unauthorizedAttempts: number;
  };
  backups: {
    totalBackups: number;
    successfulBackups: number;
    failedBackups: number;
    lastBackupDate: Date;
  };
  security: {
    loginAttempts: number;
    failedLogins: number;
    passwordChanges: number;
    accountLockouts: number;
  };
}

// ============================================================================
// REPORT MODEL CLASS
// ============================================================================

export class ReportModel {
  private prisma: PrismaClient;
  private reportsPath: string;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.reportsPath = process.env.REPORTS_PATH || './reports';
  }

  /**
   * Generate a new report
   */
  async generate(reportData: ReportData): Promise<ReportWithRelations> {
    try {
      // Validate required fields
      if (!reportData.title || !reportData.type || !reportData.format || !reportData.generatedBy) {
        throw new ValidationError('Missing required fields: title, type, format, generatedBy');
      }

      // Generate report ID
      const reportId = generateUniqueId('RPT');
      const fileName = `${reportId}.${this.getFileExtension(reportData.format)}`;
      const filePath = this.generateFilePath(fileName, reportData.type);

      // Create report record
      const report = await this.prisma.report.create({
        data: {
          id: reportId,
          reportId: reportId,
          title: reportData.title,
          description: reportData.description,
          type: reportData.type,
          format: reportData.format,
          status: ReportStatus.GENERATING,
          generatedBy: reportData.generatedBy,
          patientId: reportData.patientId,
          providerId: reportData.providerId,
          parameters: reportData.parameters || {},
          templateId: reportData.templateId,
          fileName,
          filePath,
          scheduledFor: reportData.scheduledFor,
          expiresAt: reportData.expiresAt,
          generationStartedAt: new Date(),
        },
        include: {
          generatedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          patient: reportData.patientId ? {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
            },
          } : undefined,
          provider: reportData.providerId ? {
            select: {
              firstName: true,
              lastName: true,
              title: true,
              npi: true,
            },
          } : undefined,
        },
      });

      // Generate report content asynchronously
      this.generateReportContent(report).catch(error => {
        logger.error('Error generating report content', {
          component: 'ReportModel',
          reportId,
          error: error.message,
        });
      });

      logger.info('Report generation started', {
        component: 'ReportModel',
        reportId,
        type: reportData.type,
        format: reportData.format,
        generatedBy: reportData.generatedBy,
      });

      return report;
    } catch (error) {
      logger.error('Error generating report', {
        component: 'ReportModel',
        error: (error as Error).message,
        reportData: {
          title: reportData.title,
          type: reportData.type,
          generatedBy: reportData.generatedBy,
        },
      });
      throw error;
    }
  }

  /**
   * Find report by ID
   */
  async findById(id: string, includeRelations: boolean = false): Promise<ReportWithRelations | null> {
    try {
      const report = await this.prisma.report.findUnique({
        where: { id },
        include: includeRelations ? {
          generatedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          patient: {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
            },
          },
          provider: {
            select: {
              firstName: true,
              lastName: true,
              title: true,
              npi: true,
            },
          },
        } : undefined,
      });

      return report;
    } catch (error) {
      logger.error('Error finding report by ID', {
        component: 'ReportModel',
        error: (error as Error).message,
        reportId: id,
      });
      throw new AppError('Failed to find report', 500);
    }
  }

  /**
   * Get report file buffer
   */
  async getReportFile(id: string): Promise<{ buffer: Buffer; report: ReportWithRelations }> {
    try {
      const report = await this.findById(id, true);
      if (!report) {
        throw new NotFoundError('Report not found');
      }

      if (report.status !== ReportStatus.COMPLETED) {
        throw new AppError('Report is not ready for download', 400);
      }

      const fullPath = path.join(this.reportsPath, report.filePath);
      
      try {
        const buffer = await fs.readFile(fullPath);
        
        // Update access count and last accessed time
        await this.prisma.report.update({
          where: { id },
          data: {
            accessCount: { increment: 1 },
            lastAccessedAt: new Date(),
          },
        });

        return { buffer, report };
      } catch (fsError) {
        logger.error('Report file not found on disk', {
          component: 'ReportModel',
          reportId: id,
          filePath: fullPath,
          error: (fsError as Error).message,
        });
        
        throw new NotFoundError('Report file not found');
      }
    } catch (error) {
      logger.error('Error getting report file', {
        component: 'ReportModel',
        error: (error as Error).message,
        reportId: id,
      });
      throw error;
    }
  }

  /**
   * Get reports with filters and pagination
   */
  async findMany(
    filters: ReportSearchFilters = {},
    page: number = 1,
    limit: number = 20,
    sortBy: string = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<{ reports: ReportWithRelations[]; total: number; pages: number }> {
    try {
      const skip = (page - 1) * limit;
      
      // Build where clause
      const where: any = {};

      if (filters.type) {
        where.type = filters.type;
      }

      if (filters.status) {
        where.status = filters.status;
      }

      if (filters.format) {
        where.format = filters.format;
      }

      if (filters.generatedBy) {
        where.generatedBy = filters.generatedBy;
      }

      if (filters.patientId) {
        where.patientId = filters.patientId;
      }

      if (filters.providerId) {
        where.providerId = filters.providerId;
      }

      if (filters.dateFrom || filters.dateTo) {
        where.createdAt = {};
        if (filters.dateFrom) {
          where.createdAt.gte = filters.dateFrom;
        }
        if (filters.dateTo) {
          where.createdAt.lte = filters.dateTo;
        }
      }

      if (filters.search) {
        where.OR = [
          { title: { contains: filters.search, mode: 'insensitive' } },
          { description: { contains: filters.search, mode: 'insensitive' } },
          { reportId: { contains: filters.search, mode: 'insensitive' } },
        ];
      }

      // Get reports and total count
      const [reports, total] = await Promise.all([
        this.prisma.report.findMany({
          where,
          include: {
            generatedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            patient: {
              select: {
                patientId: true,
                firstName: true,
                lastName: true,
              },
            },
            provider: {
              select: {
                firstName: true,
                lastName: true,
                title: true,
              },
            },
          },
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        this.prisma.report.count({ where }),
      ]);

      const pages = Math.ceil(total / limit);

      return { reports, total, pages };
    } catch (error) {
      logger.error('Error finding reports', {
        component: 'ReportModel',
        error: (error as Error).message,
        filters,
      });
      throw new AppError('Failed to find reports', 500);
    }
  }

  /**
   * Generate clinical report for patient
   */
  async generateClinicalReport(patientId: string, generatedBy: string, dateFrom?: Date, dateTo?: Date): Promise<ClinicalReport> {
    try {
      // Get patient information
      const patient = await this.prisma.patient.findUnique({
        where: { id: patientId },
        include: {
          allergies: true,
          medications: {
            where: {
              isActive: true,
            },
            include: {
              prescriber: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
          immunizations: {
            include: {
              provider: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      });

      if (!patient) {
        throw new NotFoundError('Patient not found');
      }

      // Build date filter
      const dateFilter: any = {};
      if (dateFrom) {
        dateFilter.gte = dateFrom;
      }
      if (dateTo) {
        dateFilter.lte = dateTo;
      }

      // Get encounters
      const encounters = await this.prisma.encounter.findMany({
        where: {
          patientId,
          ...(Object.keys(dateFilter).length > 0 ? { startTime: dateFilter } : {}),
        },
        include: {
          provider: {
            select: {
              firstName: true,
              lastName: true,
              title: true,
            },
          },
          diagnoses: true,
          procedures: true,
          prescriptions: {
            include: {
              medication: true,
            },
          },
        },
        orderBy: {
          startTime: 'desc',
        },
      });

      // Get vital signs
      const vitalSigns = await this.prisma.vitalSigns.findMany({
        where: {
          patientId,
          ...(Object.keys(dateFilter).length > 0 ? { recordedAt: dateFilter } : {}),
        },
        orderBy: {
          recordedAt: 'desc',
        },
      });

      // Get lab results (placeholder - would need lab results table)
      const labResults: any[] = [];

      // Format clinical report
      const clinicalReport: ClinicalReport = {
        patientInfo: {
          patientId: patient.patientId,
          name: `${patient.firstName} ${patient.lastName}`,
          dateOfBirth: patient.dateOfBirth,
          age: calculateAge(patient.dateOfBirth),
          gender: patient.gender,
          phone: patient.phone,
          email: patient.email,
          address: patient.address ? `${patient.address}, ${patient.city}, ${patient.state} ${patient.zipCode}` : undefined,
        },
        encounters: encounters.map(encounter => ({
          id: encounter.encounterId,
          date: encounter.startTime,
          type: encounter.type,
          provider: `${encounter.provider.title} ${encounter.provider.firstName} ${encounter.provider.lastName}`,
          chiefComplaint: encounter.chiefComplaint,
          diagnosis: encounter.diagnoses.map(d => d.description),
          procedures: encounter.procedures.map(p => p.description),
          medications: encounter.prescriptions.map(p => `${p.medication.name} ${p.dosage} ${p.frequency}`),
        })),
        vitalSigns: vitalSigns.map(vs => ({
          date: vs.recordedAt,
          bloodPressure: vs.systolicBP && vs.diastolicBP ? `${vs.systolicBP}/${vs.diastolicBP}` : undefined,
          heartRate: vs.heartRate,
          temperature: vs.temperature,
          weight: vs.weight,
          height: vs.height,
          bmi: vs.bmi,
        })),
        labResults,
        allergies: patient.allergies.map(a => a.allergen),
        medications: patient.medications.map(m => ({
          name: m.name,
          dosage: m.dosage,
          frequency: m.frequency,
          startDate: m.startDate,
          endDate: m.endDate,
          prescriber: `${m.prescriber.firstName} ${m.prescriber.lastName}`,
        })),
        immunizations: patient.immunizations.map(i => ({
          vaccine: i.vaccine,
          date: i.administeredDate,
          provider: `${i.provider.firstName} ${i.provider.lastName}`,
          lotNumber: i.lotNumber,
        })),
      };

      return clinicalReport;
    } catch (error) {
      logger.error('Error generating clinical report', {
        component: 'ReportModel',
        error: (error as Error).message,
        patientId,
        generatedBy,
      });
      throw error;
    }
  }

  /**
   * Generate analytics report
   */
  async generateAnalyticsReport(generatedBy: string, dateFrom: Date, dateTo: Date): Promise<AnalyticsReport> {
    try {
      const dateFilter = {
        gte: dateFrom,
        lte: dateTo,
      };

      // Get patient metrics
      const [totalPatients, newPatients, activePatients, patientsByAge, patientsByGender] = await Promise.all([
        this.prisma.patient.count({
          where: {
            isDeleted: false,
          },
        }),
        this.prisma.patient.count({
          where: {
            createdAt: dateFilter,
            isDeleted: false,
          },
        }),
        this.prisma.patient.count({
          where: {
            isActive: true,
            isDeleted: false,
          },
        }),
        this.prisma.patient.groupBy({
          by: ['gender'],
          where: {
            isDeleted: false,
          },
          _count: true,
        }),
        this.prisma.patient.groupBy({
          by: ['gender'],
          where: {
            isDeleted: false,
          },
          _count: true,
        }),
      ]);

      // Get appointment metrics
      const [totalAppointments, appointmentsByStatus, appointmentsByType] = await Promise.all([
        this.prisma.appointment.count({
          where: {
            startTime: dateFilter,
          },
        }),
        this.prisma.appointment.groupBy({
          by: ['status'],
          where: {
            startTime: dateFilter,
          },
          _count: true,
        }),
        this.prisma.appointment.groupBy({
          by: ['type'],
          where: {
            startTime: dateFilter,
          },
          _count: true,
        }),
      ]);

      // Get financial metrics (placeholder)
      const financialMetrics = {
        totalRevenue: 0,
        collectedAmount: 0,
        outstandingAmount: 0,
        averageClaimAmount: 0,
        revenueByService: {},
      };

      // Get provider metrics
      const [totalProviders, activeProviders, appointmentsByProvider] = await Promise.all([
        this.prisma.user.count({
          where: {
            role: 'PROVIDER',
            isDeleted: false,
          },
        }),
        this.prisma.user.count({
          where: {
            role: 'PROVIDER',
            isActive: true,
            isDeleted: false,
          },
        }),
        this.prisma.appointment.groupBy({
          by: ['providerId'],
          where: {
            startTime: dateFilter,
          },
          _count: true,
        }),
      ]);

      // Format the report
      const analyticsReport: AnalyticsReport = {
        period: {
          startDate: dateFrom,
          endDate: dateTo,
        },
        patientMetrics: {
          totalPatients,
          newPatients,
          activePatients,
          patientsByAge: {}, // Would need age calculation
          patientsByGender: patientsByGender.reduce((acc, item) => {
            acc[item.gender] = item._count;
            return acc;
          }, {} as Record<string, number>),
        },
        appointmentMetrics: {
          totalAppointments,
          completedAppointments: appointmentsByStatus.find(s => s.status === 'COMPLETED')?._count || 0,
          canceledAppointments: appointmentsByStatus.find(s => s.status === 'CANCELLED')?._count || 0,
          noShowAppointments: appointmentsByStatus.find(s => s.status === 'NO_SHOW')?._count || 0,
          averageWaitTime: 0, // Would need wait time calculation
          appointmentsByType: appointmentsByType.reduce((acc, item) => {
            acc[item.type] = item._count;
            return acc;
          }, {} as Record<string, number>),
        },
        financialMetrics,
        providerMetrics: {
          totalProviders,
          activeProviders,
          appointmentsByProvider: appointmentsByProvider.reduce((acc, item) => {
            acc[item.providerId] = item._count;
            return acc;
          }, {} as Record<string, number>),
          revenueByProvider: {}, // Would need revenue calculation
        },
      };

      return analyticsReport;
    } catch (error) {
      logger.error('Error generating analytics report', {
        component: 'ReportModel',
        error: (error as Error).message,
        generatedBy,
        dateFrom,
        dateTo,
      });
      throw error;
    }
  }

  /**
   * Get report statistics
   */
  async getStats(dateFrom?: Date, dateTo?: Date): Promise<ReportStats> {
    try {
      const where: any = {};
      
      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) {
          where.createdAt.gte = dateFrom;
        }
        if (dateTo) {
          where.createdAt.lte = dateTo;
        }
      }

      const [totalReports, reportsByType, reportsByStatus, reportsByFormat, recentReports, generationTimes] = await Promise.all([
        this.prisma.report.count({ where }),
        this.prisma.report.groupBy({
          by: ['type'],
          where,
          _count: true,
        }),
        this.prisma.report.groupBy({
          by: ['status'],
          where,
          _count: true,
        }),
        this.prisma.report.groupBy({
          by: ['format'],
          where,
          _count: true,
        }),
        this.prisma.report.count({
          where: {
            ...where,
            createdAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
            },
          },
        }),
        this.prisma.report.aggregate({
          where: {
            ...where,
            status: ReportStatus.COMPLETED,
            generationTime: { not: null },
          },
          _avg: {
            generationTime: true,
          },
        }),
      ]);

      // Format type stats
      const typeStats = reportsByType.reduce((acc, item) => {
        acc[item.type] = item._count;
        return acc;
      }, {} as Record<ReportType, number>);

      // Ensure all types are represented
      Object.values(ReportType).forEach(type => {
        if (!(type in typeStats)) {
          typeStats[type] = 0;
        }
      });

      // Format status stats
      const statusStats = reportsByStatus.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {} as Record<ReportStatus, number>);

      // Ensure all statuses are represented
      Object.values(ReportStatus).forEach(status => {
        if (!(status in statusStats)) {
          statusStats[status] = 0;
        }
      });

      // Format format stats
      const formatStats = reportsByFormat.reduce((acc, item) => {
        acc[item.format] = item._count;
        return acc;
      }, {} as Record<ReportFormat, number>);

      // Ensure all formats are represented
      Object.values(ReportFormat).forEach(format => {
        if (!(format in formatStats)) {
          formatStats[format] = 0;
        }
      });

      // Find most requested type
      const mostRequestedType = Object.entries(typeStats).reduce((a, b) => 
        typeStats[a[0] as ReportType] > typeStats[b[0] as ReportType] ? a : b
      )[0] as ReportType;

      // Calculate success rate
      const completedReports = statusStats[ReportStatus.COMPLETED] || 0;
      const successRate = totalReports > 0 ? (completedReports / totalReports) * 100 : 0;

      return {
        totalReports,
        reportsByType: typeStats,
        reportsByStatus: statusStats,
        reportsByFormat: formatStats,
        recentReports,
        averageGenerationTime: Math.round(generationTimes._avg.generationTime || 0),
        mostRequestedType,
        successRate: Math.round(successRate * 10) / 10,
      };
    } catch (error) {
      logger.error('Error getting report stats', {
        component: 'ReportModel',
        error: (error as Error).message,
      });
      throw new AppError('Failed to get report statistics', 500);
    }
  }

  /**
   * Delete report
   */
  async delete(id: string): Promise<void> {
    try {
      const report = await this.findById(id);
      if (!report) {
        throw new NotFoundError('Report not found');
      }

      // Delete file from disk
      if (report.filePath) {
        const fullPath = path.join(this.reportsPath, report.filePath);
        try {
          await fs.unlink(fullPath);
        } catch (fsError) {
          logger.warn('Report file not found on disk during deletion', {
            component: 'ReportModel',
            reportId: id,
            filePath: fullPath,
          });
        }
      }

      // Delete from database
      await this.prisma.report.delete({
        where: { id },
      });

      logger.info('Report deleted successfully', {
        component: 'ReportModel',
        reportId: id,
      });
    } catch (error) {
      logger.error('Error deleting report', {
        component: 'ReportModel',
        error: (error as Error).message,
        reportId: id,
      });
      throw error;
    }
  }

  /**
   * Generate report content (async)
   */
  private async generateReportContent(report: ReportWithRelations): Promise<void> {
    try {
      const startTime = Date.now();
      let content: string;

      // Generate content based on report type
      switch (report.type) {
        case ReportType.CLINICAL:
          if (!report.patientId) {
            throw new ValidationError('Patient ID required for clinical report');
          }
          const clinicalData = await this.generateClinicalReport(report.patientId, report.generatedBy);
          content = this.formatClinicalReport(clinicalData, report.format);
          break;

        case ReportType.ANALYTICS:
          const dateFrom = report.parameters?.dateFrom ? new Date(report.parameters.dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          const dateTo = report.parameters?.dateTo ? new Date(report.parameters.dateTo) : new Date();
          const analyticsData = await this.generateAnalyticsReport(report.generatedBy, dateFrom, dateTo);
          content = this.formatAnalyticsReport(analyticsData, report.format);
          break;

        case ReportType.COMPLIANCE:
          // Placeholder for compliance report generation
          content = 'Compliance report content';
          break;

        default:
          throw new ValidationError(`Unsupported report type: ${report.type}`);
      }

      // Ensure directory exists
      const fullPath = path.join(this.reportsPath, report.filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });

      // Write content to file
      await fs.writeFile(fullPath, content);

      // Get file size
      const stats = await fs.stat(fullPath);
      const generationTime = Date.now() - startTime;

      // Update report status
      await this.prisma.report.update({
        where: { id: report.id },
        data: {
          status: ReportStatus.COMPLETED,
          fileSize: stats.size,
          generationTime,
          generationCompletedAt: new Date(),
        },
      });

      logger.info('Report generation completed', {
        component: 'ReportModel',
        reportId: report.id,
        generationTime,
        fileSize: stats.size,
      });
    } catch (error) {
      // Update report status to failed
      await this.prisma.report.update({
        where: { id: report.id },
        data: {
          status: ReportStatus.FAILED,
          errorMessage: (error as Error).message,
          generationCompletedAt: new Date(),
        },
      });

      logger.error('Report generation failed', {
        component: 'ReportModel',
        reportId: report.id,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Format clinical report
   */
  private formatClinicalReport(data: ClinicalReport, format: ReportFormat): string {
    switch (format) {
      case ReportFormat.JSON:
        return JSON.stringify(data, null, 2);
      
      case ReportFormat.CSV:
        // Simplified CSV format for encounters
        const csvLines = [
          'Date,Type,Provider,Chief Complaint,Diagnosis,Procedures',
          ...data.encounters.map(e => 
            `${formatDate(e.date)},${e.type},${e.provider},${e.chiefComplaint || ''},${e.diagnosis.join('; ')},${e.procedures.join('; ')}`
          )
        ];
        return csvLines.join('\n');
      
      case ReportFormat.HTML:
        return this.generateClinicalHTML(data);
      
      case ReportFormat.PDF:
        // Would use a PDF library like puppeteer or jsPDF
        return this.generateClinicalHTML(data); // Placeholder
      
      default:
        return JSON.stringify(data, null, 2);
    }
  }

  /**
   * Format analytics report
   */
  private formatAnalyticsReport(data: AnalyticsReport, format: ReportFormat): string {
    switch (format) {
      case ReportFormat.JSON:
        return JSON.stringify(data, null, 2);
      
      case ReportFormat.CSV:
        // Simplified CSV format
        const csvLines = [
          'Metric,Value',
          `Total Patients,${data.patientMetrics.totalPatients}`,
          `New Patients,${data.patientMetrics.newPatients}`,
          `Total Appointments,${data.appointmentMetrics.totalAppointments}`,
          `Completed Appointments,${data.appointmentMetrics.completedAppointments}`,
        ];
        return csvLines.join('\n');
      
      case ReportFormat.HTML:
        return this.generateAnalyticsHTML(data);
      
      case ReportFormat.PDF:
        return this.generateAnalyticsHTML(data); // Placeholder
      
      default:
        return JSON.stringify(data, null, 2);
    }
  }

  /**
   * Generate clinical HTML report
   */
  private generateClinicalHTML(data: ClinicalReport): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Clinical Report - ${data.patientInfo.name}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .header { border-bottom: 2px solid #333; padding-bottom: 10px; }
          .section { margin: 20px 0; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Clinical Report</h1>
          <h2>${data.patientInfo.name}</h2>
          <p>Patient ID: ${data.patientInfo.patientId} | DOB: ${formatDate(data.patientInfo.dateOfBirth)} | Age: ${data.patientInfo.age}</p>
        </div>
        
        <div class="section">
          <h3>Recent Encounters</h3>
          <table>
            <tr><th>Date</th><th>Type</th><th>Provider</th><th>Diagnosis</th></tr>
            ${data.encounters.map(e => `
              <tr>
                <td>${formatDate(e.date)}</td>
                <td>${e.type}</td>
                <td>${e.provider}</td>
                <td>${e.diagnosis.join(', ')}</td>
              </tr>
            `).join('')}
          </table>
        </div>
        
        <div class="section">
          <h3>Current Medications</h3>
          <ul>
            ${data.medications.map(m => `<li>${m.name} - ${m.dosage} ${m.frequency}</li>`).join('')}
          </ul>
        </div>
        
        <div class="section">
          <h3>Allergies</h3>
          <ul>
            ${data.allergies.map(a => `<li>${a}</li>`).join('')}
          </ul>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate analytics HTML report
   */
  private generateAnalyticsHTML(data: AnalyticsReport): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Analytics Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .header { border-bottom: 2px solid #333; padding-bottom: 10px; }
          .section { margin: 20px 0; }
          .metric { display: inline-block; margin: 10px; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Analytics Report</h1>
          <p>Period: ${formatDate(data.period.startDate)} - ${formatDate(data.period.endDate)}</p>
        </div>
        
        <div class="section">
          <h3>Patient Metrics</h3>
          <div class="metric">Total Patients: ${data.patientMetrics.totalPatients}</div>
          <div class="metric">New Patients: ${data.patientMetrics.newPatients}</div>
          <div class="metric">Active Patients: ${data.patientMetrics.activePatients}</div>
        </div>
        
        <div class="section">
          <h3>Appointment Metrics</h3>
          <div class="metric">Total Appointments: ${data.appointmentMetrics.totalAppointments}</div>
          <div class="metric">Completed: ${data.appointmentMetrics.completedAppointments}</div>
          <div class="metric">Canceled: ${data.appointmentMetrics.canceledAppointments}</div>
          <div class="metric">No Show: ${data.appointmentMetrics.noShowAppointments}</div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate file path
   */
  private generateFilePath(fileName: string, type: ReportType): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    
    return path.join(type.toLowerCase(), String(year), month, fileName);
  }

  /**
   * Get file extension for format
   */
  private getFileExtension(format: ReportFormat): string {
    switch (format) {
      case ReportFormat.PDF:
        return 'pdf';
      case ReportFormat.CSV:
        return 'csv';
      case ReportFormat.HTML:
        return 'html';
      case ReportFormat.JSON:
        return 'json';
      default:
        return 'txt';
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ReportModel;