/**
 * ============================================================================
 * NOVA CHECK EHR - NOTIFICATION MODEL
 * ============================================================================
 */

import { PrismaClient, Notification as PrismaNotification, NotificationType, NotificationStatus, Priority } from '@prisma/client';
import { logger } from '../utils/logger';
import { AppError, NotFoundError, ValidationError } from '../utils/errors';
import { generateUniqueId } from '../utils/generators';
import { formatDate, normalizeEmail, formatPhoneNumber } from '../utils/helpers';
import { NotificationData, EmailData, SMSData } from '../types';

// ============================================================================
// INTERFACES
// ============================================================================

export interface NotificationWithRelations extends PrismaNotification {
  recipient?: any;
  sender?: any;
  relatedAppointment?: any;
  relatedEncounter?: any;
  relatedPatient?: any;
}

export interface NotificationSearchFilters {
  recipientId?: string;
  senderId?: string;
  type?: NotificationType;
  status?: NotificationStatus;
  priority?: Priority;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  isRead?: boolean;
  channel?: string;
}

export interface NotificationStats {
  totalNotifications: number;
  notificationsByType: Record<NotificationType, number>;
  notificationsByStatus: Record<NotificationStatus, number>;
  notificationsByChannel: Record<string, number>;
  deliveryRate: number;
  readRate: number;
  averageDeliveryTime: number;
  failedNotifications: number;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  type: NotificationType;
  subject?: string;
  body: string;
  variables: string[];
  isActive: boolean;
  metadata?: any;
}

export interface NotificationPreferences {
  userId: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  appointmentReminders: boolean;
  labResults: boolean;
  prescriptionUpdates: boolean;
  systemAlerts: boolean;
  marketingEmails: boolean;
  quietHours: {
    enabled: boolean;
    startTime: string;
    endTime: string;
  };
}

export interface BulkNotificationRequest {
  recipientIds: string[];
  type: NotificationType;
  subject?: string;
  message: string;
  channel: string;
  priority?: Priority;
  scheduledAt?: Date;
  templateId?: string;
  templateVariables?: Record<string, any>;
}

// ============================================================================
// NOTIFICATION MODEL CLASS
// ============================================================================

