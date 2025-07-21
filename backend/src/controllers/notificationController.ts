/**
 * ============================================================================
 * NOVA CHECK EHR - NOTIFICATION CONTROLLER
 * ============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import { PrismaClient, UserRole, NotificationType, NotificationStatus, NotificationPriority, NotificationChannel } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError, ForbiddenError } from '../middleware/errorHandler';
import logger from '../config/logger';
import { CacheService } from '../config/redis';
import { asyncHandler } from '../middleware/errorHandler';
import { sendEmail } from '../services/emailService';
import { sendSMS } from '../services/smsService';
import { sendPushNotification } from '../services/pushNotificationService';
import { getSocketIO } from '../services/socketService';
import { format, addDays, addHours, addMinutes } from 'date-fns';
import config from '../config/config';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();
const cacheService = new CacheService();

/**
 * Create notification
 */
export const createNotification = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {
    recipientId,
    type,
    title,
    message,
    priority = NotificationPriority.MEDIUM,
    channels = [NotificationChannel.IN_APP],
    data,
    scheduledFor,
    expiresAt,
  } = req.body;

  const user = req.user!;

  // Verify recipient exists
  const recipient = await prisma.user.findUnique({
    where: { id: recipientId },
    include: {
      notificationPreferences: true,
    },
  });

  if (!recipient) {
    throw new NotFoundError('Recipient not found');
  }

  // Check if user can send notifications to this recipient
  if (user.role === UserRole.PATIENT) {
    // Patients can only send notifications to their care team
    if (!user.patientId) {
      throw new ForbiddenError('Patient profile not found');
    }

    const careTeamMember = await prisma.careTeamMember.findFirst({
      where: {
        patientId: user.patientId,
        providerId: recipient.providerId,
      },
    });

    if (!careTeamMember) {
      throw new ForbiddenError('Can only send notifications to your care team');
    }
  }

  // Filter channels based on recipient preferences
  const allowedChannels = channels.filter(channel => {
    const preference = recipient.notificationPreferences?.find(p => p.type === type);
    if (!preference) return true; // Default to allow if no preference set
    
    switch (channel) {
      case NotificationChannel.EMAIL:
        return preference.emailEnabled;
      case NotificationChannel.SMS:
        return preference.smsEnabled;
      case NotificationChannel.PUSH:
        return preference.pushEnabled;
      case NotificationChannel.IN_APP:
        return preference.inAppEnabled;
      default:
        return true;
    }
  });

  if (allowedChannels.length === 0) {
    throw new ValidationError('No allowed notification channels for this recipient');
  }

  // Create notification record
  const notification = await prisma.notification.create({
    data: {
      id: uuidv4(),
      recipientId,
      senderId: user.id,
      type,
      title,
      message,
      priority,
      channels: allowedChannels,
      data: data || {},
      status: scheduledFor ? NotificationStatus.SCHEDULED : NotificationStatus.PENDING,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdAt: new Date(),
    },
    include: {
      sender: {
        select: {
          firstName: true,
          lastName: true,
          role: true,
        },
      },
      recipient: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
    },
  });

  // Send notification immediately if not scheduled
  if (!scheduledFor) {
    await processNotification(notification);
  }

  // Log notification creation
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'NOTIFICATION_CREATE',
      resource: 'Notification',
      resourceId: notification.id,
      details: {
        recipientId,
        type,
        priority,
        channels: allowedChannels,
        scheduled: !!scheduledFor,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Notification created successfully', {
    notificationId: notification.id,
    recipientId,
    type,
    priority,
    createdBy: user.id,
  });

  res.status(201).json({
    success: true,
    message: 'Notification created successfully',
    data: { notification },
  });
});

/**
 * Process notification (send via channels)
 */
