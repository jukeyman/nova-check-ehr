import { apiService, ApiResponse, PaginationParams } from './api';
import { Appointment, AppointmentCreateData, AppointmentUpdateData, AppointmentFilters } from '@/types/appointment';
import { TimeSlot, ProviderAvailability } from '@/types/provider';

export interface Appointment {
  id: string;
  patientId: string;
  providerId: string;
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    profilePicture?: string;
  };
  provider: {
    id: string;
    firstName: string;
    lastName: string;
    specialization: string;
    department: string;
    profilePicture?: string;
  };
  appointmentDate: string;
  startTime: string;
  endTime: string;
  duration: number;
  type: 'IN_PERSON' | 'TELEMEDICINE' | 'PHONE';
  status: 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  reason: string;
  notes?: string;
  location?: string;
  meetingLink?: string;
  reminderSent: boolean;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  followUpRequired: boolean;
  followUpDate?: string;
  attachments?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateAppointmentRequest {
  patientId: string;
  providerId: string;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  duration: number;
  type: 'IN_PERSON' | 'TELEMEDICINE' | 'PHONE';
  reason: string;
  notes?: string;
  location?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  reminderEnabled?: boolean;
  followUpRequired?: boolean;
  followUpDate?: string;
}

export interface UpdateAppointmentRequest {
  appointmentDate?: string;
  startTime?: string;
  endTime?: string;
  duration?: number;
  type?: 'IN_PERSON' | 'TELEMEDICINE' | 'PHONE';
  status?: 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  reason?: string;
  notes?: string;
  location?: string;
  meetingLink?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  followUpRequired?: boolean;
  followUpDate?: string;
}

// ============================================================================
// TYPES
// ============================================================================

export interface AppointmentListResponse {
  appointments: Appointment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AppointmentStatsResponse {
  totalAppointments: number;
  todayAppointments: number;
  upcomingAppointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  noShowAppointments: number;
  averageWaitTime: number;
  appointmentsByStatus: {
    scheduled: number;
    confirmed: number;
    'in-progress': number;
    completed: number;
    cancelled: number;
    'no-show': number;
  };
  appointmentsByType: Record<string, number>;
  monthlyTrends: {
    month: string;
    appointments: number;
    completed: number;
    cancelled: number;
  }[];
}

export interface AppointmentSearchParams extends PaginationParams {
  startDate?: string;
  endDate?: string;
  providerId?: string;
  patientId?: string;
  status?: string[];
  type?: string[];
  location?: string;
  urgent?: boolean;
  priority?: string;
  search?: string;
  sortBy?: 'appointmentDate' | 'createdAt' | 'patient' | 'provider' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export interface AppointmentStats {
  total: number;
  scheduled: number;
  confirmed: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  noShow: number;
  todayTotal: number;
  weekTotal: number;
  monthTotal: number;
  averageDuration: number;
  mostCommonType: string;
  mostCommonReason: string;
  upcomingCount: number;
  overdueCount: number;
}

export interface AppointmentReminder {
  id: string;
  appointmentId: string;
  type: 'EMAIL' | 'SMS' | 'PUSH';
  scheduledTime: string;
  sent: boolean;
  sentAt?: string;
  message: string;
}

export interface AvailableSlot {
  startTime: string;
  endTime: string;
  providerId: string;
  providerName: string;
  location: string;
  appointmentType: string;
  duration: number;
}

export interface AvailabilitySearchParams {
  providerId?: string;
  startDate: string;
  endDate: string;
  appointmentType?: string;
  duration?: number;
  location?: string;
  preferredTimes?: string[];
}

export interface AppointmentReminderSettings {
  email: {
    enabled: boolean;
    timeBefore: number; // minutes
  };
  sms: {
    enabled: boolean;
    timeBefore: number; // minutes
  };
  push: {
    enabled: boolean;
    timeBefore: number; // minutes
  };
}

export interface RecurringAppointmentData {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number; // every N frequency units
  daysOfWeek?: number[]; // for weekly (0 = Sunday)
  dayOfMonth?: number; // for monthly
  endDate?: string;
  occurrences?: number;
}

export interface AppointmentConflict {
  type: 'double-booking' | 'provider-unavailable' | 'location-conflict' | 'patient-conflict';
  message: string;
  conflictingAppointment?: Appointment;
  suggestions?: AvailableSlot[];
}

export interface WaitlistEntry {
  id: string;
  patientId: string;
  providerId: string;
  appointmentType: string;
  preferredDate?: string;
  preferredTime?: string;
  duration: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  notes?: string;
  createdAt: string;
  notificationPreferences: {
    email: boolean;
    sms: boolean;
    push: boolean;
  };
}

// ============================================================================
// APPOINTMENT SERVICE CLASS
// ============================================================================

export class AppointmentService {
  private static instance: AppointmentService;

