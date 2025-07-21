import { apiService, ApiResponse, PaginationParams } from './api';

// ============================================================================
// TYPES
// ============================================================================

export interface ReportFilters {
  startDate?: string;
  endDate?: string;
  providerId?: string;
  patientId?: string;
  departmentId?: string;
  locationId?: string;
  insuranceProvider?: string;
  appointmentType?: string;
  status?: string[];
  ageRange?: {
    min?: number;
    max?: number;
  };
  gender?: string;
  diagnosis?: string;
  procedure?: string;
}

export interface ReportConfig {
  type: ReportType;
  title: string;
  description?: string;
  filters: ReportFilters;
  format: 'pdf' | 'excel' | 'csv' | 'json';
  groupBy?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  includeCharts?: boolean;
  includeDetails?: boolean;
  customFields?: string[];
}

export type ReportType =
  | 'patient-demographics'
  | 'appointment-summary'
  | 'provider-productivity'
  | 'financial-summary'
  | 'billing-aging'
  | 'insurance-claims'
  | 'medication-adherence'
  | 'lab-results-summary'
  | 'diagnosis-trends'
  | 'procedure-volume'
  | 'patient-satisfaction'
  | 'no-show-analysis'
  | 'revenue-analysis'
  | 'quality-metrics'
  | 'compliance-audit'
  | 'inventory-report'
  | 'staff-utilization'
  | 'custom';

export interface GeneratedReport {
  id: string;
  type: ReportType;
  title: string;
  description?: string;
  status: 'generating' | 'completed' | 'failed';
  progress?: number;
  url?: string;
  format: string;
  fileSize?: number;
  generatedAt: string;
  generatedBy: string;
  expiresAt?: string;
  filters: ReportFilters;
  error?: string;
}

export interface ReportTemplate {
  id: string;
  name: string;
  type: ReportType;
  description?: string;
  config: ReportConfig;
  isPublic: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
}

export interface DashboardMetrics {
  totalPatients: number;
  activePatients: number;
  newPatientsThisMonth: number;
  totalAppointments: number;
  todaysAppointments: number;
  upcomingAppointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  noShowRate: number;
  averageWaitTime: number;
  totalRevenue: number;
  monthlyRevenue: number;
  outstandingBalance: number;
  collectionRate: number;
  activeProviders: number;
  utilizationRate: number;
  patientSatisfactionScore: number;
  criticalAlerts: number;
}

export interface PatientDemographicsReport {
  totalPatients: number;
  ageDistribution: {
    ageGroup: string;
    count: number;
    percentage: number;
  }[];
  genderDistribution: {
    gender: string;
    count: number;
    percentage: number;
  }[];
  insuranceDistribution: {
    provider: string;
    count: number;
    percentage: number;
  }[];
  locationDistribution: {
    location: string;
    count: number;
    percentage: number;
  }[];
  newPatientsTrend: {
    period: string;
    count: number;
  }[];
}

export interface AppointmentSummaryReport {
  totalAppointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  noShowAppointments: number;
  appointmentsByType: {
    type: string;
    count: number;
    percentage: number;
  }[];
  appointmentsByProvider: {
    providerId: string;
    providerName: string;
    total: number;
    completed: number;
    cancelled: number;
    noShow: number;
    utilizationRate: number;
  }[];
  appointmentsTrend: {
    date: string;
    scheduled: number;
    completed: number;
    cancelled: number;
    noShow: number;
  }[];
  averageAppointmentDuration: number;
  peakHours: {
    hour: number;
    count: number;
  }[];
}

export interface ProviderProductivityReport {
  providerId: string;
  providerName: string;
  totalAppointments: number;
  completedAppointments: number;
  averageAppointmentDuration: number;
  patientsServed: number;
  revenue: number;
  utilizationRate: number;
  patientSatisfactionScore: number;
  proceduresPerformed: {
    procedure: string;
    count: number;
  }[];
  diagnosesGiven: {
    diagnosis: string;
    count: number;
  }[];
  workingHours: number;
  productivityScore: number;
}

