import { apiService, ApiResponse, PaginationParams } from './api';
import { Provider, ProviderCreateData, ProviderUpdateData, ProviderFilters } from '@/types/provider';
import { ProviderSchedule, ProviderAvailability, TimeSlot } from '@/types/provider';
import { Appointment } from '@/types/appointment';

// ============================================================================
// TYPES
// ============================================================================

export interface ProviderListResponse {
  providers: Provider[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ProviderStatsResponse {
  totalProviders: number;
  activeProviders: number;
  availableProviders: number;
  busyProviders: number;
  offlineProviders: number;
  specialtyDistribution: Record<string, number>;
  locationDistribution: Record<string, number>;
  averageRating: number;
  totalPatients: number;
  totalAppointments: number;
  utilizationRate: number;
}

export interface ProviderSearchParams extends PaginationParams {
  query?: string;
  specialty?: string[];
  location?: string[];
  availability?: boolean;
  rating?: number;
  acceptingNewPatients?: boolean;
  languages?: string[];
  insurance?: string[];
  gender?: string;
  sortBy?: 'name' | 'rating' | 'experience' | 'availability';
  sortOrder?: 'asc' | 'desc';
}

export interface ScheduleCreateData {
  providerId: string;
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, etc.
  startTime: string; // HH:mm format
  endTime: string; // HH:mm format
  location: string;
  appointmentTypes: string[];
  maxAppointments?: number;
  slotDuration?: number; // minutes
  bufferTime?: number; // minutes between appointments
  isActive?: boolean;
}

export interface AvailabilityCreateData {
  providerId: string;
  date: string;
  timeSlots: {
    startTime: string;
    endTime: string;
    isAvailable: boolean;
    reason?: string; // if not available
    appointmentTypes?: string[];
    maxAppointments?: number;
  }[];
  notes?: string;
}

export interface ProviderMetrics {
  appointmentsToday: number;
  appointmentsThisWeek: number;
  appointmentsThisMonth: number;
  completedAppointments: number;
  cancelledAppointments: number;
  noShowAppointments: number;
  averageAppointmentDuration: number;
  patientSatisfactionScore: number;
  utilizationRate: number;
  revenue: {
    today: number;
    thisWeek: number;
    thisMonth: number;
    thisYear: number;
  };
  topDiagnoses: {
    diagnosis: string;
    count: number;
  }[];
  appointmentTrends: {
    date: string;
    appointments: number;
    completed: number;
    cancelled: number;
  }[];
}

export interface ProviderCredential {
  id: string;
  type: 'license' | 'certification' | 'degree' | 'training';
  name: string;
  issuingOrganization: string;
  issueDate: string;
  expirationDate?: string;
  credentialNumber: string;
  verificationStatus: 'pending' | 'verified' | 'expired' | 'revoked';
  attachments?: {
    id: string;
    filename: string;
    url: string;
  }[];
}

export interface ProviderNote {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  type: 'general' | 'performance' | 'schedule' | 'credential' | 'complaint';
  priority: 'low' | 'medium' | 'high';
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// PROVIDER SERVICE CLASS
// ============================================================================

export class ProviderService {
  private static instance: ProviderService;

  private constructor() {}

  public static getInstance(): ProviderService {
    if (!ProviderService.instance) {
      ProviderService.instance = new ProviderService();
    }
    return ProviderService.instance;
  }

  // ========================================================================
  // PROVIDER MANAGEMENT
  // ========================================================================

  /**
   * Get all providers with pagination and filtering
   */
  async getProviders(params?: ProviderSearchParams): Promise<ProviderListResponse> {
    const response = await apiService.getPaginated<Provider>('/providers', params);
    
    return {
      providers: response.data,
      total: response.meta?.total || 0,
      page: response.meta?.page || 1,
      limit: response.meta?.limit || 20,
      totalPages: response.meta?.totalPages || 1,
    };
  }

  /**
   * Get provider by ID
   */
  async getProviderById(id: string): Promise<Provider> {
    const response = await apiService.get<Provider>(`/providers/${id}`);
    return response.data;
  }

  /**
   * Create new provider
   */
  async createProvider(data: ProviderCreateData): Promise<Provider> {
    const response = await apiService.post<Provider>('/providers', data, {
      showSuccessToast: true,
      successMessage: 'Provider created successfully!',
    });
    return response.data;
  }

  /**
   * Update provider
   */
  async updateProvider(id: string, data: ProviderUpdateData): Promise<Provider> {
    const response = await apiService.patch<Provider>(`/providers/${id}`, data, {
      showSuccessToast: true,
      successMessage: 'Provider updated successfully!',
    });
    return response.data;
  }

  /**
   * Delete provider (soft delete)
   */
  async deleteProvider(id: string): Promise<void> {
    await apiService.delete(`/providers/${id}`, {
      showSuccessToast: true,
      successMessage: 'Provider deleted successfully!',
    });
  }

  /**
   * Activate provider
   */
  async activateProvider(id: string): Promise<Provider> {
    const response = await apiService.patch<Provider>(
      `/providers/${id}/activate`,
      {},
      {
        showSuccessToast: true,
        successMessage: 'Provider activated successfully!',
      }
    );
    return response.data;
  }

  /**
   * Deactivate provider
   */
  async deactivateProvider(id: string, reason?: string): Promise<Provider> {
    const response = await apiService.patch<Provider>(
      `/providers/${id}/deactivate`,
      { reason },
      {
        showSuccessToast: true,
        successMessage: 'Provider deactivated successfully!',
      }
    );
    return response.data;
  }

  /**
   * Search providers
   */
  async searchProviders(query: string, filters?: ProviderFilters): Promise<Provider[]> {
    const response = await apiService.get<Provider[]>('/providers/search', {
      q: query,
      ...filters,
    });
    return response.data;
  }

  /**
   * Get provider statistics
   */
  async getProviderStats(): Promise<ProviderStatsResponse> {
    const response = await apiService.get<ProviderStatsResponse>('/providers/stats');
    return response.data;
  }

  /**
   * Get available providers
   */
  async getAvailableProviders(
    date?: string,
    appointmentType?: string,
    location?: string
  ): Promise<Provider[]> {
    const response = await apiService.get<Provider[]>('/providers/available', {
      date,
      appointmentType,
      location,
    });
    return response.data;
  }

  // ========================================================================
  // PROVIDER SCHEDULE MANAGEMENT
  // ========================================================================

  /**
   * Get provider's schedule
   */
  async getProviderSchedule(providerId: string): Promise<ProviderSchedule[]> {
    const response = await apiService.get<ProviderSchedule[]>(`/providers/${providerId}/schedule`);
    return response.data;
  }

  /**
   * Create schedule for provider
   */
  async createSchedule(data: ScheduleCreateData): Promise<ProviderSchedule> {
    const response = await apiService.post<ProviderSchedule>(
      `/providers/${data.providerId}/schedule`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Schedule created successfully!',
      }
    );
    return response.data;
  }

  /**
   * Update provider schedule
   */
  async updateSchedule(
    providerId: string,
    scheduleId: string,
    data: Partial<ScheduleCreateData>
  ): Promise<ProviderSchedule> {
    const response = await apiService.patch<ProviderSchedule>(
      `/providers/${providerId}/schedule/${scheduleId}`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Schedule updated successfully!',
      }
    );
    return response.data;
  }

  /**
   * Delete provider schedule
   */
  async deleteSchedule(providerId: string, scheduleId: string): Promise<void> {
    await apiService.delete(`/providers/${providerId}/schedule/${scheduleId}`, {
      showSuccessToast: true,
      successMessage: 'Schedule deleted successfully!',
    });
  }

  /**
   * Bulk update provider schedule
   */
  async bulkUpdateSchedule(
    providerId: string,
    schedules: ScheduleCreateData[]
  ): Promise<ProviderSchedule[]> {
    const response = await apiService.post<ProviderSchedule[]>(
      `/providers/${providerId}/schedule/bulk`,
      { schedules },
      {
        showSuccessToast: true,
        successMessage: 'Schedules updated successfully!',
      }
    );
    return response.data;
  }

  // ========================================================================
  // PROVIDER AVAILABILITY
  // ========================================================================

  /**
   * Get provider availability for date range
   */
  async getProviderAvailability(
    providerId: string,
    startDate: string,
    endDate: string
  ): Promise<ProviderAvailability[]> {
    const response = await apiService.get<ProviderAvailability[]>(
      `/providers/${providerId}/availability`,
      { startDate, endDate }
    );
    return response.data;
  }

  /**
   * Set provider availability for specific date
   */
  async setAvailability(data: AvailabilityCreateData): Promise<ProviderAvailability> {
    const response = await apiService.post<ProviderAvailability>(
      `/providers/${data.providerId}/availability`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Availability updated successfully!',
      }
    );
    return response.data;
  }