  private constructor() {}

  public static getInstance(): AppointmentService {
    if (!AppointmentService.instance) {
      AppointmentService.instance = new AppointmentService();
    }
    return AppointmentService.instance;
  }

  // ========================================================================
  // APPOINTMENT MANAGEMENT
  // ========================================================================

  /**
   * Get appointments with filtering and pagination
   */
  async getAppointments(params?: AppointmentSearchParams): Promise<AppointmentListResponse> {
    const response = await apiService.getPaginated<Appointment>('/appointments', params);
    
    return {
      appointments: response.data,
      total: response.meta?.total || 0,
      page: response.meta?.page || 1,
      limit: response.meta?.limit || 20,
      totalPages: response.meta?.totalPages || 1,
    };
  }

  /**
   * Get appointment by ID
   */
  async getAppointmentById(id: string): Promise<Appointment> {
    const response = await apiService.get<Appointment>(`/appointments/${id}`);
    return response.data;
  }

  /**
   * Create new appointment
   */
  async createAppointment(data: AppointmentCreateData): Promise<Appointment> {
    const response = await apiService.post<Appointment>('/appointments', data, {
      showSuccessToast: true,
      successMessage: 'Appointment scheduled successfully!',
    });
    return response.data;
  }

  /**
   * Update appointment
   */
  async updateAppointment(id: string, data: AppointmentUpdateData): Promise<Appointment> {
    const response = await apiService.patch<Appointment>(`/appointments/${id}`, data, {
      showSuccessToast: true,
      successMessage: 'Appointment updated successfully!',
    });
    return response.data;
  }

  /**
   * Cancel appointment
   */
  async cancelAppointment(
    id: string,
    reason?: string,
    notifyPatient: boolean = true
  ): Promise<Appointment> {
    const response = await apiService.patch<Appointment>(
      `/appointments/${id}/cancel`,
      { reason, notifyPatient },
      {
        showSuccessToast: true,
        successMessage: 'Appointment cancelled successfully!',
      }
    );
    return response.data;
  }

  /**
   * Reschedule appointment
   */
  async rescheduleAppointment(
    id: string,
    newDateTime: string,
    reason?: string
  ): Promise<Appointment> {
    const response = await apiService.patch<Appointment>(
      `/appointments/${id}/reschedule`,
      { newDateTime, reason },
      {
        showSuccessToast: true,
        successMessage: 'Appointment rescheduled successfully!',
      }
    );
    return response.data;
  }

  /**
   * Confirm appointment
   */
  async confirmAppointment(id: string): Promise<Appointment> {
    const response = await apiService.patch<Appointment>(
      `/appointments/${id}/confirm`,
      {},
      {
        showSuccessToast: true,
        successMessage: 'Appointment confirmed!',
      }
    );
    return response.data;
  }

  /**
   * Check in patient for appointment
   */
  async checkInAppointment(id: string, checkInTime?: string): Promise<Appointment> {
    const response = await apiService.patch<Appointment>(
      `/appointments/${id}/check-in`,
      { checkInTime: checkInTime || new Date().toISOString() },
      {
        showSuccessToast: true,
        successMessage: 'Patient checked in successfully!',
      }
    );
    return response.data;
  }

  /**
   * Start appointment
   */
  async startAppointment(id: string): Promise<Appointment> {
    const response = await apiService.patch<Appointment>(
      `/appointments/${id}/start`,
      {},
      {
        showSuccessToast: true,
        successMessage: 'Appointment started!',
      }
    );
    return response.data;
  }

