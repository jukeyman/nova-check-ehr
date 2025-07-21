/**
 * ============================================================================
 * NOVA CHECK EHR - AUDIT MODEL
 * ============================================================================
 */

import { PrismaClient, AuditLog as PrismaAuditLog, AuditAction, AuditResource } from '@prisma/client';
import { logger } from '../utils/logger';
import { AppError, ValidationError } from '../utils/errors';
import { generateUniqueId } from '../utils/generators';
import { formatDate } from '../utils/helpers';
import { Request } from 'express';

// ============================================================================
// INTERFACES
// ============================================================================

export interface AuditLogWithRelations extends PrismaAuditLog {
  user?: any;
  patient?: any;
}

export interface AuditSearchFilters {
  action?: AuditAction;
  resource?: AuditResource;
  userId?: string;
  patientId?: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  success?: boolean;
}

export interface AuditStats {
  totalEvents: number;
  eventsByAction: Record<AuditAction, number>;
  eventsByResource: Record<AuditResource, number>;
  eventsByUser: Record<string, number>;
  eventsBySeverity: Record<string, number>;
  recentEvents: number;
  failedEvents: number;
  suspiciousActivities: number;
  topUsers: { userId: string; userName: string; count: number }[];
  topResources: { resource: AuditResource; count: number }[];
}

export interface AuditEvent {
  action: AuditAction;
  resource: AuditResource;
  resourceId?: string;
  userId?: string;
  patientId?: string;
  details?: Record<string, any>;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  success?: boolean;
  errorMessage?: string;
  duration?: number;
}

export interface ComplianceReport {
  period: {
    startDate: Date;
    endDate: Date;
  };
  summary: {
    totalEvents: number;
    successfulEvents: number;
    failedEvents: number;
    suspiciousEvents: number;
    complianceScore: number;
  };
  dataAccess: {
    patientRecordAccesses: number;
    unauthorizedAttempts: number;
    afterHoursAccess: number;
    bulkDataExports: number;
  };
  userActivity: {
    activeUsers: number;
    newUsers: number;
    suspendedUsers: number;
    passwordChanges: number;
    failedLogins: number;
  };
  systemSecurity: {
    loginAttempts: number;
    accountLockouts: number;
    privilegeEscalations: number;
    dataModifications: number;
  };
  violations: {
    hipaaViolations: number;
    accessViolations: number;
    dataIntegrityIssues: number;
    securityIncidents: number;
  };
}

export interface SecurityAlert {
  id: string;
  type: 'SUSPICIOUS_ACCESS' | 'FAILED_LOGIN' | 'DATA_BREACH' | 'PRIVILEGE_ESCALATION' | 'UNUSUAL_ACTIVITY';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  userId?: string;
  patientId?: string;
  resourceId?: string;
  ipAddress?: string;
  timestamp: Date;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: Date;
  notes?: string;
}

// ============================================================================
// AUDIT MODEL CLASS
// ============================================================================

