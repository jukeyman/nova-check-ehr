import { apiService, ApiResponse } from './api';

// ============================================================================
// TYPES
// ============================================================================

export interface UserSettings {
  id: string;
  userId: string;
  theme: 'light' | 'dark' | 'system';
  colorScheme: 'blue' | 'green' | 'purple' | 'orange' | 'red';
  language: string;
  timezone: string;
  dateFormat: string;
  timeFormat: '12h' | '24h';
  currency: string;
  notifications: NotificationSettings;
  dashboard: DashboardSettings;
  calendar: CalendarSettings;
  accessibility: AccessibilitySettings;
  privacy: PrivacySettings;
  integrations: IntegrationSettings;
  updatedAt: string;
}

export interface NotificationSettings {
  email: {
    appointments: boolean;
    reminders: boolean;
    cancellations: boolean;
    newPatients: boolean;
    labResults: boolean;
    billing: boolean;
    system: boolean;
    marketing: boolean;
  };
  push: {
    appointments: boolean;
    reminders: boolean;
    emergencies: boolean;
    messages: boolean;
    system: boolean;
  };
  sms: {
    appointments: boolean;
    reminders: boolean;
    emergencies: boolean;
    twoFactor: boolean;
  };
  inApp: {
    appointments: boolean;
    messages: boolean;
    system: boolean;
    updates: boolean;
  };
  frequency: {
    digest: 'immediate' | 'hourly' | 'daily' | 'weekly' | 'never';
    reminders: number; // hours before appointment
    followUps: number; // days after appointment
  };
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: string;
  };
}

export interface DashboardSettings {
  layout: 'default' | 'compact' | 'detailed';
  widgets: {
    id: string;
    type: string;
    position: { x: number; y: number; w: number; h: number };
    visible: boolean;
    config: Record<string, any>;
  }[];
  defaultView: 'overview' | 'appointments' | 'patients' | 'analytics';
  refreshInterval: number; // seconds
  showWelcome: boolean;
  compactMode: boolean;
}

export interface CalendarSettings {
  defaultView: 'month' | 'week' | 'day' | 'agenda';
  startTime: string;
  endTime: string;
  slotDuration: number; // minutes
  workingDays: number[]; // 0-6, Sunday-Saturday
  showWeekends: boolean;
  timeZone: string;
  firstDayOfWeek: number; // 0-6
  showDeclined: boolean;
  showCancelled: boolean;
  colorCoding: {
    byProvider: boolean;
    byType: boolean;
    byStatus: boolean;
  };
  reminders: {
    enabled: boolean;
    defaultTime: number; // minutes before
    methods: ('email' | 'sms' | 'push')[];
  };
}

export interface AccessibilitySettings {
  highContrast: boolean;
  largeText: boolean;
  reducedMotion: boolean;
  screenReader: boolean;
  keyboardNavigation: boolean;
  focusIndicators: boolean;
  colorBlindness: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';
  fontSize: 'small' | 'medium' | 'large' | 'extra-large';
  lineHeight: 'normal' | 'relaxed' | 'loose';
  letterSpacing: 'normal' | 'wide' | 'wider';
}

export interface PrivacySettings {
  shareAnalytics: boolean;
  shareUsageData: boolean;
  allowCookies: boolean;
  trackingConsent: boolean;
  dataRetention: number; // days
  exportData: boolean;
  deleteAccount: boolean;
  twoFactorAuth: {
    enabled: boolean;
    method: 'sms' | 'email' | 'app';
    backupCodes: string[];
  };
  sessionTimeout: number; // minutes
  ipWhitelist: string[];
  auditLog: boolean;
}

export interface IntegrationSettings {
  calendar: {
    provider: 'google' | 'outlook' | 'apple' | 'none';
    syncEnabled: boolean;
    syncDirection: 'both' | 'to-external' | 'from-external';
    calendarId?: string;
  };
  email: {
    provider: 'gmail' | 'outlook' | 'smtp' | 'none';
    syncEnabled: boolean;
    templates: boolean;
  };
  sms: {
    provider: 'twilio' | 'aws' | 'none';
    enabled: boolean;
    fromNumber?: string;
  };
  payment: {
    provider: 'stripe' | 'square' | 'paypal' | 'none';
    enabled: boolean;
    testMode: boolean;
  };
  lab: {
    provider: string;
    enabled: boolean;
    autoImport: boolean;
  };
  imaging: {
    provider: string;
    enabled: boolean;
    autoImport: boolean;
  };
  pharmacy: {
    provider: string;
    enabled: boolean;
    ePrescribing: boolean;
  };
}