  /**
   * Complete appointment
   */
  async completeAppointment(
    id: string,
    notes?: string,
    followUpRequired?: boolean
  ): Promise<Appointment> {
    const response = await apiService.patch<Appointment>(
      `/appointments/${id}/complete`,
      { notes, followUpRequired },
      {
        showSuccessToast: true,
        successMessage: 'Appointment completed!',
      }
    );
    return response.data;
  }

  /**
   * Mark appointment as no-show
   */
  async markNoShow(id: string, notes?: string): Promise<Appointment> {
    const response = await apiService.patch<Appointment>(
      `/appointments/${id}/no-show`,
      { notes },
      {
        showSuccessToast: true,
        successMessage: 'Appointment marked as no-show.',
      }
    );
    return response.data;
  }

  /**
   * Delete appointment
   */
  async deleteAppointment(id: string): Promise<void> {
    await apiService.delete(`/appointments/${id}`, {
      showSuccessToast: true,
      successMessage: 'Appointment deleted successfully!',
    });
  }

  // ========================================================================
  // AVAILABILITY & SCHEDULING
  // ========================================================================

  /**
   * Get available time slots
   */
  async getAvailableSlots(params: AvailabilitySearchParams): Promise<AvailableSlot[]> {
    const response = await apiService.get<AvailableSlot[]>('/appointments/available-slots', params);
    return response.data;
  }

  /**
   * Check for appointment conflicts
   */
  async checkConflicts(
    providerId: string,
    startTime: string,
    endTime: string,
    excludeAppointmentId?: string
  ): Promise<AppointmentConflict[]> {
    const response = await apiService.get<AppointmentConflict[]>('/appointments/check-conflicts', {
      providerId,
      startTime,
      endTime,
      excludeAppointmentId,
    });
    return response.data;
  }

  /**
   * Get provider availability
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

  // ========================================================================
  // RECURRING APPOINTMENTS
  // ========================================================================

  /**
   * Create recurring appointment series
   */
  async createRecurringAppointment(
    appointmentData: AppointmentCreateData,
    recurringData: RecurringAppointmentData
  ): Promise<Appointment[]> {
    const response = await apiService.post<Appointment[]>(
      '/appointments/recurring',
      { appointmentData, recurringData },
      {
        showSuccessToast: true,
        successMessage: 'Recurring appointments created successfully!',
      }
    );
    return response.data;
  }

  /**
   * Update recurring appointment series
   */
  async updateRecurringAppointment(
    seriesId: string,
    data: Partial<AppointmentUpdateData>,
    updateType: 'this-only' | 'this-and-future' | 'all'
  ): Promise<Appointment[]> {
    const response = await apiService.patch<Appointment[]>(
      `/appointments/recurring/${seriesId}`,
      { data, updateType },
      {
        showSuccessToast: true,
        successMessage: 'Recurring appointments updated successfully!',
      }
    );
    return response.data;
  }

  /**
   * Cancel recurring appointment series
   */
  async cancelRecurringAppointment(
    seriesId: string,
    cancelType: 'this-only' | 'this-and-future' | 'all',
    reason?: string
  ): Promise<void> {
    await apiService.patch(
      `/appointments/recurring/${seriesId}/cancel`,
      { cancelType, reason },
      {
        showSuccessToast: true,
        successMessage: 'Recurring appointments cancelled successfully!',
      }
    );
  }

  // ========================================================================
  // WAITLIST MANAGEMENT
  // ========================================================================

  /**
   * Add patient to waitlist
   */
  async addToWaitlist(data: Omit<WaitlistEntry, 'id' | 'createdAt'>): Promise<WaitlistEntry> {
    const response = await apiService.post<WaitlistEntry>('/appointments/waitlist', data, {
      showSuccessToast: true,
      successMessage: 'Added to waitlist successfully!',
    });
    return response.data;
  }

  /**
   * Get waitlist entries
   */
  async getWaitlist(params?: {
    providerId?: string;
    appointmentType?: string;
    priority?: string;
  }): Promise<WaitlistEntry[]> {
    const response = await apiService.get<WaitlistEntry[]>('/appointments/waitlist', params);
    return response.data;
  }

