/**
 * ============================================================================
 * NOVA CHECK EHR - ANALYTICS SERVICE
 * ============================================================================
 */

import { PrismaClient } from '@prisma/client';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays, subWeeks, subMonths, subYears, format } from 'date-fns';
import logger from '../config/logger';
import cacheService from './cacheService';
import auditService from './auditService';

const prisma = new PrismaClient();

interface DateRange {
  startDate: Date;
  endDate: Date;
}

interface MetricFilter {
  providerId?: string;
  departmentId?: string;
  locationId?: string;
  patientId?: string;
  dateRange?: DateRange;
  groupBy?: 'day' | 'week' | 'month' | 'quarter' | 'year';
}

interface PatientMetrics {
  totalPatients: number;
  newPatients: number;
  activePatients: number;
  patientsByAge: { ageGroup: string; count: number }[];
  patientsByGender: { gender: string; count: number }[];
  patientsByInsurance: { insuranceType: string; count: number }[];
  averageAge: number;
  patientGrowthRate: number;
}

interface AppointmentMetrics {
  totalAppointments: number;
  scheduledAppointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  noShowAppointments: number;
  averageWaitTime: number;
  averageAppointmentDuration: number;
  appointmentsByType: { type: string; count: number }[];
  appointmentsByProvider: { providerId: string; providerName: string; count: number }[];
  showRate: number;
  cancellationRate: number;
}

interface ProviderMetrics {
  totalProviders: number;
  activeProviders: number;
  averagePatientLoad: number;
  providerUtilization: { providerId: string; providerName: string; utilization: number }[];
  appointmentsPerProvider: { providerId: string; providerName: string; appointments: number }[];
  revenuePerProvider: { providerId: string; providerName: string; revenue: number }[];
  patientSatisfactionByProvider: { providerId: string; providerName: string; rating: number }[];
}

interface FinancialMetrics {
  totalRevenue: number;
  collectedRevenue: number;
  outstandingBalance: number;
  averageClaimAmount: number;
  revenueByInsurance: { insuranceType: string; revenue: number }[];
  revenueByService: { serviceType: string; revenue: number }[];
  collectionRate: number;
  daysInAR: number;
  denialRate: number;
}

interface OperationalMetrics {
  averageCheckInTime: number;
  averageCheckOutTime: number;
  roomUtilization: number;
  equipmentUtilization: { equipmentId: string; equipmentName: string; utilization: number }[];
  staffProductivity: { staffId: string; staffName: string; productivity: number }[];
  patientFlowMetrics: {
    averageTimeToSeeProvider: number;
    averageTotalVisitTime: number;
    bottlenecks: string[];
  };
}

interface QualityMetrics {
  patientSatisfactionScore: number;
  readmissionRate: number;
  medicationAdherenceRate: number;
  preventiveCareMetrics: {
    mammographyRate: number;
    colonoscopyRate: number;
    fluVaccinationRate: number;
    diabeticEyeExamRate: number;
  };
  clinicalOutcomes: {
    diabeticA1cControl: number;
    hypertensionControl: number;
    cholesterolControl: number;
  };
}

interface DashboardData {
  patientMetrics: PatientMetrics;
  appointmentMetrics: AppointmentMetrics;
  providerMetrics: ProviderMetrics;
  financialMetrics: FinancialMetrics;
  operationalMetrics: OperationalMetrics;
  qualityMetrics: QualityMetrics;
  trends: {
    patientGrowth: { date: string; count: number }[];
    revenueGrowth: { date: string; revenue: number }[];
    appointmentVolume: { date: string; count: number }[];
  };
}

interface ReportConfig {
  type: 'PATIENT' | 'FINANCIAL' | 'OPERATIONAL' | 'QUALITY' | 'PROVIDER' | 'CUSTOM';
  title: string;
  description?: string;
  filters: MetricFilter;
  metrics: string[];
  format: 'PDF' | 'EXCEL' | 'CSV' | 'JSON';
  schedule?: {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
    recipients: string[];
    enabled: boolean;
  };
}

