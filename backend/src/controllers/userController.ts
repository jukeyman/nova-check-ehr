/**
 * ============================================================================
 * NOVA CHECK EHR - USER CONTROLLER
 * ============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AuthenticatedRequest, TokenService, PasswordService, SessionService } from '../middleware/auth';
import { AppError, ValidationError, AuthenticationError, NotFoundError } from '../middleware/errorHandler';
import logger from '../config/logger';
import { CacheService } from '../config/redis';
import config from '../config/config';
import { sendEmail } from '../services/emailService';
import { generateSecureToken } from '../utils/crypto';
import { asyncHandler } from '../middleware/errorHandler';

const prisma = new PrismaClient();
const cacheService = new CacheService();
const tokenService = new TokenService();
const passwordService = new PasswordService();
const sessionService = new SessionService();

/**
 * User registration
 */
export const register = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, firstName, lastName, role = UserRole.PATIENT, phone } = req.body;

  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    throw new ValidationError('User with this email already exists');
  }

  // Hash password
  const hashedPassword = await passwordService.hashPassword(password);

  // Generate verification token
  const verificationToken = generateSecureToken();
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role,
      phone,
      status: UserStatus.PENDING,
      verificationToken,
      verificationExpires,
      lastLoginAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      phone: true,
      createdAt: true,
    },
  });

  // Send verification email
  try {
    await sendEmail({
      to: email,
      subject: 'Verify your Nova Check EHR account',
      template: 'verification',
      data: {
        firstName,
        verificationUrl: `${config.app.frontendUrl}/verify-email?token=${verificationToken}`,
      },
    });
  } catch (error) {
    logger.error('Failed to send verification email', { error, userId: user.id });
  }

  logger.info('User registered successfully', {
    userId: user.id,
    email,
    role,
  });

  res.status(201).json({
    success: true,
    message: 'User registered successfully. Please check your email to verify your account.',
    data: { user },
  });
});

/**
 * User login
 */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, rememberMe = false } = req.body;
  const userAgent = req.get('User-Agent') || 'Unknown';
  const ipAddress = req.ip;

  // Find user
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      provider: true,
      patient: true,
    },
  });

  if (!user) {
    throw new AuthenticationError('Invalid email or password');
  }

  // Check if user is active
  if (user.status !== UserStatus.ACTIVE) {
    throw new AuthenticationError('Account is not active. Please contact support.');
  }

  // Verify password
  const isPasswordValid = await passwordService.verifyPassword(password, user.password);
  if (!isPasswordValid) {
    // Log failed login attempt
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'LOGIN_FAILED',
        resource: 'User',
        resourceId: user.id,
        details: { email, ipAddress, userAgent },
        ipAddress,
        userAgent,
      },
    });

    throw new AuthenticationError('Invalid email or password');
  }

  // Generate tokens
  const accessToken = tokenService.generateAccessToken(user.id, user.role);
  const refreshToken = tokenService.generateRefreshToken(user.id);

  // Create session
  const sessionId = await sessionService.createSession({
    userId: user.id,
    refreshToken,
    userAgent,
    ipAddress,
    expiresAt: new Date(Date.now() + (rememberMe ? 30 : 7) * 24 * 60 * 60 * 1000),
  });

  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      loginCount: { increment: 1 },
    },
  });

  // Log successful login
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      resource: 'User',
      resourceId: user.id,
      details: { email, ipAddress, userAgent, sessionId },
      ipAddress,
      userAgent,
    },
  });

  // Prepare user data
  const userData = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    phone: user.phone,
    avatar: user.avatar,
    lastLoginAt: user.lastLoginAt,
    provider: user.provider,
    patient: user.patient,
  };

  // Set refresh token as httpOnly cookie
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: config.app.environment === 'production',
    sameSite: 'strict',
    maxAge: (rememberMe ? 30 : 7) * 24 * 60 * 60 * 1000,
  });

  logger.info('User logged in successfully', {
    userId: user.id,
    email,
    ipAddress,
    userAgent,
  });

  res.json({
    success: true,
    message: 'Login successful',
    data: {
      user: userData,
      accessToken,
      sessionId,
    },
  });
});

