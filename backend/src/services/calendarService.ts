/**
 * ============================================================================
 * NOVA CHECK EHR - CALENDAR SERVICE
 * ============================================================================
 */

import { PrismaClient } from '@prisma/client';
import logger from '../config/logger';
import { addMinutes, format, isAfter, isBefore, isEqual, parseISO, startOfDay, endOfDay, addDays, subDays } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

interface TimeSlot {
  start: Date;
  end: Date;
  available: boolean;
  appointmentId?: string;
  appointmentType?: string;
  patientName?: string;
}

interface AvailabilitySlot {
  start: Date;
  end: Date;
  duration: number; // in minutes
}

interface ScheduleBlock {
  id: string;
  providerId: string;
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, etc.
  startTime: string; // HH:mm format
  endTime: string; // HH:mm format
  isAvailable: boolean;
  breakStart?: string;
  breakEnd?: string;
}

interface AppointmentConflict {
  conflictType: 'overlap' | 'outside_hours' | 'break_time' | 'unavailable';
  message: string;
  conflictingAppointment?: {
    id: string;
    start: Date;
    end: Date;
    patientName: string;
  };
}

class CalendarService {
  async getProviderAvailability(
    providerId: string,
    startDate: Date,
    endDate: Date,
    appointmentDuration: number = 30
  ): Promise<AvailabilitySlot[]> {
    try {
      const availableSlots: AvailabilitySlot[] = [];
      
      // Get provider's schedule
      const schedules = await prisma.providerSchedule.findMany({
        where: { providerId },
        orderBy: { dayOfWeek: 'asc' },
      });

      if (schedules.length === 0) {
        logger.warn('No schedule found for provider', { providerId });
        return [];
      }

      // Get existing appointments in the date range
      const existingAppointments = await prisma.appointment.findMany({
        where: {
          providerId,
          scheduledAt: {
            gte: startDate,
            lte: endDate,
          },
          status: {
            in: ['scheduled', 'confirmed', 'checked_in'],
          },
        },
        select: {
          id: true,
          scheduledAt: true,
          duration: true,
          patient: {
            select: {
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      });

      // Get provider's time off/unavailable periods
      const timeOffPeriods = await prisma.providerTimeOff.findMany({
        where: {
          providerId,
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      });

      let currentDate = new Date(startDate);
      
      while (currentDate <= endDate) {
        const dayOfWeek = currentDate.getDay();
        const daySchedule = schedules.find(s => s.dayOfWeek === dayOfWeek && s.isAvailable);
        
        if (daySchedule) {
          const daySlots = this.generateDaySlots(
            currentDate,
            daySchedule,
            appointmentDuration,
            existingAppointments,
            timeOffPeriods
          );
          availableSlots.push(...daySlots);
        }
        
        currentDate = addDays(currentDate, 1);
      }

      return availableSlots;
    } catch (error) {
      logger.error('Failed to get provider availability', {
        error: error.message,
        providerId,
        startDate,
        endDate,
      });
      throw error;
    }
  }

  private generateDaySlots(
    date: Date,
    schedule: any,
    appointmentDuration: number,
    existingAppointments: any[],
    timeOffPeriods: any[]
  ): AvailabilitySlot[] {
    const slots: AvailabilitySlot[] = [];
    
    // Check if this date is in a time-off period
    const isTimeOff = timeOffPeriods.some(timeOff => {
      const startDate = new Date(timeOff.startDate);
      const endDate = new Date(timeOff.endDate);
      return date >= startDate && date <= endDate;
    });
    
    if (isTimeOff) {
      return slots;
    }

    // Parse schedule times
    const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
    const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
    
    let currentSlotStart = new Date(date);
    currentSlotStart.setHours(startHour, startMinute, 0, 0);
    
    const dayEnd = new Date(date);
    dayEnd.setHours(endHour, endMinute, 0, 0);
    
    // Handle break time if specified
    let breakStart: Date | null = null;
    let breakEnd: Date | null = null;
    
    if (schedule.breakStart && schedule.breakEnd) {
      const [breakStartHour, breakStartMinute] = schedule.breakStart.split(':').map(Number);
      const [breakEndHour, breakEndMinute] = schedule.breakEnd.split(':').map(Number);
      
      breakStart = new Date(date);
      breakStart.setHours(breakStartHour, breakStartMinute, 0, 0);
      
      breakEnd = new Date(date);
      breakEnd.setHours(breakEndHour, breakEndMinute, 0, 0);
    }

    while (currentSlotStart < dayEnd) {
      const slotEnd = addMinutes(currentSlotStart, appointmentDuration);
      
      // Check if slot extends beyond working hours
      if (slotEnd > dayEnd) {
        break;
      }
      
      // Check if slot conflicts with break time
      if (breakStart && breakEnd) {
        if (
          (currentSlotStart >= breakStart && currentSlotStart < breakEnd) ||
          (slotEnd > breakStart && slotEnd <= breakEnd) ||
          (currentSlotStart < breakStart && slotEnd > breakEnd)
        ) {
          currentSlotStart = addMinutes(currentSlotStart, appointmentDuration);
          continue;
        }
      }
      
      // Check if slot conflicts with existing appointments
      const hasConflict = existingAppointments.some(appointment => {
        const appointmentStart = new Date(appointment.scheduledAt);
        const appointmentEnd = addMinutes(appointmentStart, appointment.duration);
        
        return (
          (currentSlotStart >= appointmentStart && currentSlotStart < appointmentEnd) ||
          (slotEnd > appointmentStart && slotEnd <= appointmentEnd) ||
          (currentSlotStart < appointmentStart && slotEnd > appointmentEnd)
        );
      });
      
      if (!hasConflict) {
        slots.push({
          start: new Date(currentSlotStart),
          end: new Date(slotEnd),
          duration: appointmentDuration,
        });
      }
      
      currentSlotStart = addMinutes(currentSlotStart, appointmentDuration);
    }

    return slots;
  }

  async checkAppointmentConflicts(
    providerId: string,
    scheduledAt: Date,
    duration: number,
    excludeAppointmentId?: string
  ): Promise<AppointmentConflict[]> {
    try {
      const conflicts: AppointmentConflict[] = [];
      const appointmentEnd = addMinutes(scheduledAt, duration);
      
      // Check if appointment is within provider's working hours
      const dayOfWeek = scheduledAt.getDay();
      const schedule = await prisma.providerSchedule.findFirst({
        where: {
          providerId,
          dayOfWeek,
          isAvailable: true,
        },
      });
      
      if (!schedule) {
        conflicts.push({
          conflictType: 'unavailable',
          message: 'Provider is not available on this day',
        });
        return conflicts;
      }
      
      // Check working hours
      const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
      const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
      
      const workStart = new Date(scheduledAt);
      workStart.setHours(startHour, startMinute, 0, 0);
      
      const workEnd = new Date(scheduledAt);
      workEnd.setHours(endHour, endMinute, 0, 0);
      
      if (scheduledAt < workStart || appointmentEnd > workEnd) {
        conflicts.push({
          conflictType: 'outside_hours',
          message: `Appointment must be between ${schedule.startTime} and ${schedule.endTime}`,
        });
      }
      
      // Check break time
      if (schedule.breakStart && schedule.breakEnd) {
        const [breakStartHour, breakStartMinute] = schedule.breakStart.split(':').map(Number);
        const [breakEndHour, breakEndMinute] = schedule.breakEnd.split(':').map(Number);
        
        const breakStart = new Date(scheduledAt);
        breakStart.setHours(breakStartHour, breakStartMinute, 0, 0);
        
        const breakEnd = new Date(scheduledAt);
        breakEnd.setHours(breakEndHour, breakEndMinute, 0, 0);
        
        if (
          (scheduledAt >= breakStart && scheduledAt < breakEnd) ||
          (appointmentEnd > breakStart && appointmentEnd <= breakEnd) ||
          (scheduledAt < breakStart && appointmentEnd > breakEnd)
        ) {
          conflicts.push({
            conflictType: 'break_time',
            message: `Appointment conflicts with break time (${schedule.breakStart} - ${schedule.breakEnd})`,
          });
        }
      }
      
      // Check for overlapping appointments
      const overlappingAppointments = await prisma.appointment.findMany({
        where: {
          providerId,
          id: excludeAppointmentId ? { not: excludeAppointmentId } : undefined,
          status: {
            in: ['scheduled', 'confirmed', 'checked_in'],
          },
          OR: [
            {
              scheduledAt: {
                gte: scheduledAt,
                lt: appointmentEnd,
              },
            },
            {
              AND: [
                {
                  scheduledAt: {
                    lt: scheduledAt,
                  },
                },
                {
                  // This is a complex condition to check if the existing appointment end time overlaps
                  // We'll use a raw query for this
                },
              ],
            },
          ],
        },
        include: {
          patient: {
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      });
      
      // Additional check for appointments that end after our start time
      const additionalOverlaps = await prisma.$queryRaw`
        SELECT a.id, a."scheduledAt", a.duration,
               u."firstName", u."lastName"
        FROM "Appointment" a
        JOIN "Patient" p ON a."patientId" = p.id
        JOIN "User" u ON p."userId" = u.id
        WHERE a."providerId" = ${providerId}
          AND a.status IN ('scheduled', 'confirmed', 'checked_in')
          AND a.id != ${excludeAppointmentId || ''}
          AND a."scheduledAt" + INTERVAL '1 minute' * a.duration > ${scheduledAt}
          AND a."scheduledAt" < ${appointmentEnd}
      ` as any[];
      
      const allOverlaps = [...overlappingAppointments, ...additionalOverlaps];
      
      for (const overlap of allOverlaps) {
        const overlapStart = new Date(overlap.scheduledAt);
        const overlapEnd = addMinutes(overlapStart, overlap.duration);
        
        conflicts.push({
          conflictType: 'overlap',
          message: `Appointment overlaps with existing appointment from ${format(overlapStart, 'h:mm a')} to ${format(overlapEnd, 'h:mm a')}`,
          conflictingAppointment: {
            id: overlap.id,
            start: overlapStart,
            end: overlapEnd,
            patientName: `${overlap.firstName || overlap.patient?.user?.firstName} ${overlap.lastName || overlap.patient?.user?.lastName}`,
          },
        });
      }
      
      // Check time off periods
      const timeOffConflicts = await prisma.providerTimeOff.findMany({
        where: {
          providerId,
          startDate: { lte: endOfDay(scheduledAt) },
          endDate: { gte: startOfDay(scheduledAt) },
        },
      });
      
      for (const timeOff of timeOffConflicts) {
        conflicts.push({
          conflictType: 'unavailable',
          message: `Provider is unavailable: ${timeOff.reason || 'Time off scheduled'}`,
        });
      }
      
      return conflicts;
    } catch (error) {
      logger.error('Failed to check appointment conflicts', {
        error: error.message,
        providerId,
        scheduledAt,
        duration,
      });
      throw error;
    }
  }

  async getProviderSchedule(
    providerId: string,
    startDate: Date,
    endDate: Date
  ): Promise<TimeSlot[]> {
    try {
      const timeSlots: TimeSlot[] = [];
      
      // Get provider's weekly schedule
      const schedules = await prisma.providerSchedule.findMany({
        where: { providerId },
        orderBy: { dayOfWeek: 'asc' },
      });
      
      // Get appointments in the date range
      const appointments = await prisma.appointment.findMany({
        where: {
          providerId,
          scheduledAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          patient: {
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
        orderBy: { scheduledAt: 'asc' },
      });
      
      let currentDate = new Date(startDate);
      
      while (currentDate <= endDate) {
        const dayOfWeek = currentDate.getDay();
        const daySchedule = schedules.find(s => s.dayOfWeek === dayOfWeek);
        
        if (daySchedule && daySchedule.isAvailable) {
          const daySlots = this.generateDayTimeSlots(
            currentDate,
            daySchedule,
            appointments.filter(apt => {
              const aptDate = new Date(apt.scheduledAt);
              return aptDate.toDateString() === currentDate.toDateString();
            })
          );
          timeSlots.push(...daySlots);
        }
        
        currentDate = addDays(currentDate, 1);
      }
      
      return timeSlots;
    } catch (error) {
      logger.error('Failed to get provider schedule', {
        error: error.message,
        providerId,
        startDate,
        endDate,
      });
      throw error;
    }
  }

  private generateDayTimeSlots(
    date: Date,
    schedule: any,
    dayAppointments: any[]
  ): TimeSlot[] {
    const slots: TimeSlot[] = [];
    
    // Parse schedule times
    const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
    const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
    
    const dayStart = new Date(date);
    dayStart.setHours(startHour, startMinute, 0, 0);
    
    const dayEnd = new Date(date);
    dayEnd.setHours(endHour, endMinute, 0, 0);
    
    // Add working hours as available slots
    let currentTime = new Date(dayStart);
    
    while (currentTime < dayEnd) {
      const slotEnd = addMinutes(currentTime, 30); // 30-minute slots
      
      if (slotEnd > dayEnd) {
        break;
      }
      
      // Check if this slot has an appointment
      const appointment = dayAppointments.find(apt => {
        const aptStart = new Date(apt.scheduledAt);
        const aptEnd = addMinutes(aptStart, apt.duration);
        
        return currentTime >= aptStart && currentTime < aptEnd;
      });
      
      if (appointment) {
        // Slot is occupied
        slots.push({
          start: new Date(currentTime),
          end: new Date(slotEnd),
          available: false,
          appointmentId: appointment.id,
          appointmentType: appointment.type,
          patientName: `${appointment.patient.user.firstName} ${appointment.patient.user.lastName}`,
        });
      } else {
        // Slot is available
        slots.push({
          start: new Date(currentTime),
          end: new Date(slotEnd),
          available: true,
        });
      }
      
      currentTime = addMinutes(currentTime, 30);
    }
    
    return slots;
  }

  async createProviderSchedule(scheduleData: {
    providerId: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isAvailable: boolean;
    breakStart?: string;
    breakEnd?: string;
  }): Promise<any> {
    try {
      // Validate time format
      if (!this.isValidTimeFormat(scheduleData.startTime) || !this.isValidTimeFormat(scheduleData.endTime)) {
        throw new Error('Invalid time format. Use HH:mm format.');
      }
      
      if (scheduleData.breakStart && !this.isValidTimeFormat(scheduleData.breakStart)) {
        throw new Error('Invalid break start time format. Use HH:mm format.');
      }
      
      if (scheduleData.breakEnd && !this.isValidTimeFormat(scheduleData.breakEnd)) {
        throw new Error('Invalid break end time format. Use HH:mm format.');
      }
      
      // Check if schedule already exists for this day
      const existingSchedule = await prisma.providerSchedule.findFirst({
        where: {
          providerId: scheduleData.providerId,
          dayOfWeek: scheduleData.dayOfWeek,
        },
      });
      
      if (existingSchedule) {
        // Update existing schedule
        return await prisma.providerSchedule.update({
          where: { id: existingSchedule.id },
          data: {
            startTime: scheduleData.startTime,
            endTime: scheduleData.endTime,
            isAvailable: scheduleData.isAvailable,
            breakStart: scheduleData.breakStart,
            breakEnd: scheduleData.breakEnd,
            updatedAt: new Date(),
          },
        });
      } else {
        // Create new schedule
        return await prisma.providerSchedule.create({
          data: {
            id: uuidv4(),
            providerId: scheduleData.providerId,
            dayOfWeek: scheduleData.dayOfWeek,
            startTime: scheduleData.startTime,
            endTime: scheduleData.endTime,
            isAvailable: scheduleData.isAvailable,
            breakStart: scheduleData.breakStart,
            breakEnd: scheduleData.breakEnd,
          },
        });
      }
    } catch (error) {
      logger.error('Failed to create provider schedule', {
        error: error.message,
        scheduleData,
      });
      throw error;
    }
  }

  async addProviderTimeOff(timeOffData: {
    providerId: string;
    startDate: Date;
    endDate: Date;
    reason?: string;
    isRecurring?: boolean;
  }): Promise<any> {
    try {
      return await prisma.providerTimeOff.create({
        data: {
          id: uuidv4(),
          providerId: timeOffData.providerId,
          startDate: timeOffData.startDate,
          endDate: timeOffData.endDate,
          reason: timeOffData.reason,
          isRecurring: timeOffData.isRecurring || false,
        },
      });
    } catch (error) {
      logger.error('Failed to add provider time off', {
        error: error.message,
        timeOffData,
      });
      throw error;
    }
  }

  async getNextAvailableSlot(
    providerId: string,
    appointmentDuration: number = 30,
    startFromDate?: Date
  ): Promise<AvailabilitySlot | null> {
    try {
      const searchStartDate = startFromDate || new Date();
      const searchEndDate = addDays(searchStartDate, 30); // Search for next 30 days
      
      const availableSlots = await this.getProviderAvailability(
        providerId,
        searchStartDate,
        searchEndDate,
        appointmentDuration
      );
      
      return availableSlots.length > 0 ? availableSlots[0] : null;
    } catch (error) {
      logger.error('Failed to get next available slot', {
        error: error.message,
        providerId,
        appointmentDuration,
      });
      throw error;
    }
  }

  async getProviderWorkload(
    providerId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalWorkingHours: number;
    totalBookedHours: number;
    utilizationRate: number;
    appointmentCount: number;
  }> {
    try {
      // Get provider's schedule
      const schedules = await prisma.providerSchedule.findMany({
        where: { providerId, isAvailable: true },
      });
      
      // Calculate total working hours
      let totalWorkingHours = 0;
      let currentDate = new Date(startDate);
      
      while (currentDate <= endDate) {
        const dayOfWeek = currentDate.getDay();
        const daySchedule = schedules.find(s => s.dayOfWeek === dayOfWeek);
        
        if (daySchedule) {
          const [startHour, startMinute] = daySchedule.startTime.split(':').map(Number);
          const [endHour, endMinute] = daySchedule.endTime.split(':').map(Number);
          
          const workingMinutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
          
          // Subtract break time if any
          if (daySchedule.breakStart && daySchedule.breakEnd) {
            const [breakStartHour, breakStartMinute] = daySchedule.breakStart.split(':').map(Number);
            const [breakEndHour, breakEndMinute] = daySchedule.breakEnd.split(':').map(Number);
            
            const breakMinutes = (breakEndHour * 60 + breakEndMinute) - (breakStartHour * 60 + breakStartMinute);
            totalWorkingHours += (workingMinutes - breakMinutes) / 60;
          } else {
            totalWorkingHours += workingMinutes / 60;
          }
        }
        
        currentDate = addDays(currentDate, 1);
      }
      
      // Get booked appointments
      const appointments = await prisma.appointment.findMany({
        where: {
          providerId,
          scheduledAt: {
            gte: startDate,
            lte: endDate,
          },
          status: {
            in: ['scheduled', 'confirmed', 'checked_in', 'completed'],
          },
        },
        select: {
          duration: true,
        },
      });
      
      const totalBookedMinutes = appointments.reduce((sum, apt) => sum + apt.duration, 0);
      const totalBookedHours = totalBookedMinutes / 60;
      
      const utilizationRate = totalWorkingHours > 0 ? (totalBookedHours / totalWorkingHours) * 100 : 0;
      
      return {
        totalWorkingHours,
        totalBookedHours,
        utilizationRate,
        appointmentCount: appointments.length,
      };
    } catch (error) {
      logger.error('Failed to get provider workload', {
        error: error.message,
        providerId,
        startDate,
        endDate,
      });
      throw error;
    }
  }

  private isValidTimeFormat(time: string): boolean {
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(time);
  }

  async rescheduleAppointment(
    appointmentId: string,
    newScheduledAt: Date,
    newDuration?: number
  ): Promise<{ success: boolean; conflicts?: AppointmentConflict[] }> {
    try {
      // Get the appointment
      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: {
          providerId: true,
          duration: true,
        },
      });
      
      if (!appointment) {
        throw new Error('Appointment not found');
      }
      
      const duration = newDuration || appointment.duration;
      
      // Check for conflicts
      const conflicts = await this.checkAppointmentConflicts(
        appointment.providerId,
        newScheduledAt,
        duration,
        appointmentId
      );
      
      if (conflicts.length > 0) {
        return { success: false, conflicts };
      }
      
      // Update the appointment
      await prisma.appointment.update({
        where: { id: appointmentId },
        data: {
          scheduledAt: newScheduledAt,
          duration,
          updatedAt: new Date(),
        },
      });
      
      return { success: true };
    } catch (error) {
      logger.error('Failed to reschedule appointment', {
        error: error.message,
        appointmentId,
        newScheduledAt,
      });
      throw error;
    }
  }
}

// Export singleton instance
const calendarService = new CalendarService();
export default calendarService;

// Export individual functions for convenience
export const getProviderAvailability = (
  providerId: string,
  startDate: Date,
  endDate: Date,
  appointmentDuration?: number
) => calendarService.getProviderAvailability(providerId, startDate, endDate, appointmentDuration);

export const checkAppointmentConflicts = (
  providerId: string,
  scheduledAt: Date,
  duration: number,
  excludeAppointmentId?: string
) => calendarService.checkAppointmentConflicts(providerId, scheduledAt, duration, excludeAppointmentId);

export const getProviderSchedule = (
  providerId: string,
  startDate: Date,
  endDate: Date
) => calendarService.getProviderSchedule(providerId, startDate, endDate);

export const createProviderSchedule = (scheduleData: any) => calendarService.createProviderSchedule(scheduleData);
export const addProviderTimeOff = (timeOffData: any) => calendarService.addProviderTimeOff(timeOffData);
export const getNextAvailableSlot = (providerId: string, appointmentDuration?: number, startFromDate?: Date) => calendarService.getNextAvailableSlot(providerId, appointmentDuration, startFromDate);
export const getProviderWorkload = (providerId: string, startDate: Date, endDate: Date) => calendarService.getProviderWorkload(providerId, startDate, endDate);
export const rescheduleAppointment = (appointmentId: string, newScheduledAt: Date, newDuration?: number) => calendarService.rescheduleAppointment(appointmentId, newScheduledAt, newDuration);