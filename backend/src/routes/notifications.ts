/**
 * ============================================================================
 * NOVA CHECK EHR - NOTIFICATION ROUTES
 * ============================================================================
 * 
 * RESTful API routes for notification management.
 * Handles email, SMS, and in-app notifications.
 */

import { Router, Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { NotificationModel, createApiResponse, createErrorResponse, validatePagination } from '../models';
import { authenticateToken, requireRole } from '../middleware/auth';
import { createAuditMiddleware } from '../models/Audit';
import { logger } from '../utils/logger';
import { PrismaClient } from '@prisma/client';

// ============================================================================
// ROUTER SETUP
// ============================================================================

const router = Router();
const prisma = new PrismaClient();
const notificationModel = new NotificationModel(prisma);
const auditMiddleware = createAuditMiddleware(prisma);

// ============================================================================
// VALIDATION RULES
// ============================================================================

const createNotificationValidation = [
  body('userId').isUUID(),
  body('type').isIn(['EMAIL', 'SMS', 'IN_APP', 'PUSH']),
  body('title').notEmpty().trim().isLength({ min: 1, max: 200 }),
  body('message').notEmpty().trim().isLength({ min: 1, max: 2000 }),
  body('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  body('category').optional().isIn(['APPOINTMENT', 'REMINDER', 'ALERT', 'SYSTEM', 'MARKETING']),
  body('scheduledFor').optional().isISO8601().toDate(),
  body('metadata').optional().isObject(),
];

const bulkNotificationValidation = [
  body('userIds').isArray({ min: 1, max: 1000 }),
  body('userIds.*').isUUID(),
  body('type').isIn(['EMAIL', 'SMS', 'IN_APP', 'PUSH']),
  body('title').notEmpty().trim().isLength({ min: 1, max: 200 }),
  body('message').notEmpty().trim().isLength({ min: 1, max: 2000 }),
  body('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  body('category').optional().isIn(['APPOINTMENT', 'REMINDER', 'ALERT', 'SYSTEM', 'MARKETING']),
  body('scheduledFor').optional().isISO8601().toDate(),
  body('metadata').optional().isObject(),
];

const updateStatusValidation = [
  param('id').isUUID(),
  body('status').isIn(['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ']),
  body('errorMessage').optional().trim().isLength({ max: 500 }),
];

const preferencesValidation = [
  body('emailEnabled').optional().isBoolean(),
  body('smsEnabled').optional().isBoolean(),
  body('inAppEnabled').optional().isBoolean(),
  body('pushEnabled').optional().isBoolean(),
  body('appointmentReminders').optional().isBoolean(),
  body('systemAlerts').optional().isBoolean(),
  body('marketingEmails').optional().isBoolean(),
  body('reminderHours').optional().isInt({ min: 1, max: 168 }),
  body('quietHoursStart').optional().matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('quietHoursEnd').optional().matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
];

const searchValidation = [
  query('search').optional().trim().isLength({ min: 1, max: 200 }),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('sortBy').optional().isIn(['createdAt', 'scheduledFor', 'sentAt', 'priority']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
  query('status').optional().isIn(['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ']),
  query('type').optional().isIn(['EMAIL', 'SMS', 'IN_APP', 'PUSH']),
  query('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  query('category').optional().isIn(['APPOINTMENT', 'REMINDER', 'ALERT', 'SYSTEM', 'MARKETING']),
  query('userId').optional().isUUID(),
  query('startDate').optional().isISO8601().toDate(),
  query('endDate').optional().isISO8601().toDate(),
  query('unreadOnly').optional().isBoolean(),
];

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Validate request and handle errors
 */
const handleValidation = (req: Request, res: Response, next: any) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(
      createErrorResponse('Validation failed', errors.array().map(e => e.msg).join(', '))
    );
  }
  next();
};

/**
 * Check if notification exists and user has access
 */
const checkNotificationAccess = async (req: Request, res: Response, next: any) => {
  try {
    const { id } = req.params;
    const notification = await notificationModel.findById(id);
    
    if (!notification) {
      return res.status(404).json(
        createErrorResponse('Notification not found')
      );
    }

    const user = (req as any).user;
    
    // Users can only access their own notifications unless they're admin
    if (user.role !== 'ADMIN' && notification.userId !== user.id) {
      return res.status(403).json(
        createErrorResponse('Access denied')
      );
    }

    // Store notification in request for use in route handlers
    (req as any).notification = notification;
    next();
  } catch (error) {
    logger.error('Error checking notification access:', error);
    res.status(500).json(
      createErrorResponse('Internal server error')
    );
  }
};

// ============================================================================
// NOTIFICATION ROUTES
// ============================================================================

/**
 * @route   POST /api/notifications
 * @desc    Create a new notification
 * @access  Private (Admin, Provider, Staff)
 */
router.post('/',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  createNotificationValidation,
  handleValidation,
  auditMiddleware('NOTIFICATION_CREATE'),
  async (req: Request, res: Response) => {
    try {
      const notificationData = req.body;
      const createdBy = (req as any).user.id;

      const notification = await notificationModel.create({
        ...notificationData,
        createdBy,
      });

      logger.info(`Notification created: ${notification.id}`, {
        notificationId: notification.id,
        userId: notification.userId,
        type: notification.type,
        createdBy,
      });

      res.status(201).json(
        createApiResponse(notification, true, 'Notification created successfully')
      );
    } catch (error) {
      logger.error('Error creating notification:', error);
      res.status(500).json(
        createErrorResponse('Failed to create notification')
      );
    }
  }
);

/**
 * @route   POST /api/notifications/bulk
 * @desc    Create bulk notifications
 * @access  Private (Admin, Provider)
 */
router.post('/bulk',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  bulkNotificationValidation,
  handleValidation,
  auditMiddleware('NOTIFICATION_BULK_CREATE'),
  async (req: Request, res: Response) => {
    try {
      const { userIds, ...notificationData } = req.body;
      const createdBy = (req as any).user.id;

      const result = await notificationModel.createBulk({
        userIds,
        ...notificationData,
        createdBy,
      });

      logger.info(`Bulk notifications created: ${result.created} notifications`, {
        userCount: userIds.length,
        created: result.created,
        failed: result.failed,
        createdBy,
      });

      res.status(201).json(
        createApiResponse(result, true, `${result.created} notifications created successfully`)
      );
    } catch (error) {
      logger.error('Error creating bulk notifications:', error);
      res.status(500).json(
        createErrorResponse('Failed to create bulk notifications')
      );
    }
  }
);

/**
 * @route   GET /api/notifications
 * @desc    Get notifications with search and pagination
 * @access  Private (Admin, Provider, Staff, Patient)
 */
router.get('/',
  authenticateToken,
  searchValidation,
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const pagination = validatePagination({
        page: req.query.page as any,
        limit: req.query.limit as any,
        sortBy: req.query.sortBy as string,
        sortOrder: req.query.sortOrder as 'asc' | 'desc',
      });

      const filters = {
        search: req.query.search as string,
        status: req.query.status as any,
        type: req.query.type as any,
        priority: req.query.priority as any,
        category: req.query.category as any,
        userId: req.query.userId as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        unreadOnly: req.query.unreadOnly === 'true',
      };

      // Non-admin users can only see their own notifications
      if (user.role !== 'ADMIN') {
        filters.userId = user.id;
      }

      // Remove undefined values
      Object.keys(filters).forEach(key => {
        if (filters[key as keyof typeof filters] === undefined) {
          delete filters[key as keyof typeof filters];
        }
      });

      const result = await notificationModel.findMany(filters, pagination);

      res.json(
        createApiResponse(result.data, true, undefined, result.pagination)
      );
    } catch (error) {
      logger.error('Error fetching notifications:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch notifications')
      );
    }
  }
);

