/**
 * ============================================================================
 * NOVA CHECK EHR - NOTIFICATION SERVICE
 * ============================================================================
 */

import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import twilio from 'twilio';
import webpush from 'web-push';
import { EventEmitter } from 'events';
import logger from '../config/logger';
import config from '../config/config';
import auditService from './auditService';
import cacheService from './cacheService';
import emailService from './emailService';

const prisma = new PrismaClient();

interface NotificationChannel {
  id: string;
  type: 'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP' | 'WEBHOOK';
  name: string;
  config: Record<string, any>;
  enabled: boolean;
  priority: number;
}

interface NotificationTemplate {
  id: string;
  name: string;
  type: 'APPOINTMENT_REMINDER' | 'APPOINTMENT_CONFIRMATION' | 'LAB_RESULT' | 'PRESCRIPTION_READY' | 'SYSTEM_ALERT' | 'CUSTOM';
  subject?: string;
  content: string;
  channels: string[];
  variables: string[];
  enabled: boolean;
}

interface NotificationPreference {
  userId: string;
  type: string;
  channels: string[];
  enabled: boolean;
  frequency: 'IMMEDIATE' | 'HOURLY' | 'DAILY' | 'WEEKLY';
  quietHours?: {
    start: string;
    end: string;
  };
}

interface NotificationData {
  id?: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, any>;
  channels?: string[];
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  scheduledAt?: Date;
  expiresAt?: Date;
  metadata?: Record<string, any>;
}

interface NotificationStatus {
  id: string;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'EXPIRED';
  channel: string;
  sentAt?: Date;
  deliveredAt?: Date;
  error?: string;
  attempts: number;
}

interface BulkNotificationRequest {
  userIds: string[];
  templateId: string;
  variables: Record<string, any>;
  channels?: string[];
  scheduledAt?: Date;
}

interface NotificationStats {
  total: number;
  sent: number;
  delivered: number;
  failed: number;
  pending: number;
  deliveryRate: number;
  channelStats: {
    channel: string;
    sent: number;
    delivered: number;
    failed: number;
    deliveryRate: number;
  }[];
  typeStats: {
    type: string;
    count: number;
  }[];
}

class NotificationService extends EventEmitter {
  private smsClient: any;
  private pushConfig: any;
  private processingQueue: NotificationData[] = [];
  private isProcessing = false;
  private retryAttempts = 3;
  private retryDelay = 5000; // 5 seconds

  constructor() {
    super();
    this.initializeServices();
    this.startQueueProcessor();
  }

  private async initializeServices() {
    try {
      // Initialize Twilio for SMS
      if (config.twilio?.accountSid && config.twilio?.authToken) {
        this.smsClient = twilio(config.twilio.accountSid, config.twilio.authToken);
        logger.info('Twilio SMS service initialized');
      }

      // Initialize Web Push
      if (config.webPush?.publicKey && config.webPush?.privateKey) {
        webpush.setVapidDetails(
          config.webPush.subject || 'mailto:admin@novacheck.com',
          config.webPush.publicKey,
          config.webPush.privateKey
        );
        this.pushConfig = config.webPush;
        logger.info('Web Push service initialized');
      }

      logger.info('Notification service initialized');
    } catch (error) {
      logger.error('Failed to initialize notification services', {
        error: error.message,
      });
    }
  }

  private startQueueProcessor() {
    setInterval(() => {
      if (!this.isProcessing && this.processingQueue.length > 0) {
        this.processQueue();
      }
    }, 1000); // Check every second
  }

  private async processQueue() {
    if (this.isProcessing || this.processingQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      const notification = this.processingQueue.shift();
      if (notification) {
        await this.processNotification(notification);
      }
    } catch (error) {
      logger.error('Queue processing error', { error: error.message });
    } finally {
      this.isProcessing = false;
    }
  }