async function processNotification(notification: any) {
  const deliveryResults = [];

  for (const channel of notification.channels) {
    try {
      switch (channel) {
        case NotificationChannel.IN_APP:
          // Send real-time notification via WebSocket
          const io = getSocketIO();
          io.to(`user_${notification.recipientId}`).emit('notification', {
            id: notification.id,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            priority: notification.priority,
            data: notification.data,
            createdAt: notification.createdAt,
          });
          deliveryResults.push({ channel, status: 'sent', sentAt: new Date() });
          break;

        case NotificationChannel.EMAIL:
          if (notification.recipient.email) {
            await sendEmail({
              to: notification.recipient.email,
              subject: notification.title,
              html: generateEmailTemplate(notification),
              priority: notification.priority,
            });
            deliveryResults.push({ channel, status: 'sent', sentAt: new Date() });
          } else {
            deliveryResults.push({ channel, status: 'failed', error: 'No email address' });
          }
          break;

        case NotificationChannel.SMS:
          if (notification.recipient.phone) {
            await sendSMS({
              to: notification.recipient.phone,
              message: `${notification.title}: ${notification.message}`,
              priority: notification.priority,
            });
            deliveryResults.push({ channel, status: 'sent', sentAt: new Date() });
          } else {
            deliveryResults.push({ channel, status: 'failed', error: 'No phone number' });
          }
          break;

        case NotificationChannel.PUSH:
          await sendPushNotification({
            userId: notification.recipientId,
            title: notification.title,
            body: notification.message,
            data: notification.data,
            priority: notification.priority,
          });
          deliveryResults.push({ channel, status: 'sent', sentAt: new Date() });
          break;
      }
    } catch (error) {
      logger.error(`Failed to send notification via ${channel}`, {
        notificationId: notification.id,
        channel,
        error: error.message,
      });
      deliveryResults.push({ channel, status: 'failed', error: error.message });
    }
  }

  // Update notification status
  const hasSuccessfulDelivery = deliveryResults.some(result => result.status === 'sent');
  await prisma.notification.update({
    where: { id: notification.id },
    data: {
      status: hasSuccessfulDelivery ? NotificationStatus.SENT : NotificationStatus.FAILED,
      sentAt: hasSuccessfulDelivery ? new Date() : null,
      deliveryResults,
    },
  });

  logger.info('Notification processed', {
    notificationId: notification.id,
    deliveryResults,
  });
}

/**
 * Generate email template for notification
 */