/**
 * @route   GET /api/notifications/unread
 * @desc    Get unread notifications for current user
 * @access  Private (All authenticated users)
 */
router.get('/unread',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id;
      const notifications = await notificationModel.getUnreadForUser(userId);

      res.json(
        createApiResponse(notifications, true, 'Unread notifications retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching unread notifications:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch unread notifications')
      );
    }
  }
);

/**
 * @route   GET /api/notifications/pending
 * @desc    Get pending notifications (for processing)
 * @access  Private (Admin only)
 */
router.get('/pending',
  authenticateToken,
  requireRole(['ADMIN']),
  async (req: Request, res: Response) => {
    try {
      const notifications = await notificationModel.getPendingNotifications();

      res.json(
        createApiResponse(notifications, true, 'Pending notifications retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching pending notifications:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch pending notifications')
      );
    }
  }
);

/**
 * @route   GET /api/notifications/stats
 * @desc    Get notification statistics
 * @access  Private (Admin, Provider)
 */
router.get('/stats',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  async (req: Request, res: Response) => {
    try {
      const stats = await notificationModel.getStats();

      res.json(
        createApiResponse(stats, true, 'Notification statistics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching notification stats:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch notification statistics')
      );
    }
  }
);

/**
 * @route   GET /api/notifications/:id
 * @desc    Get notification by ID
 * @access  Private (Owner or Admin)
 */
