/**
 * ============================================================================
 * NOVA CHECK EHR - AUTHENTICATION MIDDLEWARE
 * ============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { config } from '../config/config';
import logger from '../config/logger';
import { UserRole, UserStatus } from '@prisma/client';

// Extend Request interface to include enhanced user data
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: UserRole;
        status: UserStatus;
        permissions: string[];
        organizationId?: string;
        providerId?: string;
        sessionId: string;
        lastActivity: Date;
        mfaVerified?: boolean;
        ipAddress: string;
        userAgent: string;
      };
      session?: {
        id: string;
        userId: string;
        createdAt: Date;
        lastActivity: Date;
        ipAddress: string;
        userAgent: string;
        isValid: boolean;
      };
    }
  }
}

// Security configuration
const JWT_SECRET = config.jwt.secret;
const JWT_REFRESH_SECRET = config.jwt.refreshSecret;
const JWT_EXPIRES_IN = config.jwt.expiresIn;
const JWT_REFRESH_EXPIRES_IN = config.jwt.refreshExpiresIn;
const SESSION_TIMEOUT = config.security.sessionTimeout || 3600000; // 1 hour
const MAX_SESSIONS_PER_USER = config.security.maxSessionsPerUser || 5;
const BCRYPT_ROUNDS = config.password.bcryptRounds;

// Rate limiting configurations
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  message: {
    error: 'Too many authentication attempts from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Session data interface
interface SessionData {
  id: string;
  userId: string;
  createdAt: Date;
  lastActivity: Date;
  ipAddress: string;
  userAgent: string;
  isValid: boolean;
  mfaVerified?: boolean;
}

// In-memory session store (in production, use Redis or database)
const sessionStore = new Map<string, SessionData>();
const userSessions = new Map<string, Set<string>>(); // userId -> Set of sessionIds

// Utility functions
export const generateSessionId = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

// Enhanced session management
export const createSession = (userId: string, ipAddress: string, userAgent: string): string => {
  const sessionId = generateSessionId();
  const now = new Date();
  
  // Clean up old sessions for user if exceeding limit
  const userSessionIds = userSessions.get(userId) || new Set();
  if (userSessionIds.size >= MAX_SESSIONS_PER_USER) {
    // Remove oldest session
    const oldestSessionId = Array.from(userSessionIds)[0];
    destroySession(oldestSessionId);
  }
  
  // Create new session
  const session: SessionData = {
    id: sessionId,
    userId,
    createdAt: now,
    lastActivity: now,
    ipAddress,
    userAgent,
    isValid: true
  };
  
  sessionStore.set(sessionId, session);
  
  if (!userSessions.has(userId)) {
    userSessions.set(userId, new Set());
  }
  userSessions.get(userId)!.add(sessionId);
  
  return sessionId;
};

export const getSession = (sessionId: string): SessionData | null => {
  const session = sessionStore.get(sessionId);
  if (!session) return null;
  
  // Check if session is expired
  const now = new Date();
  if (now.getTime() - session.lastActivity.getTime() > SESSION_TIMEOUT) {
    destroySession(sessionId);
    return null;
  }
  
  // Update last activity
  session.lastActivity = now;
  sessionStore.set(sessionId, session);
  
  return session;
};

export const destroySession = (sessionId: string): void => {
  const session = sessionStore.get(sessionId);
  if (session) {
    const userSessionIds = userSessions.get(session.userId);
    if (userSessionIds) {
      userSessionIds.delete(sessionId);
      if (userSessionIds.size === 0) {
        userSessions.delete(session.userId);
      }
    }
  }
  sessionStore.delete(sessionId);
};

export const destroyAllUserSessions = (userId: string): void => {
  const userSessionIds = userSessions.get(userId);
  if (userSessionIds) {
    userSessionIds.forEach(sessionId => {
      sessionStore.delete(sessionId);
    });
    userSessions.delete(userId);
  }
};

/**
 * Extended Request interface with enhanced user information
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
    status: UserStatus;
    permissions: string[];
    organizationId?: string;
    providerId?: string;
    sessionId: string;
    lastActivity: Date;
    mfaVerified?: boolean;
    ipAddress: string;
    userAgent: string;
  };
  session?: {
    id: string;
    userId: string;
    createdAt: Date;
    lastActivity: Date;
    ipAddress: string;
    userAgent: string;
    isValid: boolean;
  };
  requestId?: string;
}

/**
 * JWT payload interface
 */