export interface FinancialSummaryReport {
  totalRevenue: number;
  collectedRevenue: number;
  outstandingBalance: number;
  writeOffs: number;
  refunds: number;
  adjustments: number;
  collectionRate: number;
  revenueByService: {
    service: string;
    revenue: number;
    count: number;
  }[];
  revenueByProvider: {
    providerId: string;
    providerName: string;
    revenue: number;
    percentage: number;
  }[];
  revenueByInsurance: {
    insurance: string;
    revenue: number;
    percentage: number;
  }[];
  revenueTrend: {
    period: string;
    revenue: number;
    collected: number;
    outstanding: number;
  }[];
  paymentMethods: {
    method: string;
    amount: number;
    percentage: number;
  }[];
}

export interface QualityMetricsReport {
  patientSatisfactionScore: number;
  appointmentAdherence: number;
  medicationAdherence: number;
  preventiveCareCompliance: number;
  readmissionRate: number;
  infectionRate: number;
  mortalityRate: number;
  lengthOfStay: number;
  waitTimeMetrics: {
    averageWaitTime: number;
    medianWaitTime: number;
    maxWaitTime: number;
    waitTimeByProvider: {
      providerId: string;
      providerName: string;
      averageWaitTime: number;
    }[];
  };
  clinicalIndicators: {
    indicator: string;
    target: number;
    actual: number;
    compliance: number;
  }[];
  safetyMetrics: {
    metric: string;
    value: number;
    benchmark: number;
    status: 'good' | 'warning' | 'critical';
  }[];
}

export interface ReportSchedule {
  id: string;
  name: string;
  reportConfig: ReportConfig;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  dayOfWeek?: number;
  dayOfMonth?: number;
  time: string;
  timezone: string;
  recipients: string[];
  isActive: boolean;
  lastRun?: string;
  nextRun: string;
  createdBy: string;
  createdAt: string;
}

// ============================================================================
// REPORTS SERVICE CLASS
// ============================================================================

export class ReportsService {
  private static instance: ReportsService;

  private constructor() {}

  public static getInstance(): ReportsService {
    if (!ReportsService.instance) {
      ReportsService.instance = new ReportsService();
    }
    return ReportsService.instance;
  }

  // ========================================================================
  // DASHBOARD METRICS
  // ========================================================================

  /**
   * Get dashboard metrics
   */
  async getDashboardMetrics(
    startDate?: string,
    endDate?: string,
    providerId?: string
  ): Promise<DashboardMetrics> {
    const response = await apiService.get<DashboardMetrics>('/reports/dashboard', {
      startDate,
      endDate,
      providerId,
    });
    return response.data;
  }

  /**
   * Get real-time metrics
   */
  async getRealTimeMetrics(): Promise<{
    todaysAppointments: number;
    currentWaitingPatients: number;
    activeProviders: number;
    systemAlerts: number;
    recentActivity: {
      type: string;
      message: string;
      timestamp: string;
    }[];
  }> {
    const response = await apiService.get<{
      todaysAppointments: number;
      currentWaitingPatients: number;
      activeProviders: number;
      systemAlerts: number;
      recentActivity: {
        type: string;
        message: string;
        timestamp: string;
      }[];
    }>('/reports/real-time');
    return response.data;
  }

  // ========================================================================
  // REPORT GENERATION
  // ========================================================================

  /**
   * Generate report
   */
  async generateReport(config: ReportConfig): Promise<GeneratedReport> {
    const response = await apiService.post<GeneratedReport>('/reports/generate', config, {
      showSuccessToast: true,
      successMessage: 'Report generation started!',
    });
    return response.data;
  }

  /**
   * Get report status
   */
  async getReportStatus(reportId: string): Promise<GeneratedReport> {
    const response = await apiService.get<GeneratedReport>(`/reports/${reportId}`);
    return response.data;
  }

  /**
   * Download report
   */
  async downloadReport(reportId: string, filename?: string): Promise<void> {
    await apiService.downloadFile(`/reports/${reportId}/download`, filename);
  }

  /**
   * Get generated reports
   */
  async getGeneratedReports(
    type?: ReportType,
    status?: string,
    limit?: number
  ): Promise<GeneratedReport[]> {
    const response = await apiService.get<GeneratedReport[]>('/reports', {
      type,
      status,
      limit,
    });
    return response.data;
  }

  /**
   * Delete report
   */
  async deleteReport(reportId: string): Promise<void> {
    await apiService.delete(`/reports/${reportId}`, {
      showSuccessToast: true,
      successMessage: 'Report deleted successfully!',
    });
  }