  /**
   * Update provider availability
   */
  async updateAvailability(
    providerId: string,
    availabilityId: string,
    data: Partial<AvailabilityCreateData>
  ): Promise<ProviderAvailability> {
    const response = await apiService.patch<ProviderAvailability>(
      `/providers/${providerId}/availability/${availabilityId}`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Availability updated successfully!',
      }
    );
    return response.data;
  }

  /**
   * Delete provider availability
   */
  async deleteAvailability(providerId: string, availabilityId: string): Promise<void> {
    await apiService.delete(`/providers/${providerId}/availability/${availabilityId}`, {
      showSuccessToast: true,
      successMessage: 'Availability deleted successfully!',
    });
  }

  /**
   * Block time slot
   */
  async blockTimeSlot(
    providerId: string,
    startTime: string,
    endTime: string,
    reason: string
  ): Promise<void> {
    await apiService.post(
      `/providers/${providerId}/block-time`,
      { startTime, endTime, reason },
      {
        showSuccessToast: true,
        successMessage: 'Time slot blocked successfully!',
      }
    );
  }

  /**
   * Unblock time slot
   */
  async unblockTimeSlot(providerId: string, blockId: string): Promise<void> {
    await apiService.delete(`/providers/${providerId}/block-time/${blockId}`, {
      showSuccessToast: true,
      successMessage: 'Time slot unblocked successfully!',
    });
  }

  /**
   * Get available time slots for provider
   */
  async getAvailableTimeSlots(
    providerId: string,
    date: string,
    appointmentType?: string,
    duration?: number
  ): Promise<TimeSlot[]> {
    const response = await apiService.get<TimeSlot[]>(
      `/providers/${providerId}/available-slots`,
      { date, appointmentType, duration }
    );
    return response.data;
  }

  // ========================================================================
  // PROVIDER METRICS & ANALYTICS
  // ========================================================================

  /**
   * Get provider metrics
   */
  async getProviderMetrics(
    providerId: string,
    startDate?: string,
    endDate?: string
  ): Promise<ProviderMetrics> {
    const response = await apiService.get<ProviderMetrics>(
      `/providers/${providerId}/metrics`,
      { startDate, endDate }
    );
    return response.data;
  }

  /**
   * Get provider's appointments
   */
  async getProviderAppointments(
    providerId: string,
    params?: {
      startDate?: string;
      endDate?: string;
      status?: string[];
      page?: number;
      limit?: number;
    }
  ): Promise<Appointment[]> {
    const response = await apiService.getPaginated<Appointment>(
      `/providers/${providerId}/appointments`,
      params
    );
    return response.data;
  }

  /**
   * Get provider's patients
   */
  async getProviderPatients(
    providerId: string,
    params?: PaginationParams
  ): Promise<any[]> {
    const response = await apiService.getPaginated<any>(
      `/providers/${providerId}/patients`,
      params
    );
    return response.data;
  }

  /**
   * Get provider performance report
   */
  async getPerformanceReport(
    providerId: string,
    period: 'week' | 'month' | 'quarter' | 'year'
  ): Promise<any> {
    const response = await apiService.get<any>(
      `/providers/${providerId}/performance`,
      { period }
    );
    return response.data;
  }

  // ========================================================================
  // PROVIDER CREDENTIALS
  // ========================================================================

  /**
   * Get provider credentials
   */
  async getProviderCredentials(providerId: string): Promise<ProviderCredential[]> {
    const response = await apiService.get<ProviderCredential[]>(
      `/providers/${providerId}/credentials`
    );
    return response.data;
  }

  /**
   * Add provider credential
   */
  async addCredential(
    providerId: string,
    data: Omit<ProviderCredential, 'id' | 'verificationStatus'>,
    files?: File[]
  ): Promise<ProviderCredential> {
    const formData = new FormData();
    
    // Add credential data
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        formData.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
      }
    });
    
    // Add files
    if (files) {
      files.forEach((file, index) => {
        formData.append(`files[${index}]`, file);
      });
    }

    const response = await apiService.post<ProviderCredential>(
      `/providers/${providerId}/credentials`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        showSuccessToast: true,
        successMessage: 'Credential added successfully!',
      }
    );
    return response.data;
  }

  /**
   * Update provider credential
   */
  async updateCredential(
    providerId: string,
    credentialId: string,
    data: Partial<ProviderCredential>
  ): Promise<ProviderCredential> {
    const response = await apiService.patch<ProviderCredential>(
      `/providers/${providerId}/credentials/${credentialId}`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Credential updated successfully!',
      }
    );
    return response.data;
  }

  /**
   * Delete provider credential
   */
  async deleteCredential(providerId: string, credentialId: string): Promise<void> {
    await apiService.delete(`/providers/${providerId}/credentials/${credentialId}`, {
      showSuccessToast: true,
      successMessage: 'Credential deleted successfully!',
    });
  }

  /**
   * Verify provider credential
   */
  async verifyCredential(
    providerId: string,
    credentialId: string,
    verificationNotes?: string
  ): Promise<ProviderCredential> {
    const response = await apiService.patch<ProviderCredential>(
      `/providers/${providerId}/credentials/${credentialId}/verify`,
      { verificationNotes },
      {
        showSuccessToast: true,
        successMessage: 'Credential verified successfully!',
      }
    );
    return response.data;
  }

  // ========================================================================
  // PROVIDER NOTES
  // ========================================================================

  /**
   * Get provider notes
   */
  async getProviderNotes(
    providerId: string,
    params?: {
      type?: string;
      includePrivate?: boolean;
      page?: number;
      limit?: number;
    }
  ): Promise<ProviderNote[]> {
    const response = await apiService.getPaginated<ProviderNote>(
      `/providers/${providerId}/notes`,
      params
    );
    return response.data;
  }

  /**
   * Add provider note
   */
  async addProviderNote(
    providerId: string,
    data: Omit<ProviderNote, 'id' | 'authorId' | 'authorName' | 'createdAt' | 'updatedAt'>
  ): Promise<ProviderNote> {
    const response = await apiService.post<ProviderNote>(
      `/providers/${providerId}/notes`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Note added successfully!',
      }
    );
    return response.data;
  }

  /**
   * Update provider note
   */
  async updateProviderNote(
    providerId: string,
    noteId: string,
    data: Partial<Pick<ProviderNote, 'content' | 'type' | 'priority' | 'isPrivate'>>
  ): Promise<ProviderNote> {
    const response = await apiService.patch<ProviderNote>(
      `/providers/${providerId}/notes/${noteId}`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Note updated successfully!',
      }
    );
    return response.data;
  }

  /**
   * Delete provider note
   */
  async deleteProviderNote(providerId: string, noteId: string): Promise<void> {
    await apiService.delete(`/providers/${providerId}/notes/${noteId}`, {
      showSuccessToast: true,
      successMessage: 'Note deleted successfully!',
    });
  }

  // ========================================================================
  // PROVIDER PROFILE
  // ========================================================================

  /**
   * Upload provider photo
   */
  async uploadProviderPhoto(providerId: string, file: File): Promise<{ url: string }> {
    const response = await apiService.uploadFile<{ url: string }>(
      `/providers/${providerId}/photo`,
      file,
      {},
      undefined,
      {
        showSuccessToast: true,
        successMessage: 'Photo uploaded successfully!',
      }
    );
    return response.data;
  }

  /**
   * Update provider settings
   */
  async updateProviderSettings(
    providerId: string,
    settings: {
      notifications?: {
        email: boolean;
        sms: boolean;
        push: boolean;
      };
      scheduling?: {
        autoConfirm: boolean;
        allowOnlineBooking: boolean;
        bufferTime: number;
        maxAdvanceBooking: number;
      };
      communication?: {
        preferredLanguage: string;
        timeZone: string;
      };
    }
  ): Promise<void> {
    await apiService.patch(
      `/providers/${providerId}/settings`,
      settings,
      {
        showSuccessToast: true,
        successMessage: 'Settings updated successfully!',
      }
    );
  }

  // ========================================================================
  // PROVIDER REVIEWS & RATINGS
  // ========================================================================

  /**
   * Get provider reviews
   */
  async getProviderReviews(
    providerId: string,
    params?: PaginationParams
  ): Promise<any[]> {
    const response = await apiService.getPaginated<any>(
      `/providers/${providerId}/reviews`,
      params
    );
    return response.data;
  }

  /**
   * Get provider rating summary
   */
  async getProviderRating(providerId: string): Promise<{
    averageRating: number;
    totalReviews: number;
    ratingDistribution: Record<string, number>;
  }> {
    const response = await apiService.get<{
      averageRating: number;
      totalReviews: number;
      ratingDistribution: Record<string, number>;
    }>(`/providers/${providerId}/rating`);
    return response.data;
  }

  // ========================================================================
  // BULK OPERATIONS
  // ========================================================================

  /**
   * Bulk update providers
   */
  async bulkUpdateProviders(
    providerIds: string[],
    updates: Partial<ProviderUpdateData>
  ): Promise<Provider[]> {
    const response = await apiService.patch<Provider[]>(
      '/providers/bulk-update',
      { providerIds, updates },
      {
        showSuccessToast: true,
        successMessage: `${providerIds.length} providers updated successfully!`,
      }
    );
    return response.data;
  }

  /**
   * Export providers data
   */
  async exportProviders(
    format: 'csv' | 'excel' | 'pdf',
    filters?: ProviderFilters
  ): Promise<string> {
    const response = await apiService.get<{ url: string }>(
      `/providers/export/${format}`,
      filters
    );
    return response.data.url;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const providerService = ProviderService.getInstance();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export const getProviders = (params?: ProviderSearchParams): Promise<ProviderListResponse> =>
  providerService.getProviders(params);

export const getProviderById = (id: string): Promise<Provider> =>
  providerService.getProviderById(id);

export const createProvider = (data: ProviderCreateData): Promise<Provider> =>
  providerService.createProvider(data);

export const updateProvider = (id: string, data: ProviderUpdateData): Promise<Provider> =>
  providerService.updateProvider(id, data);

export const searchProviders = (query: string, filters?: ProviderFilters): Promise<Provider[]> =>
  providerService.searchProviders(query, filters);

export const getAvailableProviders = (
  date?: string,
  appointmentType?: string,
  location?: string
): Promise<Provider[]> => providerService.getAvailableProviders(date, appointmentType, location);

export const getProviderSchedule = (providerId: string): Promise<ProviderSchedule[]> =>
  providerService.getProviderSchedule(providerId);

export const getProviderAvailability = (
  providerId: string,
  startDate: string,
  endDate: string
): Promise<ProviderAvailability[]> =>
  providerService.getProviderAvailability(providerId, startDate, endDate);

export const getAvailableTimeSlots = (
  providerId: string,
  date: string,
  appointmentType?: string,
  duration?: number
): Promise<TimeSlot[]> =>
  providerService.getAvailableTimeSlots(providerId, date, appointmentType, duration);

// ============================================================================
// EXPORTS
// ============================================================================

export default providerService;