  /**
   * Remove from waitlist
   */
  async removeFromWaitlist(waitlistId: string): Promise<void> {
    await apiService.delete(`/appointments/waitlist/${waitlistId}`, {
      showSuccessToast: true,
      successMessage: 'Removed from waitlist successfully!',
    });
  }

  /**
   * Notify waitlist when slot becomes available
   */
  async notifyWaitlist(
    providerId: string,
    startTime: string,
    endTime: string,
    appointmentType: string
  ): Promise<{ notified: number; scheduled: number }> {
    const response = await apiService.post<{ notified: number; scheduled: number }>(
      '/appointments/waitlist/notify',
      { providerId, startTime, endTime, appointmentType },
      {
        showSuccessToast: true,
        successMessage: 'Waitlist notifications sent!',
      }
    );
    return response.data;
  }

  // ========================================================================
  // APPOINTMENT REMINDERS
  // ========================================================================

  /**
   * Send appointment reminder
   */
  async sendReminder(
    appointmentId: string,
    type: 'email' | 'sms' | 'push',
    customMessage?: string
  ): Promise<void> {
    await apiService.post(
      `/appointments/${appointmentId}/remind`,
      { type, customMessage },
      {
        showSuccessToast: true,
        successMessage: 'Reminder sent successfully!',
      }
    );
  }

  /**
   * Update reminder settings for appointment
   */
  async updateReminderSettings(
    appointmentId: string,
    settings: AppointmentReminderSettings
  ): Promise<void> {
    await apiService.patch(
      `/appointments/${appointmentId}/reminder-settings`,
      settings,
      {
        showSuccessToast: true,
        successMessage: 'Reminder settings updated!',
      }
    );
  }

  /**
   * Get upcoming appointments requiring reminders
   */
  async getUpcomingReminders(): Promise<Appointment[]> {
    const response = await apiService.get<Appointment[]>('/appointments/upcoming-reminders');
    return response.data;
  }

  // ========================================================================
  // APPOINTMENT STATISTICS
  // ========================================================================

  /**
   * Get appointment statistics
   */
  async getAppointmentStats(
    startDate?: string,
    endDate?: string,
    providerId?: string
  ): Promise<AppointmentStatsResponse> {
    const response = await apiService.get<AppointmentStatsResponse>('/appointments/stats', {
      startDate,
      endDate,
      providerId,
    });
    return response.data;
  }

  /**
   * Get appointment statistics (alternative method)
   */
  async getStats(params: {
    startDate?: string;
    endDate?: string;
    providerId?: string;
  } = {}): Promise<AppointmentStats> {
    const response = await apiService.get<AppointmentStats>('/appointments/statistics', params);
    return response.data;
  }

  /**
   * Send appointment reminder
   */
  async sendAppointmentReminder(appointmentId: string, type: 'EMAIL' | 'SMS' | 'PUSH'): Promise<void> {
    await apiService.post(
      `/appointments/${appointmentId}/send-reminder`,
      { type },
      {
        showSuccessToast: true,
        successMessage: 'Reminder sent successfully!',
      }
    );
  }

  /**
   * Get appointment reminders
   */
  async getAppointmentReminders(appointmentId: string): Promise<AppointmentReminder[]> {
    const response = await apiService.get<AppointmentReminder[]>(`/appointments/${appointmentId}/reminders`);
    return response.data;
  }

  /**
   * Export appointments
   */
  async exportAppointments(params: AppointmentSearchParams, format: 'csv' | 'pdf' | 'excel'): Promise<Blob> {
    const response = await apiService.get<Blob>('/appointments/export', {
      ...params,
      format
    }, {
      responseType: 'blob'
    });
    return response.data;
  }

  /**
   * Get patient appointment history
   */
  async getPatientHistory(patientId: string): Promise<Appointment[]> {
    const response = await apiService.get<Appointment[]>(`/patients/${patientId}/appointment-history`);
    return response.data;
  }

  /**
   * Get today's appointments
   */
  async getTodayAppointments(providerId?: string): Promise<Appointment[]> {
    const response = await apiService.get<Appointment[]>('/appointments/today', { providerId });
    return response.data;
  }