/**
 * User logout
 */
export const logout = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const refreshToken = req.cookies.refreshToken;
  const userId = req.user?.id;

  if (refreshToken && userId) {
    // Invalidate session
    await sessionService.invalidateSession(refreshToken);

    // Blacklist access token
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const accessToken = authHeader.substring(7);
      await tokenService.blacklistToken(accessToken);
    }

    // Log logout
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'LOGOUT',
        resource: 'User',
        resourceId: userId,
        details: { ipAddress: req.ip, userAgent: req.get('User-Agent') },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent') || 'Unknown',
      },
    });
  }

  // Clear refresh token cookie
  res.clearCookie('refreshToken');

  logger.info('User logged out successfully', { userId });

  res.json({
    success: true,
    message: 'Logout successful',
  });
});

/**
 * Refresh access token
 */
export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    throw new AuthenticationError('Refresh token not provided');
  }

  // Verify refresh token
  const decoded = tokenService.verifyRefreshToken(refreshToken);
  if (!decoded) {
    throw new AuthenticationError('Invalid refresh token');
  }

  // Check if session exists and is valid
  const session = await sessionService.getSession(refreshToken);
  if (!session || session.expiresAt < new Date()) {
    throw new AuthenticationError('Session expired');
  }

  // Get user
  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
  });

  if (!user || user.status !== UserStatus.ACTIVE) {
    throw new AuthenticationError('User not found or inactive');
  }

  // Generate new access token
  const newAccessToken = tokenService.generateAccessToken(user.id, user.role);

  // Update session last accessed
  await sessionService.updateSessionAccess(refreshToken);

  res.json({
    success: true,
    data: {
      accessToken: newAccessToken,
    },
  });
});

/**
 * Get current user profile
 */
export const getProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      provider: {
        include: {
          specialties: true,
          licenses: true,
        },
      },
      patient: {
        include: {
          allergies: true,
          medications: true,
        },
      },
    },
  });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  const userData = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    phone: user.phone,
    avatar: user.avatar,
    emailVerified: user.emailVerified,
    twoFactorEnabled: user.twoFactorEnabled,
    lastLoginAt: user.lastLoginAt,
    loginCount: user.loginCount,
    createdAt: user.createdAt,
    provider: user.provider,
    patient: user.patient,
  };

  res.json({
    success: true,
    data: { user: userData },
  });
});

/**
 * Update user profile
 */
export const updateProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { firstName, lastName, phone, avatar } = req.body;

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      firstName,
      lastName,
      phone,
      avatar,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      phone: true,
      avatar: true,
      updatedAt: true,
    },
  });

  // Log profile update
  await prisma.auditLog.create({
    data: {
      userId,
      action: 'PROFILE_UPDATE',
      resource: 'User',
      resourceId: userId,
      details: { updatedFields: Object.keys(req.body) },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('User profile updated', { userId, updatedFields: Object.keys(req.body) });

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: { user },
  });
});

/**
 * Change password
 */
