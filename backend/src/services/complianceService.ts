/**
 * ============================================================================
 * NOVA CHECK EHR - COMPLIANCE SERVICE
 * ============================================================================
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { format, addDays, startOfDay, endOfDay } from 'date-fns';
import logger from '../config/logger';
import config from '../config/config';
import auditService from './auditService';
import cacheService from './cacheService';
import emailService from './emailService';
import fileUploadService from './fileUploadService';

const prisma = new PrismaClient();

interface ComplianceRule {
  id: string;
  name: string;
  description: string;
  category: 'HIPAA' | 'SOX' | 'GDPR' | 'HITECH' | 'FDA' | 'STATE' | 'CUSTOM';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  automated: boolean;
  frequency: 'REAL_TIME' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';
  enabled: boolean;
  conditions: Record<string, any>;
  actions: string[];
  lastChecked?: Date;
  nextCheck?: Date;
}

interface ComplianceViolation {
  id: string;
  ruleId: string;
  ruleName: string;
  category: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  details: Record<string, any>;
  entityType: 'USER' | 'PATIENT' | 'APPOINTMENT' | 'DOCUMENT' | 'SYSTEM';
  entityId?: string;
  detectedAt: Date;
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'FALSE_POSITIVE' | 'ACCEPTED_RISK';
  assignedTo?: string;
  resolvedAt?: Date;
  resolution?: string;
  impact: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

interface ComplianceReport {
  id: string;
  type: 'HIPAA_RISK_ASSESSMENT' | 'AUDIT_LOG_REVIEW' | 'ACCESS_REVIEW' | 'VULNERABILITY_ASSESSMENT' | 'POLICY_COMPLIANCE' | 'CUSTOM';
  title: string;
  description: string;
  period: {
    startDate: Date;
    endDate: Date;
  };
  status: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'REVIEWED' | 'APPROVED';
  findings: ComplianceViolation[];
  recommendations: string[];
  riskScore: number;
  generatedBy: string;
  generatedAt: Date;
  reviewedBy?: string;
  reviewedAt?: Date;
  approvedBy?: string;
  approvedAt?: Date;
}

interface HIPAAAssessment {
  physicalSafeguards: {
    score: number;
    findings: string[];
    recommendations: string[];
  };
  administrativeSafeguards: {
    score: number;
    findings: string[];
    recommendations: string[];
  };
  technicalSafeguards: {
    score: number;
    findings: string[];
    recommendations: string[];
  };
  overallScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  compliancePercentage: number;
}

interface PolicyDocument {
  id: string;
  title: string;
  category: 'PRIVACY' | 'SECURITY' | 'OPERATIONAL' | 'CLINICAL' | 'ADMINISTRATIVE';
  version: string;
  content: string;
  effectiveDate: Date;
  reviewDate: Date;
  approvedBy: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'SUPERSEDED';
  acknowledgmentRequired: boolean;
  applicableRoles: string[];
}

interface TrainingRecord {
  id: string;
  userId: string;
  trainingType: 'HIPAA' | 'SECURITY' | 'PRIVACY' | 'CLINICAL' | 'SAFETY' | 'CUSTOM';
  title: string;
  description: string;
  completedAt: Date;
  expiresAt?: Date;
  score?: number;
  certificateUrl?: string;
  instructorId?: string;
  duration: number; // minutes
  status: 'COMPLETED' | 'EXPIRED' | 'PENDING_RENEWAL';
}

interface AccessReview {
  id: string;
  userId: string;
  reviewerId: string;
  reviewType: 'PERIODIC' | 'ROLE_CHANGE' | 'TERMINATION' | 'INCIDENT_BASED';
  currentPermissions: string[];
  recommendedPermissions: string[];
  justification: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REQUIRES_ESCALATION';
  reviewedAt?: Date;
  effectiveDate?: Date;
  comments?: string;
}

class ComplianceService {
  private complianceRules: Map<string, ComplianceRule> = new Map();
  private monitoringActive: boolean = false;

  constructor() {
    this.initializeComplianceRules();
    this.startComplianceMonitoring();
  }

  private initializeComplianceRules() {
    // HIPAA Rules
    this.addRule({
      id: 'HIPAA_001',
      name: 'Minimum Necessary Access',
      description: 'Users should only have access to minimum necessary PHI',
      category: 'HIPAA',
      severity: 'HIGH',
      automated: true,
      frequency: 'DAILY',
      enabled: true,
      conditions: {
        checkType: 'access_review',
        maxPermissions: 10,
        reviewFrequency: 90, // days
      },
      actions: ['ALERT', 'REVIEW_REQUIRED'],
    });

    this.addRule({
      id: 'HIPAA_002',
      name: 'PHI Access Logging',
      description: 'All PHI access must be logged and auditable',
      category: 'HIPAA',
      severity: 'CRITICAL',
      automated: true,
      frequency: 'REAL_TIME',
      enabled: true,
      conditions: {
        checkType: 'audit_log',
        requiredFields: ['userId', 'patientId', 'action', 'timestamp'],
      },
      actions: ['IMMEDIATE_ALERT', 'BLOCK_ACCESS'],
    });

    this.addRule({
      id: 'HIPAA_003',
      name: 'Password Complexity',
      description: 'Passwords must meet HIPAA security requirements',
      category: 'HIPAA',
      severity: 'HIGH',
      automated: true,
      frequency: 'REAL_TIME',
      enabled: true,
      conditions: {
        checkType: 'password_policy',
        minLength: 12,
        requireComplexity: true,
        maxAge: 90, // days
      },
      actions: ['FORCE_CHANGE', 'ALERT'],
    });

    this.addRule({
      id: 'HIPAA_004',
      name: 'Session Timeout',
      description: 'User sessions must timeout after period of inactivity',
      category: 'HIPAA',
      severity: 'MEDIUM',
      automated: true,
      frequency: 'REAL_TIME',
      enabled: true,
      conditions: {
        checkType: 'session_timeout',
        maxInactivity: 30, // minutes
      },
      actions: ['TERMINATE_SESSION', 'LOG_EVENT'],
    });

    this.addRule({
      id: 'HIPAA_005',
      name: 'Data Encryption',
      description: 'PHI must be encrypted at rest and in transit',
      category: 'HIPAA',
      severity: 'CRITICAL',
      automated: true,
      frequency: 'DAILY',
      enabled: true,
      conditions: {
        checkType: 'encryption_status',
        requiredAlgorithm: 'AES-256',
      },
      actions: ['IMMEDIATE_ALERT', 'ENCRYPT_DATA'],
    });

    // GDPR Rules
    this.addRule({
      id: 'GDPR_001',
      name: 'Data Retention Limits',
      description: 'Personal data must not be retained longer than necessary',
      category: 'GDPR',
      severity: 'HIGH',
      automated: true,
      frequency: 'WEEKLY',
      enabled: true,
      conditions: {
        checkType: 'data_retention',
        maxRetention: 2555, // 7 years in days
      },
      actions: ['ARCHIVE_DATA', 'ALERT'],
    });

    this.addRule({
      id: 'GDPR_002',
      name: 'Consent Management',
      description: 'Valid consent must exist for data processing',
      category: 'GDPR',
      severity: 'CRITICAL',
      automated: true,
      frequency: 'REAL_TIME',
      enabled: true,
      conditions: {
        checkType: 'consent_validation',
        requireExplicitConsent: true,
      },
      actions: ['BLOCK_PROCESSING', 'REQUEST_CONSENT'],
    });

    logger.info('Compliance rules initialized', { ruleCount: this.complianceRules.size });
  }

  private addRule(rule: ComplianceRule) {
    this.complianceRules.set(rule.id, rule);
  }

  private startComplianceMonitoring() {
    if (this.monitoringActive) return;

    this.monitoringActive = true;

    // Real-time monitoring
    setInterval(() => {
      this.runRealTimeChecks();
    }, 60000); // Every minute

    // Daily checks
    setInterval(() => {
      this.runDailyChecks();
    }, 24 * 60 * 60 * 1000); // Every 24 hours

    // Weekly checks
    setInterval(() => {
      this.runWeeklyChecks();
    }, 7 * 24 * 60 * 60 * 1000); // Every week

    logger.info('Compliance monitoring started');
  }

  private async runRealTimeChecks() {
    const realTimeRules = Array.from(this.complianceRules.values())
      .filter(rule => rule.frequency === 'REAL_TIME' && rule.enabled);

    for (const rule of realTimeRules) {
      try {
        await this.executeRule(rule);
      } catch (error) {
        logger.error('Real-time compliance check failed', {
          ruleId: rule.id,
          error: error.message,
        });
      }
    }
  }

  private async runDailyChecks() {
    const dailyRules = Array.from(this.complianceRules.values())
      .filter(rule => rule.frequency === 'DAILY' && rule.enabled);

    for (const rule of dailyRules) {
      try {
        await this.executeRule(rule);
      } catch (error) {
        logger.error('Daily compliance check failed', {
          ruleId: rule.id,
          error: error.message,
        });
      }
    }
  }

  private async runWeeklyChecks() {
    const weeklyRules = Array.from(this.complianceRules.values())
      .filter(rule => rule.frequency === 'WEEKLY' && rule.enabled);

    for (const rule of weeklyRules) {
      try {
        await this.executeRule(rule);
      } catch (error) {
        logger.error('Weekly compliance check failed', {
          ruleId: rule.id,
          error: error.message,
        });
      }
    }
  }

  private async executeRule(rule: ComplianceRule) {
    try {
      const violations = await this.checkRule(rule);
      
      if (violations.length > 0) {
        for (const violation of violations) {
          await this.recordViolation(violation);
          await this.executeActions(rule.actions, violation);
        }
      }

      // Update rule execution timestamp
      rule.lastChecked = new Date();
      rule.nextCheck = this.calculateNextCheck(rule);

    } catch (error) {
      logger.error('Rule execution failed', {
        ruleId: rule.id,
        error: error.message,
      });
    }
  }

  private async checkRule(rule: ComplianceRule): Promise<ComplianceViolation[]> {
    const violations: ComplianceViolation[] = [];

    switch (rule.conditions.checkType) {
      case 'access_review':
        violations.push(...await this.checkAccessReview(rule));
        break;
      case 'audit_log':
        violations.push(...await this.checkAuditLog(rule));
        break;
      case 'password_policy':
        violations.push(...await this.checkPasswordPolicy(rule));
        break;
      case 'session_timeout':
        violations.push(...await this.checkSessionTimeout(rule));
        break;
      case 'encryption_status':
        violations.push(...await this.checkEncryptionStatus(rule));
        break;
      case 'data_retention':
        violations.push(...await this.checkDataRetention(rule));
        break;
      case 'consent_validation':
        violations.push(...await this.checkConsentValidation(rule));
        break;
      default:
        logger.warn('Unknown rule check type', { ruleId: rule.id, checkType: rule.conditions.checkType });
    }

    return violations;
  }

  private async checkAccessReview(rule: ComplianceRule): Promise<ComplianceViolation[]> {
    const violations: ComplianceViolation[] = [];
    const reviewFrequency = rule.conditions.reviewFrequency || 90;
    const cutoffDate = addDays(new Date(), -reviewFrequency);

    const usersNeedingReview = await prisma.user.findMany({
      where: {
        OR: [
          { lastAccessReview: { lt: cutoffDate } },
          { lastAccessReview: null },
        ],
        active: true,
      },
      include: {
        rolePermissions: {
          include: { permission: true },
        },
      },
    });

    for (const user of usersNeedingReview) {
      violations.push({
        id: crypto.randomUUID(),
        ruleId: rule.id,
        ruleName: rule.name,
        category: rule.category,
        severity: rule.severity,
        description: `User access review overdue`,
        details: {
          userId: user.id,
          email: user.email,
          lastReview: user.lastAccessReview,
          permissionCount: user.rolePermissions.length,
        },
        entityType: 'USER',
        entityId: user.id,
        detectedAt: new Date(),
        status: 'OPEN',
        impact: 'MEDIUM',
      });
    }

    return violations;
  }

  private async checkAuditLog(rule: ComplianceRule): Promise<ComplianceViolation[]> {
    const violations: ComplianceViolation[] = [];
    const requiredFields = rule.conditions.requiredFields || [];
    const timeWindow = new Date(Date.now() - 60 * 60 * 1000); // Last hour

    // Check for missing audit logs for PHI access
    const phiAccess = await prisma.auditLog.findMany({
      where: {
        action: { in: ['PATIENT_VIEW', 'PATIENT_UPDATE', 'DOCUMENT_VIEW'] },
        createdAt: { gte: timeWindow },
      },
    });

    for (const log of phiAccess) {
      const details = log.details as Record<string, any>;
      const missingFields = requiredFields.filter(field => !details[field]);

      if (missingFields.length > 0) {
        violations.push({
          id: crypto.randomUUID(),
          ruleId: rule.id,
          ruleName: rule.name,
          category: rule.category,
          severity: rule.severity,
          description: 'Incomplete audit log for PHI access',
          details: {
            auditLogId: log.id,
            missingFields,
            action: log.action,
          },
          entityType: 'SYSTEM',
          detectedAt: new Date(),
          status: 'OPEN',
          impact: 'HIGH',
        });
      }
    }

    return violations;
  }

  private async checkPasswordPolicy(rule: ComplianceRule): Promise<ComplianceViolation[]> {
    const violations: ComplianceViolation[] = [];
    const maxAge = rule.conditions.maxAge || 90;
    const cutoffDate = addDays(new Date(), -maxAge);

    const usersWithOldPasswords = await prisma.user.findMany({
      where: {
        passwordChangedAt: { lt: cutoffDate },
        active: true,
      },
    });

    for (const user of usersWithOldPasswords) {
      violations.push({
        id: crypto.randomUUID(),
        ruleId: rule.id,
        ruleName: rule.name,
        category: rule.category,
        severity: rule.severity,
        description: 'Password exceeds maximum age',
        details: {
          userId: user.id,
          email: user.email,
          passwordAge: Math.floor((Date.now() - user.passwordChangedAt!.getTime()) / (1000 * 60 * 60 * 24)),
          maxAge,
        },
        entityType: 'USER',
        entityId: user.id,
        detectedAt: new Date(),
        status: 'OPEN',
        impact: 'MEDIUM',
      });
    }

    return violations;
  }

  private async checkSessionTimeout(rule: ComplianceRule): Promise<ComplianceViolation[]> {
    const violations: ComplianceViolation[] = [];
    const maxInactivity = rule.conditions.maxInactivity || 30; // minutes
    const cutoffTime = new Date(Date.now() - maxInactivity * 60 * 1000);

    const staleSessions = await prisma.userSession.findMany({
      where: {
        lastActivity: { lt: cutoffTime },
        endedAt: null,
      },
    });

    for (const session of staleSessions) {
      violations.push({
        id: crypto.randomUUID(),
        ruleId: rule.id,
        ruleName: rule.name,
        category: rule.category,
        severity: rule.severity,
        description: 'Session exceeded maximum inactivity period',
        details: {
          sessionId: session.id,
          userId: session.userId,
          lastActivity: session.lastActivity,
          inactivityMinutes: Math.floor((Date.now() - session.lastActivity!.getTime()) / (1000 * 60)),
        },
        entityType: 'USER',
        entityId: session.userId,
        detectedAt: new Date(),
        status: 'OPEN',
        impact: 'MEDIUM',
      });
    }

    return violations;
  }

  private async checkEncryptionStatus(rule: ComplianceRule): Promise<ComplianceViolation[]> {
    const violations: ComplianceViolation[] = [];

    // Check for unencrypted files
    const unencryptedFiles = await prisma.uploadedFile.findMany({
      where: {
        encrypted: false,
        fileType: { in: ['MEDICAL_IMAGE', 'LAB_RESULT', 'CLINICAL_NOTE'] },
      },
    });

    for (const file of unencryptedFiles) {
      violations.push({
        id: crypto.randomUUID(),
        ruleId: rule.id,
        ruleName: rule.name,
        category: rule.category,
        severity: rule.severity,
        description: 'PHI file not encrypted',
        details: {
          fileId: file.id,
          fileName: file.originalName,
          fileType: file.fileType,
          uploadedBy: file.uploadedBy,
        },
        entityType: 'DOCUMENT',
        entityId: file.id,
        detectedAt: new Date(),
        status: 'OPEN',
        impact: 'CRITICAL',
      });
    }

    return violations;
  }

  private async checkDataRetention(rule: ComplianceRule): Promise<ComplianceViolation[]> {
    const violations: ComplianceViolation[] = [];
    const maxRetention = rule.conditions.maxRetention || 2555; // 7 years
    const cutoffDate = addDays(new Date(), -maxRetention);

    // Check for old patient records
    const oldPatients = await prisma.patient.findMany({
      where: {
        createdAt: { lt: cutoffDate },
        archived: false,
      },
    });

    for (const patient of oldPatients) {
      violations.push({
        id: crypto.randomUUID(),
        ruleId: rule.id,
        ruleName: rule.name,
        category: rule.category,
        severity: rule.severity,
        description: 'Patient data exceeds retention period',
        details: {
          patientId: patient.id,
          createdAt: patient.createdAt,
          retentionDays: Math.floor((Date.now() - patient.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
          maxRetention,
        },
        entityType: 'PATIENT',
        entityId: patient.id,
        detectedAt: new Date(),
        status: 'OPEN',
        impact: 'HIGH',
      });
    }

    return violations;
  }

  private async checkConsentValidation(rule: ComplianceRule): Promise<ComplianceViolation[]> {
    const violations: ComplianceViolation[] = [];

    // Check for patients without valid consent
    const patientsWithoutConsent = await prisma.patient.findMany({
      where: {
        OR: [
          { consentDate: null },
          { consentExpiry: { lt: new Date() } },
        ],
        active: true,
      },
    });

    for (const patient of patientsWithoutConsent) {
      violations.push({
        id: crypto.randomUUID(),
        ruleId: rule.id,
        ruleName: rule.name,
        category: rule.category,
        severity: rule.severity,
        description: 'Patient consent missing or expired',
        details: {
          patientId: patient.id,
          consentDate: patient.consentDate,
          consentExpiry: patient.consentExpiry,
        },
        entityType: 'PATIENT',
        entityId: patient.id,
        detectedAt: new Date(),
        status: 'OPEN',
        impact: 'CRITICAL',
      });
    }

    return violations;
  }

  private calculateNextCheck(rule: ComplianceRule): Date {
    const now = new Date();
    
    switch (rule.frequency) {
      case 'REAL_TIME':
        return new Date(now.getTime() + 60 * 1000); // 1 minute
      case 'DAILY':
        return addDays(now, 1);
      case 'WEEKLY':
        return addDays(now, 7);
      case 'MONTHLY':
        return addDays(now, 30);
      case 'QUARTERLY':
        return addDays(now, 90);
      case 'ANNUALLY':
        return addDays(now, 365);
      default:
        return addDays(now, 1);
    }
  }

  private async recordViolation(violation: ComplianceViolation) {
    try {
      await prisma.complianceViolation.create({
        data: {
          id: violation.id,
          ruleId: violation.ruleId,
          ruleName: violation.ruleName,
          category: violation.category,
          severity: violation.severity,
          description: violation.description,
          details: JSON.stringify(violation.details),
          entityType: violation.entityType,
          entityId: violation.entityId,
          detectedAt: violation.detectedAt,
          status: violation.status,
          impact: violation.impact,
        },
      });

      // Log to audit service
      await auditService.logComplianceEvent(
        'VIOLATION_DETECTED',
        {
          violationId: violation.id,
          ruleId: violation.ruleId,
          severity: violation.severity,
          entityType: violation.entityType,
          entityId: violation.entityId,
        },
        violation.severity
      );

      logger.warn('Compliance violation recorded', {
        violationId: violation.id,
        ruleId: violation.ruleId,
        severity: violation.severity,
      });
    } catch (error) {
      logger.error('Failed to record compliance violation', {
        violationId: violation.id,
        error: error.message,
      });
    }
  }

  private async executeActions(actions: string[], violation: ComplianceViolation) {
    for (const action of actions) {
      try {
        await this.executeAction(action, violation);
      } catch (error) {
        logger.error('Failed to execute compliance action', {
          action,
          violationId: violation.id,
          error: error.message,
        });
      }
    }
  }

  private async executeAction(action: string, violation: ComplianceViolation) {
    switch (action) {
      case 'ALERT':
        await this.sendComplianceAlert(violation);
        break;
      case 'IMMEDIATE_ALERT':
        await this.sendImmediateAlert(violation);
        break;
      case 'REVIEW_REQUIRED':
        await this.createReviewTask(violation);
        break;
      case 'BLOCK_ACCESS':
        await this.blockAccess(violation);
        break;
      case 'TERMINATE_SESSION':
        await this.terminateSession(violation);
        break;
      case 'FORCE_CHANGE':
        await this.forcePasswordChange(violation);
        break;
      case 'ENCRYPT_DATA':
        await this.encryptData(violation);
        break;
      case 'ARCHIVE_DATA':
        await this.archiveData(violation);
        break;
      case 'REQUEST_CONSENT':
        await this.requestConsent(violation);
        break;
      case 'LOG_EVENT':
        await this.logComplianceEvent(violation);
        break;
      default:
        logger.warn('Unknown compliance action', { action, violationId: violation.id });
    }
  }

  private async sendComplianceAlert(violation: ComplianceViolation) {
    const complianceOfficers = await prisma.user.findMany({
      where: {
        role: { in: ['COMPLIANCE_OFFICER', 'ADMIN'] },
        emailNotifications: true,
      },
    });

    for (const officer of complianceOfficers) {
      await emailService.sendEmail({
        to: officer.email,
        subject: `Compliance Violation: ${violation.ruleName}`,
        template: 'compliance-violation',
        data: {
          violation,
          officer: officer.firstName,
        },
      });
    }
  }

  private async sendImmediateAlert(violation: ComplianceViolation) {
    // Send immediate alerts via multiple channels
    await this.sendComplianceAlert(violation);
    
    // Log as critical event
    logger.error('CRITICAL COMPLIANCE VIOLATION', {
      violationId: violation.id,
      ruleId: violation.ruleId,
      severity: violation.severity,
      description: violation.description,
    });
  }

  private async createReviewTask(violation: ComplianceViolation) {
    if (violation.entityType === 'USER' && violation.entityId) {
      await prisma.accessReview.create({
        data: {
          userId: violation.entityId,
          reviewType: 'INCIDENT_BASED',
          status: 'PENDING',
          justification: `Compliance violation: ${violation.description}`,
          createdAt: new Date(),
        },
      });
    }
  }

  private async blockAccess(violation: ComplianceViolation) {
    if (violation.entityType === 'USER' && violation.entityId) {
      await prisma.user.update({
        where: { id: violation.entityId },
        data: {
          locked: true,
          lockReason: `Compliance violation: ${violation.description}`,
          lockedAt: new Date(),
        },
      });
    }
  }

  private async terminateSession(violation: ComplianceViolation) {
    if (violation.details.sessionId) {
      await prisma.userSession.update({
        where: { id: violation.details.sessionId },
        data: { endedAt: new Date() },
      });
    }
  }

  private async forcePasswordChange(violation: ComplianceViolation) {
    if (violation.entityType === 'USER' && violation.entityId) {
      await prisma.user.update({
        where: { id: violation.entityId },
        data: { forcePasswordChange: true },
      });
    }
  }

  private async encryptData(violation: ComplianceViolation) {
    if (violation.entityType === 'DOCUMENT' && violation.entityId) {
      // Trigger file encryption
      const file = await prisma.uploadedFile.findUnique({
        where: { id: violation.entityId },
      });
      
      if (file) {
        // Use file upload service to encrypt the file
        await fileUploadService.encryptFile(file.filePath);
        
        await prisma.uploadedFile.update({
          where: { id: violation.entityId },
          data: { encrypted: true },
        });
      }
    }
  }

  private async archiveData(violation: ComplianceViolation) {
    if (violation.entityType === 'PATIENT' && violation.entityId) {
      await prisma.patient.update({
        where: { id: violation.entityId },
        data: {
          archived: true,
          archivedAt: new Date(),
          archivedReason: 'Data retention policy compliance',
        },
      });
    }
  }

  private async requestConsent(violation: ComplianceViolation) {
    if (violation.entityType === 'PATIENT' && violation.entityId) {
      const patient = await prisma.patient.findUnique({
        where: { id: violation.entityId },
      });
      
      if (patient) {
        await emailService.sendEmail({
          to: patient.email,
          subject: 'Consent Renewal Required',
          template: 'consent-renewal',
          data: {
            patientName: `${patient.firstName} ${patient.lastName}`,
            consentUrl: `${config.app.frontendUrl}/consent/${patient.id}`,
          },
        });
      }
    }
  }

  private async logComplianceEvent(violation: ComplianceViolation) {
    await auditService.logComplianceEvent(
      'COMPLIANCE_ACTION_EXECUTED',
      {
        violationId: violation.id,
        action: 'LOG_EVENT',
        details: violation.details,
      },
      'LOW'
    );
  }

  async performHIPAAAssessment(): Promise<HIPAAAssessment> {
    try {
      const assessment: HIPAAAssessment = {
        physicalSafeguards: await this.assessPhysicalSafeguards(),
        administrativeSafeguards: await this.assessAdministrativeSafeguards(),
        technicalSafeguards: await this.assessTechnicalSafeguards(),
        overallScore: 0,
        riskLevel: 'MEDIUM',
        compliancePercentage: 0,
      };

      // Calculate overall score
      assessment.overallScore = Math.round(
        (assessment.physicalSafeguards.score + 
         assessment.administrativeSafeguards.score + 
         assessment.technicalSafeguards.score) / 3
      );

      // Determine risk level
      if (assessment.overallScore >= 90) assessment.riskLevel = 'LOW';
      else if (assessment.overallScore >= 70) assessment.riskLevel = 'MEDIUM';
      else if (assessment.overallScore >= 50) assessment.riskLevel = 'HIGH';
      else assessment.riskLevel = 'CRITICAL';

      assessment.compliancePercentage = assessment.overallScore;

      // Store assessment results
      await prisma.complianceAssessment.create({
        data: {
          type: 'HIPAA',
          score: assessment.overallScore,
          riskLevel: assessment.riskLevel,
          findings: JSON.stringify({
            physical: assessment.physicalSafeguards.findings,
            administrative: assessment.administrativeSafeguards.findings,
            technical: assessment.technicalSafeguards.findings,
          }),
          recommendations: JSON.stringify([
            ...assessment.physicalSafeguards.recommendations,
            ...assessment.administrativeSafeguards.recommendations,
            ...assessment.technicalSafeguards.recommendations,
          ]),
          assessedAt: new Date(),
        },
      });

      logger.info('HIPAA assessment completed', {
        overallScore: assessment.overallScore,
        riskLevel: assessment.riskLevel,
      });

      return assessment;
    } catch (error) {
      logger.error('HIPAA assessment failed', { error: error.message });
      throw new Error('Failed to perform HIPAA assessment');
    }
  }

  private async assessPhysicalSafeguards(): Promise<{ score: number; findings: string[]; recommendations: string[] }> {
    const findings: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    // Check for physical access controls
    const physicalAccessLogs = await prisma.auditLog.count({
      where: {
        action: 'PHYSICAL_ACCESS',
        createdAt: {
          gte: addDays(new Date(), -30),
        },
      },
    });

    if (physicalAccessLogs === 0) {
      findings.push('No physical access logging detected');
      recommendations.push('Implement physical access logging system');
      score -= 20;
    }

    // Check for workstation security
    const unlockedSessions = await prisma.userSession.count({
      where: {
        endedAt: null,
        lastActivity: {
          lt: addDays(new Date(), -1),
        },
      },
    });

    if (unlockedSessions > 0) {
      findings.push(`${unlockedSessions} sessions left unlocked for over 24 hours`);
      recommendations.push('Implement automatic session timeout');
      score -= 15;
    }

    return { score: Math.max(score, 0), findings, recommendations };
  }

  private async assessAdministrativeSafeguards(): Promise<{ score: number; findings: string[]; recommendations: string[] }> {
    const findings: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    // Check for security officer assignment
    const securityOfficers = await prisma.user.count({
      where: {
        role: 'SECURITY_OFFICER',
        active: true,
      },
    });

    if (securityOfficers === 0) {
      findings.push('No designated security officer');
      recommendations.push('Assign a security officer');
      score -= 25;
    }

    // Check for workforce training
    const totalUsers = await prisma.user.count({ where: { active: true } });
    const trainedUsers = await prisma.trainingRecord.count({
      where: {
        trainingType: 'HIPAA',
        status: 'COMPLETED',
        expiresAt: { gt: new Date() },
      },
    });

    const trainingPercentage = totalUsers > 0 ? (trainedUsers / totalUsers) * 100 : 0;
    if (trainingPercentage < 90) {
      findings.push(`Only ${trainingPercentage.toFixed(1)}% of users have current HIPAA training`);
      recommendations.push('Ensure all users complete HIPAA training');
      score -= 20;
    }

    // Check for access reviews
    const usersNeedingReview = await prisma.user.count({
      where: {
        OR: [
          { lastAccessReview: { lt: addDays(new Date(), -90) } },
          { lastAccessReview: null },
        ],
        active: true,
      },
    });

    if (usersNeedingReview > 0) {
      findings.push(`${usersNeedingReview} users need access review`);
      recommendations.push('Conduct regular access reviews');
      score -= 15;
    }

    return { score: Math.max(score, 0), findings, recommendations };
  }

  private async assessTechnicalSafeguards(): Promise<{ score: number; findings: string[]; recommendations: string[] }> {
    const findings: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    // Check for access controls
    const usersWithoutMFA = await prisma.user.count({
      where: {
        mfaEnabled: false,
        active: true,
      },
    });

    if (usersWithoutMFA > 0) {
      findings.push(`${usersWithoutMFA} users without MFA enabled`);
      recommendations.push('Require MFA for all users');
      score -= 20;
    }

    // Check for audit controls
    const recentAuditLogs = await prisma.auditLog.count({
      where: {
        createdAt: {
          gte: addDays(new Date(), -1),
        },
      },
    });

    if (recentAuditLogs === 0) {
      findings.push('No audit logs generated in the last 24 hours');
      recommendations.push('Verify audit logging is functioning');
      score -= 25;
    }

    // Check for data integrity
    const unencryptedFiles = await prisma.uploadedFile.count({
      where: {
        encrypted: false,
        fileType: { in: ['MEDICAL_IMAGE', 'LAB_RESULT', 'CLINICAL_NOTE'] },
      },
    });

    if (unencryptedFiles > 0) {
      findings.push(`${unencryptedFiles} PHI files are not encrypted`);
      recommendations.push('Encrypt all PHI files');
      score -= 30;
    }

    // Check for transmission security
    const insecureTransmissions = await prisma.auditLog.count({
      where: {
        action: 'DATA_TRANSMISSION',
        details: {
          path: ['encrypted'],
          equals: false,
        },
        createdAt: {
          gte: addDays(new Date(), -7),
        },
      },
    });

    if (insecureTransmissions > 0) {
      findings.push(`${insecureTransmissions} unencrypted data transmissions detected`);
      recommendations.push('Ensure all data transmissions are encrypted');
      score -= 25;
    }

    return { score: Math.max(score, 0), findings, recommendations };
  }

  async generateComplianceReport(
    type: ComplianceReport['type'],
    startDate: Date,
    endDate: Date,
    generatedBy: string
  ): Promise<string> {
    try {
      const reportId = crypto.randomUUID();
      
      // Get violations for the period
      const violations = await prisma.complianceViolation.findMany({
        where: {
          detectedAt: {
            gte: startOfDay(startDate),
            lte: endOfDay(endDate),
          },
        },
        orderBy: {
          detectedAt: 'desc',
        },
      });

      // Calculate risk score
      const riskScore = this.calculateRiskScore(violations);

      // Generate recommendations
      const recommendations = this.generateRecommendations(violations);

      // Create report
      await prisma.complianceReport.create({
        data: {
          id: reportId,
          type,
          title: this.getReportTitle(type),
          description: this.getReportDescription(type, startDate, endDate),
          startDate,
          endDate,
          status: 'COMPLETED',
          findings: JSON.stringify(violations),
          recommendations: JSON.stringify(recommendations),
          riskScore,
          generatedBy,
          generatedAt: new Date(),
        },
      });

      logger.info('Compliance report generated', {
        reportId,
        type,
        violationCount: violations.length,
        riskScore,
      });

      return reportId;
    } catch (error) {
      logger.error('Compliance report generation failed', {
        type,
        error: error.message,
      });
      throw new Error('Failed to generate compliance report');
    }
  }

  private calculateRiskScore(violations: any[]): number {
    if (violations.length === 0) return 0;

    const severityWeights = {
      LOW: 1,
      MEDIUM: 3,
      HIGH: 7,
      CRITICAL: 15,
    };

    const totalWeight = violations.reduce((sum, violation) => {
      return sum + (severityWeights[violation.severity as keyof typeof severityWeights] || 1);
    }, 0);

    return Math.min(Math.round(totalWeight / violations.length * 10), 100);
  }

  private generateRecommendations(violations: any[]): string[] {
    const recommendations = new Set<string>();

    for (const violation of violations) {
      switch (violation.category) {
        case 'HIPAA':
          recommendations.add('Review and update HIPAA policies');
          recommendations.add('Conduct additional staff training');
          break;
        case 'GDPR':
          recommendations.add('Review data processing activities');
          recommendations.add('Update privacy notices');
          break;
        default:
          recommendations.add('Review compliance procedures');
      }

      if (violation.severity === 'CRITICAL') {
        recommendations.add('Immediate remediation required');
        recommendations.add('Notify compliance officer');
      }
    }

    return Array.from(recommendations);
  }

  private getReportTitle(type: ComplianceReport['type']): string {
    const titles = {
      HIPAA_RISK_ASSESSMENT: 'HIPAA Risk Assessment Report',
      AUDIT_LOG_REVIEW: 'Audit Log Review Report',
      ACCESS_REVIEW: 'Access Review Report',
      VULNERABILITY_ASSESSMENT: 'Vulnerability Assessment Report',
      POLICY_COMPLIANCE: 'Policy Compliance Report',
      CUSTOM: 'Custom Compliance Report',
    };
    return titles[type] || 'Compliance Report';
  }

  private getReportDescription(type: ComplianceReport['type'], startDate: Date, endDate: Date): string {
    const period = `${format(startDate, 'yyyy-MM-dd')} to ${format(endDate, 'yyyy-MM-dd')}`;
    return `${this.getReportTitle(type)} for the period ${period}`;
  }

  async getComplianceViolations(
    filters: {
      category?: string;
      severity?: string;
      status?: string;
      startDate?: Date;
      endDate?: Date;
    } = {},
    page: number = 1,
    limit: number = 50
  ) {
    try {
      const where: any = {};

      if (filters.category) where.category = filters.category;
      if (filters.severity) where.severity = filters.severity;
      if (filters.status) where.status = filters.status;
      if (filters.startDate || filters.endDate) {
        where.detectedAt = {};
        if (filters.startDate) where.detectedAt.gte = startOfDay(filters.startDate);
        if (filters.endDate) where.detectedAt.lte = endOfDay(filters.endDate);
      }

      const [violations, total] = await Promise.all([
        prisma.complianceViolation.findMany({
          where,
          orderBy: { detectedAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.complianceViolation.count({ where }),
      ]);

      return {
        violations,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error('Failed to get compliance violations', { error: error.message });
      throw new Error('Failed to retrieve compliance violations');
    }
  }

  async resolveViolation(violationId: string, resolution: string, resolvedBy: string) {
    try {
      await prisma.complianceViolation.update({
        where: { id: violationId },
        data: {
          status: 'RESOLVED',
          resolution,
          resolvedAt: new Date(),
          assignedTo: resolvedBy,
        },
      });

      await auditService.logComplianceEvent(
        'VIOLATION_RESOLVED',
        {
          violationId,
          resolvedBy,
          resolution,
        },
        'LOW'
      );

      logger.info('Compliance violation resolved', { violationId, resolvedBy });
    } catch (error) {
      logger.error('Failed to resolve compliance violation', {
        violationId,
        error: error.message,
      });
      throw new Error('Failed to resolve compliance violation');
    }
  }

  async getComplianceStats() {
    try {
      const [totalViolations, openViolations, criticalViolations, recentViolations] = await Promise.all([
        prisma.complianceViolation.count(),
        prisma.complianceViolation.count({ where: { status: 'OPEN' } }),
        prisma.complianceViolation.count({ where: { severity: 'CRITICAL', status: 'OPEN' } }),
        prisma.complianceViolation.count({
          where: {
            detectedAt: {
              gte: addDays(new Date(), -30),
            },
          },
        }),
      ]);

      const violationsByCategory = await prisma.complianceViolation.groupBy({
        by: ['category'],
        _count: true,
        where: { status: 'OPEN' },
      });

      const violationsBySeverity = await prisma.complianceViolation.groupBy({
        by: ['severity'],
        _count: true,
        where: { status: 'OPEN' },
      });

      return {
        totalViolations,
        openViolations,
        criticalViolations,
        recentViolations,
        violationsByCategory: violationsByCategory.map(v => ({
          category: v.category,
          count: v._count,
        })),
        violationsBySeverity: violationsBySeverity.map(v => ({
          severity: v.severity,
          count: v._count,
        })),
        complianceRate: totalViolations > 0 ? ((totalViolations - openViolations) / totalViolations) * 100 : 100,
      };
    } catch (error) {
      logger.error('Failed to get compliance stats', { error: error.message });
      throw new Error('Failed to retrieve compliance statistics');
    }
  }
}

// Export singleton instance
const complianceService = new ComplianceService();
export default complianceService;

// Export the class for testing
export { ComplianceService };