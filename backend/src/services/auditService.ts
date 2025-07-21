/**
 * ============================================================================
 * NOVA CHECK EHR - AUDIT SERVICE
 * ============================================================================
 */

import { PrismaClient } from '@prisma/client';
import logger from '../config/logger';
import { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import os from 'os';

const prisma = new PrismaClient();

interface AuditLogEntry {
  id?: string;
  userId?: string;
  userRole?: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: any;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  timestamp?: Date;
  success: boolean;
  errorMessage?: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category: 'AUTHENTICATION' | 'AUTHORIZATION' | 'DATA_ACCESS' | 'DATA_MODIFICATION' | 'SYSTEM' | 'SECURITY' | 'COMPLIANCE';
  metadata?: any;
}

interface AuditQuery {
  userId?: string;
  userRole?: string;
  action?: string;
  resource?: string;
  category?: string;
  severity?: string;
  success?: boolean;
  startDate?: Date;
  endDate?: Date;
  ipAddress?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

interface AuditStats {
  totalLogs: number;
  successfulActions: number;
  failedActions: number;
  uniqueUsers: number;
  topActions: Array<{ action: string; count: number }>;
  topResources: Array<{ resource: string; count: number }>;
  severityBreakdown: Record<string, number>;
  categoryBreakdown: Record<string, number>;
  dailyActivity: Array<{ date: string; count: number }>;
}

class AuditService {
  private static instance: AuditService;
  private batchSize = 100;
  private batchTimeout = 5000; // 5 seconds
  private pendingLogs: AuditLogEntry[] = [];
  private batchTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Start batch processing
    this.startBatchProcessing();
  }

  static getInstance(): AuditService {
    if (!AuditService.instance) {
      AuditService.instance = new AuditService();
    }
    return AuditService.instance;
  }

  private startBatchProcessing() {
    setInterval(() => {
      if (this.pendingLogs.length > 0) {
        this.processBatch();
      }
    }, this.batchTimeout);
  }

  private async processBatch() {
    if (this.pendingLogs.length === 0) return;

    const logsToProcess = this.pendingLogs.splice(0, this.batchSize);
    
    try {
      await prisma.auditLog.createMany({
        data: logsToProcess.map(log => ({
          id: log.id || uuidv4(),
          userId: log.userId,
          userRole: log.userRole,
          action: log.action,
          resource: log.resource,
          resourceId: log.resourceId,
          details: log.details ? JSON.stringify(log.details) : null,
          ipAddress: log.ipAddress,
          userAgent: log.userAgent,
          sessionId: log.sessionId,
          timestamp: log.timestamp || new Date(),
          success: log.success,
          errorMessage: log.errorMessage,
          severity: log.severity,
          category: log.category,
          metadata: log.metadata ? JSON.stringify(log.metadata) : null,
        })),
      });

      logger.debug(`Processed batch of ${logsToProcess.length} audit logs`);
    } catch (error) {
      logger.error('Failed to process audit log batch', {
        error: error.message,
        batchSize: logsToProcess.length,
      });
      
      // Re-add failed logs to the beginning of the queue for retry
      this.pendingLogs.unshift(...logsToProcess);
    }
  }

  private extractRequestInfo(req?: Request) {
    if (!req) return {};

    return {
      ipAddress: this.getClientIP(req),
      userAgent: req.get('User-Agent') || 'Unknown',
      sessionId: req.session?.id || req.get('X-Session-ID'),
    };
  }

  private getClientIP(req: Request): string {
    return (
      req.ip ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      (req.connection as any)?.socket?.remoteAddress ||
      req.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
      req.get('X-Real-IP') ||
      'Unknown'
    );
  }

  private generateChecksum(data: any): string {
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(data));
    return hash.digest('hex');
  }

  async log(entry: AuditLogEntry, req?: Request): Promise<void> {
    try {
      const requestInfo = this.extractRequestInfo(req);
      
      const auditEntry: AuditLogEntry = {
        id: uuidv4(),
        timestamp: new Date(),
        ...entry,
        ...requestInfo,
        metadata: {
          ...entry.metadata,
          hostname: os.hostname(),
          nodeVersion: process.version,
          checksum: this.generateChecksum(entry),
        },
      };

      // Add to batch queue
      this.pendingLogs.push(auditEntry);

      // Process immediately if batch is full
      if (this.pendingLogs.length >= this.batchSize) {
        await this.processBatch();
      }

      // Log critical events immediately
      if (entry.severity === 'CRITICAL') {
        logger.warn('Critical audit event', auditEntry);
      }

    } catch (error) {
      logger.error('Failed to queue audit log', {
        error: error.message,
        entry,
      });
    }
  }

  async logAuthentication(
    action: 'LOGIN' | 'LOGOUT' | 'LOGIN_FAILED' | 'PASSWORD_RESET' | 'ACCOUNT_LOCKED',
    userId?: string,
    success: boolean = true,
    details?: any,
    req?: Request
  ): Promise<void> {
    await this.log({
      userId,
      action,
      resource: 'USER_AUTHENTICATION',
      details,
      success,
      severity: success ? 'LOW' : 'MEDIUM',
      category: 'AUTHENTICATION',
    }, req);
  }

  async logDataAccess(
    resource: string,
    resourceId: string,
    userId: string,
    userRole: string,
    action: 'VIEW' | 'SEARCH' | 'EXPORT' | 'PRINT',
    details?: any,
    req?: Request
  ): Promise<void> {
    await this.log({
      userId,
      userRole,
      action,
      resource,
      resourceId,
      details,
      success: true,
      severity: 'LOW',
      category: 'DATA_ACCESS',
    }, req);
  }

  async logDataModification(
    resource: string,
    resourceId: string,
    userId: string,
    userRole: string,
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE',
    details?: any,
    success: boolean = true,
    errorMessage?: string,
    req?: Request
  ): Promise<void> {
    await this.log({
      userId,
      userRole,
      action,
      resource,
      resourceId,
      details,
      success,
      errorMessage,
      severity: action === 'DELETE' ? 'HIGH' : 'MEDIUM',
      category: 'DATA_MODIFICATION',
    }, req);
  }

  async logSystemEvent(
    action: string,
    details?: any,
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW',
    success: boolean = true,
    errorMessage?: string
  ): Promise<void> {
    await this.log({
      action,
      resource: 'SYSTEM',
      details,
      success,
      errorMessage,
      severity,
      category: 'SYSTEM',
    });
  }

  async logSecurityEvent(
    action: string,
    userId?: string,
    details?: any,
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'HIGH',
    req?: Request
  ): Promise<void> {
    await this.log({
      userId,
      action,
      resource: 'SECURITY',
      details,
      success: false,
      severity,
      category: 'SECURITY',
    }, req);
  }

  async logComplianceEvent(
    action: string,
    resource: string,
    resourceId?: string,
    userId?: string,
    userRole?: string,
    details?: any,
    req?: Request
  ): Promise<void> {
    await this.log({
      userId,
      userRole,
      action,
      resource,
      resourceId,
      details,
      success: true,
      severity: 'MEDIUM',
      category: 'COMPLIANCE',
    }, req);
  }

  async logAuthorization(
    action: string,
    resource: string,
    userId: string,
    userRole: string,
    success: boolean,
    details?: any,
    req?: Request
  ): Promise<void> {
    await this.log({
      userId,
      userRole,
      action,
      resource,
      details,
      success,
      severity: success ? 'LOW' : 'MEDIUM',
      category: 'AUTHORIZATION',
    }, req);
  }

  async getAuditLogs(query: AuditQuery = {}) {
    try {
      const {
        userId,
        userRole,
        action,
        resource,
        category,
        severity,
        success,
        startDate,
        endDate,
        ipAddress,
        page = 1,
        limit = 50,
        sortBy = 'timestamp',
        sortOrder = 'desc',
      } = query;

      const where: any = {};

      if (userId) where.userId = userId;
      if (userRole) where.userRole = userRole;
      if (action) where.action = { contains: action, mode: 'insensitive' };
      if (resource) where.resource = { contains: resource, mode: 'insensitive' };
      if (category) where.category = category;
      if (severity) where.severity = severity;
      if (success !== undefined) where.success = success;
      if (ipAddress) where.ipAddress = ipAddress;
      
      if (startDate || endDate) {
        where.timestamp = {};
        if (startDate) where.timestamp.gte = startDate;
        if (endDate) where.timestamp.lte = endDate;
      }

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { [sortBy]: sortOrder },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.auditLog.count({ where }),
      ]);

      return {
        logs: logs.map(log => ({
          ...log,
          details: log.details ? JSON.parse(log.details) : null,
          metadata: log.metadata ? JSON.parse(log.metadata) : null,
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error('Failed to retrieve audit logs', {
        error: error.message,
        query,
      });
      throw new Error('Failed to retrieve audit logs');
    }
  }

  async getAuditStats(startDate?: Date, endDate?: Date): Promise<AuditStats> {
    try {
      const where: any = {};
      
      if (startDate || endDate) {
        where.timestamp = {};
        if (startDate) where.timestamp.gte = startDate;
        if (endDate) where.timestamp.lte = endDate;
      }

      const [totalLogs, successfulActions, failedActions, uniqueUsers] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.count({ where: { ...where, success: true } }),
        prisma.auditLog.count({ where: { ...where, success: false } }),
        prisma.auditLog.findMany({
          where,
          select: { userId: true },
          distinct: ['userId'],
        }).then(users => users.filter(u => u.userId).length),
      ]);

      const [topActions, topResources, severityBreakdown, categoryBreakdown] = await Promise.all([
        prisma.auditLog.groupBy({
          by: ['action'],
          where,
          _count: { action: true },
          orderBy: { _count: { action: 'desc' } },
          take: 10,
        }).then(results => results.map(r => ({ action: r.action, count: r._count.action }))),
        
        prisma.auditLog.groupBy({
          by: ['resource'],
          where,
          _count: { resource: true },
          orderBy: { _count: { resource: 'desc' } },
          take: 10,
        }).then(results => results.map(r => ({ resource: r.resource, count: r._count.resource }))),
        
        prisma.auditLog.groupBy({
          by: ['severity'],
          where,
          _count: { severity: true },
        }).then(results => 
          results.reduce((acc, r) => ({ ...acc, [r.severity]: r._count.severity }), {})
        ),
        
        prisma.auditLog.groupBy({
          by: ['category'],
          where,
          _count: { category: true },
        }).then(results => 
          results.reduce((acc, r) => ({ ...acc, [r.category]: r._count.category }), {})
        ),
      ]);

      // Get daily activity for the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const dailyActivity = await prisma.$queryRaw`
        SELECT 
          DATE(timestamp) as date,
          COUNT(*) as count
        FROM audit_logs 
        WHERE timestamp >= ${thirtyDaysAgo}
        GROUP BY DATE(timestamp)
        ORDER BY date DESC
      ` as Array<{ date: Date; count: bigint }>;

      return {
        totalLogs,
        successfulActions,
        failedActions,
        uniqueUsers,
        topActions,
        topResources,
        severityBreakdown,
        categoryBreakdown,
        dailyActivity: dailyActivity.map(d => ({
          date: d.date.toISOString().split('T')[0],
          count: Number(d.count),
        })),
      };
    } catch (error) {
      logger.error('Failed to get audit stats', { error: error.message });
      throw new Error('Failed to get audit statistics');
    }
  }

  async getUserActivity(userId: string, days: number = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const activity = await prisma.auditLog.findMany({
        where: {
          userId,
          timestamp: { gte: startDate },
        },
        orderBy: { timestamp: 'desc' },
        take: 100,
      });

      return activity.map(log => ({
        ...log,
        details: log.details ? JSON.parse(log.details) : null,
        metadata: log.metadata ? JSON.parse(log.metadata) : null,
      }));
    } catch (error) {
      logger.error('Failed to get user activity', {
        error: error.message,
        userId,
      });
      throw new Error('Failed to get user activity');
    }
  }

  async getResourceActivity(resource: string, resourceId?: string, days: number = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const where: any = {
        resource,
        timestamp: { gte: startDate },
      };

      if (resourceId) {
        where.resourceId = resourceId;
      }

      const activity = await prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: 100,
      });

      return activity.map(log => ({
        ...log,
        details: log.details ? JSON.parse(log.details) : null,
        metadata: log.metadata ? JSON.parse(log.metadata) : null,
      }));
    } catch (error) {
      logger.error('Failed to get resource activity', {
        error: error.message,
        resource,
        resourceId,
      });
      throw new Error('Failed to get resource activity');
    }
  }

  async getSecurityEvents(days: number = 7) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const events = await prisma.auditLog.findMany({
        where: {
          category: 'SECURITY',
          timestamp: { gte: startDate },
        },
        orderBy: { timestamp: 'desc' },
      });

      return events.map(event => ({
        ...event,
        details: event.details ? JSON.parse(event.details) : null,
        metadata: event.metadata ? JSON.parse(event.metadata) : null,
      }));
    } catch (error) {
      logger.error('Failed to get security events', { error: error.message });
      throw new Error('Failed to get security events');
    }
  }

  async exportAuditLogs(query: AuditQuery = {}, format: 'json' | 'csv' = 'json') {
    try {
      const { logs } = await this.getAuditLogs({ ...query, limit: 10000 });
      
      if (format === 'csv') {
        const headers = [
          'ID', 'Timestamp', 'User ID', 'User Role', 'Action', 'Resource', 
          'Resource ID', 'Success', 'Severity', 'Category', 'IP Address', 
          'User Agent', 'Error Message'
        ];
        
        const csvRows = logs.map(log => [
          log.id,
          log.timestamp.toISOString(),
          log.userId || '',
          log.userRole || '',
          log.action,
          log.resource,
          log.resourceId || '',
          log.success.toString(),
          log.severity,
          log.category,
          log.ipAddress || '',
          log.userAgent || '',
          log.errorMessage || '',
        ]);
        
        return [headers, ...csvRows].map(row => row.join(',')).join('\n');
      }
      
      return logs;
    } catch (error) {
      logger.error('Failed to export audit logs', {
        error: error.message,
        query,
        format,
      });
      throw new Error('Failed to export audit logs');
    }
  }

  async cleanupOldLogs(retentionDays: number = 365): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const result = await prisma.auditLog.deleteMany({
        where: {
          timestamp: { lt: cutoffDate },
        },
      });

      logger.info(`Cleaned up ${result.count} old audit logs`, {
        cutoffDate,
        retentionDays,
      });

      return result.count;
    } catch (error) {
      logger.error('Failed to cleanup old audit logs', {
        error: error.message,
        retentionDays,
      });
      throw new Error('Failed to cleanup old audit logs');
    }
  }

  async flush(): Promise<void> {
    if (this.pendingLogs.length > 0) {
      await this.processBatch();
    }
  }
}

// Export singleton instance
const auditService = AuditService.getInstance();
export default auditService;

// Export convenience functions
export const logAuthentication = (action: string, userId?: string, success?: boolean, details?: any, req?: Request) => 
  auditService.logAuthentication(action as any, userId, success, details, req);

export const logDataAccess = (resource: string, resourceId: string, userId: string, userRole: string, action: string, details?: any, req?: Request) => 
  auditService.logDataAccess(resource, resourceId, userId, userRole, action as any, details, req);

export const logDataModification = (resource: string, resourceId: string, userId: string, userRole: string, action: string, details?: any, success?: boolean, errorMessage?: string, req?: Request) => 
  auditService.logDataModification(resource, resourceId, userId, userRole, action as any, details, success, errorMessage, req);

export const logSystemEvent = (action: string, details?: any, severity?: string, success?: boolean, errorMessage?: string) => 
  auditService.logSystemEvent(action, details, severity as any, success, errorMessage);

export const logSecurityEvent = (action: string, userId?: string, details?: any, severity?: string, req?: Request) => 
  auditService.logSecurityEvent(action, userId, details, severity as any, req);

export const logComplianceEvent = (action: string, resource: string, resourceId?: string, userId?: string, userRole?: string, details?: any, req?: Request) => 
  auditService.logComplianceEvent(action, resource, resourceId, userId, userRole, details, req);

export const logAuthorization = (action: string, resource: string, userId: string, userRole: string, success: boolean, details?: any, req?: Request) => 
  auditService.logAuthorization(action, resource, userId, userRole, success, details, req);