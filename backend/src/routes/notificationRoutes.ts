/**
 * ============================================================================
 * NOVA CHECK EHR - NOTIFICATION MANAGEMENT ROUTES
 * ============================================================================
 */

import { Router, Request, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { PrismaClient, UserRole, NotificationType, NotificationPriority } from '@prisma/client';
import config from '../config/config';
import logger from '../config/logger';
import { authenticateToken, requireRole } from '../middleware/auth';
import { rateLimiters } from '../middleware/security';
import auditService from '../services/auditService';
import cacheService from '../services/cacheService';
import notificationService from '../services/notificationService';
import emailService from '../services/emailService';
import smsService from '../services/smsService';

const router = Router();
const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
    facilityId?: string;
  };
}

interface NotificationResponse {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Validation middleware
const validateNotificationQuery = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('type')
    .optional()
    .isIn(Object.values(NotificationType))
    .withMessage('Invalid notification type'),
  query('priority')
    .optional()
    .isIn(Object.values(NotificationPriority))
    .withMessage('Invalid notification priority'),
  query('isRead')
    .optional()
    .isBoolean()
    .withMessage('isRead must be a boolean'),
];

const validateCreateNotification = [
  body('title')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Title must be between 1 and 200 characters'),
  body('message')
    .trim()
    .isLength({ min: 1, max: 1000 })
    .withMessage('Message must be between 1 and 1000 characters'),
  body('type')
    .isIn(Object.values(NotificationType))
    .withMessage('Invalid notification type'),
  body('priority')
    .optional()
    .isIn(Object.values(NotificationPriority))
    .withMessage('Invalid notification priority'),
  body('recipientIds')
    .isArray({ min: 1 })
    .withMessage('At least one recipient is required'),
  body('recipientIds.*')
    .isUUID()
    .withMessage('Invalid recipient ID'),
  body('actionUrl')
    .optional()
    .isURL()
    .withMessage('Invalid action URL'),
  body('expiresAt')
    .optional()
    .isISO8601()
    .withMessage('Invalid expiration date'),
  body('sendEmail')
    .optional()
    .isBoolean()
    .withMessage('sendEmail must be a boolean'),
  body('sendSms')
    .optional()
    .isBoolean()
    .withMessage('sendSms must be a boolean'),
];

const validateBulkNotification = [
  body('title')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Title must be between 1 and 200 characters'),
  body('message')
    .trim()
    .isLength({ min: 1, max: 1000 })
    .withMessage('Message must be between 1 and 1000 characters'),
  body('type')
    .isIn(Object.values(NotificationType))
    .withMessage('Invalid notification type'),
  body('priority')
    .optional()
    .isIn(Object.values(NotificationPriority))
    .withMessage('Invalid notification priority'),
  body('targetRole')
    .optional()
    .isIn(Object.values(UserRole))
    .withMessage('Invalid target role'),
  body('facilityId')
    .optional()
    .isUUID()
    .withMessage('Invalid facility ID'),
  body('sendEmail')
    .optional()
    .isBoolean()
    .withMessage('sendEmail must be a boolean'),
  body('sendSms')
    .optional()
    .isBoolean()
    .withMessage('sendSms must be a boolean'),
];

// Helper functions
const canAccessNotification = async (currentUser: any, notification: any): Promise<boolean> => {
  // Super admin can access all notifications
  if (currentUser.role === UserRole.SUPER_ADMIN) {
    return true;
  }

  // Users can access their own notifications
  if (notification.recipientId === currentUser.id) {
    return true;
  }

  // Admins can access notifications for users in their facility
  if (currentUser.role === UserRole.ADMIN && currentUser.facilityId) {
    const recipient = await prisma.user.findUnique({
      where: { id: notification.recipientId },
      select: { facilityId: true },
    });
    return recipient?.facilityId === currentUser.facilityId;
  }

  return false;
};

const formatNotificationData = (notification: any) => {
  return {
    ...notification,
    timeAgo: getTimeAgo(notification.createdAt),
    isExpired: notification.expiresAt ? new Date() > new Date(notification.expiresAt) : false,
  };
};

const getTimeAgo = (date: Date): string => {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return 'Just now';
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else {
    const days = Math.floor(diffInSeconds / 86400);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }
};

// Routes

/**
 * @route   GET /api/v1/notifications
 * @desc    Get user notifications
 * @access  Private
 */