  /**
   * Get upcoming appointments
   */
  async getUpcomingAppointments(
    days: number = 7,
    providerId?: string
  ): Promise<Appointment[]> {
    const response = await apiService.get<Appointment[]>('/appointments/upcoming', {
      days,
      providerId,
    });
    return response.data;
  }

  /**
   * Get patient's appointment history
   */
  async getPatientAppointmentHistory(
    patientId: string,
    params?: PaginationParams
  ): Promise<Appointment[]> {
    const response = await apiService.getPaginated<Appointment>(
      `/patients/${patientId}/appointments`,
      params
    );
    return response.data;
  }

  /**
   * Get provider's appointment schedule
   */
  async getProviderSchedule(
    providerId: string,
    startDate: string,
    endDate: string
  ): Promise<Appointment[]> {
    const response = await apiService.get<Appointment[]>(
      `/providers/${providerId}/schedule`,
      { startDate, endDate }
    );
    return response.data;
  }

  // ========================================================================
  // APPOINTMENT TEMPLATES
  // ========================================================================

  /**
   * Get appointment templates
   */
  async getAppointmentTemplates(): Promise<any[]> {
    const response = await apiService.get<any[]>('/appointments/templates');
    return response.data;
  }

  /**
   * Create appointment from template
   */
  async createFromTemplate(
    templateId: string,
    data: {
      patientId: string;
      providerId: string;
      startTime: string;
      customizations?: Record<string, any>;
    }
  ): Promise<Appointment> {
    const response = await apiService.post<Appointment>(
      `/appointments/templates/${templateId}/create`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Appointment created from template!',
      }
    );
    return response.data;
  }

  // ========================================================================
  // BULK OPERATIONS
  // ========================================================================

  /**
   * Bulk update appointments
   */
  async bulkUpdateAppointments(
    appointmentIds: string[],
    updates: Partial<AppointmentUpdateData>
  ): Promise<Appointment[]> {
    const response = await apiService.patch<Appointment[]>(
      '/appointments/bulk-update',
      { appointmentIds, updates },
      {
        showSuccessToast: true,
        successMessage: `${appointmentIds.length} appointments updated successfully!`,
      }
    );
    return response.data;
  }

  /**
   * Bulk cancel appointments
   */
  async bulkCancelAppointments(
    appointmentIds: string[],
    reason?: string
  ): Promise<void> {
    await apiService.patch(
      '/appointments/bulk-cancel',
      { appointmentIds, reason },
      {
        showSuccessToast: true,
        successMessage: `${appointmentIds.length} appointments cancelled successfully!`,
      }
    );
  }

  // ========================================================================
  // CALENDAR INTEGRATION
  // ========================================================================

  /**
   * Export appointments to calendar format
   */
  async exportToCalendar(
    format: 'ics' | 'google' | 'outlook',
    params?: {
      startDate?: string;
      endDate?: string;
      providerId?: string;
      patientId?: string;
    }
  ): Promise<string> {
    const response = await apiService.get<{ url: string }>(
      `/appointments/export/${format}`,
      params
    );
    return response.data.url;
  }

  /**
   * Sync with external calendar
   */
  async syncWithCalendar(
    calendarType: 'google' | 'outlook' | 'apple',
    accessToken: string
  ): Promise<{ synced: number; errors: string[] }> {
    const response = await apiService.post<{ synced: number; errors: string[] }>(
      '/appointments/sync-calendar',
      { calendarType, accessToken },
      {
        showSuccessToast: true,
        successMessage: 'Calendar sync completed!',
      }
    );
    return response.data;
  }