  // ========================================================================
  // SPECIFIC REPORTS
  // ========================================================================

  /**
   * Get patient demographics report
   */
  async getPatientDemographicsReport(
    filters?: ReportFilters
  ): Promise<PatientDemographicsReport> {
    const response = await apiService.get<PatientDemographicsReport>(
      '/reports/patient-demographics',
      filters
    );
    return response.data;
  }

  /**
   * Get appointment summary report
   */
  async getAppointmentSummaryReport(
    filters?: ReportFilters
  ): Promise<AppointmentSummaryReport> {
    const response = await apiService.get<AppointmentSummaryReport>(
      '/reports/appointment-summary',
      filters
    );
    return response.data;
  }

  /**
   * Get provider productivity report
   */
  async getProviderProductivityReport(
    providerId?: string,
    filters?: ReportFilters
  ): Promise<ProviderProductivityReport[]> {
    const response = await apiService.get<ProviderProductivityReport[]>(
      '/reports/provider-productivity',
      { ...filters, providerId }
    );
    return response.data;
  }

  /**
   * Get financial summary report
   */
  async getFinancialSummaryReport(filters?: ReportFilters): Promise<FinancialSummaryReport> {
    const response = await apiService.get<FinancialSummaryReport>(
      '/reports/financial-summary',
      filters
    );
    return response.data;
  }

  /**
   * Get quality metrics report
   */
  async getQualityMetricsReport(filters?: ReportFilters): Promise<QualityMetricsReport> {
    const response = await apiService.get<QualityMetricsReport>('/reports/quality-metrics', filters);
    return response.data;
  }

  /**
   * Get billing aging report
   */
  async getBillingAgingReport(
    asOfDate?: string,
    providerId?: string
  ): Promise<{
    totalOutstanding: number;
    agingBuckets: {
      range: string;
      amount: number;
      count: number;
      percentage: number;
    }[];
    patientBalances: {
      patientId: string;
      patientName: string;
      totalBalance: number;
      current: number;
      days30: number;
      days60: number;
      days90: number;
      days120Plus: number;
    }[];
  }> {
    const response = await apiService.get<{
      totalOutstanding: number;
      agingBuckets: {
        range: string;
        amount: number;
        count: number;
        percentage: number;
      }[];
      patientBalances: {
        patientId: string;
        patientName: string;
        totalBalance: number;
        current: number;
        days30: number;
        days60: number;
        days90: number;
        days120Plus: number;
      }[];
    }>('/reports/billing-aging', { asOfDate, providerId });
    return response.data;
  }

  /**
   * Get insurance claims report
   */
  async getInsuranceClaimsReport(
    filters?: ReportFilters
  ): Promise<{
    totalClaims: number;
    claimsByStatus: {
      status: string;
      count: number;
      amount: number;
      percentage: number;
    }[];
    claimsByInsurance: {
      insurance: string;
      submitted: number;
      approved: number;
      denied: number;
      pending: number;
      totalAmount: number;
      approvedAmount: number;
    }[];
    denialReasons: {
      reason: string;
      count: number;
      percentage: number;
    }[];
    averageProcessingTime: number;
    resubmissionRate: number;
  }> {
    const response = await apiService.get<{
      totalClaims: number;
      claimsByStatus: {
        status: string;
        count: number;
        amount: number;
        percentage: number;
      }[];
      claimsByInsurance: {
        insurance: string;
        submitted: number;
        approved: number;
        denied: number;
        pending: number;
        totalAmount: number;
        approvedAmount: number;
      }[];
      denialReasons: {
        reason: string;
        count: number;
        percentage: number;
      }[];
      averageProcessingTime: number;
      resubmissionRate: number;
    }>('/reports/insurance-claims', filters);
    return response.data;
  }