router.get('/:id',
  authenticateToken,
  [param('id').isUUID()],
  handleValidation,
  checkNotificationAccess,
  async (req: Request, res: Response) => {
    try {
      const notification = (req as any).notification;

      res.json(
        createApiResponse(notification, true, 'Notification retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching notification:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch notification')
      );
    }
  }
);

/**
 * @route   PATCH /api/notifications/:id/status
 * @desc    Update notification status
 * @access  Private (Admin, Provider, Staff)
 */
router.patch('/:id/status',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  updateStatusValidation,
  handleValidation,
  checkNotificationAccess,
  auditMiddleware('NOTIFICATION_STATUS_UPDATE'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status, errorMessage } = req.body;

      const notification = await notificationModel.updateStatus(id, status, errorMessage);

      logger.info(`Notification status updated: ${id}`, {
        notificationId: id,
        status,
        updatedBy: (req as any).user.id,
      });

      res.json(
        createApiResponse(notification, true, 'Notification status updated successfully')
      );
    } catch (error) {
      logger.error('Error updating notification status:', error);
      res.status(500).json(
        createErrorResponse('Failed to update notification status')
      );
    }
  }
);

/**
 * @route   PATCH /api/notifications/:id/read
 * @desc    Mark notification as read
 * @access  Private (Owner or Admin)
 */
router.patch('/:id/read',
  authenticateToken,
  [param('id').isUUID()],
  handleValidation,
  checkNotificationAccess,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const notification = await notificationModel.markAsRead(id);

      res.json(
        createApiResponse(notification, true, 'Notification marked as read')
      );
    } catch (error) {
      logger.error('Error marking notification as read:', error);
      res.status(500).json(
        createErrorResponse('Failed to mark notification as read')
      );
    }
  }
);

/**
 * @route   PATCH /api/notifications/read-all
 * @desc    Mark all notifications as read for current user
 * @access  Private (All authenticated users)
 */
router.patch('/read-all',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id;
      const result = await notificationModel.markAllAsRead(userId);

      logger.info(`All notifications marked as read for user: ${userId}`, {
        userId,
        count: result.count,
      });

      res.json(
        createApiResponse(result, true, `${result.count} notifications marked as read`)
      );
    } catch (error) {
      logger.error('Error marking all notifications as read:', error);
      res.status(500).json(
        createErrorResponse('Failed to mark all notifications as read')
      );
    }
  }
);

// ============================================================================
// NOTIFICATION PREFERENCES ROUTES
// ============================================================================

/**
 * @route   GET /api/notifications/preferences/:userId
 * @desc    Get user notification preferences
 * @access  Private (Owner or Admin)
 */
router.get('/preferences/:userId',
  authenticateToken,
  [param('userId').isUUID()],
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const currentUser = (req as any).user;

      // Users can only access their own preferences unless they're admin
      if (currentUser.role !== 'ADMIN' && userId !== currentUser.id) {
        return res.status(403).json(
          createErrorResponse('Access denied')
        );
      }

      const preferences = await notificationModel.getUserPreferences(userId);

      res.json(
        createApiResponse(preferences, true, 'Notification preferences retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching notification preferences:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch notification preferences')
      );
    }
  }
);

/**
 * @route   PUT /api/notifications/preferences/:userId
 * @desc    Update user notification preferences
 * @access  Private (Owner or Admin)
 */