interface JWTPayload {
  userId: string;
  email: string;
  role: UserRole;
  organizationId?: string;
  providerId?: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

/**
 * Enhanced Token generation utilities
 */
export class TokenService {
  /**
   * Generate access token with session support
   */
  static generateAccessToken(payload: {
    userId: string;
    email: string;
    role: UserRole;
    permissions: string[];
    organizationId?: string;
    providerId?: string;
    sessionId: string;
  }): string {
    return jwt.sign(
      {
        id: payload.userId,
        email: payload.email,
        role: payload.role,
        permissions: payload.permissions,
        organizationId: payload.organizationId,
        providerId: payload.providerId,
        sessionId: payload.sessionId,
      },
      JWT_SECRET,
      {
        expiresIn: JWT_EXPIRES_IN,
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
      }
    );
  }

  /**
   * Generate both access and refresh tokens
   */
  static generateTokens(payload: {
    userId: string;
    email: string;
    role: UserRole;
    permissions: string[];
    organizationId?: string;
    providerId?: string;
    sessionId: string;
  }) {
    const accessToken = this.generateAccessToken(payload);
    
    const refreshToken = jwt.sign(
      { sessionId: payload.sessionId, userId: payload.userId },
      JWT_REFRESH_SECRET,
      {
        expiresIn: JWT_REFRESH_EXPIRES_IN,
        issuer: config.jwt.issuer,
        audience: config.jwt.audience
      }
    );
    
    return { accessToken, refreshToken };
  }

  /**
   * Generate refresh token
   */
  static generateRefreshToken(payload: {
    userId: string;
    email: string;
  }): string {
    return jwt.sign(
      {
        userId: payload.userId,
        email: payload.email,
        type: 'refresh',
      },
      config.jwt.refreshSecret,
      {
        expiresIn: config.jwt.refreshExpiresIn,
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
      }
    );
  }

  /**
   * Verify access token
   */
  static verifyAccessToken(token: string): JWTPayload {
    return jwt.verify(token, config.jwt.secret, {
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    }) as JWTPayload;
  }

  /**
   * Verify refresh token
   */
  static verifyRefreshToken(token: string): any {
    return jwt.verify(token, config.jwt.refreshSecret, {
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
  }

  /**
   * Extract token from Authorization header
   */
  static extractTokenFromHeader(authHeader?: string): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.substring(7);
  }
}

/**
 * Password utilities
 */
export class PasswordService {
  /**
   * Hash password
   */
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, config.password.bcryptRounds);
  }

  /**
   * Verify password
   */
  static async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Validate password strength
   */
  static validatePassword(password: string): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (password.length < config.password.minLength) {
      errors.push(`Password must be at least ${config.password.minLength} characters long`);
    }

    if (config.password.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (config.password.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (config.password.requireNumbers && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (config.password.requireSymbols && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

/**
 * Enhanced Authentication middleware with session support
 */
export function authenticate() {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
      
      if (!token) {
        logger.security('Authentication failed - No token provided', {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          severity: 'medium',
          action: 'authentication_failed',
          details: { reason: 'no_token' },
        });
        
        return res.status(401).json({
          error: 'Access token required',
          code: 'TOKEN_MISSING'
        });
      }

      // Check if token is blacklisted
      const isBlacklisted = await cache.exists(`blacklist:${token}`);
      if (isBlacklisted) {
        logger.security('Authentication failed - Token blacklisted', {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          severity: 'high',
          action: 'authentication_failed',
          details: { reason: 'token_blacklisted' },
        });
        
        return res.status(401).json({
          error: 'Invalid or expired session',
          code: 'SESSION_INVALID'
        });
      }

      // Verify JWT token
      const decoded = jwt.verify(token, JWT_SECRET, {
        issuer: config.jwt.issuer,
        audience: config.jwt.audience
      }) as JWTPayload;
      
      // Verify session
      const session = getSession(decoded.sessionId);
      if (!session || !session.isValid) {
        return res.status(401).json({
          error: 'Invalid or expired session',
          code: 'SESSION_INVALID'
        });
      }
      
      // Check if session IP matches (optional security check)
      const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
      if (process.env.ENFORCE_IP_BINDING === 'true' && session.ipAddress !== clientIP) {
        return res.status(401).json({
          error: 'Session IP mismatch',
          code: 'IP_MISMATCH'
        });
      }
      
      // Check if user exists and is active
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        include: {
          userRoles: {
            include: {
              role: {
                include: {
                  permissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              },
            },
          },
          provider: true,
        },
      });

      if (!user) {
        logger.security('Authentication failed - User not found', {
          userId: decoded.id,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          severity: 'high',
          action: 'authentication_failed',
          details: { reason: 'user_not_found' },
        });
        
        return res.status(401).json({
          error: 'Authentication failed',
          message: 'User not found',
        });
      }

      if (user.status !== UserStatus.ACTIVE) {
        logger.security('Authentication failed - User not active', {
          userId: user.id,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          severity: 'medium',
          action: 'authentication_failed',
          details: { reason: 'user_not_active', status: user.status },
        });
        
        return res.status(401).json({
          error: 'Authentication failed',
          message: 'Account is not active',
        });
      }

      // Extract permissions
      const permissions = user.userRoles.flatMap(userRole => 
        userRole.role.permissions.map(rp => rp.permission.name)
      );

      // Attach user and session to request
      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        status: user.status,
        permissions: decoded.permissions,
        organizationId: decoded.organizationId,
        providerId: decoded.providerId,
        sessionId: decoded.sessionId,
        lastActivity: session.lastActivity,
        mfaVerified: session.mfaVerified,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent
      };
      
      req.session = session;

      // Log successful authentication
      logger.audit('User authenticated', {
        userId: user.id,
        action: 'authentication_success',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        success: true,
      });

      next();
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        logger.security('Authentication failed - Invalid token', {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          severity: 'medium',
          action: 'authentication_failed',
          details: { reason: 'invalid_token', error: error.message },
        });
        
        return res.status(401).json({
          error: 'Invalid token',
          code: 'TOKEN_INVALID',
          details: error.message
        });
      }
      
      if (error instanceof jwt.TokenExpiredError) {
        return res.status(401).json({
          error: 'Token expired',
          code: 'TOKEN_EXPIRED',
          expiredAt: error.expiredAt
        });
      }

      logger.error('Authentication middleware error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.status(500).json({
        error: 'Authentication error',
        code: 'AUTH_ERROR'
      });
    }
  };
}