export class AuditModel {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Log an audit event
   */
  async log(event: AuditEvent): Promise<AuditLogWithRelations> {
    try {
      // Generate audit ID
      const auditId = generateUniqueId('AUD');

      // Determine severity if not provided
      const severity = event.severity || this.determineSeverity(event);

      // Create audit log entry
      const auditLog = await this.prisma.auditLog.create({
        data: {
          id: auditId,
          action: event.action,
          resource: event.resource,
          resourceId: event.resourceId,
          userId: event.userId,
          patientId: event.patientId,
          details: event.details || {},
          metadata: {
            ...event.metadata,
            severity,
            success: event.success !== false, // Default to true if not specified
            duration: event.duration,
            errorMessage: event.errorMessage,
          },
          ipAddress: event.ipAddress,
          userAgent: event.userAgent,
          sessionId: event.sessionId,
          timestamp: new Date(),
        },
        include: {
          user: event.userId ? {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
            },
          } : undefined,
          patient: event.patientId ? {
            select: {
              id: true,
              patientId: true,
              firstName: true,
              lastName: true,
            },
          } : undefined,
        },
      });

      // Check for suspicious activity
      if (severity === 'HIGH' || severity === 'CRITICAL' || event.success === false) {
        this.checkSuspiciousActivity(auditLog).catch(error => {
          logger.error('Error checking suspicious activity', {
            component: 'AuditModel',
            auditId,
            error: error.message,
          });
        });
      }

      logger.info('Audit event logged', {
        component: 'AuditModel',
        auditId,
        action: event.action,
        resource: event.resource,
        userId: event.userId,
        severity,
      });

      return auditLog;
    } catch (error) {
      logger.error('Error logging audit event', {
        component: 'AuditModel',
        error: (error as Error).message,
        event: {
          action: event.action,
          resource: event.resource,
          userId: event.userId,
        },
      });
      throw new AppError('Failed to log audit event', 500);
    }
  }

  /**
   * Log from Express request
   */
  async logFromRequest(
    req: Request,
    action: AuditAction,
    resource: AuditResource,
    resourceId?: string,
    details?: Record<string, any>,
    success: boolean = true,
    errorMessage?: string
  ): Promise<AuditLogWithRelations> {
    const event: AuditEvent = {
      action,
      resource,
      resourceId,
      userId: (req as any).user?.id,
      patientId: req.params.patientId || req.body.patientId,
      details,
      ipAddress: this.getClientIP(req),
      userAgent: req.get('User-Agent'),
      sessionId: (req as any).sessionID,
      success,
      errorMessage,
    };

    return this.log(event);
  }

  /**
   * Find audit logs with filters and pagination
   */
  async findMany(
    filters: AuditSearchFilters = {},
    page: number = 1,
    limit: number = 50,
    sortBy: string = 'timestamp',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<{ auditLogs: AuditLogWithRelations[]; total: number; pages: number }> {
    try {
      const skip = (page - 1) * limit;
      
      // Build where clause
      const where: any = {};

      if (filters.action) {
        where.action = filters.action;
      }

      if (filters.resource) {
        where.resource = filters.resource;
      }

      if (filters.userId) {
        where.userId = filters.userId;
      }

      if (filters.patientId) {
        where.patientId = filters.patientId;
      }

      if (filters.resourceId) {
        where.resourceId = filters.resourceId;
      }

      if (filters.ipAddress) {
        where.ipAddress = filters.ipAddress;
      }

      if (filters.userAgent) {
        where.userAgent = { contains: filters.userAgent, mode: 'insensitive' };
      }

      if (filters.dateFrom || filters.dateTo) {
        where.timestamp = {};
        if (filters.dateFrom) {
          where.timestamp.gte = filters.dateFrom;
        }
        if (filters.dateTo) {
          where.timestamp.lte = filters.dateTo;
        }
      }

      if (filters.severity) {
        where.metadata = {
          path: ['severity'],
          equals: filters.severity,
        };
      }

      if (filters.success !== undefined) {
        where.metadata = {
          ...where.metadata,
          path: ['success'],
          equals: filters.success,
        };
      }

      if (filters.search) {
        where.OR = [
          { details: { string_contains: filters.search } },
          { resourceId: { contains: filters.search, mode: 'insensitive' } },
          { ipAddress: { contains: filters.search, mode: 'insensitive' } },
        ];
      }

      // Get audit logs and total count
      const [auditLogs, total] = await Promise.all([
        this.prisma.auditLog.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
              },
            },
            patient: {
              select: {
                id: true,
                patientId: true,
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        this.prisma.auditLog.count({ where }),
      ]);

      const pages = Math.ceil(total / limit);

      return { auditLogs, total, pages };
    } catch (error) {
      logger.error('Error finding audit logs', {
        component: 'AuditModel',
        error: (error as Error).message,
        filters,
      });
      throw new AppError('Failed to find audit logs', 500);
    }
  }

  /**
   * Get audit statistics
   */
  async getStats(dateFrom?: Date, dateTo?: Date): Promise<AuditStats> {
    try {
      const where: any = {};
      
      if (dateFrom || dateTo) {
        where.timestamp = {};
        if (dateFrom) {
          where.timestamp.gte = dateFrom;
        }
        if (dateTo) {
          where.timestamp.lte = dateTo;
        }
      }

      const [totalEvents, eventsByAction, eventsByResource, eventsByUser, recentEvents, failedEvents] = await Promise.all([
        this.prisma.auditLog.count({ where }),
        this.prisma.auditLog.groupBy({
          by: ['action'],
          where,
          _count: true,
        }),
        this.prisma.auditLog.groupBy({
          by: ['resource'],
          where,
          _count: true,
        }),
        this.prisma.auditLog.groupBy({
          by: ['userId'],
          where: {
            ...where,
            userId: { not: null },
          },
          _count: true,
        }),
        this.prisma.auditLog.count({
          where: {
            ...where,
            timestamp: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
            },
          },
        }),
        this.prisma.auditLog.count({
          where: {
            ...where,
            metadata: {
              path: ['success'],
              equals: false,
            },
          },
        }),
      ]);

      // Get top users with names
      const topUsersData = await this.prisma.auditLog.groupBy({
        by: ['userId'],
        where: {
          ...where,
          userId: { not: null },
        },
        _count: true,
        orderBy: {
          _count: {
            userId: 'desc',
          },
        },
        take: 10,
      });

      const topUsers = await Promise.all(
        topUsersData.map(async (item) => {
          const user = await this.prisma.user.findUnique({
            where: { id: item.userId! },
            select: {
              firstName: true,
              lastName: true,
            },
          });
          return {
            userId: item.userId!,
            userName: user ? `${user.firstName} ${user.lastName}` : 'Unknown User',
            count: item._count,
          };
        })
      );

      // Format action stats
      const actionStats = eventsByAction.reduce((acc, item) => {
        acc[item.action] = item._count;
        return acc;
      }, {} as Record<AuditAction, number>);

      // Ensure all actions are represented
      Object.values(AuditAction).forEach(action => {
        if (!(action in actionStats)) {
          actionStats[action] = 0;
        }
      });

      // Format resource stats
      const resourceStats = eventsByResource.reduce((acc, item) => {
        acc[item.resource] = item._count;
        return acc;
      }, {} as Record<AuditResource, number>);

      // Ensure all resources are represented
      Object.values(AuditResource).forEach(resource => {
        if (!(resource in resourceStats)) {
          resourceStats[resource] = 0;
        }
      });

      // Format user stats
      const userStats = eventsByUser.reduce((acc, item) => {
        if (item.userId) {
          acc[item.userId] = item._count;
        }
        return acc;
      }, {} as Record<string, number>);

      // Calculate suspicious activities (high severity events)
      const suspiciousActivities = await this.prisma.auditLog.count({
        where: {
          ...where,
          OR: [
            {
              metadata: {
                path: ['severity'],
                equals: 'HIGH',
              },
            },
            {
              metadata: {
                path: ['severity'],
                equals: 'CRITICAL',
              },
            },
          ],
        },
      });

      // Get severity stats
      const severityStats = {
        LOW: 0,
        MEDIUM: 0,
        HIGH: 0,
        CRITICAL: 0,
      };

      // Top resources
      const topResources = eventsByResource
        .sort((a, b) => b._count - a._count)
        .slice(0, 10)
        .map(item => ({
          resource: item.resource,
          count: item._count,
        }));

      return {
        totalEvents,
        eventsByAction: actionStats,
        eventsByResource: resourceStats,
        eventsByUser: userStats,
        eventsBySeverity: severityStats,
        recentEvents,
        failedEvents,
        suspiciousActivities,
        topUsers,
        topResources,
      };
    } catch (error) {
      logger.error('Error getting audit stats', {
        component: 'AuditModel',
        error: (error as Error).message,
      });
      throw new AppError('Failed to get audit statistics', 500);
    }
  }

  /**
   * Generate compliance report
   */
  async generateComplianceReport(dateFrom: Date, dateTo: Date): Promise<ComplianceReport> {
    try {
      const dateFilter = {
        gte: dateFrom,
        lte: dateTo,
      };

      // Get summary statistics
      const [totalEvents, successfulEvents, failedEvents, suspiciousEvents] = await Promise.all([
        this.prisma.auditLog.count({
          where: {
            timestamp: dateFilter,
          },
        }),
        this.prisma.auditLog.count({
          where: {
            timestamp: dateFilter,
            metadata: {
              path: ['success'],
              equals: true,
            },
          },
        }),
        this.prisma.auditLog.count({
          where: {
            timestamp: dateFilter,
            metadata: {
              path: ['success'],
              equals: false,
            },
          },
        }),
        this.prisma.auditLog.count({
          where: {
            timestamp: dateFilter,
            OR: [
              {
                metadata: {
                  path: ['severity'],
                  equals: 'HIGH',
                },
              },
              {
                metadata: {
                  path: ['severity'],
                  equals: 'CRITICAL',
                },
              },
            ],
          },
        }),
      ]);

      // Calculate compliance score (percentage of successful events)
      const complianceScore = totalEvents > 0 ? Math.round((successfulEvents / totalEvents) * 100) : 100;

      // Get data access metrics
      const [patientRecordAccesses, unauthorizedAttempts, bulkDataExports] = await Promise.all([
        this.prisma.auditLog.count({
          where: {
            timestamp: dateFilter,
            resource: AuditResource.PATIENT,
            action: { in: [AuditAction.READ, AuditAction.UPDATE] },
          },
        }),
        this.prisma.auditLog.count({
          where: {
            timestamp: dateFilter,
            metadata: {
              path: ['success'],
              equals: false,
            },
            action: AuditAction.READ,
          },
        }),
        this.prisma.auditLog.count({
          where: {
            timestamp: dateFilter,
            action: AuditAction.EXPORT,
          },
        }),
      ]);

      // Get after-hours access (assuming business hours are 8 AM to 6 PM)
      const afterHoursAccess = await this.prisma.auditLog.count({
        where: {
          timestamp: dateFilter,
          OR: [
            {
              timestamp: {
                ...dateFilter,
                // This would need custom SQL for time-based filtering
              },
            },
          ],
        },
      });

      // Get user activity metrics
      const [activeUsers, newUsers, passwordChanges, failedLogins] = await Promise.all([
        this.prisma.auditLog.groupBy({
          by: ['userId'],
          where: {
            timestamp: dateFilter,
            userId: { not: null },
          },
        }).then(result => result.length),
        this.prisma.user.count({
          where: {
            createdAt: dateFilter,
          },
        }),
        this.prisma.auditLog.count({
          where: {
            timestamp: dateFilter,
            action: AuditAction.UPDATE,
            resource: AuditResource.USER,
            details: {
              path: ['field'],
              equals: 'password',
            },
          },
        }),
        this.prisma.auditLog.count({
          where: {
            timestamp: dateFilter,
            action: AuditAction.LOGIN,
            metadata: {
              path: ['success'],
              equals: false,
            },
          },
        }),
      ]);

      // Get system security metrics
      const [loginAttempts, accountLockouts, privilegeEscalations, dataModifications] = await Promise.all([
        this.prisma.auditLog.count({
          where: {
            timestamp: dateFilter,
            action: AuditAction.LOGIN,
          },
        }),
        this.prisma.auditLog.count({
          where: {
            timestamp: dateFilter,
            action: AuditAction.LOCK,
            resource: AuditResource.USER,
          },
        }),
        this.prisma.auditLog.count({
          where: {
            timestamp: dateFilter,
            action: AuditAction.UPDATE,
            resource: AuditResource.USER,
            details: {
              path: ['field'],
              equals: 'role',
            },
          },
        }),
        this.prisma.auditLog.count({
          where: {
            timestamp: dateFilter,
            action: { in: [AuditAction.CREATE, AuditAction.UPDATE, AuditAction.DELETE] },
            resource: { in: [AuditResource.PATIENT, AuditResource.ENCOUNTER, AuditResource.PRESCRIPTION] },
          },
        }),
      ]);

      // Calculate violations (placeholder - would need more sophisticated logic)
      const violations = {
        hipaaViolations: Math.floor(unauthorizedAttempts * 0.1), // Estimate
        accessViolations: unauthorizedAttempts,
        dataIntegrityIssues: Math.floor(failedEvents * 0.05), // Estimate
        securityIncidents: suspiciousEvents,
      };

      return {
        period: {
          startDate: dateFrom,
          endDate: dateTo,
        },
        summary: {
          totalEvents,
          successfulEvents,
          failedEvents,
          suspiciousEvents,
          complianceScore,
        },
        dataAccess: {
          patientRecordAccesses,
          unauthorizedAttempts,
          afterHoursAccess,
          bulkDataExports,
        },
        userActivity: {
          activeUsers,
          newUsers,
          suspendedUsers: 0, // Would need user status tracking
          passwordChanges,
          failedLogins,
        },
        systemSecurity: {
          loginAttempts,
          accountLockouts,
          privilegeEscalations,
          dataModifications,
        },
        violations,
      };
    } catch (error) {
      logger.error('Error generating compliance report', {
        component: 'AuditModel',
        error: (error as Error).message,
        dateFrom,
        dateTo,
      });
      throw new AppError('Failed to generate compliance report', 500);
    }
  }

  /**
   * Get patient access history
   */
  async getPatientAccessHistory(
    patientId: string,
    dateFrom?: Date,
    dateTo?: Date,
    limit: number = 100
  ): Promise<AuditLogWithRelations[]> {
    try {
      const where: any = {
        patientId,
      };

      if (dateFrom || dateTo) {
        where.timestamp = {};
        if (dateFrom) {
          where.timestamp.gte = dateFrom;
        }
        if (dateTo) {
          where.timestamp.lte = dateTo;
        }
      }

      const accessHistory = await this.prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
            },
          },
        },
        orderBy: {
          timestamp: 'desc',
        },
        take: limit,
      });

      return accessHistory;
    } catch (error) {
      logger.error('Error getting patient access history', {
        component: 'AuditModel',
        error: (error as Error).message,
        patientId,
      });
      throw new AppError('Failed to get patient access history', 500);
    }
  }

  /**
   * Get user activity summary
   */
  async getUserActivitySummary(
    userId: string,
    dateFrom?: Date,
    dateTo?: Date
  ): Promise<{
    totalEvents: number;
    eventsByAction: Record<string, number>;
    eventsByResource: Record<string, number>;
    recentActivity: AuditLogWithRelations[];
    suspiciousActivity: number;
  }> {
    try {
      const where: any = {
        userId,
      };

      if (dateFrom || dateTo) {
        where.timestamp = {};
        if (dateFrom) {
          where.timestamp.gte = dateFrom;
        }
        if (dateTo) {
          where.timestamp.lte = dateTo;
        }
      }

      const [totalEvents, eventsByAction, eventsByResource, recentActivity, suspiciousActivity] = await Promise.all([
        this.prisma.auditLog.count({ where }),
        this.prisma.auditLog.groupBy({
          by: ['action'],
          where,
          _count: true,
        }),
        this.prisma.auditLog.groupBy({
          by: ['resource'],
          where,
          _count: true,
        }),
        this.prisma.auditLog.findMany({
          where,
          include: {
            patient: {
              select: {
                patientId: true,
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: {
            timestamp: 'desc',
          },
          take: 20,
        }),
        this.prisma.auditLog.count({
          where: {
            ...where,
            OR: [
              {
                metadata: {
                  path: ['severity'],
                  equals: 'HIGH',
                },
              },
              {
                metadata: {
                  path: ['severity'],
                  equals: 'CRITICAL',
                },
              },
            ],
          },
        }),
      ]);

      return {
        totalEvents,
        eventsByAction: eventsByAction.reduce((acc, item) => {
          acc[item.action] = item._count;
          return acc;
        }, {} as Record<string, number>),
        eventsByResource: eventsByResource.reduce((acc, item) => {
          acc[item.resource] = item._count;
          return acc;
        }, {} as Record<string, number>),
        recentActivity,
        suspiciousActivity,
      };
    } catch (error) {
      logger.error('Error getting user activity summary', {
        component: 'AuditModel',
        error: (error as Error).message,
        userId,
      });
      throw new AppError('Failed to get user activity summary', 500);
    }
  }

  /**
   * Clean up old audit logs
   */
  async cleanupOldLogs(retentionDays: number = 2555): Promise<number> { // 7 years default
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const result = await this.prisma.auditLog.deleteMany({
        where: {
          timestamp: {
            lt: cutoffDate,
          },
        },
      });

      logger.info('Old audit logs cleaned up', {
        component: 'AuditModel',
        deletedCount: result.count,
        cutoffDate,
      });

      return result.count;
    } catch (error) {
      logger.error('Error cleaning up old audit logs', {
        component: 'AuditModel',
        error: (error as Error).message,
        retentionDays,
      });
      throw new AppError('Failed to cleanup old audit logs', 500);
    }
  }

  /**
   * Determine event severity
   */
  private determineSeverity(event: AuditEvent): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    // Failed authentication attempts
    if (event.action === AuditAction.LOGIN && event.success === false) {
      return 'HIGH';
    }

    // Data deletion or export
    if (event.action === AuditAction.DELETE || event.action === AuditAction.EXPORT) {
      return 'HIGH';
    }

    // Administrative actions
    if (event.resource === AuditResource.USER && event.action === AuditAction.UPDATE) {
      return 'MEDIUM';
    }

    // Patient data access
    if (event.resource === AuditResource.PATIENT) {
      return 'MEDIUM';
    }

    // System configuration changes
    if (event.resource === AuditResource.SYSTEM) {
      return 'HIGH';
    }

    // Default to low severity
    return 'LOW';
  }

  /**
   * Check for suspicious activity
   */
  private async checkSuspiciousActivity(auditLog: AuditLogWithRelations): Promise<void> {
    try {
      const alerts: SecurityAlert[] = [];
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // Check for multiple failed login attempts
      if (auditLog.action === AuditAction.LOGIN && auditLog.metadata?.success === false) {
        const failedAttempts = await this.prisma.auditLog.count({
          where: {
            action: AuditAction.LOGIN,
            ipAddress: auditLog.ipAddress,
            timestamp: {
              gte: oneHourAgo,
            },
            metadata: {
              path: ['success'],
              equals: false,
            },
          },
        });

        if (failedAttempts >= 5) {
          alerts.push({
            id: generateUniqueId('ALT'),
            type: 'FAILED_LOGIN',
            severity: 'HIGH',
            description: `Multiple failed login attempts from IP ${auditLog.ipAddress}`,
            userId: auditLog.userId,
            ipAddress: auditLog.ipAddress,
            timestamp: now,
            resolved: false,
          });
        }
      }

      // Check for unusual access patterns
      if (auditLog.userId && auditLog.resource === AuditResource.PATIENT) {
        const recentAccesses = await this.prisma.auditLog.count({
          where: {
            userId: auditLog.userId,
            resource: AuditResource.PATIENT,
            timestamp: {
              gte: oneHourAgo,
            },
          },
        });

        if (recentAccesses >= 50) {
          alerts.push({
            id: generateUniqueId('ALT'),
            type: 'UNUSUAL_ACTIVITY',
            severity: 'MEDIUM',
            description: `Unusual number of patient record accesses by user ${auditLog.userId}`,
            userId: auditLog.userId,
            timestamp: now,
            resolved: false,
          });
        }
      }

      // Log security alerts (in a real implementation, these would be stored in a separate table)
      for (const alert of alerts) {
        logger.warn('Security alert generated', {
          component: 'AuditModel',
          alert,
        });
      }
    } catch (error) {
      logger.error('Error checking suspicious activity', {
        component: 'AuditModel',
        error: (error as Error).message,
        auditLogId: auditLog.id,
      });
    }
  }

  /**
   * Get client IP address from request
   */
  private getClientIP(req: Request): string {
    return (
      (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      (req.headers['x-real-ip'] as string) ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      ''
    );
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create audit middleware for Express routes
 */
export function createAuditMiddleware(auditModel: AuditModel) {
  return (action: AuditAction, resource: AuditResource) => {
    return async (req: any, res: any, next: any) => {
      const startTime = Date.now();
      
      // Store original end function
      const originalEnd = res.end;
      
      // Override end function to log audit event
      res.end = function(chunk: any, encoding: any) {
        const duration = Date.now() - startTime;
        const success = res.statusCode < 400;
        
        // Log audit event
        auditModel.logFromRequest(
          req,
          action,
          resource,
          req.params.id || req.params.patientId || req.body.id,
          {
            method: req.method,
            url: req.originalUrl,
            statusCode: res.statusCode,
            body: req.method !== 'GET' ? req.body : undefined,
          },
          success,
          success ? undefined : `HTTP ${res.statusCode}`,
        ).catch(error => {
          logger.error('Error logging audit event from middleware', {
            component: 'AuditMiddleware',
            error: error.message,
          });
        });
        
        // Call original end function
        originalEnd.call(this, chunk, encoding);
      };
      
      next();
    };
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default AuditModel;