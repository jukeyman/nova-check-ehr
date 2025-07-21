/**
 * ============================================================================
 * NOVA CHECK EHR - ANALYTICS MODEL
 * ============================================================================
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { AppError, ValidationError } from '../utils/errors';
import { formatDate, calculateAge, formatCurrency } from '../utils/helpers';
import { CacheService } from '../services/cacheService';

// ============================================================================
// INTERFACES
// ============================================================================

export interface AnalyticsFilters {
  dateFrom: Date;
  dateTo: Date;
  providerId?: string;
  departmentId?: string;
  locationId?: string;
  patientDemographic?: {
    ageRange?: { min: number; max: number };
    gender?: string;
    insuranceType?: string;
  };
}

export interface DashboardMetrics {
  overview: {
    totalPatients: number;
    activePatients: number;
    newPatientsThisMonth: number;
    totalAppointments: number;
    completedAppointments: number;
    canceledAppointments: number;
    noShowRate: number;
    averageWaitTime: number;
    patientSatisfactionScore: number;
  };
  financial: {
    totalRevenue: number;
    collectedAmount: number;
    outstandingAmount: number;
    averageClaimAmount: number;
    collectionRate: number;
    denialRate: number;
    revenueGrowth: number;
  };
  clinical: {
    totalEncounters: number;
    averageEncounterDuration: number;
    commonDiagnoses: { code: string; description: string; count: number }[];
    commonProcedures: { code: string; description: string; count: number }[];
    prescriptionCount: number;
    labOrderCount: number;
  };
  operational: {
    providerUtilization: number;
    roomUtilization: number;
    staffProductivity: number;
    systemUptime: number;
    averageCheckInTime: number;
    averageCheckOutTime: number;
  };
}

export interface PatientAnalytics {
  demographics: {
    totalPatients: number;
    ageDistribution: { ageGroup: string; count: number; percentage: number }[];
    genderDistribution: { gender: string; count: number; percentage: number }[];
    insuranceDistribution: { type: string; count: number; percentage: number }[];
    geographicDistribution: { location: string; count: number; percentage: number }[];
  };
  engagement: {
    appointmentFrequency: { frequency: string; count: number }[];
    noShowRate: number;
    cancellationRate: number;
    averageVisitsPerYear: number;
    patientRetentionRate: number;
  };
  health: {
    chronicConditions: { condition: string; count: number; percentage: number }[];
    commonAllergies: { allergen: string; count: number }[];
    vaccinationRates: { vaccine: string; rate: number }[];
    averageBMI: number;
    riskFactors: { factor: string; count: number }[];
  };
}

export interface ProviderAnalytics {
  productivity: {
    totalProviders: number;
    activeProviders: number;
    averageAppointmentsPerDay: number;
    averagePatientLoad: number;
    utilizationRate: number;
  };
  performance: {
    appointmentsByProvider: { providerId: string; name: string; count: number }[];
    revenueByProvider: { providerId: string; name: string; revenue: number }[];
    patientSatisfactionByProvider: { providerId: string; name: string; score: number }[];
    averageEncounterTime: { providerId: string; name: string; duration: number }[];
  };
  specialties: {
    distributionBySpecialty: { specialty: string; count: number }[];
    appointmentsBySpecialty: { specialty: string; count: number }[];
    revenueBySpecialty: { specialty: string; revenue: number }[];
  };
}

export interface FinancialAnalytics {
  revenue: {
    totalRevenue: number;
    monthlyRevenue: { month: string; revenue: number }[];
    revenueByService: { service: string; revenue: number }[];
    revenueByInsurance: { insurance: string; revenue: number }[];
    revenueGrowthRate: number;
  };
  collections: {
    totalCollected: number;
    collectionRate: number;
    averageDaysToCollect: number;
    writeOffs: number;
    badDebt: number;
  };
  claims: {
    totalClaims: number;
    approvedClaims: number;
    deniedClaims: number;
    pendingClaims: number;
    denialRate: number;
    averageClaimAmount: number;
    topDenialReasons: { reason: string; count: number }[];
  };
  aging: {
    current: number;
    thirtyDays: number;
    sixtyDays: number;
    ninetyDays: number;
    overNinetyDays: number;
  };
}

export interface OperationalAnalytics {
  appointments: {
    totalAppointments: number;
    appointmentsByType: { type: string; count: number }[];
    appointmentsByTime: { hour: number; count: number }[];
    appointmentsByDay: { day: string; count: number }[];
    averageWaitTime: number;
    onTimePercentage: number;
  };
  capacity: {
    providerUtilization: { providerId: string; name: string; utilization: number }[];
    roomUtilization: { roomId: string; name: string; utilization: number }[];
    peakHours: { hour: number; utilization: number }[];
    seasonalTrends: { month: string; appointments: number }[];
  };
  efficiency: {
    averageCheckInTime: number;
    averageWaitTime: number;
    averageEncounterTime: number;
    averageCheckOutTime: number;
    patientThroughput: number;
  };
}

export interface ClinicalAnalytics {
  encounters: {
    totalEncounters: number;
    encountersByType: { type: string; count: number }[];
    averageDuration: number;
    completionRate: number;
  };
  diagnoses: {
    topDiagnoses: { code: string; description: string; count: number }[];
    chronicConditions: { condition: string; prevalence: number }[];
    seasonalTrends: { diagnosis: string; month: string; count: number }[];
  };
  procedures: {
    topProcedures: { code: string; description: string; count: number }[];
    proceduresBySpecialty: { specialty: string; procedures: number }[];
    averageProcedureTime: number;
  };
  medications: {
    topPrescriptions: { medication: string; count: number }[];
    prescriptionsByClass: { class: string; count: number }[];
    averagePrescriptionsPerEncounter: number;
    drugInteractions: number;
  };
  vitals: {
    averageVitals: {
      bloodPressure: { systolic: number; diastolic: number };
      heartRate: number;
      temperature: number;
      weight: number;
      bmi: number;
    };
    abnormalVitals: {
      highBP: number;
      lowBP: number;
      tachycardia: number;
      bradycardia: number;
      fever: number;
    };
  };
}

export interface QualityMetrics {
  patientSafety: {
    medicationErrors: number;
    allergyAlerts: number;
    drugInteractions: number;
    criticalValues: number;
  };
  clinicalQuality: {
    preventiveCareCompliance: number;
    chronicCareManagement: number;
    vaccinationRates: { vaccine: string; rate: number }[];
    screeningRates: { screening: string; rate: number }[];
  };
  patientSatisfaction: {
    overallScore: number;
    communicationScore: number;
    waitTimeScore: number;
    facilityScore: number;
    recommendationRate: number;
  };
}

export interface TrendAnalysis {
  patientVolume: {
    daily: { date: string; count: number }[];
    weekly: { week: string; count: number }[];
    monthly: { month: string; count: number }[];
    yearly: { year: string; count: number }[];
  };
  revenue: {
    daily: { date: string; revenue: number }[];
    weekly: { week: string; revenue: number }[];
    monthly: { month: string; revenue: number }[];
    yearly: { year: string; revenue: number }[];
  };
  appointments: {
    bookingTrends: { date: string; bookings: number; cancellations: number }[];
    noShowTrends: { date: string; noShows: number; percentage: number }[];
    waitTimeTrends: { date: string; averageWaitTime: number }[];
  };
}

// ============================================================================
// ANALYTICS MODEL CLASS
// ============================================================================

export class AnalyticsModel {
  private prisma: PrismaClient;
  private cacheService: CacheService;
  private readonly CACHE_TTL = 3600; // 1 hour

  constructor(prisma: PrismaClient, cacheService: CacheService) {
    this.prisma = prisma;
    this.cacheService = cacheService;
  }

  /**
   * Get dashboard metrics
   */
  async getDashboardMetrics(filters: AnalyticsFilters): Promise<DashboardMetrics> {
    try {
      const cacheKey = `dashboard_metrics_${JSON.stringify(filters)}`;
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const { dateFrom, dateTo } = filters;
      const dateFilter = { gte: dateFrom, lte: dateTo };

      // Overview metrics
      const [totalPatients, activePatients, newPatientsThisMonth, totalAppointments, appointmentStats] = await Promise.all([
        this.prisma.patient.count({
          where: {
            isDeleted: false,
            ...(filters.providerId && { providerId: filters.providerId }),
          },
        }),
        this.prisma.patient.count({
          where: {
            isActive: true,
            isDeleted: false,
            ...(filters.providerId && { providerId: filters.providerId }),
          },
        }),
        this.prisma.patient.count({
          where: {
            createdAt: {
              gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            },
            isDeleted: false,
            ...(filters.providerId && { providerId: filters.providerId }),
          },
        }),
        this.prisma.appointment.count({
          where: {
            startTime: dateFilter,
            ...(filters.providerId && { providerId: filters.providerId }),
          },
        }),
        this.prisma.appointment.groupBy({
          by: ['status'],
          where: {
            startTime: dateFilter,
            ...(filters.providerId && { providerId: filters.providerId }),
          },
          _count: true,
        }),
      ]);

      const completedAppointments = appointmentStats.find(s => s.status === 'COMPLETED')?._count || 0;
      const canceledAppointments = appointmentStats.find(s => s.status === 'CANCELLED')?._count || 0;
      const noShowAppointments = appointmentStats.find(s => s.status === 'NO_SHOW')?._count || 0;
      const noShowRate = totalAppointments > 0 ? (noShowAppointments / totalAppointments) * 100 : 0;

      // Financial metrics (placeholder - would need invoice/billing data)
      const financial = {
        totalRevenue: 0,
        collectedAmount: 0,
        outstandingAmount: 0,
        averageClaimAmount: 0,
        collectionRate: 0,
        denialRate: 0,
        revenueGrowth: 0,
      };

      // Clinical metrics
      const [totalEncounters, commonDiagnoses, commonProcedures, prescriptionCount] = await Promise.all([
        this.prisma.encounter.count({
          where: {
            startTime: dateFilter,
            ...(filters.providerId && { providerId: filters.providerId }),
          },
        }),
        this.prisma.diagnosis.groupBy({
          by: ['code', 'description'],
          where: {
            encounter: {
              startTime: dateFilter,
              ...(filters.providerId && { providerId: filters.providerId }),
            },
          },
          _count: true,
          orderBy: {
            _count: {
              code: 'desc',
            },
          },
          take: 10,
        }),
        this.prisma.procedure.groupBy({
          by: ['code', 'description'],
          where: {
            encounter: {
              startTime: dateFilter,
              ...(filters.providerId && { providerId: filters.providerId }),
            },
          },
          _count: true,
          orderBy: {
            _count: {
              code: 'desc',
            },
          },
          take: 10,
        }),
        this.prisma.prescription.count({
          where: {
            encounter: {
              startTime: dateFilter,
              ...(filters.providerId && { providerId: filters.providerId }),
            },
          },
        }),
      ]);

      const clinical = {
        totalEncounters,
        averageEncounterDuration: 30, // Placeholder
        commonDiagnoses: commonDiagnoses.map(d => ({
          code: d.code,
          description: d.description,
          count: d._count,
        })),
        commonProcedures: commonProcedures.map(p => ({
          code: p.code,
          description: p.description,
          count: p._count,
        })),
        prescriptionCount,
        labOrderCount: 0, // Placeholder
      };

      // Operational metrics (placeholder)
      const operational = {
        providerUtilization: 85,
        roomUtilization: 75,
        staffProductivity: 90,
        systemUptime: 99.9,
        averageCheckInTime: 5,
        averageCheckOutTime: 3,
      };

      const metrics: DashboardMetrics = {
        overview: {
          totalPatients,
          activePatients,
          newPatientsThisMonth,
          totalAppointments,
          completedAppointments,
          canceledAppointments,
          noShowRate: Math.round(noShowRate * 10) / 10,
          averageWaitTime: 15, // Placeholder
          patientSatisfactionScore: 4.5, // Placeholder
        },
        financial,
        clinical,
        operational,
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(metrics), this.CACHE_TTL);

      return metrics;
    } catch (error) {
      logger.error('Error getting dashboard metrics', {
        component: 'AnalyticsModel',
        error: (error as Error).message,
        filters,
      });
      throw new AppError('Failed to get dashboard metrics', 500);
    }
  }

  /**
   * Get patient analytics
   */
  async getPatientAnalytics(filters: AnalyticsFilters): Promise<PatientAnalytics> {
    try {
      const cacheKey = `patient_analytics_${JSON.stringify(filters)}`;
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const whereClause: any = {
        isDeleted: false,
        ...(filters.providerId && { providerId: filters.providerId }),
      };

      // Demographics
      const [totalPatients, genderStats, patients] = await Promise.all([
        this.prisma.patient.count({ where: whereClause }),
        this.prisma.patient.groupBy({
          by: ['gender'],
          where: whereClause,
          _count: true,
        }),
        this.prisma.patient.findMany({
          where: whereClause,
          select: {
            dateOfBirth: true,
            gender: true,
            state: true,
            insuranceProvider: true,
          },
        }),
      ]);

      // Calculate age distribution
      const ageGroups = {
        '0-17': 0,
        '18-34': 0,
        '35-54': 0,
        '55-74': 0,
        '75+': 0,
      };

      patients.forEach(patient => {
        const age = calculateAge(patient.dateOfBirth);
        if (age < 18) ageGroups['0-17']++;
        else if (age < 35) ageGroups['18-34']++;
        else if (age < 55) ageGroups['35-54']++;
        else if (age < 75) ageGroups['55-74']++;
        else ageGroups['75+']++;
      });

      const ageDistribution = Object.entries(ageGroups).map(([ageGroup, count]) => ({
        ageGroup,
        count,
        percentage: totalPatients > 0 ? Math.round((count / totalPatients) * 100 * 10) / 10 : 0,
      }));

      const genderDistribution = genderStats.map(stat => ({
        gender: stat.gender,
        count: stat._count,
        percentage: totalPatients > 0 ? Math.round((stat._count / totalPatients) * 100 * 10) / 10 : 0,
      }));

      // Insurance distribution
      const insuranceMap = new Map<string, number>();
      patients.forEach(patient => {
        const insurance = patient.insuranceProvider || 'Unknown';
        insuranceMap.set(insurance, (insuranceMap.get(insurance) || 0) + 1);
      });

      const insuranceDistribution = Array.from(insuranceMap.entries()).map(([type, count]) => ({
        type,
        count,
        percentage: totalPatients > 0 ? Math.round((count / totalPatients) * 100 * 10) / 10 : 0,
      }));

      // Geographic distribution
      const stateMap = new Map<string, number>();
      patients.forEach(patient => {
        const state = patient.state || 'Unknown';
        stateMap.set(state, (stateMap.get(state) || 0) + 1);
      });

      const geographicDistribution = Array.from(stateMap.entries()).map(([location, count]) => ({
        location,
        count,
        percentage: totalPatients > 0 ? Math.round((count / totalPatients) * 100 * 10) / 10 : 0,
      }));

      // Engagement metrics
      const [appointmentStats, chronicConditions] = await Promise.all([
        this.prisma.appointment.groupBy({
          by: ['patientId'],
          where: {
            startTime: {
              gte: filters.dateFrom,
              lte: filters.dateTo,
            },
          },
          _count: true,
        }),
        this.prisma.diagnosis.groupBy({
          by: ['description'],
          where: {
            encounter: {
              patient: whereClause,
            },
          },
          _count: true,
          orderBy: {
            _count: {
              description: 'desc',
            },
          },
          take: 10,
        }),
      ]);

      const appointmentFrequency = {
        'Low (1-2)': 0,
        'Medium (3-5)': 0,
        'High (6+)': 0,
      };

      appointmentStats.forEach(stat => {
        if (stat._count <= 2) appointmentFrequency['Low (1-2)']++;
        else if (stat._count <= 5) appointmentFrequency['Medium (3-5)']++;
        else appointmentFrequency['High (6+)']++;
      });

      const analytics: PatientAnalytics = {
        demographics: {
          totalPatients,
          ageDistribution,
          genderDistribution,
          insuranceDistribution,
          geographicDistribution,
        },
        engagement: {
          appointmentFrequency: Object.entries(appointmentFrequency).map(([frequency, count]) => ({
            frequency,
            count,
          })),
          noShowRate: 5.2, // Placeholder
          cancellationRate: 8.1, // Placeholder
          averageVisitsPerYear: 3.5, // Placeholder
          patientRetentionRate: 85.3, // Placeholder
        },
        health: {
          chronicConditions: chronicConditions.map(condition => ({
            condition: condition.description,
            count: condition._count,
            percentage: totalPatients > 0 ? Math.round((condition._count / totalPatients) * 100 * 10) / 10 : 0,
          })),
          commonAllergies: [], // Placeholder
          vaccinationRates: [], // Placeholder
          averageBMI: 26.5, // Placeholder
          riskFactors: [], // Placeholder
        },
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(analytics), this.CACHE_TTL);

      return analytics;
    } catch (error) {
      logger.error('Error getting patient analytics', {
        component: 'AnalyticsModel',
        error: (error as Error).message,
        filters,
      });
      throw new AppError('Failed to get patient analytics', 500);
    }
  }

  /**
   * Get provider analytics
   */
  async getProviderAnalytics(filters: AnalyticsFilters): Promise<ProviderAnalytics> {
    try {
      const cacheKey = `provider_analytics_${JSON.stringify(filters)}`;
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const { dateFrom, dateTo } = filters;
      const dateFilter = { gte: dateFrom, lte: dateTo };

      // Provider counts
      const [totalProviders, activeProviders, appointmentsByProvider, providers] = await Promise.all([
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
          orderBy: {
            _count: {
              providerId: 'desc',
            },
          },
        }),
        this.prisma.user.findMany({
          where: {
            role: 'PROVIDER',
            isDeleted: false,
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            specialty: true,
          },
        }),
      ]);

      // Calculate average appointments per day
      const daysDiff = Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24));
      const totalAppointments = appointmentsByProvider.reduce((sum, item) => sum + item._count, 0);
      const averageAppointmentsPerDay = activeProviders > 0 && daysDiff > 0 
        ? Math.round((totalAppointments / (activeProviders * daysDiff)) * 10) / 10 
        : 0;

      // Format appointment data with provider names
      const appointmentsByProviderWithNames = await Promise.all(
        appointmentsByProvider.map(async (item) => {
          const provider = providers.find(p => p.id === item.providerId);
          return {
            providerId: item.providerId,
            name: provider ? `${provider.firstName} ${provider.lastName}` : 'Unknown Provider',
            count: item._count,
          };
        })
      );

      // Specialty distribution
      const specialtyMap = new Map<string, number>();
      providers.forEach(provider => {
        const specialty = provider.specialty || 'General';
        specialtyMap.set(specialty, (specialtyMap.get(specialty) || 0) + 1);
      });

      const distributionBySpecialty = Array.from(specialtyMap.entries()).map(([specialty, count]) => ({
        specialty,
        count,
      }));

      // Get appointments by specialty
      const appointmentsBySpecialty = await Promise.all(
        Array.from(specialtyMap.keys()).map(async (specialty) => {
          const providerIds = providers
            .filter(p => (p.specialty || 'General') === specialty)
            .map(p => p.id);
          
          const count = await this.prisma.appointment.count({
            where: {
              providerId: { in: providerIds },
              startTime: dateFilter,
            },
          });
          
          return { specialty, count };
        })
      );

      const analytics: ProviderAnalytics = {
        productivity: {
          totalProviders,
          activeProviders,
          averageAppointmentsPerDay,
          averagePatientLoad: 0, // Placeholder
          utilizationRate: 85, // Placeholder
        },
        performance: {
          appointmentsByProvider: appointmentsByProviderWithNames,
          revenueByProvider: [], // Placeholder
          patientSatisfactionByProvider: [], // Placeholder
          averageEncounterTime: [], // Placeholder
        },
        specialties: {
          distributionBySpecialty,
          appointmentsBySpecialty,
          revenueBySpecialty: [], // Placeholder
        },
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(analytics), this.CACHE_TTL);

      return analytics;
    } catch (error) {
      logger.error('Error getting provider analytics', {
        component: 'AnalyticsModel',
        error: (error as Error).message,
        filters,
      });
      throw new AppError('Failed to get provider analytics', 500);
    }
  }

  /**
   * Get financial analytics
   */
  async getFinancialAnalytics(filters: AnalyticsFilters): Promise<FinancialAnalytics> {
    try {
      const cacheKey = `financial_analytics_${JSON.stringify(filters)}`;
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Placeholder financial analytics
      // In a real implementation, this would query invoice, payment, and claim tables
      const analytics: FinancialAnalytics = {
        revenue: {
          totalRevenue: 0,
          monthlyRevenue: [],
          revenueByService: [],
          revenueByInsurance: [],
          revenueGrowthRate: 0,
        },
        collections: {
          totalCollected: 0,
          collectionRate: 0,
          averageDaysToCollect: 0,
          writeOffs: 0,
          badDebt: 0,
        },
        claims: {
          totalClaims: 0,
          approvedClaims: 0,
          deniedClaims: 0,
          pendingClaims: 0,
          denialRate: 0,
          averageClaimAmount: 0,
          topDenialReasons: [],
        },
        aging: {
          current: 0,
          thirtyDays: 0,
          sixtyDays: 0,
          ninetyDays: 0,
          overNinetyDays: 0,
        },
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(analytics), this.CACHE_TTL);

      return analytics;
    } catch (error) {
      logger.error('Error getting financial analytics', {
        component: 'AnalyticsModel',
        error: (error as Error).message,
        filters,
      });
      throw new AppError('Failed to get financial analytics', 500);
    }
  }

  /**
   * Get operational analytics
   */
  async getOperationalAnalytics(filters: AnalyticsFilters): Promise<OperationalAnalytics> {
    try {
      const cacheKey = `operational_analytics_${JSON.stringify(filters)}`;
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const { dateFrom, dateTo } = filters;
      const dateFilter = { gte: dateFrom, lte: dateTo };

      // Appointment analytics
      const [totalAppointments, appointmentsByType, appointments] = await Promise.all([
        this.prisma.appointment.count({
          where: {
            startTime: dateFilter,
            ...(filters.providerId && { providerId: filters.providerId }),
          },
        }),
        this.prisma.appointment.groupBy({
          by: ['type'],
          where: {
            startTime: dateFilter,
            ...(filters.providerId && { providerId: filters.providerId }),
          },
          _count: true,
        }),
        this.prisma.appointment.findMany({
          where: {
            startTime: dateFilter,
            ...(filters.providerId && { providerId: filters.providerId }),
          },
          select: {
            startTime: true,
            status: true,
          },
        }),
      ]);

      // Analyze appointment times
      const appointmentsByTime = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
      const appointmentsByDay = {
        Monday: 0,
        Tuesday: 0,
        Wednesday: 0,
        Thursday: 0,
        Friday: 0,
        Saturday: 0,
        Sunday: 0,
      };

      appointments.forEach(appointment => {
        const hour = appointment.startTime.getHours();
        appointmentsByTime[hour].count++;

        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayName = dayNames[appointment.startTime.getDay()];
        appointmentsByDay[dayName as keyof typeof appointmentsByDay]++;
      });

      // Calculate seasonal trends
      const monthlyAppointments = new Map<string, number>();
      appointments.forEach(appointment => {
        const monthKey = `${appointment.startTime.getFullYear()}-${String(appointment.startTime.getMonth() + 1).padStart(2, '0')}`;
        monthlyAppointments.set(monthKey, (monthlyAppointments.get(monthKey) || 0) + 1);
      });

      const seasonalTrends = Array.from(monthlyAppointments.entries()).map(([month, appointments]) => ({
        month,
        appointments,
      }));

      const analytics: OperationalAnalytics = {
        appointments: {
          totalAppointments,
          appointmentsByType: appointmentsByType.map(item => ({
            type: item.type,
            count: item._count,
          })),
          appointmentsByTime: appointmentsByTime.filter(item => item.count > 0),
          appointmentsByDay: Object.entries(appointmentsByDay).map(([day, count]) => ({
            day,
            count,
          })),
          averageWaitTime: 15, // Placeholder
          onTimePercentage: 85, // Placeholder
        },
        capacity: {
          providerUtilization: [], // Placeholder
          roomUtilization: [], // Placeholder
          peakHours: appointmentsByTime
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
            .map(item => ({
              hour: item.hour,
              utilization: totalAppointments > 0 ? Math.round((item.count / totalAppointments) * 100) : 0,
            })),
          seasonalTrends,
        },
        efficiency: {
          averageCheckInTime: 5, // Placeholder
          averageWaitTime: 15, // Placeholder
          averageEncounterTime: 30, // Placeholder
          averageCheckOutTime: 3, // Placeholder
          patientThroughput: totalAppointments, // Placeholder
        },
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(analytics), this.CACHE_TTL);

      return analytics;
    } catch (error) {
      logger.error('Error getting operational analytics', {
        component: 'AnalyticsModel',
        error: (error as Error).message,
        filters,
      });
      throw new AppError('Failed to get operational analytics', 500);
    }
  }

  /**
   * Get clinical analytics
   */
  async getClinicalAnalytics(filters: AnalyticsFilters): Promise<ClinicalAnalytics> {
    try {
      const cacheKey = `clinical_analytics_${JSON.stringify(filters)}`;
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const { dateFrom, dateTo } = filters;
      const dateFilter = { gte: dateFrom, lte: dateTo };

      // Encounter analytics
      const [totalEncounters, encountersByType, topDiagnoses, topProcedures, topPrescriptions, vitalSigns] = await Promise.all([
        this.prisma.encounter.count({
          where: {
            startTime: dateFilter,
            ...(filters.providerId && { providerId: filters.providerId }),
          },
        }),
        this.prisma.encounter.groupBy({
          by: ['type'],
          where: {
            startTime: dateFilter,
            ...(filters.providerId && { providerId: filters.providerId }),
          },
          _count: true,
        }),
        this.prisma.diagnosis.groupBy({
          by: ['code', 'description'],
          where: {
            encounter: {
              startTime: dateFilter,
              ...(filters.providerId && { providerId: filters.providerId }),
            },
          },
          _count: true,
          orderBy: {
            _count: {
              code: 'desc',
            },
          },
          take: 10,
        }),
        this.prisma.procedure.groupBy({
          by: ['code', 'description'],
          where: {
            encounter: {
              startTime: dateFilter,
              ...(filters.providerId && { providerId: filters.providerId }),
            },
          },
          _count: true,
          orderBy: {
            _count: {
              code: 'desc',
            },
          },
          take: 10,
        }),
        this.prisma.prescription.groupBy({
          by: ['medicationName'],
          where: {
            encounter: {
              startTime: dateFilter,
              ...(filters.providerId && { providerId: filters.providerId }),
            },
          },
          _count: true,
          orderBy: {
            _count: {
              medicationName: 'desc',
            },
          },
          take: 10,
        }),
        this.prisma.vitalSigns.aggregate({
          where: {
            recordedAt: dateFilter,
            ...(filters.providerId && {
              encounter: {
                providerId: filters.providerId,
              },
            }),
          },
          _avg: {
            systolicBP: true,
            diastolicBP: true,
            heartRate: true,
            temperature: true,
            weight: true,
            bmi: true,
          },
          _count: true,
        }),
      ]);

      // Calculate completion rate
      const completedEncounters = await this.prisma.encounter.count({
        where: {
          startTime: dateFilter,
          status: 'COMPLETED',
          ...(filters.providerId && { providerId: filters.providerId }),
        },
      });
      const completionRate = totalEncounters > 0 ? (completedEncounters / totalEncounters) * 100 : 0;

      // Calculate abnormal vitals
      const [highBP, lowBP, tachycardia, bradycardia, fever] = await Promise.all([
        this.prisma.vitalSigns.count({
          where: {
            recordedAt: dateFilter,
            systolicBP: { gte: 140 },
            ...(filters.providerId && {
              encounter: {
                providerId: filters.providerId,
              },
            }),
          },
        }),
        this.prisma.vitalSigns.count({
          where: {
            recordedAt: dateFilter,
            systolicBP: { lte: 90 },
            ...(filters.providerId && {
              encounter: {
                providerId: filters.providerId,
              },
            }),
          },
        }),
        this.prisma.vitalSigns.count({
          where: {
            recordedAt: dateFilter,
            heartRate: { gte: 100 },
            ...(filters.providerId && {
              encounter: {
                providerId: filters.providerId,
              },
            }),
          },
        }),
        this.prisma.vitalSigns.count({
          where: {
            recordedAt: dateFilter,
            heartRate: { lte: 60 },
            ...(filters.providerId && {
              encounter: {
                providerId: filters.providerId,
              },
            }),
          },
        }),
        this.prisma.vitalSigns.count({
          where: {
            recordedAt: dateFilter,
            temperature: { gte: 100.4 },
            ...(filters.providerId && {
              encounter: {
                providerId: filters.providerId,
              },
            }),
          },
        }),
      ]);

      const analytics: ClinicalAnalytics = {
        encounters: {
          totalEncounters,
          encountersByType: encountersByType.map(item => ({
            type: item.type,
            count: item._count,
          })),
          averageDuration: 30, // Placeholder
          completionRate: Math.round(completionRate * 10) / 10,
        },
        diagnoses: {
          topDiagnoses: topDiagnoses.map(item => ({
            code: item.code,
            description: item.description,
            count: item._count,
          })),
          chronicConditions: [], // Placeholder
          seasonalTrends: [], // Placeholder
        },
        procedures: {
          topProcedures: topProcedures.map(item => ({
            code: item.code,
            description: item.description,
            count: item._count,
          })),
          proceduresBySpecialty: [], // Placeholder
          averageProcedureTime: 45, // Placeholder
        },
        medications: {
          topPrescriptions: topPrescriptions.map(item => ({
            medication: item.medicationName,
            count: item._count,
          })),
          prescriptionsByClass: [], // Placeholder
          averagePrescriptionsPerEncounter: totalEncounters > 0 ? 
            Math.round((topPrescriptions.reduce((sum, item) => sum + item._count, 0) / totalEncounters) * 10) / 10 : 0,
          drugInteractions: 0, // Placeholder
        },
        vitals: {
          averageVitals: {
            bloodPressure: {
              systolic: Math.round(vitalSigns._avg.systolicBP || 0),
              diastolic: Math.round(vitalSigns._avg.diastolicBP || 0),
            },
            heartRate: Math.round(vitalSigns._avg.heartRate || 0),
            temperature: Math.round((vitalSigns._avg.temperature || 0) * 10) / 10,
            weight: Math.round((vitalSigns._avg.weight || 0) * 10) / 10,
            bmi: Math.round((vitalSigns._avg.bmi || 0) * 10) / 10,
          },
          abnormalVitals: {
            highBP,
            lowBP,
            tachycardia,
            bradycardia,
            fever,
          },
        },
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(analytics), this.CACHE_TTL);

      return analytics;
    } catch (error) {
      logger.error('Error getting clinical analytics', {
        component: 'AnalyticsModel',
        error: (error as Error).message,
        filters,
      });
      throw new AppError('Failed to get clinical analytics', 500);
    }
  }

  /**
   * Get trend analysis
   */
  async getTrendAnalysis(filters: AnalyticsFilters): Promise<TrendAnalysis> {
    try {
      const cacheKey = `trend_analysis_${JSON.stringify(filters)}`;
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const { dateFrom, dateTo } = filters;

      // Generate date ranges for trends
      const dailyData = await this.generateDailyTrends(dateFrom, dateTo, filters);
      const weeklyData = await this.generateWeeklyTrends(dateFrom, dateTo, filters);
      const monthlyData = await this.generateMonthlyTrends(dateFrom, dateTo, filters);

      const trends: TrendAnalysis = {
        patientVolume: {
          daily: dailyData.patients,
          weekly: weeklyData.patients,
          monthly: monthlyData.patients,
          yearly: [], // Placeholder
        },
        revenue: {
          daily: dailyData.revenue,
          weekly: weeklyData.revenue,
          monthly: monthlyData.revenue,
          yearly: [], // Placeholder
        },
        appointments: {
          bookingTrends: dailyData.appointments,
          noShowTrends: [], // Placeholder
          waitTimeTrends: [], // Placeholder
        },
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(trends), this.CACHE_TTL);

      return trends;
    } catch (error) {
      logger.error('Error getting trend analysis', {
        component: 'AnalyticsModel',
        error: (error as Error).message,
        filters,
      });
      throw new AppError('Failed to get trend analysis', 500);
    }
  }

  /**
   * Generate daily trends
   */
  private async generateDailyTrends(dateFrom: Date, dateTo: Date, filters: AnalyticsFilters) {
    const days = [];
    const currentDate = new Date(dateFrom);
    
    while (currentDate <= dateTo) {
      const dayStart = new Date(currentDate);
      const dayEnd = new Date(currentDate);
      dayEnd.setHours(23, 59, 59, 999);
      
      const [patientCount, appointmentCount] = await Promise.all([
        this.prisma.patient.count({
          where: {
            createdAt: {
              gte: dayStart,
              lte: dayEnd,
            },
            isDeleted: false,
            ...(filters.providerId && { providerId: filters.providerId }),
          },
        }),
        this.prisma.appointment.count({
          where: {
            startTime: {
              gte: dayStart,
              lte: dayEnd,
            },
            ...(filters.providerId && { providerId: filters.providerId }),
          },
        }),
      ]);
      
      const dateStr = formatDate(currentDate);
      
      days.push({
        patients: { date: dateStr, count: patientCount },
        revenue: { date: dateStr, revenue: 0 }, // Placeholder
        appointments: { date: dateStr, bookings: appointmentCount, cancellations: 0 },
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return {
      patients: days.map(d => d.patients),
      revenue: days.map(d => d.revenue),
      appointments: days.map(d => d.appointments),
    };
  }

  /**
   * Generate weekly trends
   */
  private async generateWeeklyTrends(dateFrom: Date, dateTo: Date, filters: AnalyticsFilters) {
    // Simplified weekly aggregation
    return {
      patients: [],
      revenue: [],
      appointments: [],
    };
  }

  /**
   * Generate monthly trends
   */
  private async generateMonthlyTrends(dateFrom: Date, dateTo: Date, filters: AnalyticsFilters) {
    // Simplified monthly aggregation
    return {
      patients: [],
      revenue: [],
      appointments: [],
    };
  }

  /**
   * Clear analytics cache
   */
  async clearCache(pattern?: string): Promise<void> {
    try {
      const keys = await this.cacheService.keys(pattern || 'analytics_*');
      if (keys.length > 0) {
        await Promise.all(keys.map(key => this.cacheService.del(key)));
      }
      
      logger.info('Analytics cache cleared', {
        component: 'AnalyticsModel',
        keysCleared: keys.length,
        pattern,
      });
    } catch (error) {
      logger.error('Error clearing analytics cache', {
        component: 'AnalyticsModel',
        error: (error as Error).message,
        pattern,
      });
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default AnalyticsModel;