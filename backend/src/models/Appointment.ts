/**
 * ============================================================================
 * NOVA CHECK EHR - APPOINTMENT MODEL
 * ============================================================================
 */

import { PrismaClient, Appointment as PrismaAppointment, AppointmentType, AppointmentStatus, Priority } from '@prisma/client';
import { logger } from '../utils/logger';
import { AppError, NotFoundError, ValidationError, ConflictError } from '../utils/errors';
import { generateUniqueId } from '../utils/generators';
import { isValidAppointmentTime, generateTimeSlots, isTimeSlotAvailable } from '../utils/helpers';
import { AppointmentCreateData, AppointmentUpdateData } from '../types';

// ============================================================================
// INTERFACES
// ============================================================================

export interface AppointmentWithRelations extends PrismaAppointment {
  patient?: any;
  provider?: any;
  reminders?: any[];
  notes?: any[];
  documents?: any[];
}

export interface AppointmentSearchFilters {
  patientId?: string;
  providerId?: string;
  type?: AppointmentType;
  status?: AppointmentStatus;
  priority?: Priority;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  isVirtual?: boolean;
  isRecurring?: boolean;
}

export interface AppointmentStats {
  totalAppointments: number;
  scheduledAppointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  noShowAppointments: number;
  appointmentsByType: Record<AppointmentType, number>;
  appointmentsByStatus: Record<AppointmentStatus, number>;
  averageDuration: number;
  utilizationRate: number;
}

export interface ProviderSchedule {
  providerId: string;
  date: string;
  availableSlots: TimeSlot[];
  bookedSlots: TimeSlot[];
  blockedSlots: TimeSlot[];
}

export interface TimeSlot {
  startTime: string;
  endTime: string;
  duration: number;
  isAvailable: boolean;
  appointmentId?: string;
  reason?: string;
}

export interface AppointmentConflict {
  conflictType: 'OVERLAP' | 'DOUBLE_BOOKING' | 'OUTSIDE_HOURS';
  message: string;
  conflictingAppointment?: any;
}

// ============================================================================
// APPOINTMENT MODEL CLASS
// ============================================================================

export class AppointmentModel {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create a new appointment
   */
  async create(appointmentData: AppointmentCreateData): Promise<AppointmentWithRelations> {
    try {
      // Validate required fields
      if (!appointmentData.patientId || !appointmentData.providerId || !appointmentData.scheduledAt) {
        throw new ValidationError('Missing required fields: patientId, providerId, scheduledAt');
      }

      // Validate appointment time
      if (!isValidAppointmentTime(appointmentData.scheduledAt)) {
        throw new ValidationError('Invalid appointment time');
      }

      // Check for conflicts
      const conflicts = await this.checkConflicts(
        appointmentData.providerId,
        appointmentData.scheduledAt,
        appointmentData.duration || 30
      );

      if (conflicts.length > 0) {
        throw new ConflictError(`Appointment conflicts detected: ${conflicts.map(c => c.message).join(', ')}`);
      }

      // Verify patient and provider exist
      const [patient, provider] = await Promise.all([
        this.prisma.patient.findUnique({ where: { id: appointmentData.patientId } }),
        this.prisma.user.findUnique({ where: { id: appointmentData.providerId } }),
      ]);

      if (!patient) {
        throw new NotFoundError('Patient not found');
      }

      if (!provider) {
        throw new NotFoundError('Provider not found');
      }

      // Generate appointment ID
      const appointmentId = generateUniqueId('APT');

      // Calculate end time
      const duration = appointmentData.duration || 30;
      const endTime = new Date(appointmentData.scheduledAt.getTime() + duration * 60000);

      // Create appointment with transaction
      const appointment = await this.prisma.$transaction(async (tx) => {
        // Create appointment
        const newAppointment = await tx.appointment.create({
          data: {
            id: generateUniqueId('APP'),
            appointmentId,
            patientId: appointmentData.patientId,
            providerId: appointmentData.providerId,
            type: appointmentData.type || AppointmentType.CONSULTATION,
            status: AppointmentStatus.SCHEDULED,
            priority: appointmentData.priority || Priority.MEDIUM,
            scheduledAt: appointmentData.scheduledAt,
            endTime,
            duration,
            title: appointmentData.title || `${appointmentData.type || 'Consultation'} - ${patient.firstName} ${patient.lastName}`,
            description: appointmentData.description,
            location: appointmentData.location,
            isVirtual: appointmentData.isVirtual || false,
            virtualMeetingUrl: appointmentData.virtualMeetingUrl,
            isRecurring: appointmentData.isRecurring || false,
            recurringPattern: appointmentData.recurringPattern,
            recurringEndDate: appointmentData.recurringEndDate,
            notes: appointmentData.notes,
            metadata: appointmentData.metadata || {},
            reminderPreferences: appointmentData.reminderPreferences || {},
          },
          include: {
            patient: {
              select: {
                id: true,
                patientId: true,
                firstName: true,
                lastName: true,
                phone: true,
                email: true,
                dateOfBirth: true,
              },
            },
            provider: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                title: true,
                department: true,
                phone: true,
                email: true,
              },
            },
          },
        });

        // Create recurring appointments if specified
        if (appointmentData.isRecurring && appointmentData.recurringPattern) {
          await this.createRecurringAppointments(
            tx,
            newAppointment,
            appointmentData.recurringPattern,
            appointmentData.recurringEndDate
          );
        }

        // Schedule reminders if preferences provided
        if (appointmentData.reminderPreferences) {
          await this.scheduleReminders(tx, newAppointment.id, appointmentData.reminderPreferences);
        }

        return newAppointment;
      });