export const changePassword = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { currentPassword, newPassword } = req.body;

  // Get current user
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Verify current password
  const isCurrentPasswordValid = await passwordService.verifyPassword(currentPassword, user.password);
  if (!isCurrentPasswordValid) {
    throw new ValidationError('Current password is incorrect');
  }

  // Validate new password strength
  const passwordValidation = passwordService.validatePasswordStrength(newPassword);
  if (!passwordValidation.isValid) {
    throw new ValidationError('New password does not meet security requirements', passwordValidation.errors);
  }

  // Hash new password
  const hashedNewPassword = await passwordService.hashPassword(newPassword);

  // Update password
  await prisma.user.update({
    where: { id: userId },
    data: {
      password: hashedNewPassword,
      passwordChangedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Invalidate all sessions except current
  await sessionService.invalidateAllUserSessions(userId, req.cookies.refreshToken);

  // Log password change
  await prisma.auditLog.create({
    data: {
      userId,
      action: 'PASSWORD_CHANGE',
      resource: 'User',
      resourceId: userId,
      details: { ipAddress: req.ip, userAgent: req.get('User-Agent') },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('User password changed', { userId });

  res.json({
    success: true,
    message: 'Password changed successfully',
  });
});

/**
 * Forgot password
 */
export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;

  const user = await prisma.user.findUnique({
    where: { email },
  });

  // Always return success to prevent email enumeration
  if (!user) {
    return res.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
  }

  // Generate reset token
  const resetToken = generateSecureToken();
  const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // Save reset token
  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetToken,
      resetExpires,
    },
  });

  // Send reset email
  try {
    await sendEmail({
      to: email,
      subject: 'Reset your Nova Check EHR password',
      template: 'password-reset',
      data: {
        firstName: user.firstName,
        resetUrl: `${config.app.frontendUrl}/reset-password?token=${resetToken}`,
      },
    });
  } catch (error) {
    logger.error('Failed to send password reset email', { error, userId: user.id });
  }

  // Log password reset request
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'PASSWORD_RESET_REQUEST',
      resource: 'User',
      resourceId: user.id,
      details: { email, ipAddress: req.ip, userAgent: req.get('User-Agent') },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Password reset requested', { userId: user.id, email });

  res.json({
    success: true,
    message: 'If an account with that email exists, a password reset link has been sent.',
  });
});

/**
 * Reset password
 */
export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, newPassword } = req.body;

  const user = await prisma.user.findFirst({
    where: {
      resetToken: token,
      resetExpires: {
        gt: new Date(),
      },
    },
  });

  if (!user) {
    throw new ValidationError('Invalid or expired reset token');
  }

  // Validate new password strength
  const passwordValidation = passwordService.validatePasswordStrength(newPassword);
  if (!passwordValidation.isValid) {
    throw new ValidationError('Password does not meet security requirements', passwordValidation.errors);
  }

  // Hash new password
  const hashedPassword = await passwordService.hashPassword(newPassword);

  // Update password and clear reset token
  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashedPassword,
      passwordChangedAt: new Date(),
      resetToken: null,
      resetExpires: null,
      updatedAt: new Date(),
    },
  });

  // Invalidate all sessions
  await sessionService.invalidateAllUserSessions(user.id);

  // Log password reset
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'PASSWORD_RESET',
      resource: 'User',
      resourceId: user.id,
      details: { ipAddress: req.ip, userAgent: req.get('User-Agent') },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Password reset completed', { userId: user.id });

  res.json({
    success: true,
    message: 'Password reset successfully',
  });
});

/**
 * Verify email
 */
export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body;

  const user = await prisma.user.findFirst({
    where: {
      verificationToken: token,
      verificationExpires: {
        gt: new Date(),
      },
    },
  });

  if (!user) {
    throw new ValidationError('Invalid or expired verification token');
  }

  // Update user as verified and active
  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      status: UserStatus.ACTIVE,
      verificationToken: null,
      verificationExpires: null,
      updatedAt: new Date(),
    },
  });

  // Log email verification
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'EMAIL_VERIFIED',
      resource: 'User',
      resourceId: user.id,
      details: { email: user.email, ipAddress: req.ip, userAgent: req.get('User-Agent') },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Email verified successfully', { userId: user.id, email: user.email });

  res.json({
    success: true,
    message: 'Email verified successfully',
  });
});

/**
 * Get all users (Admin only)
 */