export interface OrganizationSettings {
  id: string;
  name: string;
  logo?: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  contact: {
    phone: string;
    email: string;
    website?: string;
    fax?: string;
  };
  business: {
    taxId: string;
    npi?: string;
    license?: string;
    accreditation?: string[];
  };
  branding: {
    primaryColor: string;
    secondaryColor: string;
    logo?: string;
    favicon?: string;
    customCss?: string;
  };
  features: {
    telemedicine: boolean;
    billing: boolean;
    inventory: boolean;
    lab: boolean;
    imaging: boolean;
    pharmacy: boolean;
    reporting: boolean;
  };
  security: {
    passwordPolicy: {
      minLength: number;
      requireUppercase: boolean;
      requireLowercase: boolean;
      requireNumbers: boolean;
      requireSymbols: boolean;
      expiryDays: number;
    };
    sessionTimeout: number;
    maxLoginAttempts: number;
    lockoutDuration: number;
    twoFactorRequired: boolean;
    ipWhitelist: string[];
    auditLogging: boolean;
  };
  compliance: {
    hipaa: boolean;
    gdpr: boolean;
    hitech: boolean;
    dataRetentionDays: number;
    backupFrequency: 'daily' | 'weekly' | 'monthly';
    encryptionLevel: 'standard' | 'enhanced';
  };
  billing: {
    currency: string;
    taxRate: number;
    paymentTerms: number;
    lateFee: number;
    autoReminders: boolean;
    acceptedPayments: string[];
  };
  scheduling: {
    advanceBookingDays: number;
    cancellationPolicy: number; // hours
    noShowFee: number;
    overbookingAllowed: boolean;
    waitlistEnabled: boolean;
    onlineBooking: boolean;
  };
  updatedAt: string;
}

export interface SystemSettings {
  maintenance: {
    enabled: boolean;
    message: string;
    startTime?: string;
    endTime?: string;
  };
  features: {
    registration: boolean;
    guestAccess: boolean;
    apiAccess: boolean;
    mobileApp: boolean;
    telemedicine: boolean;
  };
  limits: {
    maxUsers: number;
    maxPatients: number;
    maxStorage: number; // GB
    apiRateLimit: number; // requests per minute
  };
  backup: {
    enabled: boolean;
    frequency: 'hourly' | 'daily' | 'weekly';
    retention: number; // days
    location: 'local' | 'cloud';
  };
  monitoring: {
    enabled: boolean;
    alertThreshold: number;
    recipients: string[];
  };
  updates: {
    autoUpdate: boolean;
    channel: 'stable' | 'beta' | 'alpha';
    notifications: boolean;
  };
}

export interface SettingsCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  sections: SettingsSection[];
}

export interface SettingsSection {
  id: string;
  name: string;
  description?: string;
  fields: SettingsField[];
}

export interface SettingsField {
  id: string;
  name: string;
  description?: string;
  type: 'text' | 'email' | 'password' | 'number' | 'boolean' | 'select' | 'multiselect' | 'color' | 'file' | 'textarea';
  value: any;
  defaultValue: any;
  required: boolean;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
  options?: { label: string; value: any }[];
  placeholder?: string;
  helpText?: string;
  disabled?: boolean;
  hidden?: boolean;
  group?: string;
}

// ============================================================================
// SETTINGS SERVICE CLASS
// ============================================================================

export class SettingsService {
  private static instance: SettingsService;

  private constructor() {}

  public static getInstance(): SettingsService {
    if (!SettingsService.instance) {
      SettingsService.instance = new SettingsService();
    }
    return SettingsService.instance;
  }

  // ========================================================================
  // USER SETTINGS
  // ========================================================================

  /**
   * Get user settings
   */
  async getUserSettings(): Promise<UserSettings> {
    const response = await apiService.get<UserSettings>('/settings/user');
    return response.data;
  }

