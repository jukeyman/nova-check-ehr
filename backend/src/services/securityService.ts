/**
 * ============================================================================
 * NOVA CHECK EHR - SECURITY SERVICE
 * ============================================================================
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';
import config from '../config/config';
import auditService from './auditService';
import cacheService from './cacheService';
import emailService from './emailService';

const prisma = new PrismaClient();

interface LoginAttempt {
  email: string;
  ipAddress: string;
  userAgent: string;
  success: boolean;
  timestamp: Date;
  failureReason?: string;
}

interface SecurityEvent {
  type: 'SUSPICIOUS_LOGIN' | 'MULTIPLE_FAILURES' | 'ACCOUNT_LOCKOUT' | 'PASSWORD_BREACH' | 'UNUSUAL_ACTIVITY' | 'DATA_ACCESS_VIOLATION';
  userId?: string;
  ipAddress: string;
  userAgent: string;
  details: Record<string, any>;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  timestamp: Date;
}

interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  preventReuse: number;
  maxAge: number; // days
  requireChange: boolean;
}

interface SessionData {
  userId: string;
  email: string;
  role: string;
  permissions: string[];
  ipAddress: string;
  userAgent: string;
  createdAt: Date;
  lastActivity: Date;
  mfaVerified: boolean;
}

interface SecuritySettings {
  passwordPolicy: PasswordPolicy;
  sessionTimeout: number; // minutes
  maxLoginAttempts: number;
  lockoutDuration: number; // minutes
  requireMFA: boolean;
  allowedIpRanges?: string[];
  blockedIpAddresses: string[];
  securityQuestions: boolean;
  deviceTracking: boolean;
}

interface DeviceInfo {
  id: string;
  userId: string;
  deviceId: string;
  deviceName: string;
  deviceType: 'DESKTOP' | 'MOBILE' | 'TABLET';
  browser: string;
  os: string;
  ipAddress: string;
  location?: string;
  trusted: boolean;
  lastUsed: Date;
  createdAt: Date;
}

interface RiskAssessment {
  score: number; // 0-100
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  factors: {
    factor: string;
    weight: number;
    description: string;
  }[];
  recommendations: string[];
}

class SecurityService {
  private defaultPasswordPolicy: PasswordPolicy = {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    preventReuse: 5,
    maxAge: 90,
    requireChange: true,
  };

  private defaultSecuritySettings: SecuritySettings = {
    passwordPolicy: this.defaultPasswordPolicy,
    sessionTimeout: 30,
    maxLoginAttempts: 5,
    lockoutDuration: 15,
    requireMFA: true,
    blockedIpAddresses: [],
    securityQuestions: true,
    deviceTracking: true,
  };

  constructor() {
    this.initializeSecurityMonitoring();
  }

  private initializeSecurityMonitoring() {
    // Setup periodic security checks
    setInterval(() => {
      this.performSecurityScan();
    }, 60000); // Every minute

    // Setup session cleanup
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 300000); // Every 5 minutes

    logger.info('Security monitoring initialized');
  }

  private async performSecurityScan() {
    try {
      // Check for suspicious activities
      await this.detectSuspiciousActivities();
      
      // Check for expired passwords
      await this.checkExpiredPasswords();
      
      // Monitor failed login attempts
      await this.monitorFailedLogins();
      
    } catch (error) {
      logger.error('Security scan failed', { error: error.message });
    }
  }

  private async detectSuspiciousActivities() {
    // Detect multiple failed logins from same IP
    const recentFailures = await prisma.loginAttempt.groupBy({
      by: ['ipAddress'],
      _count: true,
      where: {
        success: false,
        createdAt: {
          gte: new Date(Date.now() - 15 * 60 * 1000), // Last 15 minutes
        },
      },
      having: {
        ipAddress: {
          _count: {
            gte: 10, // 10 or more failures
          },
        },
      },
    });

    for (const failure of recentFailures) {
      await this.createSecurityEvent({
        type: 'MULTIPLE_FAILURES',
        ipAddress: failure.ipAddress,
        userAgent: 'Unknown',
        details: {
          failureCount: failure._count,
          timeWindow: '15 minutes',
        },
        severity: 'HIGH',
        timestamp: new Date(),
      });

      // Auto-block IP if too many failures
      if (failure._count >= 20) {
        await this.blockIpAddress(failure.ipAddress, 'Automated block due to excessive failed login attempts');
      }
    }
  }

  private async checkExpiredPasswords() {
    const settings = await this.getSecuritySettings();
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() - settings.passwordPolicy.maxAge);

    const usersWithExpiredPasswords = await prisma.user.findMany({
      where: {
        passwordChangedAt: {
          lt: expirationDate,
        },
        forcePasswordChange: false,
      },
      select: { id: true, email: true },
    });

    for (const user of usersWithExpiredPasswords) {
      await prisma.user.update({
        where: { id: user.id },
        data: { forcePasswordChange: true },
      });

      // Send password expiration notification
      await emailService.sendEmail({
        to: user.email,
        subject: 'Password Expired - Action Required',
        template: 'password-expired',
        data: { email: user.email },
      });

      logger.info('Password expired for user', { userId: user.id });
    }
  }

  private async monitorFailedLogins() {
    const settings = await this.getSecuritySettings();
    const timeWindow = new Date(Date.now() - 15 * 60 * 1000); // Last 15 minutes

    const userFailures = await prisma.loginAttempt.groupBy({
      by: ['email'],
      _count: true,
      where: {
        success: false,
        createdAt: { gte: timeWindow },
      },
      having: {
        email: {
          _count: {
            gte: settings.maxLoginAttempts,
          },
        },
      },
    });

    for (const failure of userFailures) {
      const user = await prisma.user.findUnique({
        where: { email: failure.email },
      });

      if (user && !user.locked) {
        await this.lockUserAccount(user.id, 'Automated lock due to excessive failed login attempts');
      }
    }
  }

  async hashPassword(password: string): Promise<string> {
    try {
      const saltRounds = 12;
      return await bcrypt.hash(password, saltRounds);
    } catch (error) {
      logger.error('Password hashing failed', { error: error.message });
      throw new Error('Failed to hash password');
    }
  }

  async verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    try {
      return await bcrypt.compare(password, hashedPassword);
    } catch (error) {
      logger.error('Password verification failed', { error: error.message });
      return false;
    }
  }

  async validatePasswordPolicy(password: string, userId?: string): Promise<{ valid: boolean; errors: string[] }> {
    const settings = await this.getSecuritySettings();
    const policy = settings.passwordPolicy;
    const errors: string[] = [];

    // Check minimum length
    if (password.length < policy.minLength) {
      errors.push(`Password must be at least ${policy.minLength} characters long`);
    }

    // Check uppercase requirement
    if (policy.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    // Check lowercase requirement
    if (policy.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    // Check numbers requirement
    if (policy.requireNumbers && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    // Check special characters requirement
    if (policy.requireSpecialChars && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    // Check against common passwords
    if (await this.isCommonPassword(password)) {
      errors.push('Password is too common, please choose a more unique password');
    }

    // Check password reuse if userId provided
    if (userId && policy.preventReuse > 0) {
      const isReused = await this.isPasswordReused(userId, password, policy.preventReuse);
      if (isReused) {
        errors.push(`Password cannot be one of your last ${policy.preventReuse} passwords`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private async isCommonPassword(password: string): Promise<boolean> {
    // Check against a list of common passwords
    const commonPasswords = [
      'password', '123456', '123456789', 'qwerty', 'abc123',
      'password123', 'admin', 'letmein', 'welcome', 'monkey',
      // Add more common passwords
    ];

    return commonPasswords.includes(password.toLowerCase());
  }

  private async isPasswordReused(userId: string, newPassword: string, preventReuse: number): Promise<boolean> {
    try {
      const recentPasswords = await prisma.passwordHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: preventReuse,
      });

      for (const oldPassword of recentPasswords) {
        if (await bcrypt.compare(newPassword, oldPassword.passwordHash)) {
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Password reuse check failed', { error: error.message });
      return false;
    }
  }

  async generateSecureToken(length: number = 32): Promise<string> {
    return crypto.randomBytes(length).toString('hex');
  }

  async generateJWT(payload: any, expiresIn: string = '1h'): Promise<string> {
    try {
      return jwt.sign(payload, config.jwt.secret, {
        expiresIn,
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
      });
    } catch (error) {
      logger.error('JWT generation failed', { error: error.message });
      throw new Error('Failed to generate JWT');
    }
  }

  async verifyJWT(token: string): Promise<any> {
    try {
      return jwt.verify(token, config.jwt.secret, {
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
      });
    } catch (error) {
      logger.error('JWT verification failed', { error: error.message });
      throw new Error('Invalid or expired token');
    }
  }

  async setupMFA(userId: string): Promise<{ secret: string; qrCode: string; backupCodes: string[] }> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, firstName: true, lastName: true },
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Generate MFA secret
      const secret = speakeasy.generateSecret({
        name: `Nova Check EHR (${user.email})`,
        issuer: 'Nova Check EHR',
        length: 32,
      });

      // Generate QR code
      const qrCode = await qrcode.toDataURL(secret.otpauth_url!);

      // Generate backup codes
      const backupCodes = Array.from({ length: 10 }, () => 
        crypto.randomBytes(4).toString('hex').toUpperCase()
      );

      // Store MFA settings (don't enable until verified)
      await prisma.user.update({
        where: { id: userId },
        data: {
          mfaSecret: secret.base32,
          mfaBackupCodes: JSON.stringify(backupCodes),
          mfaEnabled: false, // Will be enabled after verification
        },
      });

      await auditService.logSecurityEvent(
        'MFA_SETUP_INITIATED',
        { userId },
        'MEDIUM'
      );

      return {
        secret: secret.base32!,
        qrCode,
        backupCodes,
      };
    } catch (error) {
      logger.error('MFA setup failed', { userId, error: error.message });
      throw new Error('Failed to setup MFA');
    }
  }

  async verifyMFA(userId: string, token: string, isBackupCode: boolean = false): Promise<boolean> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { mfaSecret: true, mfaBackupCodes: true, mfaEnabled: true },
      });

      if (!user || !user.mfaSecret) {
        return false;
      }

      if (isBackupCode) {
        const backupCodes = user.mfaBackupCodes ? JSON.parse(user.mfaBackupCodes) : [];
        const codeIndex = backupCodes.indexOf(token.toUpperCase());
        
        if (codeIndex === -1) {
          return false;
        }

        // Remove used backup code
        backupCodes.splice(codeIndex, 1);
        await prisma.user.update({
          where: { id: userId },
          data: { mfaBackupCodes: JSON.stringify(backupCodes) },
        });

        await auditService.logSecurityEvent(
          'MFA_BACKUP_CODE_USED',
          { userId },
          'MEDIUM'
        );

        return true;
      } else {
        // Verify TOTP token
        const verified = speakeasy.totp.verify({
          secret: user.mfaSecret,
          encoding: 'base32',
          token,
          window: 2, // Allow 2 time steps (60 seconds) of drift
        });

        if (verified && !user.mfaEnabled) {
          // Enable MFA on first successful verification
          await prisma.user.update({
            where: { id: userId },
            data: { mfaEnabled: true },
          });

          await auditService.logSecurityEvent(
            'MFA_ENABLED',
            { userId },
            'MEDIUM'
          );
        }

        return verified;
      }
    } catch (error) {
      logger.error('MFA verification failed', { userId, error: error.message });
      return false;
    }
  }

  async disableMFA(userId: string): Promise<void> {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: {
          mfaEnabled: false,
          mfaSecret: null,
          mfaBackupCodes: null,
        },
      });

      await auditService.logSecurityEvent(
        'MFA_DISABLED',
        { userId },
        'HIGH'
      );

      logger.info('MFA disabled for user', { userId });
    } catch (error) {
      logger.error('Failed to disable MFA', { userId, error: error.message });
      throw new Error('Failed to disable MFA');
    }
  }

  async createSession(userId: string, ipAddress: string, userAgent: string): Promise<string> {
    try {
      const sessionId = await this.generateSecureToken();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + (await this.getSecuritySettings()).sessionTimeout);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, role: true },
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Get user permissions
      const permissions = await this.getUserPermissions(userId);

      const sessionData: SessionData = {
        userId,
        email: user.email,
        role: user.role,
        permissions,
        ipAddress,
        userAgent,
        createdAt: new Date(),
        lastActivity: new Date(),
        mfaVerified: false,
      };

      // Store session in cache
      await cacheService.set(`session:${sessionId}`, sessionData, (await this.getSecuritySettings()).sessionTimeout * 60);

      // Store session in database for audit
      await prisma.userSession.create({
        data: {
          id: sessionId,
          userId,
          ipAddress,
          userAgent,
          expiresAt,
          createdAt: new Date(),
        },
      });

      logger.info('Session created', { userId, sessionId, ipAddress });
      return sessionId;
    } catch (error) {
      logger.error('Session creation failed', { userId, error: error.message });
      throw new Error('Failed to create session');
    }
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    try {
      const sessionData = await cacheService.get<SessionData>(`session:${sessionId}`);
      
      if (sessionData) {
        // Update last activity
        sessionData.lastActivity = new Date();
        await cacheService.set(`session:${sessionId}`, sessionData, (await this.getSecuritySettings()).sessionTimeout * 60);
      }

      return sessionData;
    } catch (error) {
      logger.error('Session retrieval failed', { sessionId, error: error.message });
      return null;
    }
  }

  async updateSessionMFA(sessionId: string, mfaVerified: boolean): Promise<void> {
    try {
      const sessionData = await this.getSession(sessionId);
      if (sessionData) {
        sessionData.mfaVerified = mfaVerified;
        await cacheService.set(`session:${sessionId}`, sessionData, (await this.getSecuritySettings()).sessionTimeout * 60);
      }
    } catch (error) {
      logger.error('Session MFA update failed', { sessionId, error: error.message });
    }
  }

  async destroySession(sessionId: string): Promise<void> {
    try {
      await cacheService.delete(`session:${sessionId}`);
      
      await prisma.userSession.update({
        where: { id: sessionId },
        data: { endedAt: new Date() },
      });

      logger.info('Session destroyed', { sessionId });
    } catch (error) {
      logger.error('Session destruction failed', { sessionId, error: error.message });
    }
  }

  async destroyAllUserSessions(userId: string): Promise<void> {
    try {
      // Get all active sessions for user
      const sessions = await prisma.userSession.findMany({
        where: {
          userId,
          endedAt: null,
        },
        select: { id: true },
      });

      // Destroy each session
      for (const session of sessions) {
        await this.destroySession(session.id);
      }

      logger.info('All user sessions destroyed', { userId });
    } catch (error) {
      logger.error('Failed to destroy all user sessions', { userId, error: error.message });
    }
  }

  private async cleanupExpiredSessions(): Promise<void> {
    try {
      const expiredSessions = await prisma.userSession.findMany({
        where: {
          expiresAt: { lt: new Date() },
          endedAt: null,
        },
        select: { id: true },
      });

      for (const session of expiredSessions) {
        await this.destroySession(session.id);
      }

      if (expiredSessions.length > 0) {
        logger.info('Cleaned up expired sessions', { count: expiredSessions.length });
      }
    } catch (error) {
      logger.error('Session cleanup failed', { error: error.message });
    }
  }

  async logLoginAttempt(attempt: LoginAttempt): Promise<void> {
    try {
      await prisma.loginAttempt.create({
        data: {
          email: attempt.email,
          ipAddress: attempt.ipAddress,
          userAgent: attempt.userAgent,
          success: attempt.success,
          failureReason: attempt.failureReason,
          createdAt: attempt.timestamp,
        },
      });

      // Log to audit service
      await auditService.logAuthentication(
        attempt.success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILURE',
        {
          email: attempt.email,
          ipAddress: attempt.ipAddress,
          userAgent: attempt.userAgent,
          failureReason: attempt.failureReason,
        },
        attempt.success ? 'LOW' : 'MEDIUM'
      );
    } catch (error) {
      logger.error('Failed to log login attempt', { error: error.message });
    }
  }

  async createSecurityEvent(event: SecurityEvent): Promise<void> {
    try {
      await prisma.securityEvent.create({
        data: {
          type: event.type,
          userId: event.userId,
          ipAddress: event.ipAddress,
          userAgent: event.userAgent,
          details: JSON.stringify(event.details),
          severity: event.severity,
          createdAt: event.timestamp,
        },
      });

      // Log to audit service
      await auditService.logSecurityEvent(
        event.type,
        {
          userId: event.userId,
          ipAddress: event.ipAddress,
          details: event.details,
        },
        event.severity
      );

      // Send alerts for high/critical events
      if (event.severity === 'HIGH' || event.severity === 'CRITICAL') {
        await this.sendSecurityAlert(event);
      }

      logger.warn('Security event created', {
        type: event.type,
        severity: event.severity,
        userId: event.userId,
        ipAddress: event.ipAddress,
      });
    } catch (error) {
      logger.error('Failed to create security event', { error: error.message });
    }
  }

  private async sendSecurityAlert(event: SecurityEvent): Promise<void> {
    try {
      // Get security administrators
      const admins = await prisma.user.findMany({
        where: {
          role: 'ADMIN',
          emailNotifications: true,
        },
        select: { email: true },
      });

      const subject = `Security Alert: ${event.type}`;
      const message = `
        A ${event.severity} security event has been detected:
        
        Type: ${event.type}
        Time: ${event.timestamp.toISOString()}
        IP Address: ${event.ipAddress}
        User: ${event.userId || 'Unknown'}
        
        Details: ${JSON.stringify(event.details, null, 2)}
        
        Please review this event immediately.
      `;

      for (const admin of admins) {
        await emailService.sendEmail({
          to: admin.email,
          subject,
          text: message,
        });
      }
    } catch (error) {
      logger.error('Failed to send security alert', { error: error.message });
    }
  }

  async lockUserAccount(userId: string, reason: string): Promise<void> {
    try {
      const settings = await this.getSecuritySettings();
      const lockedUntil = new Date();
      lockedUntil.setMinutes(lockedUntil.getMinutes() + settings.lockoutDuration);

      await prisma.user.update({
        where: { id: userId },
        data: {
          locked: true,
          lockedAt: new Date(),
          lockedUntil,
          lockReason: reason,
        },
      });

      // Destroy all user sessions
      await this.destroyAllUserSessions(userId);

      await this.createSecurityEvent({
        type: 'ACCOUNT_LOCKOUT',
        userId,
        ipAddress: 'System',
        userAgent: 'System',
        details: { reason },
        severity: 'HIGH',
        timestamp: new Date(),
      });

      logger.warn('User account locked', { userId, reason });
    } catch (error) {
      logger.error('Failed to lock user account', { userId, error: error.message });
      throw new Error('Failed to lock user account');
    }
  }

  async unlockUserAccount(userId: string): Promise<void> {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: {
          locked: false,
          lockedAt: null,
          lockedUntil: null,
          lockReason: null,
        },
      });

      await auditService.logSecurityEvent(
        'ACCOUNT_UNLOCKED',
        { userId },
        'MEDIUM'
      );

      logger.info('User account unlocked', { userId });
    } catch (error) {
      logger.error('Failed to unlock user account', { userId, error: error.message });
      throw new Error('Failed to unlock user account');
    }
  }

  async blockIpAddress(ipAddress: string, reason: string): Promise<void> {
    try {
      await prisma.blockedIp.create({
        data: {
          ipAddress,
          reason,
          blockedAt: new Date(),
        },
      });

      // Update security settings cache
      const settings = await this.getSecuritySettings();
      settings.blockedIpAddresses.push(ipAddress);
      await cacheService.set('security:settings', settings, 3600);

      await this.createSecurityEvent({
        type: 'SUSPICIOUS_LOGIN',
        ipAddress,
        userAgent: 'System',
        details: { reason, action: 'IP_BLOCKED' },
        severity: 'HIGH',
        timestamp: new Date(),
      });

      logger.warn('IP address blocked', { ipAddress, reason });
    } catch (error) {
      logger.error('Failed to block IP address', { ipAddress, error: error.message });
    }
  }

  async unblockIpAddress(ipAddress: string): Promise<void> {
    try {
      await prisma.blockedIp.delete({
        where: { ipAddress },
      });

      // Update security settings cache
      const settings = await this.getSecuritySettings();
      settings.blockedIpAddresses = settings.blockedIpAddresses.filter(ip => ip !== ipAddress);
      await cacheService.set('security:settings', settings, 3600);

      logger.info('IP address unblocked', { ipAddress });
    } catch (error) {
      logger.error('Failed to unblock IP address', { ipAddress, error: error.message });
    }
  }

  async isIpBlocked(ipAddress: string): Promise<boolean> {
    try {
      const settings = await this.getSecuritySettings();
      return settings.blockedIpAddresses.includes(ipAddress);
    } catch (error) {
      logger.error('Failed to check IP block status', { ipAddress, error: error.message });
      return false;
    }
  }

  async trackDevice(userId: string, deviceInfo: Partial<DeviceInfo>): Promise<string> {
    try {
      const deviceId = deviceInfo.deviceId || crypto.createHash('sha256')
        .update(`${deviceInfo.userAgent}-${deviceInfo.ipAddress}-${userId}`)
        .digest('hex');

      const existingDevice = await prisma.userDevice.findUnique({
        where: { deviceId },
      });

      if (existingDevice) {
        // Update last used
        await prisma.userDevice.update({
          where: { deviceId },
          data: {
            lastUsed: new Date(),
            ipAddress: deviceInfo.ipAddress,
          },
        });
        return deviceId;
      }

      // Create new device record
      await prisma.userDevice.create({
        data: {
          deviceId,
          userId,
          deviceName: deviceInfo.deviceName || 'Unknown Device',
          deviceType: deviceInfo.deviceType || 'DESKTOP',
          browser: deviceInfo.browser || 'Unknown',
          os: deviceInfo.os || 'Unknown',
          ipAddress: deviceInfo.ipAddress || '',
          location: deviceInfo.location,
          trusted: false,
          lastUsed: new Date(),
          createdAt: new Date(),
        },
      });

      // Create security event for new device
      await this.createSecurityEvent({
        type: 'UNUSUAL_ACTIVITY',
        userId,
        ipAddress: deviceInfo.ipAddress || '',
        userAgent: deviceInfo.userAgent || '',
        details: {
          action: 'NEW_DEVICE_DETECTED',
          deviceId,
          deviceName: deviceInfo.deviceName,
        },
        severity: 'MEDIUM',
        timestamp: new Date(),
      });

      logger.info('New device tracked', { userId, deviceId });
      return deviceId;
    } catch (error) {
      logger.error('Device tracking failed', { userId, error: error.message });
      throw new Error('Failed to track device');
    }
  }

  async assessRisk(userId: string, context: Record<string, any>): Promise<RiskAssessment> {
    try {
      const factors: { factor: string; weight: number; description: string }[] = [];
      let totalScore = 0;

      // Check login patterns
      const recentLogins = await prisma.loginAttempt.findMany({
        where: {
          email: context.email,
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
          },
        },
      });

      const failedLogins = recentLogins.filter(l => !l.success).length;
      if (failedLogins > 0) {
        const weight = Math.min(failedLogins * 10, 30);
        factors.push({
          factor: 'Failed Login Attempts',
          weight,
          description: `${failedLogins} failed login attempts in the last 24 hours`,
        });
        totalScore += weight;
      }

      // Check IP reputation
      if (context.ipAddress) {
        const isBlocked = await this.isIpBlocked(context.ipAddress);
        if (isBlocked) {
          factors.push({
            factor: 'Blocked IP Address',
            weight: 50,
            description: 'Login attempt from blocked IP address',
          });
          totalScore += 50;
        }
      }

      // Check device trust
      if (context.deviceId) {
        const device = await prisma.userDevice.findUnique({
          where: { deviceId: context.deviceId },
        });

        if (!device) {
          factors.push({
            factor: 'Unknown Device',
            weight: 20,
            description: 'Login from unrecognized device',
          });
          totalScore += 20;
        } else if (!device.trusted) {
          factors.push({
            factor: 'Untrusted Device',
            weight: 15,
            description: 'Login from untrusted device',
          });
          totalScore += 15;
        }
      }

      // Check time-based patterns
      const currentHour = new Date().getHours();
      if (currentHour < 6 || currentHour > 22) {
        factors.push({
          factor: 'Unusual Time',
          weight: 10,
          description: 'Login attempt outside normal business hours',
        });
        totalScore += 10;
      }

      // Determine risk level
      let level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      if (totalScore < 20) level = 'LOW';
      else if (totalScore < 40) level = 'MEDIUM';
      else if (totalScore < 70) level = 'HIGH';
      else level = 'CRITICAL';

      // Generate recommendations
      const recommendations: string[] = [];
      if (level === 'MEDIUM' || level === 'HIGH') {
        recommendations.push('Require additional authentication');
        recommendations.push('Monitor user activity closely');
      }
      if (level === 'HIGH' || level === 'CRITICAL') {
        recommendations.push('Consider temporary account restrictions');
        recommendations.push('Notify security team');
      }
      if (level === 'CRITICAL') {
        recommendations.push('Block access until manual review');
        recommendations.push('Immediate security investigation required');
      }

      return {
        score: Math.min(totalScore, 100),
        level,
        factors,
        recommendations,
      };
    } catch (error) {
      logger.error('Risk assessment failed', { userId, error: error.message });
      return {
        score: 50,
        level: 'MEDIUM',
        factors: [{ factor: 'Assessment Error', weight: 50, description: 'Unable to complete risk assessment' }],
        recommendations: ['Manual review required'],
      };
    }
  }

  private async getUserPermissions(userId: string): Promise<string[]> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          rolePermissions: {
            include: {
              permission: true,
            },
          },
        },
      });

      if (!user) return [];

      return user.rolePermissions.map(rp => rp.permission.name);
    } catch (error) {
      logger.error('Failed to get user permissions', { userId, error: error.message });
      return [];
    }
  }

  async getSecuritySettings(): Promise<SecuritySettings> {
    try {
      const cached = await cacheService.get<SecuritySettings>('security:settings');
      if (cached) return cached;

      // Load from database or use defaults
      const settings = this.defaultSecuritySettings;
      
      // Load blocked IPs
      const blockedIps = await prisma.blockedIp.findMany({
        select: { ipAddress: true },
      });
      settings.blockedIpAddresses = blockedIps.map(ip => ip.ipAddress);

      await cacheService.set('security:settings', settings, 3600);
      return settings;
    } catch (error) {
      logger.error('Failed to get security settings', { error: error.message });
      return this.defaultSecuritySettings;
    }
  }

  async updateSecuritySettings(settings: Partial<SecuritySettings>): Promise<void> {
    try {
      const currentSettings = await this.getSecuritySettings();
      const updatedSettings = { ...currentSettings, ...settings };
      
      await cacheService.set('security:settings', updatedSettings, 3600);
      
      logger.info('Security settings updated');
    } catch (error) {
      logger.error('Failed to update security settings', { error: error.message });
      throw new Error('Failed to update security settings');
    }
  }

  // Rate limiting middleware
  createRateLimiter(options: {
    windowMs: number;
    max: number;
    message?: string;
    skipSuccessfulRequests?: boolean;
  }) {
    return rateLimit({
      windowMs: options.windowMs,
      max: options.max,
      message: options.message || 'Too many requests, please try again later',
      skipSuccessfulRequests: options.skipSuccessfulRequests || false,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req: Request, res: Response) => {
        this.createSecurityEvent({
          type: 'SUSPICIOUS_LOGIN',
          ipAddress: req.ip,
          userAgent: req.get('User-Agent') || '',
          details: {
            action: 'RATE_LIMIT_EXCEEDED',
            endpoint: req.path,
          },
          severity: 'MEDIUM',
          timestamp: new Date(),
        });
        
        res.status(429).json({
          error: 'Too many requests',
          message: options.message || 'Too many requests, please try again later',
        });
      },
    });
  }
}

// Export singleton instance
const securityService = new SecurityService();
export default securityService;

// Export the class for testing
export { SecurityService };