function generateEmailTemplate(notification: any): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>${notification.title}</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9fafb; }
            .priority-high { border-left: 4px solid #dc2626; }
            .priority-medium { border-left: 4px solid #f59e0b; }
            .priority-low { border-left: 4px solid #10b981; }
            .footer { padding: 20px; text-align: center; color: #6b7280; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Nova Check EHR</h1>
            </div>
            <div class="content priority-${notification.priority.toLowerCase()}">
                <h2>${notification.title}</h2>
                <p>${notification.message}</p>
                ${notification.data?.appointmentDate ? `<p><strong>Appointment:</strong> ${format(new Date(notification.data.appointmentDate), 'PPP p')}</p>` : ''}
                ${notification.data?.patientName ? `<p><strong>Patient:</strong> ${notification.data.patientName}</p>` : ''}
                <p><strong>Priority:</strong> ${notification.priority}</p>
                <p><strong>Sent:</strong> ${format(new Date(notification.createdAt), 'PPP p')}</p>
            </div>
            <div class="footer">
                <p>This is an automated message from Nova Check EHR. Please do not reply to this email.</p>
                <p>If you have questions, please contact your healthcare provider.</p>
            </div>
        </div>
    </body>
    </html>
  `;
}

/**
 * Get notifications for user
 */
export const getNotifications = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {
    page = 1,
    limit = 20,
    status,
    type,
    priority,
    unreadOnly = false,
    startDate,
    endDate,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = req.query;

  const offset = (Number(page) - 1) * Number(limit);
  const user = req.user!;

  // Build where clause
  const where: any = {
    recipientId: user.id,
  };

  if (status) {
    where.status = status;
  }

  if (type) {
    where.type = type;
  }

  if (priority) {
    where.priority = priority;
  }

  if (unreadOnly === 'true') {
    where.readAt = null;
  }

  // Date range filter
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) {
      where.createdAt.gte = new Date(startDate as string);
    }
    if (endDate) {
      where.createdAt.lte = new Date(endDate as string);
    }
  }

  // Exclude expired notifications
  where.OR = [
    { expiresAt: null },
    { expiresAt: { gt: new Date() } },
  ];

  // Build order by
  const orderBy: any = {};
  orderBy[sortBy as string] = sortOrder;

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      include: {
        sender: {
          select: {
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
      orderBy,
      skip: offset,
      take: Number(limit),
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({
      where: {
        recipientId: user.id,
        readAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    }),
  ]);

  const totalPages = Math.ceil(total / Number(limit));

  res.json({
    success: true,
    data: {
      notifications,
      unreadCount,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages,
        hasNext: Number(page) < totalPages,
        hasPrev: Number(page) > 1,
      },
    },
  });
});

/**
 * Mark notification as read
 */
export const markAsRead = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;

  const notification = await prisma.notification.findUnique({
    where: { id },
  });

  if (!notification) {
    throw new NotFoundError('Notification not found');
  }

  if (notification.recipientId !== user.id) {
    throw new ForbiddenError('Access denied');
  }

  const updatedNotification = await prisma.notification.update({
    where: { id },
    data: {
      readAt: new Date(),
    },
  });

  // Emit real-time update
  const io = getSocketIO();
  io.to(`user_${user.id}`).emit('notification_read', { notificationId: id });

  res.json({
    success: true,
    message: 'Notification marked as read',
    data: { notification: updatedNotification },
  });
});

/**
 * Mark all notifications as read
 */
export const markAllAsRead = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;

  const result = await prisma.notification.updateMany({
    where: {
      recipientId: user.id,
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  });

  // Emit real-time update
  const io = getSocketIO();
  io.to(`user_${user.id}`).emit('all_notifications_read');

  res.json({
    success: true,
    message: `${result.count} notifications marked as read`,
    data: { count: result.count },
  });
});

/**
 * Delete notification
 */
export const deleteNotification = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;

  const notification = await prisma.notification.findUnique({
    where: { id },
  });

  if (!notification) {
    throw new NotFoundError('Notification not found');
  }

  if (notification.recipientId !== user.id) {
    throw new ForbiddenError('Access denied');
  }

  await prisma.notification.delete({
    where: { id },
  });

  res.json({
    success: true,
    message: 'Notification deleted successfully',
  });
});

/**
 * Get notification preferences
 */
export const getNotificationPreferences = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;

  const preferences = await prisma.notificationPreference.findMany({
    where: { userId: user.id },
    orderBy: { type: 'asc' },
  });

  // If no preferences exist, return defaults
  if (preferences.length === 0) {
    const defaultPreferences = Object.values(NotificationType).map(type => ({
      type,
      emailEnabled: true,
      smsEnabled: false,
      pushEnabled: true,
      inAppEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
    }));

    res.json({
      success: true,
      data: { preferences: defaultPreferences },
    });
    return;
  }

  res.json({
    success: true,
    data: { preferences },
  });
});

/**
 * Update notification preferences
 */
export const updateNotificationPreferences = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { preferences } = req.body;
  const user = req.user!;

  if (!Array.isArray(preferences)) {
    throw new ValidationError('Preferences must be an array');
  }

  const updatedPreferences = [];

  for (const pref of preferences) {
    const {
      type,
      emailEnabled,
      smsEnabled,
      pushEnabled,
      inAppEnabled,
      quietHoursStart,
      quietHoursEnd,
    } = pref;

    const updatedPref = await prisma.notificationPreference.upsert({
      where: {
        userId_type: {
          userId: user.id,
          type,
        },
      },
      update: {
        emailEnabled,
        smsEnabled,
        pushEnabled,
        inAppEnabled,
        quietHoursStart,
        quietHoursEnd,
        updatedAt: new Date(),
      },
      create: {
        userId: user.id,
        type,
        emailEnabled,
        smsEnabled,
        pushEnabled,
        inAppEnabled,
        quietHoursStart,
        quietHoursEnd,
      },
    });

    updatedPreferences.push(updatedPref);
  }

  // Log preference update
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'NOTIFICATION_PREFERENCES_UPDATE',
      resource: 'NotificationPreference',
      resourceId: user.id,
      details: {
        updatedTypes: preferences.map(p => p.type),
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Notification preferences updated', {
    userId: user.id,
    updatedTypes: preferences.map(p => p.type),
  });

  res.json({
    success: true,
    message: 'Notification preferences updated successfully',
    data: { preferences: updatedPreferences },
  });
});

/**
 * Send appointment reminder
 */
export const sendAppointmentReminder = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { appointmentId, reminderType = 'APPOINTMENT_REMINDER' } = req.body;
  const user = req.user!;

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: {
        include: {
          user: true,
        },
      },
      provider: {
        include: {
          user: true,
        },
      },
    },
  });

  if (!appointment) {
    throw new NotFoundError('Appointment not found');
  }

  // Check permissions
  if (user.role === UserRole.PROVIDER && user.providerId !== appointment.providerId) {
    throw new ForbiddenError('Access denied');
  }

  if (user.role === UserRole.PATIENT && user.patientId !== appointment.patientId) {
    throw new ForbiddenError('Access denied');
  }

  // Create reminder notification
  const reminderTime = format(appointment.scheduledAt, 'PPP p');
  const notification = await prisma.notification.create({
    data: {
      id: uuidv4(),
      recipientId: appointment.patient.user.id,
      senderId: user.id,
      type: reminderType as NotificationType,
      title: 'Appointment Reminder',
      message: `You have an appointment scheduled for ${reminderTime} with Dr. ${appointment.provider.user.firstName} ${appointment.provider.user.lastName}.`,
      priority: NotificationPriority.HIGH,
      channels: [NotificationChannel.EMAIL, NotificationChannel.SMS, NotificationChannel.IN_APP],
      data: {
        appointmentId,
        appointmentDate: appointment.scheduledAt.toISOString(),
        providerName: `${appointment.provider.user.firstName} ${appointment.provider.user.lastName}`,
        patientName: `${appointment.patient.firstName} ${appointment.patient.lastName}`,
        appointmentType: appointment.type,
      },
      status: NotificationStatus.PENDING,
    },
    include: {
      recipient: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
    },
  });

  // Process notification immediately
  await processNotification(notification);

  logger.info('Appointment reminder sent', {
    appointmentId,
    patientId: appointment.patientId,
    providerId: appointment.providerId,
    sentBy: user.id,
  });

  res.json({
    success: true,
    message: 'Appointment reminder sent successfully',
    data: { notification },
  });
});

/**
 * Schedule automatic reminders
 */
export const scheduleAutomaticReminders = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { appointmentId, reminderTimes = ['24h', '2h'] } = req.body;
  const user = req.user!;

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: {
        include: {
          user: true,
        },
      },
      provider: {
        include: {
          user: true,
        },
      },
    },
  });

  if (!appointment) {
    throw new NotFoundError('Appointment not found');
  }

  // Check permissions
  if (user.role === UserRole.PROVIDER && user.providerId !== appointment.providerId) {
    throw new ForbiddenError('Access denied');
  }

  const scheduledNotifications = [];

  for (const reminderTime of reminderTimes) {
    let scheduledFor: Date;
    
    switch (reminderTime) {
      case '24h':
        scheduledFor = addDays(appointment.scheduledAt, -1);
        break;
      case '2h':
        scheduledFor = addHours(appointment.scheduledAt, -2);
        break;
      case '30m':
        scheduledFor = addMinutes(appointment.scheduledAt, -30);
        break;
      default:
        continue;
    }

    // Only schedule if the reminder time is in the future
    if (scheduledFor > new Date()) {
      const notification = await prisma.notification.create({
        data: {
          id: uuidv4(),
          recipientId: appointment.patient.user.id,
          senderId: user.id,
          type: NotificationType.APPOINTMENT_REMINDER,
          title: `Appointment Reminder - ${reminderTime} before`,
          message: `You have an appointment in ${reminderTime} with Dr. ${appointment.provider.user.firstName} ${appointment.provider.user.lastName}.`,
          priority: NotificationPriority.HIGH,
          channels: [NotificationChannel.EMAIL, NotificationChannel.SMS, NotificationChannel.IN_APP],
          data: {
            appointmentId,
            appointmentDate: appointment.scheduledAt.toISOString(),
            providerName: `${appointment.provider.user.firstName} ${appointment.provider.user.lastName}`,
            patientName: `${appointment.patient.firstName} ${appointment.patient.lastName}`,
            appointmentType: appointment.type,
            reminderType: reminderTime,
          },
          status: NotificationStatus.SCHEDULED,
          scheduledFor,
        },
      });

      scheduledNotifications.push(notification);
    }
  }

  logger.info('Automatic reminders scheduled', {
    appointmentId,
    scheduledCount: scheduledNotifications.length,
    reminderTimes,
    scheduledBy: user.id,
  });

  res.json({
    success: true,
    message: `${scheduledNotifications.length} automatic reminders scheduled`,
    data: { notifications: scheduledNotifications },
  });
});

/**
 * Get notification statistics
 */
export const getNotificationStats = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { startDate, endDate } = req.query;
  const user = req.user!;

  // Build base where clause
  const baseWhere: any = {};
  
  if (user.role !== UserRole.ADMIN) {
    baseWhere.recipientId = user.id;
  }

  // Date range filter
  if (startDate || endDate) {
    baseWhere.createdAt = {};
    if (startDate) {
      baseWhere.createdAt.gte = new Date(startDate as string);
    }
    if (endDate) {
      baseWhere.createdAt.lte = new Date(endDate as string);
    }
  }

  const [totalNotifications, notificationsByStatus, notificationsByType, notificationsByPriority, unreadCount] = await Promise.all([
    prisma.notification.count({ where: baseWhere }),
    prisma.notification.groupBy({
      by: ['status'],
      where: baseWhere,
      _count: true,
    }),
    prisma.notification.groupBy({
      by: ['type'],
      where: baseWhere,
      _count: true,
    }),
    prisma.notification.groupBy({
      by: ['priority'],
      where: baseWhere,
      _count: true,
    }),
    prisma.notification.count({
      where: {
        ...baseWhere,
        readAt: null,
      },
    }),
  ]);

  const stats = {
    totalNotifications,
    unreadCount,
    notificationsByStatus: notificationsByStatus.map(group => ({
      status: group.status,
      count: group._count,
    })),
    notificationsByType: notificationsByType.map(group => ({
      type: group.type,
      count: group._count,
    })),
    notificationsByPriority: notificationsByPriority.map(group => ({
      priority: group.priority,
      count: group._count,
    })),
  };

  res.json({
    success: true,
    data: { stats },
  });
});