  /**
   * Update user settings
   */
  async updateUserSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
    const response = await apiService.patch<UserSettings>('/settings/user', settings, {
      showSuccessToast: true,
      successMessage: 'Settings updated successfully!',
    });
    return response.data;
  }

  /**
   * Reset user settings to defaults
   */
  async resetUserSettings(): Promise<UserSettings> {
    const response = await apiService.post<UserSettings>('/settings/user/reset', {}, {
      showSuccessToast: true,
      successMessage: 'Settings reset to defaults!',
    });
    return response.data;
  }

  /**
   * Export user settings
   */
  async exportUserSettings(): Promise<Blob> {
    const response = await apiService.get('/settings/user/export', {}, {
      responseType: 'blob',
    });
    return response.data;
  }

  /**
   * Import user settings
   */
  async importUserSettings(file: File): Promise<UserSettings> {
    const formData = new FormData();
    formData.append('settings', file);
    
    const response = await apiService.post<UserSettings>('/settings/user/import', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      showSuccessToast: true,
      successMessage: 'Settings imported successfully!',
    });
    return response.data;
  }

  // ========================================================================
  // NOTIFICATION SETTINGS
  // ========================================================================

  /**
   * Update notification settings
   */
  async updateNotificationSettings(
    settings: Partial<NotificationSettings>
  ): Promise<NotificationSettings> {
    const response = await apiService.patch<NotificationSettings>(
      '/settings/notifications',
      settings,
      {
        showSuccessToast: true,
        successMessage: 'Notification settings updated!',
      }
    );
    return response.data;
  }

  /**
   * Test notification
   */
  async testNotification(
    type: 'email' | 'sms' | 'push',
    message?: string
  ): Promise<void> {
    await apiService.post('/settings/notifications/test', { type, message }, {
      showSuccessToast: true,
      successMessage: 'Test notification sent!',
    });
  }

  /**
   * Get notification history
   */
  async getNotificationHistory(
    limit: number = 50,
    offset: number = 0
  ): Promise<{
    notifications: {
      id: string;
      type: string;
      method: string;
      recipient: string;
      subject: string;
      message: string;
      status: 'sent' | 'failed' | 'pending';
      sentAt: string;
      error?: string;
    }[];
    total: number;
  }> {
    const response = await apiService.get<{
      notifications: {
        id: string;
        type: string;
        method: string;
        recipient: string;
        subject: string;
        message: string;
        status: 'sent' | 'failed' | 'pending';
        sentAt: string;
        error?: string;
      }[];
      total: number;
    }>('/settings/notifications/history', { limit, offset });
    return response.data;
  }

  // ========================================================================
  // ORGANIZATION SETTINGS
  // ========================================================================

  /**
   * Get organization settings
   */
  async getOrganizationSettings(): Promise<OrganizationSettings> {
    const response = await apiService.get<OrganizationSettings>('/settings/organization');
    return response.data;
  }

  /**
   * Update organization settings
   */
  async updateOrganizationSettings(
    settings: Partial<OrganizationSettings>
  ): Promise<OrganizationSettings> {
    const response = await apiService.patch<OrganizationSettings>(
      '/settings/organization',
      settings,
      {
        showSuccessToast: true,
        successMessage: 'Organization settings updated!',
      }
    );
    return response.data;
  }

  /**
   * Upload organization logo
   */
  async uploadOrganizationLogo(file: File): Promise<{ url: string }> {
    const formData = new FormData();
    formData.append('logo', file);
    
    const response = await apiService.post<{ url: string }>(
      '/settings/organization/logo',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        showSuccessToast: true,
        successMessage: 'Logo uploaded successfully!',
      }
    );
    return response.data;
  }

  /**
   * Remove organization logo
   */
  async removeOrganizationLogo(): Promise<void> {
    await apiService.delete('/settings/organization/logo', {
      showSuccessToast: true,
      successMessage: 'Logo removed successfully!',
    });
  }

  // ========================================================================
  // SYSTEM SETTINGS
  // ========================================================================

  /**
   * Get system settings (admin only)
   */
  async getSystemSettings(): Promise<SystemSettings> {
    const response = await apiService.get<SystemSettings>('/settings/system');
    return response.data;
  }

  /**
   * Update system settings (admin only)
   */
  async updateSystemSettings(settings: Partial<SystemSettings>): Promise<SystemSettings> {
    const response = await apiService.patch<SystemSettings>('/settings/system', settings, {
      showSuccessToast: true,
      successMessage: 'System settings updated!',
    });
    return response.data;
  }

  /**
   * Enable maintenance mode
   */
  async enableMaintenanceMode(
    message: string,
    startTime?: string,
    endTime?: string
  ): Promise<void> {
    await apiService.post('/settings/system/maintenance/enable', {
      message,
      startTime,
      endTime,
    }, {
      showSuccessToast: true,
      successMessage: 'Maintenance mode enabled!',
    });
  }

  /**
   * Disable maintenance mode
   */
  async disableMaintenanceMode(): Promise<void> {
    await apiService.post('/settings/system/maintenance/disable', {}, {
      showSuccessToast: true,
      successMessage: 'Maintenance mode disabled!',
    });
  }

  /**
   * Get system status
   */
  async getSystemStatus(): Promise<{
    status: 'healthy' | 'warning' | 'critical';
    uptime: number;
    version: string;
    database: {
      status: 'connected' | 'disconnected';
      responseTime: number;
    };
    storage: {
      used: number;
      total: number;
      percentage: number;
    };
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    cpu: {
      usage: number;
    };
    services: {
      name: string;
      status: 'running' | 'stopped' | 'error';
      lastCheck: string;
    }[];
  }> {
    const response = await apiService.get<{
      status: 'healthy' | 'warning' | 'critical';
      uptime: number;
      version: string;
      database: {
        status: 'connected' | 'disconnected';
        responseTime: number;
      };
      storage: {
        used: number;
        total: number;
        percentage: number;
      };
      memory: {
        used: number;
        total: number;
        percentage: number;
      };
      cpu: {
        usage: number;
      };
      services: {
        name: string;
        status: 'running' | 'stopped' | 'error';
        lastCheck: string;
      }[];
    }>('/settings/system/status');
    return response.data;
  }

  // ========================================================================
  // INTEGRATION SETTINGS
  // ========================================================================

  /**
   * Get available integrations
   */
  async getAvailableIntegrations(): Promise<{
    id: string;
    name: string;
    description: string;
    category: string;
    icon: string;
    status: 'available' | 'connected' | 'error';
    features: string[];
    pricing: {
      free: boolean;
      plans: {
        name: string;
        price: number;
        features: string[];
      }[];
    };
  }[]> {
    const response = await apiService.get<{
      id: string;
      name: string;
      description: string;
      category: string;
      icon: string;
      status: 'available' | 'connected' | 'error';
      features: string[];
      pricing: {
        free: boolean;
        plans: {
          name: string;
          price: number;
          features: string[];
        }[];
      };
    }[]>('/settings/integrations/available');
    return response.data;
  }

  /**
   * Connect integration
   */
  async connectIntegration(
    integrationId: string,
    config: Record<string, any>
  ): Promise<{ success: boolean; redirectUrl?: string }> {
    const response = await apiService.post<{ success: boolean; redirectUrl?: string }>(
      `/settings/integrations/${integrationId}/connect`,
      config,
      {
        showSuccessToast: true,
        successMessage: 'Integration connected successfully!',
      }
    );
    return response.data;
  }

  /**
   * Disconnect integration
   */
  async disconnectIntegration(integrationId: string): Promise<void> {
    await apiService.post(`/settings/integrations/${integrationId}/disconnect`, {}, {
      showSuccessToast: true,
      successMessage: 'Integration disconnected successfully!',
    });
  }

  /**
   * Test integration
   */
  async testIntegration(integrationId: string): Promise<{
    success: boolean;
    message: string;
    details?: Record<string, any>;
  }> {
    const response = await apiService.post<{
      success: boolean;
      message: string;
      details?: Record<string, any>;
    }>(`/settings/integrations/${integrationId}/test`);
    return response.data;
  }

  /**
   * Get integration logs
   */
  async getIntegrationLogs(
    integrationId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{
    logs: {
      id: string;
      level: 'info' | 'warning' | 'error';
      message: string;
      details?: Record<string, any>;
      timestamp: string;
    }[];
    total: number;
  }> {
    const response = await apiService.get<{
      logs: {
        id: string;
        level: 'info' | 'warning' | 'error';
        message: string;
        details?: Record<string, any>;
        timestamp: string;
      }[];
      total: number;
    }>(`/settings/integrations/${integrationId}/logs`, { limit, offset });
    return response.data;
  }

  // ========================================================================
  // SETTINGS SCHEMA
  // ========================================================================

  /**
   * Get settings schema
   */
  async getSettingsSchema(category?: string): Promise<SettingsCategory[]> {
    const response = await apiService.get<SettingsCategory[]>('/settings/schema', { category });
    return response.data;
  }

  /**
   * Validate settings
   */
  async validateSettings(
    category: string,
    settings: Record<string, any>
  ): Promise<{
    valid: boolean;
    errors: {
      field: string;
      message: string;
    }[];
  }> {
    const response = await apiService.post<{
      valid: boolean;
      errors: {
        field: string;
        message: string;
      }[];
    }>('/settings/validate', { category, settings });
    return response.data;
  }

  // ========================================================================
  // BACKUP AND RESTORE
  // ========================================================================

  /**
   * Create settings backup
   */
  async createSettingsBackup(categories?: string[]): Promise<{
    id: string;
    filename: string;
    size: number;
    createdAt: string;
  }> {
    const response = await apiService.post<{
      id: string;
      filename: string;
      size: number;
      createdAt: string;
    }>('/settings/backup', { categories }, {
      showSuccessToast: true,
      successMessage: 'Settings backup created!',
    });
    return response.data;
  }

  /**
   * Get settings backups
   */
  async getSettingsBackups(): Promise<{
    id: string;
    filename: string;
    size: number;
    categories: string[];
    createdAt: string;
  }[]> {
    const response = await apiService.get<{
      id: string;
      filename: string;
      size: number;
      categories: string[];
      createdAt: string;
    }[]>('/settings/backups');
    return response.data;
  }

  /**
   * Download settings backup
   */
  async downloadSettingsBackup(backupId: string): Promise<void> {
    await apiService.downloadFile(`/settings/backups/${backupId}/download`);
  }

  /**
   * Restore settings from backup
   */
  async restoreSettingsBackup(
    backupId: string,
    categories?: string[]
  ): Promise<void> {
    await apiService.post(`/settings/backups/${backupId}/restore`, { categories }, {
      showSuccessToast: true,
      successMessage: 'Settings restored from backup!',
    });
  }

  /**
   * Delete settings backup
   */
  async deleteSettingsBackup(backupId: string): Promise<void> {
    await apiService.delete(`/settings/backups/${backupId}`, {
      showSuccessToast: true,
      successMessage: 'Backup deleted successfully!',
    });
  }

  // ========================================================================
  // AUDIT LOG
  // ========================================================================

  /**
   * Get settings audit log
   */
  async getSettingsAuditLog(
    category?: string,
    userId?: string,
    startDate?: string,
    endDate?: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{
    logs: {
      id: string;
      userId: string;
      userName: string;
      action: 'create' | 'update' | 'delete' | 'reset';
      category: string;
      field?: string;
      oldValue?: any;
      newValue?: any;
      ipAddress: string;
      userAgent: string;
      timestamp: string;
    }[];
    total: number;
  }> {
    const response = await apiService.get<{
      logs: {
        id: string;
        userId: string;
        userName: string;
        action: 'create' | 'update' | 'delete' | 'reset';
        category: string;
        field?: string;
        oldValue?: any;
        newValue?: any;
        ipAddress: string;
        userAgent: string;
        timestamp: string;
      }[];
      total: number;
    }>('/settings/audit-log', {
      category,
      userId,
      startDate,
      endDate,
      limit,
      offset,
    });
    return response.data;
  }

  // ========================================================================
  // FEATURE FLAGS
  // ========================================================================

  /**
   * Get feature flags
   */
  async getFeatureFlags(): Promise<Record<string, boolean>> {
    const response = await apiService.get<Record<string, boolean>>('/settings/feature-flags');
    return response.data;
  }

  /**
   * Update feature flag
   */
  async updateFeatureFlag(flag: string, enabled: boolean): Promise<void> {
    await apiService.patch(`/settings/feature-flags/${flag}`, { enabled }, {
      showSuccessToast: true,
      successMessage: `Feature ${enabled ? 'enabled' : 'disabled'} successfully!`,
    });
  }

  /**
   * Get feature flag usage
   */
  async getFeatureFlagUsage(flag: string): Promise<{
    flag: string;
    enabled: boolean;
    usageCount: number;
    lastUsed?: string;
    users: {
      userId: string;
      userName: string;
      usageCount: number;
      lastUsed: string;
    }[];
  }> {
    const response = await apiService.get<{
      flag: string;
      enabled: boolean;
      usageCount: number;
      lastUsed?: string;
      users: {
        userId: string;
        userName: string;
        usageCount: number;
        lastUsed: string;
      }[];
    }>(`/settings/feature-flags/${flag}/usage`);
    return response.data;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const settingsService = SettingsService.getInstance();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export const getUserSettings = (): Promise<UserSettings> => settingsService.getUserSettings();

export const updateUserSettings = (settings: Partial<UserSettings>): Promise<UserSettings> =>
  settingsService.updateUserSettings(settings);

export const getOrganizationSettings = (): Promise<OrganizationSettings> =>
  settingsService.getOrganizationSettings();

export const updateOrganizationSettings = (
  settings: Partial<OrganizationSettings>
): Promise<OrganizationSettings> => settingsService.updateOrganizationSettings(settings);

export const getSystemSettings = (): Promise<SystemSettings> => settingsService.getSystemSettings();

export const updateSystemSettings = (settings: Partial<SystemSettings>): Promise<SystemSettings> =>
  settingsService.updateSystemSettings(settings);

export const getFeatureFlags = (): Promise<Record<string, boolean>> =>
  settingsService.getFeatureFlags();

// ============================================================================
// EXPORTS
// ============================================================================

export default settingsService;