  /**
   * Get no-show analysis report
   */
  async getNoShowAnalysisReport(
    filters?: ReportFilters
  ): Promise<{
    totalNoShows: number;
    noShowRate: number;
    noShowsByProvider: {
      providerId: string;
      providerName: string;
      noShows: number;
      totalAppointments: number;
      rate: number;
    }[];
    noShowsByDay: {
      dayOfWeek: string;
      noShows: number;
      rate: number;
    }[];
    noShowsByTime: {
      hour: number;
      noShows: number;
      rate: number;
    }[];
    patientNoShowHistory: {
      patientId: string;
      patientName: string;
      noShows: number;
      totalAppointments: number;
      rate: number;
      lastNoShow: string;
    }[];
    costImpact: {
      lostRevenue: number;
      wastedTime: number;
      affectedPatients: number;
    };
  }> {
    const response = await apiService.get<{
      totalNoShows: number;
      noShowRate: number;
      noShowsByProvider: {
        providerId: string;
        providerName: string;
        noShows: number;
        totalAppointments: number;
        rate: number;
      }[];
      noShowsByDay: {
        dayOfWeek: string;
        noShows: number;
        rate: number;
      }[];
      noShowsByTime: {
        hour: number;
        noShows: number;
        rate: number;
      }[];
      patientNoShowHistory: {
        patientId: string;
        patientName: string;
        noShows: number;
        totalAppointments: number;
        rate: number;
        lastNoShow: string;
      }[];
      costImpact: {
        lostRevenue: number;
        wastedTime: number;
        affectedPatients: number;
      };
    }>('/reports/no-show-analysis', filters);
    return response.data;
  }

  /**
   * Get medication adherence report
   */
  async getMedicationAdherenceReport(
    filters?: ReportFilters
  ): Promise<{
    overallAdherence: number;
    adherenceByMedication: {
      medication: string;
      prescribed: number;
      adherent: number;
      rate: number;
    }[];
    adherenceByProvider: {
      providerId: string;
      providerName: string;
      prescribed: number;
      adherent: number;
      rate: number;
    }[];
    adherenceByAge: {
      ageGroup: string;
      prescribed: number;
      adherent: number;
      rate: number;
    }[];
    nonAdherentPatients: {
      patientId: string;
      patientName: string;
      medications: {
        name: string;
        prescribed: string;
        lastFilled: string;
        daysSupply: number;
        adherenceRate: number;
      }[];
    }[];
  }> {
    const response = await apiService.get<{
      overallAdherence: number;
      adherenceByMedication: {
        medication: string;
        prescribed: number;
        adherent: number;
        rate: number;
      }[];
      adherenceByProvider: {
        providerId: string;
        providerName: string;
        prescribed: number;
        adherent: number;
        rate: number;
      }[];
      adherenceByAge: {
        ageGroup: string;
        prescribed: number;
        adherent: number;
        rate: number;
      }[];
      nonAdherentPatients: {
        patientId: string;
        patientName: string;
        medications: {
          name: string;
          prescribed: string;
          lastFilled: string;
          daysSupply: number;
          adherenceRate: number;
        }[];
      }[];
    }>('/reports/medication-adherence', filters);
    return response.data;
  }

  // ========================================================================
  // REPORT TEMPLATES
  // ========================================================================

  /**
   * Get report templates
   */
  async getReportTemplates(type?: ReportType): Promise<ReportTemplate[]> {
    const response = await apiService.get<ReportTemplate[]>('/reports/templates', { type });
    return response.data;
  }

  /**
   * Create report template
   */
  async createReportTemplate(
    template: Omit<ReportTemplate, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'>
  ): Promise<ReportTemplate> {
    const response = await apiService.post<ReportTemplate>('/reports/templates', template, {
      showSuccessToast: true,
      successMessage: 'Report template created successfully!',
    });
    return response.data;
  }

  /**
   * Update report template
   */
  async updateReportTemplate(
    templateId: string,
    updates: Partial<ReportTemplate>
  ): Promise<ReportTemplate> {
    const response = await apiService.patch<ReportTemplate>(
      `/reports/templates/${templateId}`,
      updates,
      {
        showSuccessToast: true,
        successMessage: 'Report template updated successfully!',
      }
    );
    return response.data;
  }

  /**
   * Delete report template
   */
  async deleteReportTemplate(templateId: string): Promise<void> {
    await apiService.delete(`/reports/templates/${templateId}`, {
      showSuccessToast: true,
      successMessage: 'Report template deleted successfully!',
    });
  }

  /**
   * Generate report from template
   */
  async generateReportFromTemplate(
    templateId: string,
    overrides?: Partial<ReportConfig>
  ): Promise<GeneratedReport> {
    const response = await apiService.post<GeneratedReport>(
      `/reports/templates/${templateId}/generate`,
      overrides,
      {
        showSuccessToast: true,
        successMessage: 'Report generation started!',
      }
    );
    return response.data;
  }