export const getUsers = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page = 1, limit = 20, search, role, status } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const where: any = {};

  if (search) {
    where.OR = [
      { firstName: { contains: search as string, mode: 'insensitive' } },
      { lastName: { contains: search as string, mode: 'insensitive' } },
      { email: { contains: search as string, mode: 'insensitive' } },
    ];
  }

  if (role) {
    where.role = role;
  }

  if (status) {
    where.status = status;
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        phone: true,
        avatar: true,
        emailVerified: true,
        lastLoginAt: true,
        loginCount: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: Number(limit),
    }),
    prisma.user.count({ where }),
  ]);

  const totalPages = Math.ceil(total / Number(limit));

  res.json({
    success: true,
    data: {
      users,
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
 * Get user by ID (Admin only)
 */
export const getUserById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      provider: {
        include: {
          specialties: true,
          licenses: true,
        },
      },
      patient: {
        include: {
          allergies: true,
          medications: true,
        },
      },
      auditLogs: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  res.json({
    success: true,
    data: { user },
  });
});

/**
 * Update user (Admin only)
 */
export const updateUser = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { firstName, lastName, email, phone, role, status } = req.body;
  const adminUserId = req.user!.id;

  // Check if user exists
  const existingUser = await prisma.user.findUnique({
    where: { id },
  });

  if (!existingUser) {
    throw new NotFoundError('User not found');
  }

  // Check if email is already taken by another user
  if (email && email !== existingUser.email) {
    const emailExists = await prisma.user.findUnique({
      where: { email },
    });

    if (emailExists) {
      throw new ValidationError('Email is already taken');
    }
  }

  // Update user
  const user = await prisma.user.update({
    where: { id },
    data: {
      firstName,
      lastName,
      email,
      phone,
      role,
      status,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      phone: true,
      avatar: true,
      updatedAt: true,
    },
  });

  // Log user update
  await prisma.auditLog.create({
    data: {
      userId: adminUserId,
      action: 'USER_UPDATE',
      resource: 'User',
      resourceId: id,
      details: {
        updatedFields: Object.keys(req.body),
        targetUser: { id, email: existingUser.email },
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('User updated by admin', {
    adminUserId,
    targetUserId: id,
    updatedFields: Object.keys(req.body),
  });

  res.json({
    success: true,
    message: 'User updated successfully',
    data: { user },
  });
});

/**
 * Delete user (Admin only)
 */
export const deleteUser = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const adminUserId = req.user!.id;

  // Check if user exists
  const user = await prisma.user.findUnique({
    where: { id },
  });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Prevent self-deletion
  if (id === adminUserId) {
    throw new ValidationError('Cannot delete your own account');
  }

  // Soft delete user
  await prisma.user.update({
    where: { id },
    data: {
      status: UserStatus.INACTIVE,
      deletedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Invalidate all user sessions
  await sessionService.invalidateAllUserSessions(id);

  // Log user deletion
  await prisma.auditLog.create({
    data: {
      userId: adminUserId,
      action: 'USER_DELETE',
      resource: 'User',
      resourceId: id,
      details: {
        targetUser: { id, email: user.email, role: user.role },
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('User deleted by admin', {
    adminUserId,
    targetUserId: id,
    targetUserEmail: user.email,
  });

  res.json({
    success: true,
    message: 'User deleted successfully',
  });
});

/**
 * Get user sessions
 */
export const getUserSessions = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  const sessions = await sessionService.getUserSessions(userId);

  res.json({
    success: true,
    data: { sessions },
  });
});

/**
 * Revoke user session
 */
export const revokeSession = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { sessionId } = req.params;
  const currentRefreshToken = req.cookies.refreshToken;

  await sessionService.revokeSession(sessionId, userId, currentRefreshToken);

  // Log session revocation
  await prisma.auditLog.create({
    data: {
      userId,
      action: 'SESSION_REVOKE',
      resource: 'Session',
      resourceId: sessionId,
      details: { sessionId },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Session revoked', { userId, sessionId });

  res.json({
    success: true,
    message: 'Session revoked successfully',
  });
});

/**
 * Get user activity logs
 */
export const getUserActivity = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const [activities, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: Number(limit),
    }),
    prisma.auditLog.count({ where: { userId } }),
  ]);

  const totalPages = Math.ceil(total / Number(limit));

  res.json({
    success: true,
    data: {
      activities,
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