router.get('/', authenticateToken, validateNotificationQuery, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const {
      page = 1,
      limit = 20,
      type,
      priority,
      isRead,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = {
      recipientId: req.user?.id,
    };

    // Apply filters
    if (type) {
      where.type = type;
    }

    if (priority) {
      where.priority = priority;
    }

    if (isRead !== undefined) {
      where.isRead = isRead === 'true';
    }

    // Exclude expired notifications unless specifically requested
    if (!req.query.includeExpired) {
      where.OR = [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ];
    }

    // Build orderBy clause
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    // Get notifications with pagination
    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip,
        take: limitNum,
        orderBy,
        include: {
          sender: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
            },
          },
        },
      }),
      prisma.notification.count({ where }),
    ]);

    // Format notification data
    const formattedNotifications = notifications.map(formatNotificationData);

    const totalPages = Math.ceil(total / limitNum);

    const response: NotificationResponse = {
      success: true,
      message: 'Notifications retrieved successfully',
      data: { notifications: formattedNotifications },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get notifications error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/notifications/:id
 * @desc    Get notification by ID
 * @access  Private
 */
router.get('/:id', authenticateToken, [param('id').isUUID().withMessage('Invalid notification ID')], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { id } = req.params;

    const notification = await prisma.notification.findUnique({
      where: { id },
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
        recipient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
    }

    // Check access permissions
    const hasAccess = await canAccessNotification(req.user, notification);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to notification',
      });
    }

    // Mark as read if it's the recipient viewing it
    if (notification.recipientId === req.user?.id && !notification.isRead) {
      await prisma.notification.update({
        where: { id },
        data: { 
          isRead: true,
          readAt: new Date(),
        },
      });
      notification.isRead = true;
      notification.readAt = new Date();
    }

    const formattedNotification = formatNotificationData(notification);

    const response: NotificationResponse = {
      success: true,
      message: 'Notification retrieved successfully',
      data: { notification: formattedNotification },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get notification error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      notificationId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   POST /api/v1/notifications
 * @desc    Create notification
 * @access  Private (Healthcare providers and admins)
 */
router.post('/', authenticateToken, requireRole([UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.SUPER_ADMIN]), rateLimiters.notification, validateCreateNotification, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const {
      title,
      message,
      type,
      priority = NotificationPriority.MEDIUM,
      recipientIds,
      actionUrl,
      expiresAt,
      sendEmail = false,
      sendSms = false,
    } = req.body;

    // Verify recipients exist and user has permission to send to them
    const recipients = await prisma.user.findMany({
      where: {
        id: { in: recipientIds },
        status: 'ACTIVE',
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        facilityId: true,
      },
    });

    if (recipients.length !== recipientIds.length) {
      return res.status(400).json({
        success: false,
        message: 'Some recipients not found or inactive',
      });
    }

    // Check permission to send to recipients
    if (req.user?.role !== UserRole.SUPER_ADMIN) {
      const unauthorizedRecipients = recipients.filter(recipient => {
        if (req.user?.role === UserRole.ADMIN) {
          return recipient.facilityId !== req.user.facilityId;
        }
        // Doctors and nurses can only send to patients and colleagues in same facility
        return recipient.facilityId !== req.user?.facilityId;
      });

      if (unauthorizedRecipients.length > 0) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to some recipients',
        });
      }
    }

    // Create notifications
    const notifications = await Promise.all(
      recipients.map(async (recipient) => {
        const notification = await prisma.notification.create({
          data: {
            title,
            message,
            type,
            priority,
            recipientId: recipient.id,
            senderId: req.user?.id,
            actionUrl,
            expiresAt: expiresAt ? new Date(expiresAt) : null,
            createdAt: new Date(),
          },
          include: {
            sender: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
              },
            },
          },
        });

        // Send email notification if requested
        if (sendEmail && recipient.email) {
          try {
            await emailService.sendNotificationEmail({
              to: recipient.email,
              recipientName: `${recipient.firstName} ${recipient.lastName}`,
              title,
              message,
              actionUrl,
              priority,
            });
          } catch (emailError) {
            logger.warn('Failed to send notification email', {
              recipientId: recipient.id,
              email: recipient.email,
              error: emailError.message,
            });
          }
        }

        // Send SMS notification if requested
        if (sendSms && recipient.phone) {
          try {
            await smsService.sendNotificationSms({
              to: recipient.phone,
              recipientName: `${recipient.firstName} ${recipient.lastName}`,
              title,
              message,
              actionUrl,
            });
          } catch (smsError) {
            logger.warn('Failed to send notification SMS', {
              recipientId: recipient.id,
              phone: recipient.phone,
              error: smsError.message,
            });
          }
        }

        return notification;
      })
    );

    // Log audit event
    await auditService.log({
      action: 'NOTIFICATIONS_CREATED',
      userId: req.user?.id,
      resourceType: 'Notification',
      resourceId: notifications.map(n => n.id).join(','),
      details: {
        title,
        type,
        priority,
        recipientCount: recipients.length,
        sendEmail,
        sendSms,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Notifications created successfully', {
      count: notifications.length,
      createdBy: req.user?.id,
      type,
      priority,
    });

    const formattedNotifications = notifications.map(formatNotificationData);

    const response: NotificationResponse = {
      success: true,
      message: `${notifications.length} notification(s) created successfully`,
      data: { notifications: formattedNotifications },
    };

    res.status(201).json(response);
  } catch (error) {
    logger.error('Create notification error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during notification creation',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   POST /api/v1/notifications/bulk
 * @desc    Create bulk notifications
 * @access  Private (Admins only)
 */
router.post('/bulk', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), rateLimiters.notification, validateBulkNotification, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const {
      title,
      message,
      type,
      priority = NotificationPriority.MEDIUM,
      targetRole,
      facilityId,
      sendEmail = false,
      sendSms = false,
    } = req.body;

    // Build recipient filter
    const recipientFilter: any = {
      status: 'ACTIVE',
    };

    if (targetRole) {
      recipientFilter.role = targetRole;
    }

    if (facilityId) {
      recipientFilter.facilityId = facilityId;
    } else if (req.user?.role === UserRole.ADMIN && req.user?.facilityId) {
      // Admins can only send to users in their facility
      recipientFilter.facilityId = req.user.facilityId;
    }

    // Get recipients
    const recipients = await prisma.user.findMany({
      where: recipientFilter,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        facilityId: true,
      },
    });

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No recipients found matching criteria',
      });
    }

    // Create notifications in batches
    const batchSize = 100;
    const notifications = [];

    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      
      const batchNotifications = await Promise.all(
        batch.map(async (recipient) => {
          const notification = await prisma.notification.create({
            data: {
              title,
              message,
              type,
              priority,
              recipientId: recipient.id,
              senderId: req.user?.id,
              createdAt: new Date(),
            },
            include: {
              sender: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  role: true,
                },
              },
            },
          });

          // Send email notification if requested
          if (sendEmail && recipient.email) {
            try {
              await emailService.sendNotificationEmail({
                to: recipient.email,
                recipientName: `${recipient.firstName} ${recipient.lastName}`,
                title,
                message,
                priority,
              });
            } catch (emailError) {
              logger.warn('Failed to send bulk notification email', {
                recipientId: recipient.id,
                email: recipient.email,
                error: emailError.message,
              });
            }
          }

          // Send SMS notification if requested
          if (sendSms && recipient.phone) {
            try {
              await smsService.sendNotificationSms({
                to: recipient.phone,
                recipientName: `${recipient.firstName} ${recipient.lastName}`,
                title,
                message,
              });
            } catch (smsError) {
              logger.warn('Failed to send bulk notification SMS', {
                recipientId: recipient.id,
                phone: recipient.phone,
                error: smsError.message,
              });
            }
          }

          return notification;
        })
      );

      notifications.push(...batchNotifications);
    }

    // Log audit event
    await auditService.log({
      action: 'BULK_NOTIFICATIONS_CREATED',
      userId: req.user?.id,
      resourceType: 'Notification',
      resourceId: notifications.map(n => n.id).join(','),
      details: {
        title,
        type,
        priority,
        recipientCount: recipients.length,
        targetRole,
        facilityId,
        sendEmail,
        sendSms,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Bulk notifications created successfully', {
      count: notifications.length,
      createdBy: req.user?.id,
      type,
      priority,
      targetRole,
      facilityId,
    });

    const response: NotificationResponse = {
      success: true,
      message: `${notifications.length} bulk notification(s) created successfully`,
      data: { 
        notificationCount: notifications.length,
        recipientCount: recipients.length,
      },
    };

    res.status(201).json(response);
  } catch (error) {
    logger.error('Create bulk notification error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during bulk notification creation',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   PUT /api/v1/notifications/:id/read
 * @desc    Mark notification as read
 * @access  Private
 */
router.put('/:id/read', authenticateToken, [param('id').isUUID().withMessage('Invalid notification ID')], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { id } = req.params;

    const notification = await prisma.notification.findUnique({
      where: { id },
      select: {
        id: true,
        recipientId: true,
        isRead: true,
      },
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
    }

    // Only recipient can mark as read
    if (notification.recipientId !== req.user?.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to notification',
      });
    }

    if (notification.isRead) {
      return res.status(400).json({
        success: false,
        message: 'Notification already marked as read',
      });
    }

    const updatedNotification = await prisma.notification.update({
      where: { id },
      data: {
        isRead: true,
        readAt: new Date(),
      },
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    const formattedNotification = formatNotificationData(updatedNotification);

    const response: NotificationResponse = {
      success: true,
      message: 'Notification marked as read',
      data: { notification: formattedNotification },
    };

    res.json(response);
  } catch (error) {
    logger.error('Mark notification as read error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      notificationId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   PUT /api/v1/notifications/read-all
 * @desc    Mark all notifications as read
 * @access  Private
 */
router.put('/read-all', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const result = await prisma.notification.updateMany({
      where: {
        recipientId: req.user?.id,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    logger.info('All notifications marked as read', {
      userId: req.user?.id,
      count: result.count,
    });

    const response: NotificationResponse = {
      success: true,
      message: `${result.count} notification(s) marked as read`,
      data: { updatedCount: result.count },
    };

    res.json(response);
  } catch (error) {
    logger.error('Mark all notifications as read error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   DELETE /api/v1/notifications/:id
 * @desc    Delete notification
 * @access  Private
 */
router.delete('/:id', authenticateToken, [param('id').isUUID().withMessage('Invalid notification ID')], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { id } = req.params;

    const notification = await prisma.notification.findUnique({
      where: { id },
      select: {
        id: true,
        recipientId: true,
        senderId: true,
        title: true,
      },
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
    }

    // Check access permissions
    const hasAccess = await canAccessNotification(req.user, notification);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to notification',
      });
    }

    await prisma.notification.delete({
      where: { id },
    });

    // Log audit event
    await auditService.log({
      action: 'NOTIFICATION_DELETED',
      userId: req.user?.id,
      resourceType: 'Notification',
      resourceId: id,
      details: {
        title: notification.title,
        recipientId: notification.recipientId,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Notification deleted successfully', {
      notificationId: id,
      deletedBy: req.user?.id,
    });

    const response: NotificationResponse = {
      success: true,
      message: 'Notification deleted successfully',
    };

    res.json(response);
  } catch (error) {
    logger.error('Delete notification error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      notificationId: req.params.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during notification deletion',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/notifications/unread/count
 * @desc    Get unread notification count
 * @access  Private
 */
router.get('/unread/count', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const count = await prisma.notification.count({
      where: {
        recipientId: req.user?.id,
        isRead: false,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });

    const response: NotificationResponse = {
      success: true,
      message: 'Unread notification count retrieved successfully',
      data: { count },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get unread notification count error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /api/v1/notifications/stats
 * @desc    Get notification statistics
 * @access  Private (Admins only)
 */
router.get('/stats', authenticateToken, requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]), async (req: AuthRequest, res: Response) => {
  try {
    const facilityFilter = req.user?.role !== UserRole.SUPER_ADMIN && req.user?.facilityId
      ? {
          recipient: {
            facilityId: req.user.facilityId,
          },
        }
      : {};

    const [totalNotifications, unreadNotifications, notificationsByType, notificationsByPriority, recentNotifications] = await Promise.all([
      prisma.notification.count({ where: facilityFilter }),
      prisma.notification.count({
        where: {
          ...facilityFilter,
          isRead: false,
        },
      }),
      prisma.notification.groupBy({
        by: ['type'],
        where: facilityFilter,
        _count: {
          id: true,
        },
      }),
      prisma.notification.groupBy({
        by: ['priority'],
        where: facilityFilter,
        _count: {
          id: true,
        },
      }),
      prisma.notification.count({
        where: {
          ...facilityFilter,
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        },
      }),
    ]);

    const typeStats = notificationsByType.reduce((acc, item) => {
      acc[item.type] = item._count.id;
      return acc;
    }, {} as Record<string, number>);

    const priorityStats = notificationsByPriority.reduce((acc, item) => {
      acc[item.priority] = item._count.id;
      return acc;
    }, {} as Record<string, number>);

    const stats = {
      totalNotifications,
      unreadNotifications,
      readRate: totalNotifications > 0 ? ((totalNotifications - unreadNotifications) / totalNotifications * 100).toFixed(2) : '0.00',
      notificationsByType: typeStats,
      notificationsByPriority: priorityStats,
      recentNotifications,
    };

    const response: NotificationResponse = {
      success: true,
      message: 'Notification statistics retrieved successfully',
      data: { stats },
    };

    res.json(response);
  } catch (error) {
    logger.error('Get notification stats error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

export default router;