router.put('/preferences/:userId',
  authenticateToken,
  [param('userId').isUUID()],
  preferencesValidation,
  handleValidation,
  auditMiddleware('NOTIFICATION_PREFERENCES_UPDATE'),
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const currentUser = (req as any).user;
      const preferencesData = req.body;

      // Users can only update their own preferences unless they're admin
      if (currentUser.role !== 'ADMIN' && userId !== currentUser.id) {
        return res.status(403).json(
          createErrorResponse('Access denied')
        );
      }

      const preferences = await notificationModel.updateUserPreferences(userId, preferencesData);

      logger.info(`Notification preferences updated for user: ${userId}`, {
        userId,
        updatedBy: currentUser.id,
      });

      res.json(
        createApiResponse(preferences, true, 'Notification preferences updated successfully')
      );
    } catch (error) {
      logger.error('Error updating notification preferences:', error);
      res.status(500).json(
        createErrorResponse('Failed to update notification preferences')
      );
    }
  }
);

// ============================================================================
// APPOINTMENT REMINDER ROUTES
// ============================================================================

/**
 * @route   POST /api/notifications/appointment-reminder
 * @desc    Create appointment reminder notification
 * @access  Private (Admin, Provider, Staff)
 */
router.post('/appointment-reminder',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [
    body('appointmentId').isUUID(),
    body('reminderType').isIn(['24_HOURS', '2_HOURS', '30_MINUTES']),
    body('notificationTypes').isArray({ min: 1 }),
    body('notificationTypes.*').isIn(['EMAIL', 'SMS', 'IN_APP']),
  ],
  handleValidation,
  auditMiddleware('APPOINTMENT_REMINDER_CREATE'),
  async (req: Request, res: Response) => {
    try {
      const { appointmentId, reminderType, notificationTypes } = req.body;
      const createdBy = (req as any).user.id;

      const notifications = await notificationModel.createAppointmentReminder(
        appointmentId,
        reminderType,
        notificationTypes,
        createdBy
      );

      logger.info(`Appointment reminder created: ${appointmentId}`, {
        appointmentId,
        reminderType,
        notificationTypes,
        count: notifications.length,
        createdBy,
      });

      res.status(201).json(
        createApiResponse(notifications, true, 'Appointment reminder notifications created successfully')
      );
    } catch (error) {
      logger.error('Error creating appointment reminder:', error);
      res.status(500).json(
        createErrorResponse('Failed to create appointment reminder')
      );
    }
  }
);

// ============================================================================
// CLEANUP ROUTES
// ============================================================================

/**
 * @route   DELETE /api/notifications/cleanup
 * @desc    Clean up old notifications
 * @access  Private (Admin only)
 */
router.delete('/cleanup',
  authenticateToken,
  requireRole(['ADMIN']),
  [
    query('days').optional().isInt({ min: 1, max: 365 }).toInt(),
  ],
  handleValidation,
  auditMiddleware('NOTIFICATION_CLEANUP'),
  async (req: Request, res: Response) => {
    try {
      const days = (req.query.days as any) || 90; // Default to 90 days
      const result = await notificationModel.deleteOldNotifications(days);

      logger.info(`Old notifications cleaned up`, {
        days,
        deletedCount: result.count,
        performedBy: (req as any).user.id,
      });

      res.json(
        createApiResponse(result, true, `${result.count} old notifications deleted`)
      );
    } catch (error) {
      logger.error('Error cleaning up notifications:', error);
      res.status(500).json(
        createErrorResponse('Failed to clean up notifications')
      );
    }
  }
);

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Global error handler for notification routes
 */
router.use((error: any, req: Request, res: Response, next: any) => {
  logger.error('Notification route error:', error);
  
  if (error.code === 'P2002') {
    return res.status(409).json(
      createErrorResponse('Notification with this information already exists')
    );
  }
  
  if (error.code === 'P2025') {
    return res.status(404).json(
      createErrorResponse('Notification not found')
    );
  }
  
  res.status(500).json(
    createErrorResponse('Internal server error')
  );
});

// ============================================================================
// EXPORTS
// ============================================================================

export default router;