export class NotificationModel {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create a new notification
   */
  async create(notificationData: NotificationData): Promise<NotificationWithRelations> {
    try {
      // Validate required fields
      if (!notificationData.recipientId || !notificationData.message) {
        throw new ValidationError('Missing required fields: recipientId, message');
      }

      // Verify recipient exists
      const recipient = await this.prisma.user.findUnique({
        where: { id: notificationData.recipientId },
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
          notificationPreferences: true,
        },
      });

      if (!recipient) {
        throw new NotFoundError('Recipient not found');
      }

      // Check notification preferences
      const preferences = recipient.notificationPreferences as any;
      if (preferences && !this.shouldSendNotification(notificationData, preferences)) {
        logger.info('Notification skipped due to user preferences', {
          component: 'NotificationModel',
          recipientId: notificationData.recipientId,
          type: notificationData.type,
        });
        
        // Still create the notification but mark it as skipped
        notificationData.status = NotificationStatus.SKIPPED;
      }

      // Generate notification ID
      const notificationId = generateUniqueId('NOT');

      // Create notification
      const notification = await this.prisma.notification.create({
        data: {
          id: generateUniqueId('NOT'),
          notificationId,
          recipientId: notificationData.recipientId,
          senderId: notificationData.senderId,
          type: notificationData.type || NotificationType.SYSTEM,
          status: notificationData.status || NotificationStatus.PENDING,
          priority: notificationData.priority || Priority.MEDIUM,
          channel: notificationData.channel || 'EMAIL',
          subject: notificationData.subject,
          message: notificationData.message,
          scheduledAt: notificationData.scheduledAt || new Date(),
          relatedAppointmentId: notificationData.relatedAppointmentId,
          relatedEncounterId: notificationData.relatedEncounterId,
          relatedPatientId: notificationData.relatedPatientId,
          templateId: notificationData.templateId,
          templateVariables: notificationData.templateVariables || {},
          metadata: notificationData.metadata || {},
        },
        include: {
          recipient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          sender: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              title: true,
            },
          },
          relatedAppointment: {
            select: {
              appointmentId: true,
              scheduledAt: true,
              type: true,
            },
          },
          relatedEncounter: {
            select: {
              encounterId: true,
              startTime: true,
              type: true,
            },
          },
          relatedPatient: {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      logger.info('Notification created successfully', {
        component: 'NotificationModel',
        notificationId: notification.notificationId,
        recipientId: notificationData.recipientId,
        type: notificationData.type,
        channel: notificationData.channel,
      });

      return notification;
    } catch (error) {
      logger.error('Error creating notification', {
        component: 'NotificationModel',
        error: (error as Error).message,
        notificationData: {
          recipientId: notificationData.recipientId,
          type: notificationData.type,
          channel: notificationData.channel,
        },
      });
      throw error;
    }
  }

  /**
   * Find notification by ID
   */
  async findById(id: string, includeRelations: boolean = false): Promise<NotificationWithRelations | null> {
    try {
      const notification = await this.prisma.notification.findUnique({
        where: { id },
        include: includeRelations ? {
          recipient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          sender: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              title: true,
            },
          },
          relatedAppointment: {
            select: {
              appointmentId: true,
              scheduledAt: true,
              type: true,
              patient: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
          relatedEncounter: {
            select: {
              encounterId: true,
              startTime: true,
              type: true,
              patient: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
          relatedPatient: {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
            },
          },
        } : undefined,
      });

      return notification;
    } catch (error) {
      logger.error('Error finding notification by ID', {
        component: 'NotificationModel',
        error: (error as Error).message,
        notificationId: id,
      });
      throw new AppError('Failed to find notification', 500);
    }
  }

  /**
   * Update notification status
   */
  async updateStatus(
    id: string,
    status: NotificationStatus,
    deliveredAt?: Date,
    readAt?: Date,
    errorMessage?: string
  ): Promise<NotificationWithRelations> {
    try {
      const notification = await this.findById(id);
      if (!notification) {
        throw new NotFoundError('Notification not found');
      }

      const updateData: any = {
        status,
        updatedAt: new Date(),
      };

      if (deliveredAt) {
        updateData.deliveredAt = deliveredAt;
      }

      if (readAt) {
        updateData.readAt = readAt;
        updateData.isRead = true;
      }

      if (errorMessage) {
        updateData.errorMessage = errorMessage;
      }

      const updatedNotification = await this.prisma.notification.update({
        where: { id },
        data: updateData,
        include: {
          recipient: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      logger.info('Notification status updated', {
        component: 'NotificationModel',
        notificationId: id,
        status,
        deliveredAt,
        readAt,
      });

      return updatedNotification;
    } catch (error) {
      logger.error('Error updating notification status', {
        component: 'NotificationModel',
        error: (error as Error).message,
        notificationId: id,
        status,
      });
      throw error;
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(id: string, readBy?: string): Promise<NotificationWithRelations> {
    try {
      return await this.updateStatus(id, NotificationStatus.DELIVERED, undefined, new Date());
    } catch (error) {
      logger.error('Error marking notification as read', {
        component: 'NotificationModel',
        error: (error as Error).message,
        notificationId: id,
      });
      throw error;
    }
  }

  /**
   * Mark multiple notifications as read
   */
  async markMultipleAsRead(ids: string[], readBy?: string): Promise<number> {
    try {
      const result = await this.prisma.notification.updateMany({
        where: {
          id: { in: ids },
          isRead: false,
        },
        data: {
          isRead: true,
          readAt: new Date(),
          status: NotificationStatus.DELIVERED,
          updatedAt: new Date(),
        },
      });

      logger.info('Multiple notifications marked as read', {
        component: 'NotificationModel',
        count: result.count,
        readBy,
      });

      return result.count;
    } catch (error) {
      logger.error('Error marking multiple notifications as read', {
        component: 'NotificationModel',
        error: (error as Error).message,
        notificationIds: ids,
      });
      throw new AppError('Failed to mark notifications as read', 500);
    }
  }

  /**
   * Get notifications with filters and pagination
   */
  async findMany(
    filters: NotificationSearchFilters = {},
    page: number = 1,
    limit: number = 20,
    sortBy: string = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<{ notifications: NotificationWithRelations[]; total: number; pages: number; unreadCount: number }> {
    try {
      const skip = (page - 1) * limit;
      
      // Build where clause
      const where: any = {};

      if (filters.recipientId) {
        where.recipientId = filters.recipientId;
      }

      if (filters.senderId) {
        where.senderId = filters.senderId;
      }

      if (filters.type) {
        where.type = filters.type;
      }

      if (filters.status) {
        where.status = filters.status;
      }

      if (filters.priority) {
        where.priority = filters.priority;
      }

      if (filters.channel) {
        where.channel = filters.channel;
      }

      if (filters.isRead !== undefined) {
        where.isRead = filters.isRead;
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
          { subject: { contains: filters.search, mode: 'insensitive' } },
          { message: { contains: filters.search, mode: 'insensitive' } },
          { notificationId: { contains: filters.search, mode: 'insensitive' } },
        ];
      }

      // Get notifications, total count, and unread count
      const [notifications, total, unreadCount] = await Promise.all([
        this.prisma.notification.findMany({
          where,
          include: {
            recipient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            sender: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                title: true,
              },
            },
            relatedAppointment: {
              select: {
                appointmentId: true,
                scheduledAt: true,
                type: true,
              },
            },
          },
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        this.prisma.notification.count({ where }),
        this.prisma.notification.count({
          where: {
            ...where,
            isRead: false,
          },
        }),
      ]);

      const pages = Math.ceil(total / limit);

      return { notifications, total, pages, unreadCount };
    } catch (error) {
      logger.error('Error finding notifications', {
        component: 'NotificationModel',
        error: (error as Error).message,
        filters,
      });
      throw new AppError('Failed to find notifications', 500);
    }
  }

  /**
   * Get unread notifications for a user
   */
  async getUnreadForUser(userId: string, limit: number = 10): Promise<NotificationWithRelations[]> {
    try {
      const notifications = await this.prisma.notification.findMany({
        where: {
          recipientId: userId,
          isRead: false,
          status: {
            in: [NotificationStatus.PENDING, NotificationStatus.DELIVERED],
          },
        },
        include: {
          sender: {
            select: {
              firstName: true,
              lastName: true,
              title: true,
            },
          },
          relatedAppointment: {
            select: {
              appointmentId: true,
              scheduledAt: true,
              type: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: limit,
      });

      return notifications;
    } catch (error) {
      logger.error('Error getting unread notifications for user', {
        component: 'NotificationModel',
        error: (error as Error).message,
        userId,
      });
      throw new AppError('Failed to get unread notifications', 500);
    }
  }

  /**
   * Create bulk notifications
   */
  async createBulk(bulkRequest: BulkNotificationRequest): Promise<{ created: number; failed: number; errors: string[] }> {
    try {
      const results = {
        created: 0,
        failed: 0,
        errors: [] as string[],
      };

      // Process notifications in batches to avoid overwhelming the database
      const batchSize = 50;
      const batches = [];
      
      for (let i = 0; i < bulkRequest.recipientIds.length; i += batchSize) {
        batches.push(bulkRequest.recipientIds.slice(i, i + batchSize));
      }

      for (const batch of batches) {
        try {
          const notifications = batch.map(recipientId => ({
            id: generateUniqueId('NOT'),
            notificationId: generateUniqueId('NOT'),
            recipientId,
            type: bulkRequest.type,
            status: NotificationStatus.PENDING,
            priority: bulkRequest.priority || Priority.MEDIUM,
            channel: bulkRequest.channel,
            subject: bulkRequest.subject,
            message: bulkRequest.message,
            scheduledAt: bulkRequest.scheduledAt || new Date(),
            templateId: bulkRequest.templateId,
            templateVariables: bulkRequest.templateVariables || {},
            metadata: {},
          }));

          await this.prisma.notification.createMany({
            data: notifications,
          });

          results.created += batch.length;
        } catch (error) {
          results.failed += batch.length;
          results.errors.push(`Batch failed: ${(error as Error).message}`);
        }
      }

      logger.info('Bulk notifications created', {
        component: 'NotificationModel',
        totalRequested: bulkRequest.recipientIds.length,
        created: results.created,
        failed: results.failed,
      });

      return results;
    } catch (error) {
      logger.error('Error creating bulk notifications', {
        component: 'NotificationModel',
        error: (error as Error).message,
        recipientCount: bulkRequest.recipientIds.length,
      });
      throw new AppError('Failed to create bulk notifications', 500);
    }
  }

  /**
   * Get pending notifications for processing
   */
  async getPendingNotifications(limit: number = 100): Promise<NotificationWithRelations[]> {
    try {
      const notifications = await this.prisma.notification.findMany({
        where: {
          status: NotificationStatus.PENDING,
          scheduledAt: {
            lte: new Date(),
          },
        },
        include: {
          recipient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              notificationPreferences: true,
            },
          },
          sender: {
            select: {
              firstName: true,
              lastName: true,
              title: true,
            },
          },
        },
        orderBy: {
          priority: 'desc',
        },
        take: limit,
      });

      return notifications;
    } catch (error) {
      logger.error('Error getting pending notifications', {
        component: 'NotificationModel',
        error: (error as Error).message,
      });
      throw new AppError('Failed to get pending notifications', 500);
    }
  }

  /**
   * Get notification statistics
   */
  async getStats(dateFrom?: Date, dateTo?: Date): Promise<NotificationStats> {
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

      const [totalNotifications, notificationsByType, notificationsByStatus, notificationsByChannel, deliveredNotifications, readNotifications, avgDeliveryTime] = await Promise.all([
        this.prisma.notification.count({ where }),
        this.prisma.notification.groupBy({
          by: ['type'],
          where,
          _count: true,
        }),
        this.prisma.notification.groupBy({
          by: ['status'],
          where,
          _count: true,
        }),
        this.prisma.notification.groupBy({
          by: ['channel'],
          where,
          _count: true,
        }),
        this.prisma.notification.count({
          where: {
            ...where,
            status: NotificationStatus.DELIVERED,
          },
        }),
        this.prisma.notification.count({
          where: {
            ...where,
            isRead: true,
          },
        }),
        this.prisma.notification.aggregate({
          where: {
            ...where,
            deliveredAt: { not: null },
          },
          _avg: {
            deliveryTime: true,
          },
        }),
      ]);

      // Format type stats
      const typeStats = notificationsByType.reduce((acc, item) => {
        acc[item.type] = item._count;
        return acc;
      }, {} as Record<NotificationType, number>);

      // Ensure all types are represented
      Object.values(NotificationType).forEach(type => {
        if (!(type in typeStats)) {
          typeStats[type] = 0;
        }
      });

      // Format status stats
      const statusStats = notificationsByStatus.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {} as Record<NotificationStatus, number>);

      // Ensure all statuses are represented
      Object.values(NotificationStatus).forEach(status => {
        if (!(status in statusStats)) {
          statusStats[status] = 0;
        }
      });

      // Format channel stats
      const channelStats = notificationsByChannel.reduce((acc, item) => {
        acc[item.channel] = item._count;
        return acc;
      }, {} as Record<string, number>);

      // Calculate rates
      const deliveryRate = totalNotifications > 0 ? (deliveredNotifications / totalNotifications) * 100 : 0;
      const readRate = deliveredNotifications > 0 ? (readNotifications / deliveredNotifications) * 100 : 0;
      const failedNotifications = statusStats[NotificationStatus.FAILED] || 0;

      return {
        totalNotifications,
        notificationsByType: typeStats,
        notificationsByStatus: statusStats,
        notificationsByChannel: channelStats,
        deliveryRate: Math.round(deliveryRate * 10) / 10,
        readRate: Math.round(readRate * 10) / 10,
        averageDeliveryTime: Math.round(avgDeliveryTime._avg.deliveryTime || 0),
        failedNotifications,
      };
    } catch (error) {
      logger.error('Error getting notification stats', {
        component: 'NotificationModel',
        error: (error as Error).message,
      });
      throw new AppError('Failed to get notification statistics', 500);
    }
  }

  /**
   * Delete old notifications
   */
  async deleteOldNotifications(daysOld: number = 90): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const result = await this.prisma.notification.deleteMany({
        where: {
          createdAt: {
            lt: cutoffDate,
          },
          status: {
            in: [NotificationStatus.DELIVERED, NotificationStatus.FAILED, NotificationStatus.SKIPPED],
          },
        },
      });

      logger.info('Old notifications deleted', {
        component: 'NotificationModel',
        deletedCount: result.count,
        daysOld,
      });

      return result.count;
    } catch (error) {
      logger.error('Error deleting old notifications', {
        component: 'NotificationModel',
        error: (error as Error).message,
        daysOld,
      });
      throw new AppError('Failed to delete old notifications', 500);
    }
  }

  /**
   * Get notification preferences for a user
   */
  async getPreferences(userId: string): Promise<NotificationPreferences | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          notificationPreferences: true,
        },
      });

      return user?.notificationPreferences as NotificationPreferences || null;
    } catch (error) {
      logger.error('Error getting notification preferences', {
        component: 'NotificationModel',
        error: (error as Error).message,
        userId,
      });
      throw new AppError('Failed to get notification preferences', 500);
    }
  }

  /**
   * Update notification preferences for a user
   */
  async updatePreferences(userId: string, preferences: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: {
          notificationPreferences: preferences,
          updatedAt: new Date(),
        },
        select: {
          notificationPreferences: true,
        },
      });

      logger.info('Notification preferences updated', {
        component: 'NotificationModel',
        userId,
        updatedFields: Object.keys(preferences),
      });

      return user.notificationPreferences as NotificationPreferences;
    } catch (error) {
      logger.error('Error updating notification preferences', {
        component: 'NotificationModel',
        error: (error as Error).message,
        userId,
      });
      throw error;
    }
  }

  /**
   * Check if notification should be sent based on user preferences
   */
  private shouldSendNotification(notificationData: NotificationData, preferences: any): boolean {
    if (!preferences) return true;

    // Check if the notification type is enabled
    switch (notificationData.type) {
      case NotificationType.APPOINTMENT_REMINDER:
        return preferences.appointmentReminders !== false;
      case NotificationType.LAB_RESULT:
        return preferences.labResults !== false;
      case NotificationType.PRESCRIPTION_UPDATE:
        return preferences.prescriptionUpdates !== false;
      case NotificationType.SYSTEM_ALERT:
        return preferences.systemAlerts !== false;
      case NotificationType.MARKETING:
        return preferences.marketingEmails !== false;
      default:
        return true;
    }
  }

  /**
   * Create appointment reminder notification
   */
  async createAppointmentReminder(
    appointmentId: string,
    patientId: string,
    reminderTime: Date,
    reminderType: '24h' | '2h' | '30m' = '24h'
  ): Promise<NotificationWithRelations> {
    try {
      // Get appointment details
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
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
      });

      if (!appointment) {
        throw new NotFoundError('Appointment not found');
      }

      const reminderMessages = {
        '24h': `Reminder: You have an appointment tomorrow at ${formatDate(appointment.scheduledAt, 'h:mm a')} with Dr. ${appointment.provider?.lastName}.`,
        '2h': `Reminder: You have an appointment in 2 hours at ${formatDate(appointment.scheduledAt, 'h:mm a')} with Dr. ${appointment.provider?.lastName}.`,
        '30m': `Reminder: You have an appointment in 30 minutes at ${formatDate(appointment.scheduledAt, 'h:mm a')} with Dr. ${appointment.provider?.lastName}.`,
      };

      const notificationData: NotificationData = {
        recipientId: patientId,
        type: NotificationType.APPOINTMENT_REMINDER,
        priority: reminderType === '30m' ? Priority.HIGH : Priority.MEDIUM,
        channel: 'EMAIL',
        subject: `Appointment Reminder - ${formatDate(appointment.scheduledAt, 'MMM d, yyyy')}`,
        message: reminderMessages[reminderType],
        scheduledAt: reminderTime,
        relatedAppointmentId: appointmentId,
        metadata: {
          reminderType,
          appointmentTime: appointment.scheduledAt,
          providerName: `${appointment.provider?.firstName} ${appointment.provider?.lastName}`,
        },
      };

      return await this.create(notificationData);
    } catch (error) {
      logger.error('Error creating appointment reminder', {
        component: 'NotificationModel',
        error: (error as Error).message,
        appointmentId,
        patientId,
        reminderType,
      });
      throw error;
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default NotificationModel;