/**
 * Optional authentication middleware (doesn't fail if no token)
 */
export function optionalAuthenticate() {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const token = TokenService.extractTokenFromHeader(req.headers.authorization);
    
    if (!token) {
      return next();
    }

    try {
      const payload = TokenService.verifyAccessToken(token);
      
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        include: {
          userRoles: {
            include: {
              role: {
                include: {
                  permissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              },
            },
          },
          provider: true,
        },
      });

      if (user && user.status === UserStatus.ACTIVE) {
        const permissions = user.userRoles.flatMap(userRole => 
          userRole.role.permissions.map(rp => rp.permission.name)
        );

        req.user = {
          id: user.id,
          email: user.email,
          role: payload.role,
          status: user.status,
          permissions,
          organizationId: payload.organizationId,
          providerId: user.provider?.id,
          lastLoginAt: user.lastLoginAt,
        };
      }
    } catch (error) {
      // Silently fail for optional authentication
      logger.debug('Optional authentication failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    next();
  };
}

/**
 * Enhanced Role-based authorization middleware
 */
export function authorize(allowedRoles: UserRole[] | UserRole) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

    if (!roles.includes(req.user.role)) {
      logger.security('Authorization failed - Insufficient role', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRoles: roles,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        severity: 'medium',
        action: 'authorization_failed',
      });
      
      return res.status(403).json({
        error: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        required: roles,
        current: req.user.role
      });
    }

    next();
  };
}

/**
 * Permission-based authorization middleware
 */
export function requirePermission(permission: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'User not authenticated',
      });
    }

    if (!req.user.permissions.includes(permission)) {
      logger.security('Authorization failed - Missing permission', {
        userId: req.user.id,
        requiredPermission: permission,
        userPermissions: req.user.permissions,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        severity: 'medium',
        action: 'authorization_failed',
      });
      
      return res.status(403).json({
        error: 'Access denied',
        message: `Permission '${permission}' required`,
      });
    }

    next();
  };
}

/**
 * Resource ownership authorization
 */
export function requireOwnership(resourceIdParam: string = 'id') {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'User not authenticated',
      });
    }

    const resourceId = req.params[resourceIdParam];
    const userId = req.user.id;

    // Admin users can access any resource
    if (req.user.role === UserRole.ADMIN || req.user.role === UserRole.SUPER_ADMIN) {
      return next();
    }

    // Check if user owns the resource (implementation depends on resource type)
    // This is a generic check - specific implementations should override this
    if (resourceId === userId) {
      return next();
    }

    logger.security('Authorization failed - Resource ownership', {
      userId: req.user.id,
      resourceId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      severity: 'medium',
      action: 'authorization_failed',
    });

    return res.status(403).json({
      error: 'Access denied',
      message: 'You can only access your own resources',
    });
  };
}

/**
 * Enhanced Rate limiting for authentication endpoints
 */