  /**
   * Get mock appointments for development
   */
  private getMockAppointments(params: AppointmentSearchParams = {}): {
    appointments: Appointment[];
    total: number;
    page: number;
    totalPages: number;
  } {
    const mockAppointments: Appointment[] = [
      {
        id: '1',
        patientId: 'patient-1',
        providerId: 'provider-1',
        patient: {
          id: 'patient-1',
          firstName: 'Sarah',
          lastName: 'Johnson',
          email: 'sarah.johnson@email.com',
          phone: '(555) 123-4567',
          dateOfBirth: '1985-03-15',
        },
        provider: {
          id: 'provider-1',
          firstName: 'Dr. Emily',
          lastName: 'Chen',
          specialization: 'Internal Medicine',
          department: 'Primary Care',
        },
        appointmentDate: '2024-02-15',
        startTime: '09:00',
        endTime: '09:30',
        duration: 30,
        type: 'IN_PERSON',
        status: 'SCHEDULED',
        reason: 'Annual checkup',
        notes: 'Patient requested early morning appointment',
        location: 'Room 101',
        reminderSent: false,
        priority: 'MEDIUM',
        followUpRequired: false,
        createdAt: '2024-02-01T10:00:00Z',
        updatedAt: '2024-02-01T10:00:00Z',
      },
      {
        id: '2',
        patientId: 'patient-2',
        providerId: 'provider-2',
        patient: {
          id: 'patient-2',
          firstName: 'Michael',
          lastName: 'Brown',
          email: 'michael.brown@email.com',
          phone: '(555) 234-5678',
          dateOfBirth: '1978-07-22',
        },
        provider: {
          id: 'provider-2',
          firstName: 'Dr. James',
          lastName: 'Wilson',
          specialization: 'Cardiology',
          department: 'Cardiology',
        },
        appointmentDate: '2024-02-15',
        startTime: '14:00',
        endTime: '14:45',
        duration: 45,
        type: 'TELEMEDICINE',
        status: 'CONFIRMED',
        reason: 'Follow-up consultation',
        notes: 'Review recent test results',
        meetingLink: 'https://meet.example.com/abc123',
        reminderSent: true,
        priority: 'HIGH',
        followUpRequired: true,
        followUpDate: '2024-03-15',
        createdAt: '2024-02-05T14:30:00Z',
        updatedAt: '2024-02-10T09:15:00Z',
      },
      {
        id: '3',
        patientId: 'patient-3',
        providerId: 'provider-1',
        patient: {
          id: 'patient-3',
          firstName: 'Emily',
          lastName: 'Davis',
          email: 'emily.davis@email.com',
          phone: '(555) 345-6789',
          dateOfBirth: '1992-11-08',
        },
        provider: {
          id: 'provider-1',
          firstName: 'Dr. Emily',
          lastName: 'Chen',
          specialization: 'Internal Medicine',
          department: 'Primary Care',
        },
        appointmentDate: '2024-02-16',
        startTime: '10:30',
        endTime: '11:00',
        duration: 30,
        type: 'IN_PERSON',
        status: 'COMPLETED',
        reason: 'Routine physical',
        location: 'Room 102',
        reminderSent: true,
        priority: 'LOW',
        followUpRequired: false,
        createdAt: '2024-02-08T11:20:00Z',
        updatedAt: '2024-02-16T11:00:00Z',
      },
    ];

    return {
      appointments: mockAppointments,
      total: mockAppointments.length,
      page: params.page || 1,
      totalPages: Math.ceil(mockAppointments.length / (params.limit || 10)),
    };
  }

  /**
   * Get mock appointment statistics
   */
  private getMockStats(): AppointmentStats {
    return {
      total: 156,
      scheduled: 45,
      confirmed: 32,
      inProgress: 3,
      completed: 68,
      cancelled: 7,
      noShow: 1,
      todayTotal: 12,
      weekTotal: 47,
      monthTotal: 156,
      averageDuration: 35,
      mostCommonType: 'IN_PERSON',
      mostCommonReason: 'Follow-up consultation',
      upcomingCount: 77,
      overdueCount: 2,
    };
  }

  /**
   * Get mock provider availability
   */
  private getMockAvailability(providerId: string, date: string): ProviderAvailability {
    const timeSlots: TimeSlot[] = [
      { startTime: '09:00', endTime: '09:30', available: true, duration: 30 },
      { startTime: '09:30', endTime: '10:00', available: false, appointmentId: '1', duration: 30 },
      { startTime: '10:00', endTime: '10:30', available: true, duration: 30 },
      { startTime: '10:30', endTime: '11:00', available: true, duration: 30 },
      { startTime: '11:00', endTime: '11:30', available: false, appointmentId: '2', duration: 30 },
      { startTime: '14:00', endTime: '14:30', available: true, duration: 30 },
      { startTime: '14:30', endTime: '15:00', available: true, duration: 30 },
      { startTime: '15:00', endTime: '15:30', available: false, appointmentId: '3', duration: 30 },
    ];

    return {
      providerId,
      date,
      timeSlots,
      totalSlots: timeSlots.length,
      availableSlots: timeSlots.filter(slot => slot.available).length,
      bookedSlots: timeSlots.filter(slot => !slot.available).length,
    };
  }