  // ========================================================================
  // SCHEDULED REPORTS
  // ========================================================================

  /**
   * Get scheduled reports
   */
  async getScheduledReports(): Promise<ReportSchedule[]> {
    const response = await apiService.get<ReportSchedule[]>('/reports/schedules');
    return response.data;
  }

  /**
   * Create scheduled report
   */
  async createScheduledReport(
    schedule: Omit<ReportSchedule, 'id' | 'createdAt' | 'lastRun' | 'nextRun'>
  ): Promise<ReportSchedule> {
    const response = await apiService.post<ReportSchedule>('/reports/schedules', schedule, {
      showSuccessToast: true,
      successMessage: 'Scheduled report created successfully!',
    });
    return response.data;
  }

  /**
   * Update scheduled report
   */
  async updateScheduledReport(
    scheduleId: string,
    updates: Partial<ReportSchedule>
  ): Promise<ReportSchedule> {
    const response = await apiService.patch<ReportSchedule>(
      `/reports/schedules/${scheduleId}`,
      updates,
      {
        showSuccessToast: true,
        successMessage: 'Scheduled report updated successfully!',
      }
    );
    return response.data;
  }

  /**
   * Delete scheduled report
   */
  async deleteScheduledReport(scheduleId: string): Promise<void> {
    await apiService.delete(`/reports/schedules/${scheduleId}`, {
      showSuccessToast: true,
      successMessage: 'Scheduled report deleted successfully!',
    });
  }

  /**
   * Toggle scheduled report
   */
  async toggleScheduledReport(scheduleId: string, isActive: boolean): Promise<ReportSchedule> {
    const response = await apiService.patch<ReportSchedule>(
      `/reports/schedules/${scheduleId}/toggle`,
      { isActive },
      {
        showSuccessToast: true,
        successMessage: `Scheduled report ${isActive ? 'activated' : 'deactivated'} successfully!`,
      }
    );
    return response.data;
  }

  /**
   * Run scheduled report now
   */
  async runScheduledReportNow(scheduleId: string): Promise<GeneratedReport> {
    const response = await apiService.post<GeneratedReport>(
      `/reports/schedules/${scheduleId}/run`,
      {},
      {
        showSuccessToast: true,
        successMessage: 'Scheduled report started!',
      }
    );
    return response.data;
  }

  // ========================================================================
  // ANALYTICS AND TRENDS
  // ========================================================================

  /**
   * Get revenue trends
   */
  async getRevenueTrends(
    period: 'week' | 'month' | 'quarter' | 'year',
    groupBy: 'day' | 'week' | 'month',
    providerId?: string
  ): Promise<{
    period: string;
    revenue: number;
    collected: number;
    outstanding: number;
    growth: number;
  }[]> {
    const response = await apiService.get<{
      period: string;
      revenue: number;
      collected: number;
      outstanding: number;
      growth: number;
    }[]>('/reports/revenue-trends', { period, groupBy, providerId });
    return response.data;
  }

  /**
   * Get patient trends
   */
  async getPatientTrends(
    period: 'week' | 'month' | 'quarter' | 'year',
    groupBy: 'day' | 'week' | 'month'
  ): Promise<{
    period: string;
    newPatients: number;
    activePatients: number;
    returningPatients: number;
    growth: number;
  }[]> {
    const response = await apiService.get<{
      period: string;
      newPatients: number;
      activePatients: number;
      returningPatients: number;
      growth: number;
    }[]>('/reports/patient-trends', { period, groupBy });
    return response.data;
  }

  /**
   * Get appointment trends
   */
  async getAppointmentTrends(
    period: 'week' | 'month' | 'quarter' | 'year',
    groupBy: 'day' | 'week' | 'month',
    providerId?: string
  ): Promise<{
    period: string;
    scheduled: number;
    completed: number;
    cancelled: number;
    noShow: number;
    utilizationRate: number;
  }[]> {
    const response = await apiService.get<{
      period: string;
      scheduled: number;
      completed: number;
      cancelled: number;
      noShow: number;
      utilizationRate: number;
    }[]>('/reports/appointment-trends', { period, groupBy, providerId });
    return response.data;
  }

  // ========================================================================
  // COMPARATIVE ANALYTICS
  // ========================================================================