export function authRateLimit() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = `auth_rate_limit:${req.ip}`;
    const maxAttempts = config.security.maxLoginAttempts;
    const windowMs = config.security.accountLockoutDuration;

    try {
      const attempts = await cache.get<number>(key) || 0;
      
      if (attempts >= maxAttempts) {
        logger.security('Rate limit exceeded for authentication', {
          ipAddress: req.ip,
          attempts,
          maxAttempts,
          severity: 'high',
          action: 'rate_limit_exceeded',
        });
        
        return res.status(429).json({
          error: 'Too many authentication attempts from this IP, please try again later.',
          retryAfter: '15 minutes',
          code: 'RATE_LIMIT_EXCEEDED'
        });
      }

      // Increment attempts
      await cache.set(key, attempts + 1, Math.ceil(windowMs / 1000));
      
      next();
    } catch (error) {
      logger.error('Auth rate limit middleware error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: req.ip,
      });
      
      // Continue on cache error
      next();
    }
  };
}

/**
 * Clear authentication rate limit on successful login
 */
export async function clearAuthRateLimit(ipAddress: string): Promise<void> {
  try {
    const key = `auth_rate_limit:${ipAddress}`;
    await cache.del(key);
  } catch (error) {
    logger.error('Failed to clear auth rate limit', {
      error: error instanceof Error ? error.message : 'Unknown error',
      ipAddress,
    });
  }
}

/**
 * Blacklist token
 */
export async function blacklistToken(token: string): Promise<void> {
  try {
    const payload = TokenService.verifyAccessToken(token);
    const expiresIn = payload.exp - Math.floor(Date.now() / 1000);
    
    if (expiresIn > 0) {
      await cache.set(`blacklist:${token}`, true, expiresIn);
    }
  } catch (error) {
    logger.error('Failed to blacklist token', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Enhanced Session management with Redis integration
 */
export class SessionService {
  /**
   * Create user session with Redis backup
   */
  static async createSession(userId: string, ipAddress: string, userAgent: string): Promise<string> {
    const sessionId = generateSessionId();
    const sessionData = {
      id: sessionId,
      userId,
      ipAddress,
      userAgent,
      createdAt: new Date(),
      lastActivity: new Date(),
      isValid: true
    };

    // Store in memory
    const memorySessionId = createSession(userId, ipAddress, userAgent);
    
    // Also store in Redis for persistence
    await cache.set(
      `session:${sessionId}`,
      sessionData,
      Math.ceil(config.cache.ttl.userSession)
    );

    return sessionId;
  }

  /**
   * Get session data from memory or Redis
   */
  static async getSession(sessionId: string): Promise<SessionData | null> {
    // Try memory first
    let session = getSession(sessionId);
    
    // Fallback to Redis
    if (!session) {
      session = await cache.get(`session:${sessionId}`);
      if (session) {
        // Restore to memory
        sessionStore.set(sessionId, session);
      }
    }
    
    return session;
  }

  /**
   * Update session last accessed time
   */
  static async updateSessionAccess(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (session) {
      session.lastActivity = new Date();
      sessionStore.set(sessionId, session);
      
      // Update Redis
      await cache.set(
        `session:${sessionId}`,
        session,
        Math.ceil(config.cache.ttl.userSession)
      );
    }
  }

  /**
   * Destroy session from both memory and Redis
   */
  static async destroySession(sessionId: string): Promise<void> {
    destroySession(sessionId);
    await cache.del(`session:${sessionId}`);
  }

  /**
   * Destroy all user sessions
   */
  static async destroyUserSessions(userId: string): Promise<void> {
    destroyAllUserSessions(userId);
    
    // Clear from Redis (pattern-based deletion)
    const pattern = `session:*`;
    const keys = await cache.keys(pattern);
    
    for (const key of keys) {
      const session = await cache.get(key);
      if (session && session.userId === userId) {
        await cache.del(key);
      }
    }
  }

  /**
   * Validate session and check for security issues
   */
  static async validateSession(sessionId: string, ipAddress: string, userAgent: string): Promise<boolean> {
    const session = await this.getSession(sessionId);
    
    if (!session || !session.isValid) {
      return false;
    }
    
    // Check for session hijacking
    if (process.env.ENFORCE_IP_BINDING === 'true' && session.ipAddress !== ipAddress) {
      logger.security('Potential session hijacking detected', {
        sessionId,
        originalIP: session.ipAddress,
        currentIP: ipAddress,
        severity: 'high'
      });
      
      await this.destroySession(sessionId);
      return false;
    }
    
    // Check session timeout
    const now = new Date();
    if (now.getTime() - session.lastActivity.getTime() > SESSION_TIMEOUT) {
      await this.destroySession(sessionId);
      return false;
    }
    
    return true;
  }
}