/**
 * ============================================================================
 * NOVA CHECK EHR - USER MODEL
 * ============================================================================
 */

import { PrismaClient, User as PrismaUser, UserRole, UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { logger } from '../utils/logger';
import { AppError, NotFoundError, ValidationError } from '../utils/errors';
import { generateUniqueId } from '../utils/generators';
import { normalizeEmail, isValidSSN } from '../utils/helpers';
import { UserCreateData, UserUpdateData } from '../types';

// ============================================================================
// INTERFACES
// ============================================================================

export interface UserWithRelations extends PrismaUser {
  profile?: any;
  permissions?: any[];
  sessions?: any[];
  auditLogs?: any[];
}

export interface UserSearchFilters {
  role?: UserRole;
  status?: UserStatus;
  search?: string;
  department?: string;
  createdAfter?: Date;
  createdBefore?: Date;
}

export interface UserStats {
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  usersByRole: Record<UserRole, number>;
  recentRegistrations: number;
}

// ============================================================================
// USER MODEL CLASS
// ============================================================================

export class UserModel {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create a new user
   */
  async create(userData: UserCreateData): Promise<UserWithRelations> {
    try {
      // Validate required fields
      if (!userData.email || !userData.password || !userData.firstName || !userData.lastName) {
        throw new ValidationError('Missing required fields');
      }

      // Normalize email
      const email = normalizeEmail(userData.email);

      // Check if user already exists
      const existingUser = await this.findByEmail(email);
      if (existingUser) {
        throw new ValidationError('User with this email already exists');
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, 12);

      // Generate user ID
      const userId = generateUniqueId('USR');

      // Create user with transaction
      const user = await this.prisma.$transaction(async (tx) => {
        // Create user
        const newUser = await tx.user.create({
          data: {
            id: userId,
            email,
            password: hashedPassword,
            firstName: userData.firstName,
            lastName: userData.lastName,
            role: userData.role || UserRole.STAFF,
            status: UserStatus.ACTIVE,
            phone: userData.phone,
            department: userData.department,
            title: userData.title,
            licenseNumber: userData.licenseNumber,
            npiNumber: userData.npiNumber,
            specialties: userData.specialties || [],
            preferences: userData.preferences || {},
            lastLoginAt: null,
            emailVerifiedAt: null,
            twoFactorEnabled: false,
          },
          include: {
            profile: true,
            permissions: true,
          },
        });

        // Create user profile if additional data provided
        if (userData.profile) {
          await tx.userProfile.create({
            data: {
              userId: newUser.id,
              ...userData.profile,
            },
          });
        }

        return newUser;
      });

      logger.info('User created successfully', {
        component: 'UserModel',
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      return user;
    } catch (error) {
      logger.error('Error creating user', {
        component: 'UserModel',
        error: (error as Error).message,
        email: userData.email,
      });
      throw error;
    }
  }

  /**
   * Find user by ID
   */
  async findById(id: string, includeRelations: boolean = false): Promise<UserWithRelations | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
        include: includeRelations ? {
          profile: true,
          permissions: true,
          sessions: {
            where: {
              expiresAt: {
                gt: new Date(),
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
        } : undefined,
      });

      return user;
    } catch (error) {
      logger.error('Error finding user by ID', {
        component: 'UserModel',
        error: (error as Error).message,
        userId: id,
      });
      throw new AppError('Failed to find user', 500);
    }
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string, includeRelations: boolean = false): Promise<UserWithRelations | null> {
    try {
      const normalizedEmail = normalizeEmail(email);
      
      const user = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
        include: includeRelations ? {
          profile: true,
          permissions: true,
        } : undefined,
      });

      return user;
    } catch (error) {
      logger.error('Error finding user by email', {
        component: 'UserModel',
        error: (error as Error).message,
        email,
      });
      throw new AppError('Failed to find user', 500);
    }
  }

  /**
   * Update user
   */
  async update(id: string, updateData: UserUpdateData): Promise<UserWithRelations> {
    try {
      // Check if user exists
      const existingUser = await this.findById(id);
      if (!existingUser) {
        throw new NotFoundError('User not found');
      }

      // Prepare update data
      const updatePayload: any = { ...updateData };

      // Hash password if provided
      if (updateData.password) {
        updatePayload.password = await bcrypt.hash(updateData.password, 12);
      }

      // Normalize email if provided
      if (updateData.email) {
        updatePayload.email = normalizeEmail(updateData.email);
        
        // Check if email is already taken by another user
        const emailExists = await this.prisma.user.findFirst({
          where: {
            email: updatePayload.email,
            id: { not: id },
          },
        });
        
        if (emailExists) {
          throw new ValidationError('Email is already taken by another user');
        }
      }

      // Update user
      const updatedUser = await this.prisma.user.update({
        where: { id },
        data: {
          ...updatePayload,
          updatedAt: new Date(),
        },
        include: {
          profile: true,
          permissions: true,
        },
      });

      logger.info('User updated successfully', {
        component: 'UserModel',
        userId: id,
        updatedFields: Object.keys(updateData),
      });

      return updatedUser;
    } catch (error) {
      logger.error('Error updating user', {
        component: 'UserModel',
        error: (error as Error).message,
        userId: id,
      });
      throw error;
    }
  }

  /**
   * Delete user (soft delete)
   */
  async delete(id: string): Promise<boolean> {
    try {
      // Check if user exists
      const existingUser = await this.findById(id);
      if (!existingUser) {
        throw new NotFoundError('User not found');
      }

      // Soft delete by updating status
      await this.prisma.user.update({
        where: { id },
        data: {
          status: UserStatus.INACTIVE,
          deletedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      logger.info('User deleted successfully', {
        component: 'UserModel',
        userId: id,
      });

      return true;
    } catch (error) {
      logger.error('Error deleting user', {
        component: 'UserModel',
        error: (error as Error).message,
        userId: id,
      });
      throw error;
    }
  }

  /**
   * Get users with filters and pagination
   */
  async findMany(
    filters: UserSearchFilters = {},
    page: number = 1,
    limit: number = 20,
    sortBy: string = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<{ users: UserWithRelations[]; total: number; pages: number }> {
    try {
      const skip = (page - 1) * limit;
      
      // Build where clause
      const where: any = {
        deletedAt: null, // Only active users
      };

      if (filters.role) {
        where.role = filters.role;
      }

      if (filters.status) {
        where.status = filters.status;
      }

      if (filters.department) {
        where.department = filters.department;
      }

      if (filters.search) {
        where.OR = [
          { firstName: { contains: filters.search, mode: 'insensitive' } },
          { lastName: { contains: filters.search, mode: 'insensitive' } },
          { email: { contains: filters.search, mode: 'insensitive' } },
          { phone: { contains: filters.search, mode: 'insensitive' } },
        ];
      }

      if (filters.createdAfter || filters.createdBefore) {
        where.createdAt = {};
        if (filters.createdAfter) {
          where.createdAt.gte = filters.createdAfter;
        }
        if (filters.createdBefore) {
          where.createdAt.lte = filters.createdBefore;
        }
      }

      // Get users and total count
      const [users, total] = await Promise.all([
        this.prisma.user.findMany({
          where,
          include: {
            profile: true,
            permissions: true,
          },
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        this.prisma.user.count({ where }),
      ]);

      const pages = Math.ceil(total / limit);

      return { users, total, pages };
    } catch (error) {
      logger.error('Error finding users', {
        component: 'UserModel',
        error: (error as Error).message,
        filters,
      });
      throw new AppError('Failed to find users', 500);
    }
  }

  /**
   * Verify user password
   */
  async verifyPassword(id: string, password: string): Promise<boolean> {
    try {
      const user = await this.findById(id);
      if (!user) {
        throw new NotFoundError('User not found');
      }

      return await bcrypt.compare(password, user.password);
    } catch (error) {
      logger.error('Error verifying password', {
        component: 'UserModel',
        error: (error as Error).message,
        userId: id,
      });
      throw error;
    }
  }

  /**
   * Update last login time
   */
  async updateLastLogin(id: string): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id },
        data: {
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      logger.error('Error updating last login', {
        component: 'UserModel',
        error: (error as Error).message,
        userId: id,
      });
      // Don't throw error for this operation
    }
  }

  /**
   * Update user status
   */
  async updateStatus(id: string, status: UserStatus): Promise<UserWithRelations> {
    try {
      const updatedUser = await this.prisma.user.update({
        where: { id },
        data: {
          status,
          updatedAt: new Date(),
        },
        include: {
          profile: true,
          permissions: true,
        },
      });

      logger.info('User status updated', {
        component: 'UserModel',
        userId: id,
        newStatus: status,
      });

      return updatedUser;
    } catch (error) {
      logger.error('Error updating user status', {
        component: 'UserModel',
        error: (error as Error).message,
        userId: id,
        status,
      });
      throw error;
    }
  }

  /**
   * Get user statistics
   */
  async getStats(): Promise<UserStats> {
    try {
      const [totalUsers, activeUsers, usersByRole, recentRegistrations] = await Promise.all([
        this.prisma.user.count({
          where: { deletedAt: null },
        }),
        this.prisma.user.count({
          where: {
            status: UserStatus.ACTIVE,
            deletedAt: null,
          },
        }),
        this.prisma.user.groupBy({
          by: ['role'],
          where: { deletedAt: null },
          _count: true,
        }),
        this.prisma.user.count({
          where: {
            createdAt: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
            },
            deletedAt: null,
          },
        }),
      ]);

      const inactiveUsers = totalUsers - activeUsers;
      
      const roleStats = usersByRole.reduce((acc, item) => {
        acc[item.role] = item._count;
        return acc;
      }, {} as Record<UserRole, number>);

      // Ensure all roles are represented
      Object.values(UserRole).forEach(role => {
        if (!(role in roleStats)) {
          roleStats[role] = 0;
        }
      });

      return {
        totalUsers,
        activeUsers,
        inactiveUsers,
        usersByRole: roleStats,
        recentRegistrations,
      };
    } catch (error) {
      logger.error('Error getting user stats', {
        component: 'UserModel',
        error: (error as Error).message,
      });
      throw new AppError('Failed to get user statistics', 500);
    }
  }

  /**
   * Search users by various criteria
   */
  async search(
    query: string,
    filters: UserSearchFilters = {},
    limit: number = 10
  ): Promise<UserWithRelations[]> {
    try {
      const where: any = {
        deletedAt: null,
        OR: [
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query, mode: 'insensitive' } },
          { licenseNumber: { contains: query, mode: 'insensitive' } },
          { npiNumber: { contains: query, mode: 'insensitive' } },
        ],
      };

      // Apply additional filters
      if (filters.role) {
        where.role = filters.role;
      }

      if (filters.status) {
        where.status = filters.status;
      }

      if (filters.department) {
        where.department = filters.department;
      }

      const users = await this.prisma.user.findMany({
        where,
        include: {
          profile: true,
        },
        orderBy: [
          { status: 'asc' }, // Active users first
          { firstName: 'asc' },
          { lastName: 'asc' },
        ],
        take: limit,
      });

      return users;
    } catch (error) {
      logger.error('Error searching users', {
        component: 'UserModel',
        error: (error as Error).message,
        query,
        filters,
      });
      throw new AppError('Failed to search users', 500);
    }
  }

  /**
   * Get users by role
   */
  async findByRole(role: UserRole, includeInactive: boolean = false): Promise<UserWithRelations[]> {
    try {
      const where: any = {
        role,
        deletedAt: null,
      };

      if (!includeInactive) {
        where.status = UserStatus.ACTIVE;
      }

      const users = await this.prisma.user.findMany({
        where,
        include: {
          profile: true,
        },
        orderBy: [
          { firstName: 'asc' },
          { lastName: 'asc' },
        ],
      });

      return users;
    } catch (error) {
      logger.error('Error finding users by role', {
        component: 'UserModel',
        error: (error as Error).message,
        role,
      });
      throw new AppError('Failed to find users by role', 500);
    }
  }

  /**
   * Verify email
   */
  async verifyEmail(id: string): Promise<UserWithRelations> {
    try {
      const updatedUser = await this.prisma.user.update({
        where: { id },
        data: {
          emailVerifiedAt: new Date(),
          updatedAt: new Date(),
        },
        include: {
          profile: true,
          permissions: true,
        },
      });

      logger.info('User email verified', {
        component: 'UserModel',
        userId: id,
      });

      return updatedUser;
    } catch (error) {
      logger.error('Error verifying email', {
        component: 'UserModel',
        error: (error as Error).message,
        userId: id,
      });
      throw error;
    }
  }

  /**
   * Enable/disable two-factor authentication
   */
  async updateTwoFactor(id: string, enabled: boolean, secret?: string): Promise<UserWithRelations> {
    try {
      const updateData: any = {
        twoFactorEnabled: enabled,
        updatedAt: new Date(),
      };

      if (enabled && secret) {
        updateData.twoFactorSecret = secret;
      } else if (!enabled) {
        updateData.twoFactorSecret = null;
      }

      const updatedUser = await this.prisma.user.update({
        where: { id },
        data: updateData,
        include: {
          profile: true,
          permissions: true,
        },
      });

      logger.info('User two-factor authentication updated', {
        component: 'UserModel',
        userId: id,
        enabled,
      });

      return updatedUser;
    } catch (error) {
      logger.error('Error updating two-factor authentication', {
        component: 'UserModel',
        error: (error as Error).message,
        userId: id,
      });
      throw error;
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default UserModel;