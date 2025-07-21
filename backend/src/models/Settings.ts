/**
 * ============================================================================
 * NOVA CHECK EHR - SETTINGS MODEL
 * ============================================================================
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { AppError, ValidationError } from '../utils/errors';
import { generateId } from '../utils/helpers';
import { CacheService } from '../services/cacheService';

// ============================================================================
// INTERFACES
// ============================================================================

export interface SettingWithRelations {
  id: string;
  key: string;
  value: any;
  type: string;
  category: string;
  description?: string;
  isPublic: boolean;
  isEditable: boolean;
  userId?: string;
  organizationId?: string;
  validationRules?: any;
  defaultValue?: any;
  createdAt: Date;
  updatedAt: Date;
  user?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}

export interface SettingsSearchFilters {
  category?: string;
  type?: string;
  isPublic?: boolean;
  isEditable?: boolean;
  userId?: string;
  organizationId?: string;
  search?: string;
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'auto';
  language: string;
  timezone: string;
  dateFormat: string;
  timeFormat: '12h' | '24h';
  notifications: {
    email: boolean;
    sms: boolean;
    push: boolean;
    appointmentReminders: boolean;
    systemAlerts: boolean;
    marketingEmails: boolean;
  };
  dashboard: {
    layout: string;
    widgets: string[];
    refreshInterval: number;
  };
  calendar: {
    defaultView: 'day' | 'week' | 'month';
    workingHours: {
      start: string;
      end: string;
    };
    workingDays: number[];
  };
  privacy: {
    showOnlineStatus: boolean;
    allowDirectMessages: boolean;
    shareActivityStatus: boolean;
  };
}

export interface SystemSettings {
  general: {
    organizationName: string;
    organizationLogo?: string;
    contactEmail: string;
    contactPhone: string;
    address: {
      street: string;
      city: string;
      state: string;
      zipCode: string;
      country: string;
    };
    timezone: string;
    currency: string;
    language: string;
  };
  security: {
    passwordPolicy: {
      minLength: number;
      requireUppercase: boolean;
      requireLowercase: boolean;
      requireNumbers: boolean;
      requireSpecialChars: boolean;
      expirationDays: number;
    };
    sessionTimeout: number;
    maxLoginAttempts: number;
    lockoutDuration: number;
    twoFactorRequired: boolean;
    ipWhitelist: string[];
  };
  appointments: {
    defaultDuration: number;
    bufferTime: number;
    maxAdvanceBooking: number;
    cancellationPolicy: {
      allowCancellation: boolean;
      minimumNotice: number;
      penaltyFee: number;
    };
    reminderSettings: {
      email: {
        enabled: boolean;
        timing: number[];
      };
      sms: {
        enabled: boolean;
        timing: number[];
      };
    };
  };
  billing: {
    taxRate: number;
    currency: string;
    paymentMethods: string[];
    invoiceSettings: {
      autoGenerate: boolean;
      dueDate: number;
      lateFeePenalty: number;
      reminderSchedule: number[];
    };
  };
  integrations: {
    email: {
      provider: string;
      settings: any;
    };
    sms: {
      provider: string;
      settings: any;
    };
    payment: {
      provider: string;
      settings: any;
    };
    calendar: {
      provider: string;
      settings: any;
    };
  };
}

export interface SettingValidationRule {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'email' | 'url' | 'phone';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  enum?: any[];
  custom?: (value: any) => boolean | string;
}

export interface SettingTemplate {
  key: string;
  category: string;
  type: string;
  description: string;
  defaultValue: any;
  validationRules: SettingValidationRule;
  isPublic: boolean;
  isEditable: boolean;
}

export interface SettingsExport {
  version: string;
  exportedAt: Date;
  settings: {
    system: any;
    users: { [userId: string]: any };
  };
}

// ============================================================================
// SETTINGS MODEL CLASS
// ============================================================================

export class SettingsModel {
  private prisma: PrismaClient;
  private cacheService: CacheService;
  private readonly CACHE_TTL = 3600; // 1 hour

  constructor(prisma: PrismaClient, cacheService: CacheService) {
    this.prisma = prisma;
    this.cacheService = cacheService;
  }

  /**
   * Get setting by key
   */
  async getSetting(key: string, userId?: string, organizationId?: string): Promise<SettingWithRelations | null> {
    try {
      const cacheKey = `setting_${key}_${userId || 'system'}_${organizationId || 'global'}`;
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const setting = await this.prisma.setting.findFirst({
        where: {
          key,
          ...(userId && { userId }),
          ...(organizationId && { organizationId }),
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      if (setting) {
        // Parse JSON values
        const parsedSetting = {
          ...setting,
          value: this.parseSettingValue(setting.value, setting.type),
          validationRules: setting.validationRules ? JSON.parse(setting.validationRules as string) : null,
          defaultValue: setting.defaultValue ? this.parseSettingValue(setting.defaultValue, setting.type) : null,
        };

        // Cache the result
        await this.cacheService.set(cacheKey, JSON.stringify(parsedSetting), this.CACHE_TTL);
        return parsedSetting;
      }

      return null;
    } catch (error) {
      logger.error('Error getting setting', {
        component: 'SettingsModel',
        error: (error as Error).message,
        key,
        userId,
        organizationId,
      });
      throw new AppError('Failed to get setting', 500);
    }
  }

  /**
   * Get setting value (simplified)
   */
  async getSettingValue(key: string, userId?: string, organizationId?: string): Promise<any> {
    const setting = await this.getSetting(key, userId, organizationId);
    return setting?.value || null;
  }

  /**
   * Set setting value
   */
  async setSetting(
    key: string,
    value: any,
    options: {
      type?: string;
      category?: string;
      description?: string;
      isPublic?: boolean;
      isEditable?: boolean;
      userId?: string;
      organizationId?: string;
      validationRules?: SettingValidationRule;
    } = {}
  ): Promise<SettingWithRelations> {
    try {
      // Validate the value if validation rules exist
      if (options.validationRules) {
        const validationResult = this.validateSettingValue(value, options.validationRules);
        if (validationResult !== true) {
          throw new ValidationError(validationResult);
        }
      }

      // Serialize the value based on type
      const serializedValue = this.serializeSettingValue(value, options.type || 'string');
      const serializedValidationRules = options.validationRules ? JSON.stringify(options.validationRules) : null;

      const setting = await this.prisma.setting.upsert({
        where: {
          key_userId_organizationId: {
            key,
            userId: options.userId || null,
            organizationId: options.organizationId || null,
          },
        },
        update: {
          value: serializedValue,
          type: options.type || 'string',
          category: options.category || 'general',
          description: options.description,
          isPublic: options.isPublic ?? false,
          isEditable: options.isEditable ?? true,
          validationRules: serializedValidationRules,
          updatedAt: new Date(),
        },
        create: {
          id: generateId(),
          key,
          value: serializedValue,
          type: options.type || 'string',
          category: options.category || 'general',
          description: options.description,
          isPublic: options.isPublic ?? false,
          isEditable: options.isEditable ?? true,
          userId: options.userId,
          organizationId: options.organizationId,
          validationRules: serializedValidationRules,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      // Clear cache
      const cacheKey = `setting_${key}_${options.userId || 'system'}_${options.organizationId || 'global'}`;
      await this.cacheService.del(cacheKey);

      // Parse and return the setting
      const parsedSetting = {
        ...setting,
        value: this.parseSettingValue(setting.value, setting.type),
        validationRules: setting.validationRules ? JSON.parse(setting.validationRules as string) : null,
        defaultValue: setting.defaultValue ? this.parseSettingValue(setting.defaultValue, setting.type) : null,
      };

      logger.info('Setting updated', {
        component: 'SettingsModel',
        key,
        userId: options.userId,
        organizationId: options.organizationId,
      });

      return parsedSetting;
    } catch (error) {
      logger.error('Error setting value', {
        component: 'SettingsModel',
        error: (error as Error).message,
        key,
        options,
      });
      
      if (error instanceof ValidationError) {
        throw error;
      }
      
      throw new AppError('Failed to set setting', 500);
    }
  }

  /**
   * Get multiple settings
   */
  async getSettings(filters: SettingsSearchFilters = {}): Promise<SettingWithRelations[]> {
    try {
      const whereClause: any = {};

      if (filters.category) {
        whereClause.category = filters.category;
      }

      if (filters.type) {
        whereClause.type = filters.type;
      }

      if (filters.isPublic !== undefined) {
        whereClause.isPublic = filters.isPublic;
      }

      if (filters.isEditable !== undefined) {
        whereClause.isEditable = filters.isEditable;
      }

      if (filters.userId) {
        whereClause.userId = filters.userId;
      }

      if (filters.organizationId) {
        whereClause.organizationId = filters.organizationId;
      }

      if (filters.search) {
        whereClause.OR = [
          { key: { contains: filters.search, mode: 'insensitive' } },
          { description: { contains: filters.search, mode: 'insensitive' } },
        ];
      }

      const settings = await this.prisma.setting.findMany({
        where: whereClause,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        orderBy: [
          { category: 'asc' },
          { key: 'asc' },
        ],
      });

      // Parse all settings
      return settings.map(setting => ({
        ...setting,
        value: this.parseSettingValue(setting.value, setting.type),
        validationRules: setting.validationRules ? JSON.parse(setting.validationRules as string) : null,
        defaultValue: setting.defaultValue ? this.parseSettingValue(setting.defaultValue, setting.type) : null,
      }));
    } catch (error) {
      logger.error('Error getting settings', {
        component: 'SettingsModel',
        error: (error as Error).message,
        filters,
      });
      throw new AppError('Failed to get settings', 500);
    }
  }

  /**
   * Get user preferences
   */
  async getUserPreferences(userId: string): Promise<UserPreferences> {
    try {
      const cacheKey = `user_preferences_${userId}`;
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const settings = await this.getSettings({
        userId,
        category: 'user_preferences',
      });

      // Build preferences object with defaults
      const preferences: UserPreferences = {
        theme: 'light',
        language: 'en',
        timezone: 'UTC',
        dateFormat: 'MM/DD/YYYY',
        timeFormat: '12h',
        notifications: {
          email: true,
          sms: false,
          push: true,
          appointmentReminders: true,
          systemAlerts: true,
          marketingEmails: false,
        },
        dashboard: {
          layout: 'default',
          widgets: ['appointments', 'patients', 'revenue'],
          refreshInterval: 300000, // 5 minutes
        },
        calendar: {
          defaultView: 'week',
          workingHours: {
            start: '09:00',
            end: '17:00',
          },
          workingDays: [1, 2, 3, 4, 5], // Monday to Friday
        },
        privacy: {
          showOnlineStatus: true,
          allowDirectMessages: true,
          shareActivityStatus: false,
        },
      };

      // Override with user settings
      settings.forEach(setting => {
        const keyPath = setting.key.replace('user_preferences.', '').split('.');
        this.setNestedValue(preferences, keyPath, setting.value);
      });

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(preferences), this.CACHE_TTL);

      return preferences;
    } catch (error) {
      logger.error('Error getting user preferences', {
        component: 'SettingsModel',
        error: (error as Error).message,
        userId,
      });
      throw new AppError('Failed to get user preferences', 500);
    }
  }

  /**
   * Update user preferences
   */
  async updateUserPreferences(userId: string, preferences: Partial<UserPreferences>): Promise<UserPreferences> {
    try {
      // Flatten preferences object into individual settings
      const flattenedSettings = this.flattenObject(preferences, 'user_preferences');

      // Update each setting
      await Promise.all(
        Object.entries(flattenedSettings).map(([key, value]) =>
          this.setSetting(key, value, {
            type: this.inferType(value),
            category: 'user_preferences',
            userId,
            isPublic: false,
            isEditable: true,
          })
        )
      );

      // Clear cache
      const cacheKey = `user_preferences_${userId}`;
      await this.cacheService.del(cacheKey);

      // Return updated preferences
      return this.getUserPreferences(userId);
    } catch (error) {
      logger.error('Error updating user preferences', {
        component: 'SettingsModel',
        error: (error as Error).message,
        userId,
        preferences,
      });
      throw new AppError('Failed to update user preferences', 500);
    }
  }

  /**
   * Get system settings
   */
  async getSystemSettings(): Promise<SystemSettings> {
    try {
      const cacheKey = 'system_settings';
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const settings = await this.getSettings({
        category: 'system',
      });

      // Build system settings object with defaults
      const systemSettings: SystemSettings = {
        general: {
          organizationName: 'Nova Check EHR',
          contactEmail: 'contact@novacheck.com',
          contactPhone: '+1-555-0123',
          address: {
            street: '123 Healthcare Ave',
            city: 'Medical City',
            state: 'CA',
            zipCode: '90210',
            country: 'USA',
          },
          timezone: 'America/Los_Angeles',
          currency: 'USD',
          language: 'en',
        },
        security: {
          passwordPolicy: {
            minLength: 8,
            requireUppercase: true,
            requireLowercase: true,
            requireNumbers: true,
            requireSpecialChars: true,
            expirationDays: 90,
          },
          sessionTimeout: 3600000, // 1 hour
          maxLoginAttempts: 5,
          lockoutDuration: 900000, // 15 minutes
          twoFactorRequired: false,
          ipWhitelist: [],
        },
        appointments: {
          defaultDuration: 30,
          bufferTime: 15,
          maxAdvanceBooking: 90,
          cancellationPolicy: {
            allowCancellation: true,
            minimumNotice: 24,
            penaltyFee: 0,
          },
          reminderSettings: {
            email: {
              enabled: true,
              timing: [24, 2], // 24 hours and 2 hours before
            },
            sms: {
              enabled: false,
              timing: [2], // 2 hours before
            },
          },
        },
        billing: {
          taxRate: 0.0875, // 8.75%
          currency: 'USD',
          paymentMethods: ['cash', 'card', 'check', 'insurance'],
          invoiceSettings: {
            autoGenerate: true,
            dueDate: 30,
            lateFeePenalty: 5.0,
            reminderSchedule: [7, 14, 30], // Days after due date
          },
        },
        integrations: {
          email: {
            provider: 'smtp',
            settings: {},
          },
          sms: {
            provider: 'twilio',
            settings: {},
          },
          payment: {
            provider: 'stripe',
            settings: {},
          },
          calendar: {
            provider: 'internal',
            settings: {},
          },
        },
      };

      // Override with stored settings
      settings.forEach(setting => {
        const keyPath = setting.key.replace('system.', '').split('.');
        this.setNestedValue(systemSettings, keyPath, setting.value);
      });

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(systemSettings), this.CACHE_TTL);

      return systemSettings;
    } catch (error) {
      logger.error('Error getting system settings', {
        component: 'SettingsModel',
        error: (error as Error).message,
      });
      throw new AppError('Failed to get system settings', 500);
    }
  }

  /**
   * Update system settings
   */
  async updateSystemSettings(settings: Partial<SystemSettings>): Promise<SystemSettings> {
    try {
      // Flatten settings object into individual settings
      const flattenedSettings = this.flattenObject(settings, 'system');

      // Update each setting
      await Promise.all(
        Object.entries(flattenedSettings).map(([key, value]) =>
          this.setSetting(key, value, {
            type: this.inferType(value),
            category: 'system',
            isPublic: false,
            isEditable: true,
          })
        )
      );

      // Clear cache
      await this.cacheService.del('system_settings');

      logger.info('System settings updated', {
        component: 'SettingsModel',
        settingsCount: Object.keys(flattenedSettings).length,
      });

      // Return updated settings
      return this.getSystemSettings();
    } catch (error) {
      logger.error('Error updating system settings', {
        component: 'SettingsModel',
        error: (error as Error).message,
        settings,
      });
      throw new AppError('Failed to update system settings', 500);
    }
  }

  /**
   * Delete setting
   */
  async deleteSetting(key: string, userId?: string, organizationId?: string): Promise<void> {
    try {
      const setting = await this.prisma.setting.findFirst({
        where: {
          key,
          ...(userId && { userId }),
          ...(organizationId && { organizationId }),
        },
      });

      if (!setting) {
        throw new AppError('Setting not found', 404);
      }

      if (!setting.isEditable) {
        throw new AppError('Setting is not editable', 400);
      }

      await this.prisma.setting.delete({
        where: { id: setting.id },
      });

      // Clear cache
      const cacheKey = `setting_${key}_${userId || 'system'}_${organizationId || 'global'}`;
      await this.cacheService.del(cacheKey);

      logger.info('Setting deleted', {
        component: 'SettingsModel',
        key,
        userId,
        organizationId,
      });
    } catch (error) {
      logger.error('Error deleting setting', {
        component: 'SettingsModel',
        error: (error as Error).message,
        key,
        userId,
        organizationId,
      });
      
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError('Failed to delete setting', 500);
    }
  }

  /**
   * Reset settings to defaults
   */
  async resetSettings(category?: string, userId?: string, organizationId?: string): Promise<void> {
    try {
      const whereClause: any = {
        isEditable: true,
        ...(category && { category }),
        ...(userId && { userId }),
        ...(organizationId && { organizationId }),
      };

      await this.prisma.setting.deleteMany({
        where: whereClause,
      });

      // Clear relevant caches
      if (userId) {
        await this.cacheService.del(`user_preferences_${userId}`);
      }
      if (!userId && !organizationId) {
        await this.cacheService.del('system_settings');
      }

      logger.info('Settings reset', {
        component: 'SettingsModel',
        category,
        userId,
        organizationId,
      });
    } catch (error) {
      logger.error('Error resetting settings', {
        component: 'SettingsModel',
        error: (error as Error).message,
        category,
        userId,
        organizationId,
      });
      throw new AppError('Failed to reset settings', 500);
    }
  }

  /**
   * Export settings
   */
  async exportSettings(includeUserSettings = false): Promise<SettingsExport> {
    try {
      const systemSettings = await this.getSettings({
        category: 'system',
      });

      const exportData: SettingsExport = {
        version: '1.0.0',
        exportedAt: new Date(),
        settings: {
          system: this.settingsArrayToObject(systemSettings),
          users: {},
        },
      };

      if (includeUserSettings) {
        const userSettings = await this.getSettings({
          category: 'user_preferences',
        });

        // Group by user ID
        const userSettingsMap = new Map<string, any[]>();
        userSettings.forEach(setting => {
          if (setting.userId) {
            if (!userSettingsMap.has(setting.userId)) {
              userSettingsMap.set(setting.userId, []);
            }
            userSettingsMap.get(setting.userId)!.push(setting);
          }
        });

        // Convert to object format
        userSettingsMap.forEach((settings, userId) => {
          exportData.settings.users[userId] = this.settingsArrayToObject(settings);
        });
      }

      return exportData;
    } catch (error) {
      logger.error('Error exporting settings', {
        component: 'SettingsModel',
        error: (error as Error).message,
        includeUserSettings,
      });
      throw new AppError('Failed to export settings', 500);
    }
  }

  /**
   * Import settings
   */
  async importSettings(settingsData: SettingsExport, overwrite = false): Promise<void> {
    try {
      // Import system settings
      if (settingsData.settings.system) {
        for (const [key, value] of Object.entries(settingsData.settings.system)) {
          const existingSetting = await this.getSetting(key);
          
          if (!existingSetting || overwrite) {
            await this.setSetting(key, value, {
              type: this.inferType(value),
              category: 'system',
              isPublic: false,
              isEditable: true,
            });
          }
        }
      }

      // Import user settings
      if (settingsData.settings.users) {
        for (const [userId, userSettings] of Object.entries(settingsData.settings.users)) {
          for (const [key, value] of Object.entries(userSettings)) {
            const existingSetting = await this.getSetting(key, userId);
            
            if (!existingSetting || overwrite) {
              await this.setSetting(key, value, {
                type: this.inferType(value),
                category: 'user_preferences',
                userId,
                isPublic: false,
                isEditable: true,
              });
            }
          }
        }
      }

      logger.info('Settings imported', {
        component: 'SettingsModel',
        version: settingsData.version,
        overwrite,
      });
    } catch (error) {
      logger.error('Error importing settings', {
        component: 'SettingsModel',
        error: (error as Error).message,
        overwrite,
      });
      throw new AppError('Failed to import settings', 500);
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Parse setting value based on type
   */
  private parseSettingValue(value: any, type: string): any {
    if (value === null || value === undefined) {
      return value;
    }

    try {
      switch (type) {
        case 'boolean':
          return typeof value === 'boolean' ? value : value === 'true';
        case 'number':
          return typeof value === 'number' ? value : parseFloat(value);
        case 'array':
        case 'object':
          return typeof value === 'string' ? JSON.parse(value) : value;
        case 'string':
        default:
          return String(value);
      }
    } catch (error) {
      logger.warn('Error parsing setting value', {
        component: 'SettingsModel',
        value,
        type,
        error: (error as Error).message,
      });
      return value;
    }
  }

  /**
   * Serialize setting value for storage
   */
  private serializeSettingValue(value: any, type: string): string {
    if (value === null || value === undefined) {
      return '';
    }

    switch (type) {
      case 'array':
      case 'object':
        return JSON.stringify(value);
      default:
        return String(value);
    }
  }

  /**
   * Validate setting value
   */
  private validateSettingValue(value: any, rules: SettingValidationRule): true | string {
    if (rules.required && (value === null || value === undefined || value === '')) {
      return 'Value is required';
    }

    if (value === null || value === undefined) {
      return true;
    }

    switch (rules.type) {
      case 'string':
        if (typeof value !== 'string') {
          return 'Value must be a string';
        }
        if (rules.minLength && value.length < rules.minLength) {
          return `Value must be at least ${rules.minLength} characters`;
        }
        if (rules.maxLength && value.length > rules.maxLength) {
          return `Value must be no more than ${rules.maxLength} characters`;
        }
        if (rules.pattern && !new RegExp(rules.pattern).test(value)) {
          return 'Value does not match required pattern';
        }
        break;

      case 'number':
        const numValue = typeof value === 'number' ? value : parseFloat(value);
        if (isNaN(numValue)) {
          return 'Value must be a number';
        }
        if (rules.min !== undefined && numValue < rules.min) {
          return `Value must be at least ${rules.min}`;
        }
        if (rules.max !== undefined && numValue > rules.max) {
          return `Value must be no more than ${rules.max}`;
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          return 'Value must be a boolean';
        }
        break;

      case 'email':
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(String(value))) {
          return 'Value must be a valid email address';
        }
        break;

      case 'url':
        try {
          new URL(String(value));
        } catch {
          return 'Value must be a valid URL';
        }
        break;
    }

    if (rules.enum && !rules.enum.includes(value)) {
      return `Value must be one of: ${rules.enum.join(', ')}`;
    }

    if (rules.custom) {
      const customResult = rules.custom(value);
      if (customResult !== true) {
        return typeof customResult === 'string' ? customResult : 'Value failed custom validation';
      }
    }

    return true;
  }

  /**
   * Infer type from value
   */
  private inferType(value: any): string {
    if (Array.isArray(value)) {
      return 'array';
    }
    if (value !== null && typeof value === 'object') {
      return 'object';
    }
    return typeof value;
  }

  /**
   * Flatten nested object into dot notation
   */
  private flattenObject(obj: any, prefix = ''): { [key: string]: any } {
    const flattened: { [key: string]: any } = {};

    Object.keys(obj).forEach(key => {
      const value = obj[key];
      const newKey = prefix ? `${prefix}.${key}` : key;

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(flattened, this.flattenObject(value, newKey));
      } else {
        flattened[newKey] = value;
      }
    });

    return flattened;
  }

  /**
   * Set nested value in object
   */
  private setNestedValue(obj: any, path: string[], value: any): void {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    current[path[path.length - 1]] = value;
  }

  /**
   * Convert settings array to object
   */
  private settingsArrayToObject(settings: SettingWithRelations[]): { [key: string]: any } {
    const obj: { [key: string]: any } = {};
    settings.forEach(setting => {
      obj[setting.key] = setting.value;
    });
    return obj;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default SettingsModel;