interface BenchmarkData {
  metric: string;
  currentValue: number;
  benchmarkValue: number;
  percentile: number;
  trend: 'IMPROVING' | 'DECLINING' | 'STABLE';
  industry: string;
}

class AnalyticsService {
  private cacheTimeout = 300; // 5 minutes

  constructor() {
    this.setupPeriodicReports();
  }

  private setupPeriodicReports() {
    // Setup scheduled report generation
    // This would typically use a job scheduler like Bull or Agenda
    logger.info('Analytics service initialized with periodic reporting');
  }

  private async getCachedOrCompute<T>(
    cacheKey: string,
    computeFn: () => Promise<T>,
    ttl: number = this.cacheTimeout
  ): Promise<T> {
    try {
      const cached = await cacheService.get<T>(cacheKey);
      if (cached) {
        return cached;
      }

      const result = await computeFn();
      await cacheService.set(cacheKey, result, ttl);
      return result;
    } catch (error) {
      logger.error('Cache operation failed, computing directly', {
        cacheKey,
        error: error.message,
      });
      return await computeFn();
    }
  }

  private getDateRangeFilter(dateRange?: DateRange) {
    if (!dateRange) {
      return {
        gte: startOfMonth(new Date()),
        lte: endOfMonth(new Date()),
      };
    }
    return {
      gte: dateRange.startDate,
      lte: dateRange.endDate,
    };
  }

  async getPatientMetrics(filters: MetricFilter = {}): Promise<PatientMetrics> {
    const cacheKey = `patient-metrics:${JSON.stringify(filters)}`;
    
    return this.getCachedOrCompute(cacheKey, async () => {
      const dateFilter = this.getDateRangeFilter(filters.dateRange);
      
      const [totalPatients, newPatients, activePatients, patientsByAge, patientsByGender, patientsByInsurance] = await Promise.all([
        // Total patients
        prisma.patient.count({
          where: {
            createdAt: { lte: dateFilter.lte },
            ...(filters.providerId && { primaryProviderId: filters.providerId }),
          },
        }),
        
        // New patients in date range
        prisma.patient.count({
          where: {
            createdAt: dateFilter,
            ...(filters.providerId && { primaryProviderId: filters.providerId }),
          },
        }),
        
        // Active patients (had appointment in last 12 months)
        prisma.patient.count({
          where: {
            appointments: {
              some: {
                scheduledAt: {
                  gte: subMonths(new Date(), 12),
                },
              },
            },
            ...(filters.providerId && { primaryProviderId: filters.providerId }),
          },
        }),
        
        // Patients by age groups
        prisma.$queryRaw`
          SELECT 
            CASE 
              WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) < 18 THEN 'Under 18'
              WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) BETWEEN 18 AND 30 THEN '18-30'
              WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) BETWEEN 31 AND 50 THEN '31-50'
              WHEN EXTRACT(YEAR FROM AGE(date_of_birth)) BETWEEN 51 AND 65 THEN '51-65'
              ELSE 'Over 65'
            END as age_group,
            COUNT(*) as count
          FROM "Patient"
          WHERE created_at <= ${dateFilter.lte}
          ${filters.providerId ? prisma.$queryRaw`AND primary_provider_id = ${filters.providerId}` : prisma.$queryRaw``}
          GROUP BY age_group
          ORDER BY age_group
        `,
        
        // Patients by gender
        prisma.patient.groupBy({
          by: ['gender'],
          _count: true,
          where: {
            createdAt: { lte: dateFilter.lte },
            ...(filters.providerId && { primaryProviderId: filters.providerId }),
          },
        }),
        
        // Patients by insurance
        prisma.patient.groupBy({
          by: ['insuranceType'],
          _count: true,
          where: {
            createdAt: { lte: dateFilter.lte },
            ...(filters.providerId && { primaryProviderId: filters.providerId }),
          },
        }),
      ]);

      // Calculate average age
      const ageResult = await prisma.$queryRaw<[{ avg_age: number }]>`
        SELECT AVG(EXTRACT(YEAR FROM AGE(date_of_birth))) as avg_age
        FROM "Patient"
        WHERE created_at <= ${dateFilter.lte}
        ${filters.providerId ? prisma.$queryRaw`AND primary_provider_id = ${filters.providerId}` : prisma.$queryRaw``}
      `;
      
      const averageAge = Number(ageResult[0]?.avg_age || 0);

      // Calculate patient growth rate
      const previousPeriodStart = subMonths(dateFilter.gte, 1);
      const previousPeriodEnd = subDays(dateFilter.gte, 1);
      
      const previousPeriodPatients = await prisma.patient.count({
        where: {
          createdAt: {
            gte: previousPeriodStart,
            lte: previousPeriodEnd,
          },
          ...(filters.providerId && { primaryProviderId: filters.providerId }),
        },
      });
      
      const patientGrowthRate = previousPeriodPatients > 0 
        ? ((newPatients - previousPeriodPatients) / previousPeriodPatients) * 100 
        : 0;

      return {
        totalPatients,
        newPatients,
        activePatients,
        patientsByAge: (patientsByAge as any[]).map(item => ({
          ageGroup: item.age_group,
          count: Number(item.count),
        })),
        patientsByGender: patientsByGender.map(item => ({
          gender: item.gender || 'Unknown',
          count: item._count,
        })),
        patientsByInsurance: patientsByInsurance.map(item => ({
          insuranceType: item.insuranceType || 'Unknown',
          count: item._count,
        })),
        averageAge,
        patientGrowthRate,
      };
    });
  }