      logger.info('Appointment created successfully', {
        component: 'AppointmentModel',
        appointmentId: appointment.appointmentId,
        patientId: appointmentData.patientId,
        providerId: appointmentData.providerId,
        scheduledAt: appointmentData.scheduledAt,
      });

      return appointment;
    } catch (error) {
      logger.error('Error creating appointment', {
        component: 'AppointmentModel',
        error: (error as Error).message,
        appointmentData: {
          patientId: appointmentData.patientId,
          providerId: appointmentData.providerId,
          scheduledAt: appointmentData.scheduledAt,
        },
      });
      throw error;
    }
  }

  /**
   * Find appointment by ID
   */
  async findById(id: string, includeRelations: boolean = false): Promise<AppointmentWithRelations | null> {
    try {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id },
        include: includeRelations ? {
          patient: {
            select: {
              id: true,
              patientId: true,
              firstName: true,
              lastName: true,
              phone: true,
              email: true,
              dateOfBirth: true,
              gender: true,
              allergies: {
                where: { isActive: true },
                select: {
                  allergen: true,
                  severity: true,
                },
              },
            },
          },
          provider: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              title: true,
              department: true,
              phone: true,
              email: true,
            },
          },
          reminders: {
            orderBy: { scheduledAt: 'asc' },
          },
          notes: {
            orderBy: { createdAt: 'desc' },
            include: {
              author: {
                select: {
                  firstName: true,
                  lastName: true,
                  title: true,
                },
              },
            },
          },
          documents: {
            orderBy: { createdAt: 'desc' },
          },
        } : undefined,
      });

      return appointment;
    } catch (error) {
      logger.error('Error finding appointment by ID', {
        component: 'AppointmentModel',
        error: (error as Error).message,
        appointmentId: id,
      });
      throw new AppError('Failed to find appointment', 500);
    }
  }

  /**
   * Update appointment
   */
  async update(id: string, updateData: AppointmentUpdateData): Promise<AppointmentWithRelations> {
    try {
      // Check if appointment exists
      const existingAppointment = await this.findById(id);
      if (!existingAppointment) {
        throw new NotFoundError('Appointment not found');
      }

      // Check if appointment can be updated
      if (existingAppointment.status === AppointmentStatus.COMPLETED) {
        throw new ValidationError('Cannot update completed appointment');
      }

      // Validate time change if provided
      if (updateData.scheduledAt) {
        if (!isValidAppointmentTime(updateData.scheduledAt)) {
          throw new ValidationError('Invalid appointment time');
        }

        // Check for conflicts if time is being changed
        if (updateData.scheduledAt.getTime() !== existingAppointment.scheduledAt.getTime()) {
          const conflicts = await this.checkConflicts(
            existingAppointment.providerId,
            updateData.scheduledAt,
            updateData.duration || existingAppointment.duration,
            id // Exclude current appointment from conflict check
          );

          if (conflicts.length > 0) {
            throw new ConflictError(`Appointment conflicts detected: ${conflicts.map(c => c.message).join(', ')}`);
          }
        }
      }

      // Prepare update data
      const updatePayload: any = { ...updateData };

      // Calculate new end time if duration or scheduled time changed
      if (updateData.scheduledAt || updateData.duration) {
        const scheduledAt = updateData.scheduledAt || existingAppointment.scheduledAt;
        const duration = updateData.duration || existingAppointment.duration;
        updatePayload.endTime = new Date(scheduledAt.getTime() + duration * 60000);
      }

      // Update appointment
      const updatedAppointment = await this.prisma.appointment.update({
        where: { id },
        data: {
          ...updatePayload,
          updatedAt: new Date(),
        },
        include: {
          patient: {
            select: {
              id: true,
              patientId: true,
              firstName: true,
              lastName: true,
              phone: true,
              email: true,
            },
          },
          provider: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              title: true,
              department: true,
            },
          },
        },
      });

      logger.info('Appointment updated successfully', {
        component: 'AppointmentModel',
        appointmentId: id,
        updatedFields: Object.keys(updateData),
      });

      return updatedAppointment;
    } catch (error) {
      logger.error('Error updating appointment', {
        component: 'AppointmentModel',
        error: (error as Error).message,
        appointmentId: id,
      });
      throw error;
    }
  }

  /**
   * Cancel appointment
   */
  async cancel(id: string, reason?: string, cancelledBy?: string): Promise<AppointmentWithRelations> {
    try {
      const appointment = await this.findById(id);
      if (!appointment) {
        throw new NotFoundError('Appointment not found');
      }

      if (appointment.status === AppointmentStatus.CANCELLED) {
        throw new ValidationError('Appointment is already cancelled');
      }

      if (appointment.status === AppointmentStatus.COMPLETED) {
        throw new ValidationError('Cannot cancel completed appointment');
      }

      const updatedAppointment = await this.prisma.appointment.update({
        where: { id },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancellationReason: reason,
          cancelledBy,
          cancelledAt: new Date(),
          updatedAt: new Date(),
        },
        include: {
          patient: true,
          provider: true,
        },
      });

      logger.info('Appointment cancelled successfully', {
        component: 'AppointmentModel',
        appointmentId: id,
        reason,
        cancelledBy,
      });

      return updatedAppointment;
    } catch (error) {
      logger.error('Error cancelling appointment', {
        component: 'AppointmentModel',
        error: (error as Error).message,
        appointmentId: id,
      });
      throw error;
    }
  }

  /**
   * Complete appointment
   */
  async complete(id: string, completedBy?: string, notes?: string): Promise<AppointmentWithRelations> {
    try {
      const appointment = await this.findById(id);
      if (!appointment) {
        throw new NotFoundError('Appointment not found');
      }

      if (appointment.status === AppointmentStatus.COMPLETED) {
        throw new ValidationError('Appointment is already completed');
      }

      if (appointment.status === AppointmentStatus.CANCELLED) {
        throw new ValidationError('Cannot complete cancelled appointment');
      }

      const updatedAppointment = await this.prisma.appointment.update({
        where: { id },
        data: {
          status: AppointmentStatus.COMPLETED,
          completedBy,
          completedAt: new Date(),
          completionNotes: notes,
          updatedAt: new Date(),
        },
        include: {
          patient: true,
          provider: true,
        },
      });

      logger.info('Appointment completed successfully', {
        component: 'AppointmentModel',
        appointmentId: id,
        completedBy,
      });

      return updatedAppointment;
    } catch (error) {
      logger.error('Error completing appointment', {
        component: 'AppointmentModel',
        error: (error as Error).message,
        appointmentId: id,
      });
      throw error;
    }
  }

  /**
   * Get appointments with filters and pagination
   */
  async findMany(
    filters: AppointmentSearchFilters = {},
    page: number = 1,
    limit: number = 20,
    sortBy: string = 'scheduledAt',
    sortOrder: 'asc' | 'desc' = 'asc'
  ): Promise<{ appointments: AppointmentWithRelations[]; total: number; pages: number }> {
    try {
      const skip = (page - 1) * limit;
      
      // Build where clause
      const where: any = {};

      if (filters.patientId) {
        where.patientId = filters.patientId;
      }

      if (filters.providerId) {
        where.providerId = filters.providerId;
      }

      if (filters.type) {
        where.type = filters.type;
      }

      if (filters.status) {
        where.status = filters.status;
      }

      if (filters.priority) {
        where.priority = filters.priority;
      }

      if (filters.isVirtual !== undefined) {
        where.isVirtual = filters.isVirtual;
      }

      if (filters.isRecurring !== undefined) {
        where.isRecurring = filters.isRecurring;
      }

      if (filters.dateFrom || filters.dateTo) {
        where.scheduledAt = {};
        if (filters.dateFrom) {
          where.scheduledAt.gte = filters.dateFrom;
        }
        if (filters.dateTo) {
          where.scheduledAt.lte = filters.dateTo;
        }
      }

      if (filters.search) {
        where.OR = [
          { title: { contains: filters.search, mode: 'insensitive' } },
          { description: { contains: filters.search, mode: 'insensitive' } },
          { appointmentId: { contains: filters.search, mode: 'insensitive' } },
          {
            patient: {
              OR: [
                { firstName: { contains: filters.search, mode: 'insensitive' } },
                { lastName: { contains: filters.search, mode: 'insensitive' } },
                { patientId: { contains: filters.search, mode: 'insensitive' } },
              ],
            },
          },
        ];
      }

      // Get appointments and total count
      const [appointments, total] = await Promise.all([
        this.prisma.appointment.findMany({
          where,
          include: {
            patient: {
              select: {
                id: true,
                patientId: true,
                firstName: true,
                lastName: true,
                phone: true,
                email: true,
                dateOfBirth: true,
              },
            },
            provider: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                title: true,
                department: true,
              },
            },
          },
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        this.prisma.appointment.count({ where }),
      ]);

      const pages = Math.ceil(total / limit);

      return { appointments, total, pages };
    } catch (error) {
      logger.error('Error finding appointments', {
        component: 'AppointmentModel',
        error: (error as Error).message,
        filters,
      });
      throw new AppError('Failed to find appointments', 500);
    }
  }

  /**
   * Get provider schedule for a specific date
   */
  async getProviderSchedule(providerId: string, date: Date): Promise<ProviderSchedule> {
    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      // Get provider's appointments for the day
      const appointments = await this.prisma.appointment.findMany({
        where: {
          providerId,
          scheduledAt: {
            gte: startOfDay,
            lte: endOfDay,
          },
          status: {
            not: AppointmentStatus.CANCELLED,
          },
        },
        orderBy: {
          scheduledAt: 'asc',
        },
      });

      // Get provider's working hours (assuming 9 AM to 5 PM for now)
      const workingHours = {
        start: 9, // 9 AM
        end: 17,  // 5 PM
      };

      // Generate all possible time slots (30-minute intervals)
      const allSlots = generateTimeSlots(
        new Date(date.getFullYear(), date.getMonth(), date.getDate(), workingHours.start),
        new Date(date.getFullYear(), date.getMonth(), date.getDate(), workingHours.end),
        30
      );

      // Mark booked slots
      const bookedSlots: TimeSlot[] = [];
      const availableSlots: TimeSlot[] = [];

      allSlots.forEach(slot => {
        const slotStart = new Date(`${date.toDateString()} ${slot.startTime}`);
        const slotEnd = new Date(`${date.toDateString()} ${slot.endTime}`);
        
        const isBooked = appointments.some(apt => {
          const aptStart = new Date(apt.scheduledAt);
          const aptEnd = new Date(apt.endTime);
          
          return (
            (slotStart >= aptStart && slotStart < aptEnd) ||
            (slotEnd > aptStart && slotEnd <= aptEnd) ||
            (slotStart <= aptStart && slotEnd >= aptEnd)
          );
        });

        if (isBooked) {
          const appointment = appointments.find(apt => {
            const aptStart = new Date(apt.scheduledAt);
            const aptEnd = new Date(apt.endTime);
            return slotStart >= aptStart && slotStart < aptEnd;
          });
          
          bookedSlots.push({
            ...slot,
            isAvailable: false,
            appointmentId: appointment?.id,
          });
        } else {
          availableSlots.push({
            ...slot,
            isAvailable: true,
          });
        }
      });

      return {
        providerId,
        date: date.toISOString().split('T')[0],
        availableSlots,
        bookedSlots,
        blockedSlots: [], // TODO: Implement blocked slots
      };
    } catch (error) {
      logger.error('Error getting provider schedule', {
        component: 'AppointmentModel',
        error: (error as Error).message,
        providerId,
        date,
      });
      throw new AppError('Failed to get provider schedule', 500);
    }
  }

  /**
   * Check for appointment conflicts
   */
  async checkConflicts(
    providerId: string,
    scheduledAt: Date,
    duration: number,
    excludeAppointmentId?: string
  ): Promise<AppointmentConflict[]> {
    try {
      const endTime = new Date(scheduledAt.getTime() + duration * 60000);
      const conflicts: AppointmentConflict[] = [];

      // Check for overlapping appointments
      const where: any = {
        providerId,
        status: {
          not: AppointmentStatus.CANCELLED,
        },
        OR: [
          {
            scheduledAt: {
              lt: endTime,
            },
            endTime: {
              gt: scheduledAt,
            },
          },
        ],
      };

      if (excludeAppointmentId) {
        where.id = { not: excludeAppointmentId };
      }

      const overlappingAppointments = await this.prisma.appointment.findMany({
        where,
        include: {
          patient: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      if (overlappingAppointments.length > 0) {
        overlappingAppointments.forEach(apt => {
          conflicts.push({
            conflictType: 'OVERLAP',
            message: `Overlaps with existing appointment for ${apt.patient?.firstName} ${apt.patient?.lastName} at ${apt.scheduledAt.toLocaleTimeString()}`,
            conflictingAppointment: apt,
          });
        });
      }

      // Check if appointment is within working hours (9 AM to 5 PM)
      const hour = scheduledAt.getHours();
      const endHour = endTime.getHours();
      
      if (hour < 9 || endHour > 17) {
        conflicts.push({
          conflictType: 'OUTSIDE_HOURS',
          message: 'Appointment is outside working hours (9 AM - 5 PM)',
        });
      }

      return conflicts;
    } catch (error) {
      logger.error('Error checking appointment conflicts', {
        component: 'AppointmentModel',
        error: (error as Error).message,
        providerId,
        scheduledAt,
        duration,
      });
      throw new AppError('Failed to check appointment conflicts', 500);
    }
  }

  /**
   * Get appointment statistics
   */
  async getStats(dateFrom?: Date, dateTo?: Date): Promise<AppointmentStats> {
    try {
      const where: any = {};
      
      if (dateFrom || dateTo) {
        where.scheduledAt = {};
        if (dateFrom) {
          where.scheduledAt.gte = dateFrom;
        }
        if (dateTo) {
          where.scheduledAt.lte = dateTo;
        }
      }

      const [totalAppointments, appointmentsByStatus, appointmentsByType, avgDuration] = await Promise.all([
        this.prisma.appointment.count({ where }),
        this.prisma.appointment.groupBy({
          by: ['status'],
          where,
          _count: true,
        }),
        this.prisma.appointment.groupBy({
          by: ['type'],
          where,
          _count: true,
        }),
        this.prisma.appointment.aggregate({
          where,
          _avg: {
            duration: true,
          },
        }),
      ]);

      // Format status stats
      const statusStats = appointmentsByStatus.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {} as Record<AppointmentStatus, number>);

      // Ensure all statuses are represented
      Object.values(AppointmentStatus).forEach(status => {
        if (!(status in statusStats)) {
          statusStats[status] = 0;
        }
      });

      // Format type stats
      const typeStats = appointmentsByType.reduce((acc, item) => {
        acc[item.type] = item._count;
        return acc;
      }, {} as Record<AppointmentType, number>);

      // Ensure all types are represented
      Object.values(AppointmentType).forEach(type => {
        if (!(type in typeStats)) {
          typeStats[type] = 0;
        }
      });

      // Calculate utilization rate (scheduled + completed vs total slots)
      const workingDays = dateTo && dateFrom 
        ? Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24))
        : 30; // Default to 30 days
      
      const totalSlots = workingDays * 8 * 2; // 8 hours * 2 slots per hour
      const utilizationRate = totalAppointments > 0 ? (totalAppointments / totalSlots) * 100 : 0;

      return {
        totalAppointments,
        scheduledAppointments: statusStats[AppointmentStatus.SCHEDULED] || 0,
        completedAppointments: statusStats[AppointmentStatus.COMPLETED] || 0,
        cancelledAppointments: statusStats[AppointmentStatus.CANCELLED] || 0,
        noShowAppointments: statusStats[AppointmentStatus.NO_SHOW] || 0,
        appointmentsByType: typeStats,
        appointmentsByStatus: statusStats,
        averageDuration: Math.round(avgDuration._avg.duration || 30),
        utilizationRate: Math.round(utilizationRate * 10) / 10,
      };
    } catch (error) {
      logger.error('Error getting appointment stats', {
        component: 'AppointmentModel',
        error: (error as Error).message,
      });
      throw new AppError('Failed to get appointment statistics', 500);
    }
  }

  /**
   * Get upcoming appointments for a patient
   */
  async getUpcomingForPatient(patientId: string, limit: number = 5): Promise<AppointmentWithRelations[]> {
    try {
      const appointments = await this.prisma.appointment.findMany({
        where: {
          patientId,
          scheduledAt: {
            gte: new Date(),
          },
          status: {
            in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
          },
        },
        include: {
          provider: {
            select: {
              firstName: true,
              lastName: true,
              title: true,
              department: true,
            },
          },
        },
        orderBy: {
          scheduledAt: 'asc',
        },
        take: limit,
      });

      return appointments;
    } catch (error) {
      logger.error('Error getting upcoming appointments for patient', {
        component: 'AppointmentModel',
        error: (error as Error).message,
        patientId,
      });
      throw new AppError('Failed to get upcoming appointments', 500);
    }
  }

  /**
   * Get today's appointments for a provider
   */
  async getTodayForProvider(providerId: string): Promise<AppointmentWithRelations[]> {
    try {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);

      const appointments = await this.prisma.appointment.findMany({
        where: {
          providerId,
          scheduledAt: {
            gte: startOfDay,
            lte: endOfDay,
          },
          status: {
            not: AppointmentStatus.CANCELLED,
          },
        },
        include: {
          patient: {
            select: {
              id: true,
              patientId: true,
              firstName: true,
              lastName: true,
              phone: true,
              dateOfBirth: true,
              allergies: {
                where: { isActive: true },
                select: {
                  allergen: true,
                  severity: true,
                },
              },
            },
          },
        },
        orderBy: {
          scheduledAt: 'asc',
        },
      });

      return appointments;
    } catch (error) {
      logger.error('Error getting today\'s appointments for provider', {
        component: 'AppointmentModel',
        error: (error as Error).message,
        providerId,
      });
      throw new AppError('Failed to get today\'s appointments', 500);
    }
  }

  /**
   * Create recurring appointments
   */
  private async createRecurringAppointments(
    tx: any,
    baseAppointment: any,
    pattern: any,
    endDate?: Date
  ): Promise<void> {
    // Implementation for creating recurring appointments
    // This would depend on the specific recurring pattern structure
    // For now, this is a placeholder
    logger.info('Creating recurring appointments', {
      component: 'AppointmentModel',
      baseAppointmentId: baseAppointment.id,
      pattern,
      endDate,
    });
  }

  /**
   * Schedule appointment reminders
   */
  private async scheduleReminders(
    tx: any,
    appointmentId: string,
    preferences: any
  ): Promise<void> {
    // Implementation for scheduling reminders
    // This would integrate with the notification system
    logger.info('Scheduling appointment reminders', {
      component: 'AppointmentModel',
      appointmentId,
      preferences,
    });
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default AppointmentModel;