  /**
   * Get mock upcoming appointments
   */
  private getMockUpcomingAppointments(): Appointment[] {
    return [
      {
        id: '4',
        patientId: 'patient-4',
        providerId: 'provider-1',
        patient: {
          id: 'patient-4',
          firstName: 'David',
          lastName: 'Wilson',
          email: 'david.wilson@email.com',
          phone: '(555) 456-7890',
          dateOfBirth: '1965-05-30',
        },
        provider: {
          id: 'provider-1',
          firstName: 'Dr. Emily',
          lastName: 'Chen',
          specialization: 'Internal Medicine',
          department: 'Primary Care',
        },
        appointmentDate: '2024-02-20',
        startTime: '09:00',
        endTime: '09:30',
        duration: 30,
        type: 'IN_PERSON',
        status: 'SCHEDULED',
        reason: 'Blood pressure check',
        location: 'Room 101',
        reminderSent: false,
        priority: 'MEDIUM',
        followUpRequired: false,
        createdAt: '2024-02-15T16:00:00Z',
        updatedAt: '2024-02-15T16:00:00Z',
      },
    ];
  }

  /**
   * Get mock today's appointments
   */
  private getMockTodaysAppointments(): Appointment[] {
    return [
      {
        id: '5',
        patientId: 'patient-5',
        providerId: 'provider-2',
        patient: {
          id: 'patient-5',
          firstName: 'Lisa',
          lastName: 'Anderson',
          email: 'lisa.anderson@email.com',
          phone: '(555) 567-8901',
          dateOfBirth: '1980-09-12',
        },
        provider: {
          id: 'provider-2',
          firstName: 'Dr. James',
          lastName: 'Wilson',
          specialization: 'Cardiology',
          department: 'Cardiology',
        },
        appointmentDate: new Date().toISOString().split('T')[0],
        startTime: '10:00',
        endTime: '10:45',
        duration: 45,
        type: 'TELEMEDICINE',
        status: 'CONFIRMED',
        reason: 'Cardiac consultation',
        meetingLink: 'https://meet.example.com/xyz789',
        reminderSent: true,
        priority: 'HIGH',
        followUpRequired: true,
        followUpDate: '2024-03-20',
        createdAt: '2024-02-18T08:30:00Z',
        updatedAt: '2024-02-18T08:30:00Z',
      },
    ];
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const appointmentService = AppointmentService.getInstance();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export const getAppointments = (params?: AppointmentSearchParams): Promise<AppointmentListResponse> =>
  appointmentService.getAppointments(params);

export const getAppointmentById = (id: string): Promise<Appointment> =>
  appointmentService.getAppointmentById(id);

export const createAppointment = (data: AppointmentCreateData): Promise<Appointment> =>
  appointmentService.createAppointment(data);

export const updateAppointment = (id: string, data: AppointmentUpdateData): Promise<Appointment> =>
  appointmentService.updateAppointment(id, data);

export const cancelAppointment = (
  id: string,
  reason?: string,
  notifyPatient?: boolean
): Promise<Appointment> => appointmentService.cancelAppointment(id, reason, notifyPatient);

export const getAvailableSlots = (params: AvailabilitySearchParams): Promise<AvailableSlot[]> =>
  appointmentService.getAvailableSlots(params);

export const getTodayAppointments = (providerId?: string): Promise<Appointment[]> =>
  appointmentService.getTodayAppointments(providerId);

export const getUpcomingAppointments = (days?: number, providerId?: string): Promise<Appointment[]> =>
  appointmentService.getUpcomingAppointments(days, providerId);

// ============================================================================
// EXPORTS
// ============================================================================

export default appointmentService;