  async getAppointmentMetrics(filters: MetricFilter = {}): Promise<AppointmentMetrics> {
    const cacheKey = `appointment-metrics:${JSON.stringify(filters)}`;
    
    return this.getCachedOrCompute(cacheKey, async () => {
      const dateFilter = this.getDateRangeFilter(filters.dateRange);
      
      const [totalAppointments, appointmentsByStatus, appointmentsByType, appointmentsByProvider, waitTimeData, durationData] = await Promise.all([
        // Total appointments
        prisma.appointment.count({
          where: {
            scheduledAt: dateFilter,
            ...(filters.providerId && { providerId: filters.providerId }),
          },
        }),
        
        // Appointments by status
        prisma.appointment.groupBy({
          by: ['status'],
          _count: true,
          where: {
            scheduledAt: dateFilter,
            ...(filters.providerId && { providerId: filters.providerId }),
          },
        }),
        
        // Appointments by type
        prisma.appointment.groupBy({
          by: ['type'],
          _count: true,
          where: {
            scheduledAt: dateFilter,
            ...(filters.providerId && { providerId: filters.providerId }),
          },
        }),
        
        // Appointments by provider
        prisma.appointment.groupBy({
          by: ['providerId'],
          _count: true,
          where: {
            scheduledAt: dateFilter,
          },
        }),
        
        // Wait time data
        prisma.$queryRaw`
          SELECT AVG(EXTRACT(EPOCH FROM (actual_start_time - scheduled_at))/60) as avg_wait_minutes
          FROM "Appointment"
          WHERE scheduled_at BETWEEN ${dateFilter.gte} AND ${dateFilter.lte}
          AND actual_start_time IS NOT NULL
          ${filters.providerId ? prisma.$queryRaw`AND provider_id = ${filters.providerId}` : prisma.$queryRaw``}
        `,
        
        // Duration data
        prisma.$queryRaw`
          SELECT AVG(duration) as avg_duration
          FROM "Appointment"
          WHERE scheduled_at BETWEEN ${dateFilter.gte} AND ${dateFilter.lte}
          AND status = 'COMPLETED'
          ${filters.providerId ? prisma.$queryRaw`AND provider_id = ${filters.providerId}` : prisma.$queryRaw``}
        `,
      ]);

      // Get provider names for appointment metrics
      const providerIds = appointmentsByProvider.map(item => item.providerId);
      const providers = await prisma.user.findMany({
        where: { id: { in: providerIds } },
        select: { id: true, firstName: true, lastName: true },
      });
      
      const providerMap = new Map(providers.map(p => [p.id, `${p.firstName} ${p.lastName}`]));

      const statusCounts = appointmentsByStatus.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {} as Record<string, number>);

      const scheduledAppointments = statusCounts['SCHEDULED'] || 0;
      const completedAppointments = statusCounts['COMPLETED'] || 0;
      const cancelledAppointments = statusCounts['CANCELLED'] || 0;
      const noShowAppointments = statusCounts['NO_SHOW'] || 0;

      const showRate = totalAppointments > 0 
        ? ((completedAppointments) / (scheduledAppointments + completedAppointments + noShowAppointments)) * 100 
        : 0;
      
      const cancellationRate = totalAppointments > 0 
        ? (cancelledAppointments / totalAppointments) * 100 
        : 0;

      return {
        totalAppointments,
        scheduledAppointments,
        completedAppointments,
        cancelledAppointments,
        noShowAppointments,
        averageWaitTime: Number((waitTimeData as any[])[0]?.avg_wait_minutes || 0),
        averageAppointmentDuration: Number((durationData as any[])[0]?.avg_duration || 0),
        appointmentsByType: appointmentsByType.map(item => ({
          type: item.type,
          count: item._count,
        })),
        appointmentsByProvider: appointmentsByProvider.map(item => ({
          providerId: item.providerId,
          providerName: providerMap.get(item.providerId) || 'Unknown',
          count: item._count,
        })),
        showRate,
        cancellationRate,
      };
    });
  }

  async getProviderMetrics(filters: MetricFilter = {}): Promise<ProviderMetrics> {
    const cacheKey = `provider-metrics:${JSON.stringify(filters)}`;
    
    return this.getCachedOrCompute(cacheKey, async () => {
      const dateFilter = this.getDateRangeFilter(filters.dateRange);
      
      const [totalProviders, activeProviders, providerAppointments, providerRevenue] = await Promise.all([
        // Total providers
        prisma.user.count({
          where: {
            role: 'PROVIDER',
            ...(filters.providerId && { id: filters.providerId }),
          },
        }),
        
        // Active providers (had appointments in date range)
        prisma.user.count({
          where: {
            role: 'PROVIDER',
            appointments: {
              some: {
                scheduledAt: dateFilter,
              },
            },
            ...(filters.providerId && { id: filters.providerId }),
          },
        }),
        
        // Provider appointment counts
        prisma.appointment.groupBy({
          by: ['providerId'],
          _count: true,
          where: {
            scheduledAt: dateFilter,
            ...(filters.providerId && { providerId: filters.providerId }),
          },
        }),
        
        // Provider revenue (placeholder - would need billing integration)
        prisma.$queryRaw`
          SELECT 
            a.provider_id,
            COUNT(DISTINCT a.patient_id) as patient_count,
            COUNT(a.id) as appointment_count,
            COALESCE(SUM(b.amount), 0) as total_revenue
          FROM "Appointment" a
          LEFT JOIN "Billing" b ON a.id = b.appointment_id
          WHERE a.scheduled_at BETWEEN ${dateFilter.gte} AND ${dateFilter.lte}
          ${filters.providerId ? prisma.$queryRaw`AND a.provider_id = ${filters.providerId}` : prisma.$queryRaw``}
          GROUP BY a.provider_id
        `,
      ]);

      // Get provider details
      const providerIds = [...new Set([
        ...providerAppointments.map(p => p.providerId),
        ...(providerRevenue as any[]).map(p => p.provider_id),
      ])];
      
      const providers = await prisma.user.findMany({
        where: { id: { in: providerIds } },
        select: { id: true, firstName: true, lastName: true },
      });
      
      const providerMap = new Map(providers.map(p => [p.id, `${p.firstName} ${p.lastName}`]));

      // Calculate average patient load
      const totalPatientLoad = (providerRevenue as any[]).reduce((sum, p) => sum + Number(p.patient_count), 0);
      const averagePatientLoad = activeProviders > 0 ? totalPatientLoad / activeProviders : 0;

      // Calculate utilization (appointments per working day)
      const workingDays = Math.ceil((dateFilter.lte.getTime() - dateFilter.gte.getTime()) / (1000 * 60 * 60 * 24 * 7)) * 5; // Assume 5 working days per week
      
      const providerUtilization = providerAppointments.map(p => {
        const utilization = workingDays > 0 ? (p._count / workingDays) * 100 : 0;
        return {
          providerId: p.providerId,
          providerName: providerMap.get(p.providerId) || 'Unknown',
          utilization,
        };
      });

      return {
        totalProviders,
        activeProviders,
        averagePatientLoad,
        providerUtilization,
        appointmentsPerProvider: providerAppointments.map(p => ({
          providerId: p.providerId,
          providerName: providerMap.get(p.providerId) || 'Unknown',
          appointments: p._count,
        })),
        revenuePerProvider: (providerRevenue as any[]).map(p => ({
          providerId: p.provider_id,
          providerName: providerMap.get(p.provider_id) || 'Unknown',
          revenue: Number(p.total_revenue),
        })),
        patientSatisfactionByProvider: [], // Would need patient satisfaction data
      };
    });
  }

  async getFinancialMetrics(filters: MetricFilter = {}): Promise<FinancialMetrics> {
    const cacheKey = `financial-metrics:${JSON.stringify(filters)}`;
    
    return this.getCachedOrCompute(cacheKey, async () => {
      const dateFilter = this.getDateRangeFilter(filters.dateRange);
      
      // This is a placeholder implementation
      // In a real system, you'd integrate with billing/accounting systems
      const [billingData, revenueByInsurance, revenueByService] = await Promise.all([
        prisma.$queryRaw`
          SELECT 
            SUM(amount) as total_revenue,
            SUM(CASE WHEN status = 'PAID' THEN amount ELSE 0 END) as collected_revenue,
            SUM(CASE WHEN status = 'PENDING' THEN amount ELSE 0 END) as outstanding_balance,
            AVG(amount) as avg_claim_amount,
            COUNT(CASE WHEN status = 'DENIED' THEN 1 END) as denied_claims,
            COUNT(*) as total_claims
          FROM "Billing"
          WHERE created_at BETWEEN ${dateFilter.gte} AND ${dateFilter.lte}
        `,
        
        // Revenue by insurance type (placeholder)
        prisma.$queryRaw`
          SELECT 
            p.insurance_type,
            SUM(b.amount) as revenue
          FROM "Billing" b
          JOIN "Appointment" a ON b.appointment_id = a.id
          JOIN "Patient" p ON a.patient_id = p.id
          WHERE b.created_at BETWEEN ${dateFilter.gte} AND ${dateFilter.lte}
          GROUP BY p.insurance_type
        `,
        
        // Revenue by service type (placeholder)
        prisma.$queryRaw`
          SELECT 
            a.type as service_type,
            SUM(b.amount) as revenue
          FROM "Billing" b
          JOIN "Appointment" a ON b.appointment_id = a.id
          WHERE b.created_at BETWEEN ${dateFilter.gte} AND ${dateFilter.lte}
          GROUP BY a.type
        `,
      ]);

      const billing = (billingData as any[])[0] || {};
      const totalRevenue = Number(billing.total_revenue || 0);
      const collectedRevenue = Number(billing.collected_revenue || 0);
      const outstandingBalance = Number(billing.outstanding_balance || 0);
      const averageClaimAmount = Number(billing.avg_claim_amount || 0);
      const deniedClaims = Number(billing.denied_claims || 0);
      const totalClaims = Number(billing.total_claims || 0);

      const collectionRate = totalRevenue > 0 ? (collectedRevenue / totalRevenue) * 100 : 0;
      const denialRate = totalClaims > 0 ? (deniedClaims / totalClaims) * 100 : 0;
      
      // Calculate days in A/R (simplified)
      const daysInAR = outstandingBalance > 0 && collectedRevenue > 0 
        ? (outstandingBalance / (collectedRevenue / 30)) 
        : 0;

      return {
        totalRevenue,
        collectedRevenue,
        outstandingBalance,
        averageClaimAmount,
        revenueByInsurance: (revenueByInsurance as any[]).map(item => ({
          insuranceType: item.insurance_type || 'Unknown',
          revenue: Number(item.revenue),
        })),
        revenueByService: (revenueByService as any[]).map(item => ({
          serviceType: item.service_type || 'Unknown',
          revenue: Number(item.revenue),
        })),
        collectionRate,
        daysInAR,
        denialRate,
      };
    });
  }

  async getOperationalMetrics(filters: MetricFilter = {}): Promise<OperationalMetrics> {
    const cacheKey = `operational-metrics:${JSON.stringify(filters)}`;
    
    return this.getCachedOrCompute(cacheKey, async () => {
      // Placeholder implementation for operational metrics
      // In a real system, you'd track check-in/check-out times, room usage, etc.
      
      return {
        averageCheckInTime: 5.2, // minutes
        averageCheckOutTime: 3.8, // minutes
        roomUtilization: 78.5, // percentage
        equipmentUtilization: [
          { equipmentId: '1', equipmentName: 'X-Ray Machine', utilization: 65.2 },
          { equipmentId: '2', equipmentName: 'Ultrasound', utilization: 82.1 },
          { equipmentId: '3', equipmentName: 'EKG Machine', utilization: 45.7 },
        ],
        staffProductivity: [
          { staffId: '1', staffName: 'Nurse Johnson', productivity: 92.3 },
          { staffId: '2', staffName: 'Nurse Smith', productivity: 88.7 },
        ],
        patientFlowMetrics: {
          averageTimeToSeeProvider: 18.5, // minutes
          averageTotalVisitTime: 45.2, // minutes
          bottlenecks: ['Registration', 'Lab Results'],
        },
      };
    });
  }

  async getQualityMetrics(filters: MetricFilter = {}): Promise<QualityMetrics> {
    const cacheKey = `quality-metrics:${JSON.stringify(filters)}`;
    
    return this.getCachedOrCompute(cacheKey, async () => {
      // Placeholder implementation for quality metrics
      // In a real system, you'd track patient satisfaction, clinical outcomes, etc.
      
      return {
        patientSatisfactionScore: 4.2, // out of 5
        readmissionRate: 8.5, // percentage
        medicationAdherenceRate: 76.3, // percentage
        preventiveCareMetrics: {
          mammographyRate: 68.2,
          colonoscopyRate: 72.1,
          fluVaccinationRate: 84.5,
          diabeticEyeExamRate: 65.8,
        },
        clinicalOutcomes: {
          diabeticA1cControl: 71.2, // percentage with A1c < 7%
          hypertensionControl: 78.9, // percentage with BP < 140/90
          cholesterolControl: 69.4, // percentage with LDL < 100
        },
      };
    });
  }

  async getDashboardData(filters: MetricFilter = {}): Promise<DashboardData> {
    const cacheKey = `dashboard-data:${JSON.stringify(filters)}`;
    
    return this.getCachedOrCompute(cacheKey, async () => {
      const [patientMetrics, appointmentMetrics, providerMetrics, financialMetrics, operationalMetrics, qualityMetrics] = await Promise.all([
        this.getPatientMetrics(filters),
        this.getAppointmentMetrics(filters),
        this.getProviderMetrics(filters),
        this.getFinancialMetrics(filters),
        this.getOperationalMetrics(filters),
        this.getQualityMetrics(filters),
      ]);

      // Generate trend data
      const trends = await this.getTrendData(filters);

      return {
        patientMetrics,
        appointmentMetrics,
        providerMetrics,
        financialMetrics,
        operationalMetrics,
        qualityMetrics,
        trends,
      };
    }, 600); // Cache dashboard data for 10 minutes
  }

  private async getTrendData(filters: MetricFilter = {}) {
    const dateFilter = this.getDateRangeFilter(filters.dateRange);
    const groupBy = filters.groupBy || 'day';
    
    // Generate date series based on groupBy
    const dates: Date[] = [];
    let current = new Date(dateFilter.gte);
    
    while (current <= dateFilter.lte) {
      dates.push(new Date(current));
      
      switch (groupBy) {
        case 'day':
          current.setDate(current.getDate() + 1);
          break;
        case 'week':
          current.setDate(current.getDate() + 7);
          break;
        case 'month':
          current.setMonth(current.getMonth() + 1);
          break;
        case 'quarter':
          current.setMonth(current.getMonth() + 3);
          break;
        case 'year':
          current.setFullYear(current.getFullYear() + 1);
          break;
      }
    }

    // Get trend data for each date
    const patientGrowth = await Promise.all(
      dates.map(async (date) => {
        const count = await prisma.patient.count({
          where: {
            createdAt: {
              gte: startOfDay(date),
              lte: endOfDay(date),
            },
          },
        });
        return {
          date: format(date, 'yyyy-MM-dd'),
          count,
        };
      })
    );

    const appointmentVolume = await Promise.all(
      dates.map(async (date) => {
        const count = await prisma.appointment.count({
          where: {
            scheduledAt: {
              gte: startOfDay(date),
              lte: endOfDay(date),
            },
          },
        });
        return {
          date: format(date, 'yyyy-MM-dd'),
          count,
        };
      })
    );

    // Placeholder for revenue growth
    const revenueGrowth = dates.map(date => ({
      date: format(date, 'yyyy-MM-dd'),
      revenue: Math.random() * 10000 + 5000, // Placeholder data
    }));

    return {
      patientGrowth,
      revenueGrowth,
      appointmentVolume,
    };
  }

  async generateReport(config: ReportConfig): Promise<string> {
    try {
      logger.info('Generating report', {
        type: config.type,
        title: config.title,
        format: config.format,
      });

      // Get data based on report type
      let reportData: any;
      
      switch (config.type) {
        case 'PATIENT':
          reportData = await this.getPatientMetrics(config.filters);
          break;
        case 'FINANCIAL':
          reportData = await this.getFinancialMetrics(config.filters);
          break;
        case 'OPERATIONAL':
          reportData = await this.getOperationalMetrics(config.filters);
          break;
        case 'QUALITY':
          reportData = await this.getQualityMetrics(config.filters);
          break;
        case 'PROVIDER':
          reportData = await this.getProviderMetrics(config.filters);
          break;
        case 'CUSTOM':
          reportData = await this.getDashboardData(config.filters);
          break;
        default:
          throw new Error(`Unsupported report type: ${config.type}`);
      }

      // Generate report file based on format
      const reportId = await this.createReportFile(config, reportData);
      
      // Log report generation
      await auditService.logSystemEvent(
        'REPORT_GENERATED',
        {
          reportId,
          type: config.type,
          title: config.title,
          format: config.format,
        },
        'MEDIUM'
      );

      logger.info('Report generated successfully', {
        reportId,
        type: config.type,
        format: config.format,
      });

      return reportId;
    } catch (error) {
      logger.error('Report generation failed', {
        error: error.message,
        config,
      });
      throw new Error('Failed to generate report');
    }
  }

  private async createReportFile(config: ReportConfig, data: any): Promise<string> {
    const reportId = `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Store report metadata
    await prisma.report.create({
      data: {
        id: reportId,
        type: config.type,
        title: config.title,
        description: config.description,
        format: config.format,
        filters: JSON.stringify(config.filters),
        data: JSON.stringify(data),
        generatedAt: new Date(),
      },
    });

    // In a real implementation, you would generate the actual file
    // based on the format (PDF, Excel, CSV, etc.)
    
    return reportId;
  }

  async getBenchmarkData(metric: string): Promise<BenchmarkData[]> {
    // Placeholder implementation for benchmark data
    // In a real system, you'd compare against industry benchmarks
    
    const benchmarks: BenchmarkData[] = [
      {
        metric: 'Patient Satisfaction',
        currentValue: 4.2,
        benchmarkValue: 4.0,
        percentile: 75,
        trend: 'IMPROVING',
        industry: 'Primary Care',
      },
      {
        metric: 'Show Rate',
        currentValue: 85.3,
        benchmarkValue: 82.0,
        percentile: 68,
        trend: 'STABLE',
        industry: 'Primary Care',
      },
      {
        metric: 'Collection Rate',
        currentValue: 94.2,
        benchmarkValue: 96.0,
        percentile: 45,
        trend: 'DECLINING',
        industry: 'Primary Care',
      },
    ];

    return benchmarks.filter(b => !metric || b.metric.toLowerCase().includes(metric.toLowerCase()));
  }

  async getReportHistory(page: number = 1, limit: number = 20) {
    try {
      const [reports, total] = await Promise.all([
        prisma.report.findMany({
          orderBy: { generatedAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            type: true,
            title: true,
            description: true,
            format: true,
            generatedAt: true,
          },
        }),
        prisma.report.count(),
      ]);

      return {
        reports,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error('Failed to get report history', { error: error.message });
      throw new Error('Failed to get report history');
    }
  }

  async deleteReport(reportId: string): Promise<void> {
    try {
      await prisma.report.delete({
        where: { id: reportId },
      });
      
      logger.info('Report deleted', { reportId });
    } catch (error) {
      logger.error('Failed to delete report', {
        reportId,
        error: error.message,
      });
      throw new Error('Failed to delete report');
    }
  }

  // Predefined report configurations
  static getMonthlyPatientReport(): ReportConfig {
    return {
      type: 'PATIENT',
      title: 'Monthly Patient Report',
      description: 'Comprehensive patient metrics and demographics',
      filters: {
        dateRange: {
          startDate: startOfMonth(new Date()),
          endDate: endOfMonth(new Date()),
        },
      },
      metrics: ['totalPatients', 'newPatients', 'patientsByAge', 'patientsByGender'],
      format: 'PDF',
    };
  }

  static getQuarterlyFinancialReport(): ReportConfig {
    return {
      type: 'FINANCIAL',
      title: 'Quarterly Financial Report',
      description: 'Revenue, collections, and financial performance metrics',
      filters: {
        dateRange: {
          startDate: startOfMonth(subMonths(new Date(), 2)),
          endDate: endOfMonth(new Date()),
        },
      },
      metrics: ['totalRevenue', 'collectionRate', 'daysInAR', 'revenueByService'],
      format: 'EXCEL',
    };
  }

  static getProviderProductivityReport(): ReportConfig {
    return {
      type: 'PROVIDER',
      title: 'Provider Productivity Report',
      description: 'Provider performance and utilization metrics',
      filters: {
        dateRange: {
          startDate: startOfMonth(new Date()),
          endDate: endOfMonth(new Date()),
        },
      },
      metrics: ['providerUtilization', 'appointmentsPerProvider', 'revenuePerProvider'],
      format: 'PDF',
    };
  }
}

// Export singleton instance
const analyticsService = new AnalyticsService();
export default analyticsService;

// Export the class for testing
export { AnalyticsService };