  /**
   * Compare providers
   */
  async compareProviders(
    providerIds: string[],
    metrics: string[],
    startDate?: string,
    endDate?: string
  ): Promise<{
    providerId: string;
    providerName: string;
    metrics: Record<string, number>;
    ranking: number;
  }[]> {
    const response = await apiService.post<{
      providerId: string;
      providerName: string;
      metrics: Record<string, number>;
      ranking: number;
    }[]>('/reports/compare-providers', {
      providerIds,
      metrics,
      startDate,
      endDate,
    });
    return response.data;
  }

  /**
   * Compare time periods
   */
  async compareTimePeriods(
    currentPeriod: { startDate: string; endDate: string },
    comparisonPeriod: { startDate: string; endDate: string },
    metrics: string[]
  ): Promise<{
    metric: string;
    current: number;
    comparison: number;
    change: number;
    changePercentage: number;
    trend: 'up' | 'down' | 'stable';
  }[]> {
    const response = await apiService.post<{
      metric: string;
      current: number;
      comparison: number;
      change: number;
      changePercentage: number;
      trend: 'up' | 'down' | 'stable';
    }[]>('/reports/compare-periods', {
      currentPeriod,
      comparisonPeriod,
      metrics,
    });
    return response.data;
  }

  // ========================================================================
  // EXPORT AND SHARING
  // ========================================================================

  /**
   * Share report
   */
  async shareReport(
    reportId: string,
    recipients: string[],
    message?: string,
    expiresAt?: string
  ): Promise<{ shareId: string; url: string }> {
    const response = await apiService.post<{ shareId: string; url: string }>(
      `/reports/${reportId}/share`,
      {
        recipients,
        message,
        expiresAt,
      },
      {
        showSuccessToast: true,
        successMessage: 'Report shared successfully!',
      }
    );
    return response.data;
  }

  /**
   * Email report
   */
  async emailReport(
    reportId: string,
    recipients: string[],
    subject?: string,
    message?: string
  ): Promise<void> {
    await apiService.post(
      `/reports/${reportId}/email`,
      {
        recipients,
        subject,
        message,
      },
      {
        showSuccessToast: true,
        successMessage: 'Report emailed successfully!',
      }
    );
  }

  // ========================================================================
  // CUSTOM REPORTS
  // ========================================================================

  /**
   * Get available report fields
   */
  async getReportFields(type: ReportType): Promise<{
    field: string;
    label: string;
    type: 'string' | 'number' | 'date' | 'boolean';
    filterable: boolean;
    sortable: boolean;
    groupable: boolean;
  }[]> {
    const response = await apiService.get<{
      field: string;
      label: string;
      type: 'string' | 'number' | 'date' | 'boolean';
      filterable: boolean;
      sortable: boolean;
      groupable: boolean;
    }[]>(`/reports/fields/${type}`);
    return response.data;
  }

  /**
   * Preview report data
   */
  async previewReportData(
    config: ReportConfig,
    limit: number = 10
  ): Promise<{
    columns: string[];
    data: Record<string, any>[];
    totalRows: number;
  }> {
    const response = await apiService.post<{
      columns: string[];
      data: Record<string, any>[];
      totalRows: number;
    }>('/reports/preview', { ...config, limit });
    return response.data;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const reportsService = ReportsService.getInstance();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export const getDashboardMetrics = (
  startDate?: string,
  endDate?: string,
  providerId?: string
): Promise<DashboardMetrics> => reportsService.getDashboardMetrics(startDate, endDate, providerId);

export const generateReport = (config: ReportConfig): Promise<GeneratedReport> =>
  reportsService.generateReport(config);

export const getPatientDemographicsReport = (
  filters?: ReportFilters
): Promise<PatientDemographicsReport> => reportsService.getPatientDemographicsReport(filters);

export const getAppointmentSummaryReport = (
  filters?: ReportFilters
): Promise<AppointmentSummaryReport> => reportsService.getAppointmentSummaryReport(filters);

export const getFinancialSummaryReport = (
  filters?: ReportFilters
): Promise<FinancialSummaryReport> => reportsService.getFinancialSummaryReport(filters);

export const getProviderProductivityReport = (
  providerId?: string,
  filters?: ReportFilters
): Promise<ProviderProductivityReport[]> =>
  reportsService.getProviderProductivityReport(providerId, filters);

// ============================================================================
// EXPORTS
// ============================================================================

export default reportsService;