  private async processNotification(notification: NotificationData) {
    try {
      // Check if notification is scheduled for future
      if (notification.scheduledAt && notification.scheduledAt > new Date()) {
        // Re-queue for later processing
        setTimeout(() => {
          this.processingQueue.push(notification);
        }, notification.scheduledAt.getTime() - Date.now());
        return;
      }

      // Check if notification has expired
      if (notification.expiresAt && notification.expiresAt < new Date()) {
        await this.updateNotificationStatus(notification.id!, 'EXPIRED', 'ALL');
        return;
      }

      // Get user preferences
      const preferences = await this.getUserPreferences(notification.userId);
      const userPreference = preferences.find(p => p.type === notification.type);

      // Check if user has notifications enabled for this type
      if (userPreference && !userPreference.enabled) {
        logger.info('Notification skipped - user preference disabled', {
          userId: notification.userId,
          type: notification.type,
        });
        return;
      }

      // Check quiet hours
      if (userPreference?.quietHours && this.isInQuietHours(userPreference.quietHours)) {
        // Re-queue for after quiet hours
        const nextSendTime = this.getNextSendTime(userPreference.quietHours);
        notification.scheduledAt = nextSendTime;
        this.processingQueue.push(notification);
        return;
      }

      // Determine channels to use
      const channels = notification.channels || userPreference?.channels || ['IN_APP'];
      
      // Send notification through each channel
      for (const channelId of channels) {
        await this.sendThroughChannel(notification, channelId);
      }

      // Emit event for real-time updates
      this.emit('notification:sent', notification);

    } catch (error) {
      logger.error('Failed to process notification', {
        notificationId: notification.id,
        error: error.message,
      });
      
      if (notification.id) {
        await this.updateNotificationStatus(notification.id, 'FAILED', 'ALL', error.message);
      }
    }
  }

  private async sendThroughChannel(notification: NotificationData, channelId: string) {
    try {
      const channel = await this.getChannel(channelId);
      if (!channel || !channel.enabled) {
        logger.warn('Channel not found or disabled', { channelId });
        return;
      }

      let success = false;
      let error: string | undefined;

      switch (channel.type) {
        case 'EMAIL':
          success = await this.sendEmail(notification, channel);
          break;
        case 'SMS':
          success = await this.sendSMS(notification, channel);
          break;
        case 'PUSH':
          success = await this.sendPushNotification(notification, channel);
          break;
        case 'IN_APP':
          success = await this.sendInAppNotification(notification);
          break;
        case 'WEBHOOK':
          success = await this.sendWebhook(notification, channel);
          break;
        default:
          logger.warn('Unsupported channel type', { type: channel.type });
          return;
      }

      const status = success ? 'SENT' : 'FAILED';
      if (notification.id) {
        await this.updateNotificationStatus(notification.id, status, channel.type, error);
      }

      logger.info('Notification sent through channel', {
        notificationId: notification.id,
        channel: channel.type,
        success,
      });

    } catch (error) {
      logger.error('Failed to send through channel', {
        notificationId: notification.id,
        channelId,
        error: error.message,
      });
      
      if (notification.id) {
        await this.updateNotificationStatus(notification.id, 'FAILED', channelId, error.message);
      }
    }
  }

  private async sendEmail(notification: NotificationData, channel: NotificationChannel): Promise<boolean> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: notification.userId },
        select: { email: true, firstName: true, lastName: true },
      });

      if (!user?.email) {
        throw new Error('User email not found');
      }

      await emailService.sendEmail({
        to: user.email,
        subject: notification.title,
        html: this.formatEmailContent(notification.message, notification.data),
        metadata: {
          notificationId: notification.id,
          userId: notification.userId,
          type: notification.type,
        },
      });

      return true;
    } catch (error) {
      logger.error('Email sending failed', { error: error.message });
      return false;
    }
  }

  private async sendSMS(notification: NotificationData, channel: NotificationChannel): Promise<boolean> {
    try {
      if (!this.smsClient) {
        throw new Error('SMS service not configured');
      }

      const user = await prisma.user.findUnique({
        where: { id: notification.userId },
        select: { phone: true },
      });

      if (!user?.phone) {
        throw new Error('User phone number not found');
      }

      await this.smsClient.messages.create({
        body: this.formatSMSContent(notification.message, notification.data),
        from: config.twilio?.phoneNumber,
        to: user.phone,
      });

      return true;
    } catch (error) {
      logger.error('SMS sending failed', { error: error.message });
      return false;
    }
  }

  private async sendPushNotification(notification: NotificationData, channel: NotificationChannel): Promise<boolean> {
    try {
      if (!this.pushConfig) {
        throw new Error('Push notification service not configured');
      }

      // Get user's push subscriptions
      const subscriptions = await prisma.pushSubscription.findMany({
        where: { userId: notification.userId },
      });

      if (subscriptions.length === 0) {
        throw new Error('No push subscriptions found for user');
      }

      const payload = JSON.stringify({
        title: notification.title,
        body: notification.message,
        icon: '/icon-192x192.png',
        badge: '/badge-72x72.png',
        data: notification.data,
      });

      const promises = subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            payload
          );
          return true;
        } catch (error) {
          // Remove invalid subscriptions
          if (error.statusCode === 410) {
            await prisma.pushSubscription.delete({
              where: { id: subscription.id },
            });
          }
          return false;
        }
      });

      const results = await Promise.all(promises);
      return results.some(result => result);
    } catch (error) {
      logger.error('Push notification sending failed', { error: error.message });
      return false;
    }
  }

  private async sendInAppNotification(notification: NotificationData): Promise<boolean> {
    try {
      // Store in-app notification in database
      await prisma.notification.create({
        data: {
          id: notification.id,
          userId: notification.userId,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          data: notification.data ? JSON.stringify(notification.data) : null,
          priority: notification.priority,
          read: false,
          createdAt: new Date(),
        },
      });

      // Emit real-time event for WebSocket clients
      this.emit('notification:in-app', {
        userId: notification.userId,
        notification,
      });

      return true;
    } catch (error) {
      logger.error('In-app notification creation failed', { error: error.message });
      return false;
    }
  }

  private async sendWebhook(notification: NotificationData, channel: NotificationChannel): Promise<boolean> {
    try {
      const webhookUrl = channel.config.url;
      const headers = channel.config.headers || {};
      
      const payload = {
        notification,
        timestamp: new Date().toISOString(),
      };

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(payload),
      });

      return response.ok;
    } catch (error) {
      logger.error('Webhook sending failed', { error: error.message });
      return false;
    }
  }

  private formatEmailContent(message: string, data?: Record<string, any>): string {
    let content = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
          <h2 style="color: #333; margin-bottom: 20px;">Nova Check EHR</h2>
          <div style="background-color: white; padding: 20px; border-radius: 4px; border-left: 4px solid #007bff;">
            ${message}
          </div>
        </div>
      </div>
    `;

    // Replace variables if data is provided
    if (data) {
      Object.keys(data).forEach(key => {
        const placeholder = `{{${key}}}`;
        content = content.replace(new RegExp(placeholder, 'g'), String(data[key]));
      });
    }

    return content;
  }

  private formatSMSContent(message: string, data?: Record<string, any>): string {
    let content = message;

    // Replace variables if data is provided
    if (data) {
      Object.keys(data).forEach(key => {
        const placeholder = `{{${key}}}`;
        content = content.replace(new RegExp(placeholder, 'g'), String(data[key]));
      });
    }

    // Truncate to SMS length limit
    return content.length > 160 ? content.substring(0, 157) + '...' : content;
  }

  private isInQuietHours(quietHours: { start: string; end: string }): boolean {
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    
    const [startHour, startMin] = quietHours.start.split(':').map(Number);
    const [endHour, endMin] = quietHours.end.split(':').map(Number);
    
    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    if (startTime <= endTime) {
      return currentTime >= startTime && currentTime <= endTime;
    } else {
      // Quiet hours span midnight
      return currentTime >= startTime || currentTime <= endTime;
    }
  }

  private getNextSendTime(quietHours: { start: string; end: string }): Date {
    const now = new Date();
    const [endHour, endMin] = quietHours.end.split(':').map(Number);
    
    const nextSendTime = new Date(now);
    nextSendTime.setHours(endHour, endMin, 0, 0);
    
    // If end time is earlier in the day, it means quiet hours span midnight
    if (nextSendTime <= now) {
      nextSendTime.setDate(nextSendTime.getDate() + 1);
    }
    
    return nextSendTime;
  }

  async sendNotification(notification: NotificationData): Promise<string> {
    try {
      // Generate notification ID if not provided
      if (!notification.id) {
        notification.id = `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      }

      // Validate required fields
      if (!notification.userId || !notification.type || !notification.title || !notification.message) {
        throw new Error('Missing required notification fields');
      }

      // Store notification in database
      await prisma.notificationLog.create({
        data: {
          id: notification.id,
          userId: notification.userId,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          data: notification.data ? JSON.stringify(notification.data) : null,
          priority: notification.priority,
          scheduledAt: notification.scheduledAt,
          expiresAt: notification.expiresAt,
          metadata: notification.metadata ? JSON.stringify(notification.metadata) : null,
          status: 'PENDING',
          createdAt: new Date(),
        },
      });

      // Add to processing queue
      this.processingQueue.push(notification);

      // Log audit event
      await auditService.logSystemEvent(
        'NOTIFICATION_QUEUED',
        {
          notificationId: notification.id,
          userId: notification.userId,
          type: notification.type,
          priority: notification.priority,
        },
        'LOW'
      );

      logger.info('Notification queued', {
        notificationId: notification.id,
        userId: notification.userId,
        type: notification.type,
      });

      return notification.id;
    } catch (error) {
      logger.error('Failed to send notification', {
        error: error.message,
        notification,
      });
      throw new Error('Failed to send notification');
    }
  }

  async sendBulkNotification(request: BulkNotificationRequest): Promise<string[]> {
    try {
      const template = await this.getTemplate(request.templateId);
      if (!template) {
        throw new Error('Template not found');
      }

      const notificationIds: string[] = [];

      for (const userId of request.userIds) {
        const notification: NotificationData = {
          userId,
          type: template.type,
          title: this.replaceVariables(template.subject || template.name, request.variables),
          message: this.replaceVariables(template.content, request.variables),
          data: request.variables,
          channels: request.channels || template.channels,
          priority: 'MEDIUM',
          scheduledAt: request.scheduledAt,
        };

        const notificationId = await this.sendNotification(notification);
        notificationIds.push(notificationId);
      }

      logger.info('Bulk notification sent', {
        templateId: request.templateId,
        userCount: request.userIds.length,
        notificationIds: notificationIds.length,
      });

      return notificationIds;
    } catch (error) {
      logger.error('Failed to send bulk notification', {
        error: error.message,
        request,
      });
      throw new Error('Failed to send bulk notification');
    }
  }

  private replaceVariables(content: string, variables: Record<string, any>): string {
    let result = content;
    Object.keys(variables).forEach(key => {
      const placeholder = `{{${key}}}`;
      result = result.replace(new RegExp(placeholder, 'g'), String(variables[key]));
    });
    return result;
  }

  async getUserNotifications(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      unreadOnly?: boolean;
      type?: string;
    } = {}
  ) {
    try {
      const { page = 1, limit = 20, unreadOnly = false, type } = options;
      
      const where: any = { userId };
      if (unreadOnly) where.read = false;
      if (type) where.type = type;

      const [notifications, total] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.notification.count({ where }),
      ]);

      return {
        notifications: notifications.map(n => ({
          ...n,
          data: n.data ? JSON.parse(n.data) : null,
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error('Failed to get user notifications', {
        userId,
        error: error.message,
      });
      throw new Error('Failed to get user notifications');
    }
  }

  async markAsRead(notificationId: string, userId: string): Promise<void> {
    try {
      await prisma.notification.updateMany({
        where: {
          id: notificationId,
          userId,
        },
        data: {
          read: true,
          readAt: new Date(),
        },
      });

      logger.info('Notification marked as read', {
        notificationId,
        userId,
      });
    } catch (error) {
      logger.error('Failed to mark notification as read', {
        notificationId,
        userId,
        error: error.message,
      });
      throw new Error('Failed to mark notification as read');
    }
  }

  async markAllAsRead(userId: string): Promise<void> {
    try {
      await prisma.notification.updateMany({
        where: {
          userId,
          read: false,
        },
        data: {
          read: true,
          readAt: new Date(),
        },
      });

      logger.info('All notifications marked as read', { userId });
    } catch (error) {
      logger.error('Failed to mark all notifications as read', {
        userId,
        error: error.message,
      });
      throw new Error('Failed to mark all notifications as read');
    }
  }

  async deleteNotification(notificationId: string, userId: string): Promise<void> {
    try {
      await prisma.notification.deleteMany({
        where: {
          id: notificationId,
          userId,
        },
      });

      logger.info('Notification deleted', {
        notificationId,
        userId,
      });
    } catch (error) {
      logger.error('Failed to delete notification', {
        notificationId,
        userId,
        error: error.message,
      });
      throw new Error('Failed to delete notification');
    }
  }

  async getUserPreferences(userId: string): Promise<NotificationPreference[]> {
    try {
      const preferences = await prisma.notificationPreference.findMany({
        where: { userId },
      });

      return preferences.map(p => ({
        userId: p.userId,
        type: p.type,
        channels: JSON.parse(p.channels),
        enabled: p.enabled,
        frequency: p.frequency as any,
        quietHours: p.quietHours ? JSON.parse(p.quietHours) : undefined,
      }));
    } catch (error) {
      logger.error('Failed to get user preferences', {
        userId,
        error: error.message,
      });
      return [];
    }
  }

  async updateUserPreferences(userId: string, preferences: Partial<NotificationPreference>[]): Promise<void> {
    try {
      for (const preference of preferences) {
        await prisma.notificationPreference.upsert({
          where: {
            userId_type: {
              userId,
              type: preference.type!,
            },
          },
          update: {
            channels: JSON.stringify(preference.channels),
            enabled: preference.enabled,
            frequency: preference.frequency,
            quietHours: preference.quietHours ? JSON.stringify(preference.quietHours) : null,
          },
          create: {
            userId,
            type: preference.type!,
            channels: JSON.stringify(preference.channels || []),
            enabled: preference.enabled ?? true,
            frequency: preference.frequency || 'IMMEDIATE',
            quietHours: preference.quietHours ? JSON.stringify(preference.quietHours) : null,
          },
        });
      }

      logger.info('User notification preferences updated', { userId });
    } catch (error) {
      logger.error('Failed to update user preferences', {
        userId,
        error: error.message,
      });
      throw new Error('Failed to update user preferences');
    }
  }

  async getTemplate(templateId: string): Promise<NotificationTemplate | null> {
    try {
      const template = await prisma.notificationTemplate.findUnique({
        where: { id: templateId },
      });

      if (!template) return null;

      return {
        id: template.id,
        name: template.name,
        type: template.type as any,
        subject: template.subject,
        content: template.content,
        channels: JSON.parse(template.channels),
        variables: JSON.parse(template.variables),
        enabled: template.enabled,
      };
    } catch (error) {
      logger.error('Failed to get template', {
        templateId,
        error: error.message,
      });
      return null;
    }
  }

  async getChannel(channelId: string): Promise<NotificationChannel | null> {
    try {
      const channel = await prisma.notificationChannel.findUnique({
        where: { id: channelId },
      });

      if (!channel) return null;

      return {
        id: channel.id,
        type: channel.type as any,
        name: channel.name,
        config: JSON.parse(channel.config),
        enabled: channel.enabled,
        priority: channel.priority,
      };
    } catch (error) {
      logger.error('Failed to get channel', {
        channelId,
        error: error.message,
      });
      return null;
    }
  }

  private async updateNotificationStatus(
    notificationId: string,
    status: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'EXPIRED',
    channel: string,
    error?: string
  ): Promise<void> {
    try {
      await prisma.notificationStatus.create({
        data: {
          notificationId,
          status,
          channel,
          sentAt: status === 'SENT' ? new Date() : null,
          deliveredAt: status === 'DELIVERED' ? new Date() : null,
          error,
          attempts: 1,
        },
      });

      // Update main notification log status
      await prisma.notificationLog.update({
        where: { id: notificationId },
        data: { status },
      });
    } catch (error) {
      logger.error('Failed to update notification status', {
        notificationId,
        status,
        channel,
        error: error.message,
      });
    }
  }

  async getNotificationStats(dateRange?: { start: Date; end: Date }): Promise<NotificationStats> {
    try {
      const where: any = {};
      if (dateRange) {
        where.createdAt = {
          gte: dateRange.start,
          lte: dateRange.end,
        };
      }

      const [statusStats, channelStats, typeStats] = await Promise.all([
        prisma.notificationLog.groupBy({
          by: ['status'],
          _count: true,
          where,
        }),
        prisma.notificationStatus.groupBy({
          by: ['channel', 'status'],
          _count: true,
          where: dateRange ? {
            notification: {
              createdAt: {
                gte: dateRange.start,
                lte: dateRange.end,
              },
            },
          } : {},
        }),
        prisma.notificationLog.groupBy({
          by: ['type'],
          _count: true,
          where,
        }),
      ]);

      const statusCounts = statusStats.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {} as Record<string, number>);

      const total = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
      const sent = statusCounts['SENT'] || 0;
      const delivered = statusCounts['DELIVERED'] || 0;
      const failed = statusCounts['FAILED'] || 0;
      const pending = statusCounts['PENDING'] || 0;

      const deliveryRate = sent > 0 ? (delivered / sent) * 100 : 0;

      // Process channel stats
      const channelStatsMap = new Map<string, { sent: number; delivered: number; failed: number }>();
      
      channelStats.forEach(stat => {
        if (!channelStatsMap.has(stat.channel)) {
          channelStatsMap.set(stat.channel, { sent: 0, delivered: 0, failed: 0 });
        }
        
        const channelData = channelStatsMap.get(stat.channel)!;
        if (stat.status === 'SENT') channelData.sent += stat._count;
        if (stat.status === 'DELIVERED') channelData.delivered += stat._count;
        if (stat.status === 'FAILED') channelData.failed += stat._count;
      });

      const channelStatsArray = Array.from(channelStatsMap.entries()).map(([channel, data]) => ({
        channel,
        sent: data.sent,
        delivered: data.delivered,
        failed: data.failed,
        deliveryRate: data.sent > 0 ? (data.delivered / data.sent) * 100 : 0,
      }));

      return {
        total,
        sent,
        delivered,
        failed,
        pending,
        deliveryRate,
        channelStats: channelStatsArray,
        typeStats: typeStats.map(stat => ({
          type: stat.type,
          count: stat._count,
        })),
      };
    } catch (error) {
      logger.error('Failed to get notification stats', {
        error: error.message,
      });
      throw new Error('Failed to get notification stats');
    }
  }

  // Predefined notification methods
  async sendAppointmentReminder(appointmentId: string): Promise<string> {
    try {
      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          patient: true,
          provider: true,
        },
      });

      if (!appointment) {
        throw new Error('Appointment not found');
      }

      const notification: NotificationData = {
        userId: appointment.patient.id,
        type: 'APPOINTMENT_REMINDER',
        title: 'Appointment Reminder',
        message: `You have an appointment with Dr. ${appointment.provider.lastName} on ${appointment.scheduledAt.toLocaleDateString()} at ${appointment.scheduledAt.toLocaleTimeString()}.`,
        data: {
          appointmentId: appointment.id,
          providerName: `Dr. ${appointment.provider.lastName}`,
          scheduledAt: appointment.scheduledAt.toISOString(),
        },
        priority: 'MEDIUM',
        scheduledAt: new Date(appointment.scheduledAt.getTime() - 24 * 60 * 60 * 1000), // 24 hours before
      };

      return await this.sendNotification(notification);
    } catch (error) {
      logger.error('Failed to send appointment reminder', {
        appointmentId,
        error: error.message,
      });
      throw new Error('Failed to send appointment reminder');
    }
  }

  async sendLabResultNotification(labResultId: string): Promise<string> {
    try {
      // This would integrate with lab results system
      const notification: NotificationData = {
        userId: 'patient-id', // Would get from lab result
        type: 'LAB_RESULT',
        title: 'Lab Results Available',
        message: 'Your lab results are now available in your patient portal.',
        data: {
          labResultId,
        },
        priority: 'HIGH',
      };

      return await this.sendNotification(notification);
    } catch (error) {
      logger.error('Failed to send lab result notification', {
        labResultId,
        error: error.message,
      });
      throw new Error('Failed to send lab result notification');
    }
  }

  async sendSystemAlert(message: string, userIds: string[], priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' = 'MEDIUM'): Promise<string[]> {
    try {
      const notificationIds: string[] = [];

      for (const userId of userIds) {
        const notification: NotificationData = {
          userId,
          type: 'SYSTEM_ALERT',
          title: 'System Alert',
          message,
          priority,
          channels: ['IN_APP', 'EMAIL'],
        };

        const notificationId = await this.sendNotification(notification);
        notificationIds.push(notificationId);
      }

      return notificationIds;
    } catch (error) {
      logger.error('Failed to send system alert', {
        message,
        userIds,
        error: error.message,
      });
      throw new Error('Failed to send system alert');
    }
  }
}

// Export singleton instance
const notificationService = new NotificationService();
export default notificationService;

// Export the class for testing
export { NotificationService };