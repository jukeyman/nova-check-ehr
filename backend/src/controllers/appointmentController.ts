/**
 * ============================================================================
 * NOVA CHECK EHR - APPOINTMENT CONTROLLER
 * ============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import { PrismaClient, AppointmentStatus, AppointmentType, UserRole } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../middleware/errorHandler';
import logger from '../config/logger';
import { CacheService } from '../config/redis';
import { asyncHandler } from '../middleware/errorHandler';
import { sendEmail } from '../services/emailService';
import { sendSMS } from '../services/smsService';
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '../services/calendarService';
import { addMinutes, format, isAfter, isBefore, parseISO } from 'date-fns';
import config from '../config/config';

const prisma = new PrismaClient();
const cacheService = new CacheService();

/**
 * Create a new appointment
 */
export const createAppointment = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {
    patientId,
    providerId,
    scheduledAt,
    duration = 30,
    type,
    reason,
    notes,
    isUrgent = false,
    reminderPreferences,
  } = req.body;

  const createdBy = req.user!.id;
  const scheduledDate = new Date(scheduledAt);
  const endTime = addMinutes(scheduledDate, duration);

  // Validate appointment time
  if (isBefore(scheduledDate, new Date())) {
    throw new ValidationError('Cannot schedule appointments in the past');
  }

  // Check if patient exists and user has access
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    include: {
      careTeam: true,
    },
  });

  if (!patient) {
    throw new NotFoundError('Patient not found');
  }

  // Check access permissions
  const user = req.user!;
  if (user.role === UserRole.PATIENT && user.patientId !== patientId) {
    throw new ForbiddenError('Cannot schedule appointments for other patients');
  }

  if (user.role === UserRole.PROVIDER && user.providerId) {
    const hasAccess = patient.careTeam.some(member => member.providerId === user.providerId);
    if (!hasAccess && user.providerId !== providerId) {
      throw new ForbiddenError('Access denied');
    }
  }

  // Check if provider exists and is available
  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      schedule: {
        where: {
          dayOfWeek: scheduledDate.getDay(),
          isActive: true,
        },
      },
    },
  });

  if (!provider) {
    throw new NotFoundError('Provider not found');
  }

  // Check provider availability
  const dayOfWeek = scheduledDate.getDay();
  const timeSlot = format(scheduledDate, 'HH:mm');
  
  const providerSchedule = provider.schedule.find(s => s.dayOfWeek === dayOfWeek);
  if (!providerSchedule) {
    throw new ValidationError('Provider is not available on this day');
  }

  if (timeSlot < providerSchedule.startTime || timeSlot >= providerSchedule.endTime) {
    throw new ValidationError('Provider is not available at this time');
  }

  // Check for conflicting appointments
  const conflictingAppointments = await prisma.appointment.findMany({
    where: {
      providerId,
      status: {
        in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.IN_PROGRESS],
      },
      OR: [
        {
          scheduledAt: {
            gte: scheduledDate,
            lt: endTime,
          },
        },
        {
          AND: [
            {
              scheduledAt: {
                lte: scheduledDate,
              },
            },
            {
              scheduledAt: {
                gte: addMinutes(scheduledDate, -duration),
              },
            },
          ],
        },
      ],
    },
  });

  if (conflictingAppointments.length > 0) {
    throw new ConflictError('Provider has conflicting appointments at this time');
  }

  // Create appointment
  const appointment = await prisma.appointment.create({
    data: {
      patientId,
      providerId,
      scheduledAt: scheduledDate,
      duration,
      type,
      reason,
      notes,
      status: AppointmentStatus.SCHEDULED,
      isUrgent,
      reminderPreferences,
      createdBy,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    include: {
      patient: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      provider: {
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          specialties: true,
        },
      },
    },
  });

  // Create calendar event
  try {
    const calendarEvent = await createCalendarEvent({
      title: `Appointment: ${appointment.patient.firstName} ${appointment.patient.lastName}`,
      description: `${type} appointment${reason ? ` - ${reason}` : ''}`,
      startTime: scheduledDate,
      endTime,
      attendees: [
        appointment.provider.user.email,
        appointment.patient.email,
      ].filter(Boolean),
      location: provider.address || 'TBD',
    });

    // Update appointment with calendar event ID
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { calendarEventId: calendarEvent.id },
    });
  } catch (error) {
    logger.error('Failed to create calendar event', {
      error,
      appointmentId: appointment.id,
    });
  }

  // Send confirmation emails
  try {
    // Email to patient
    if (appointment.patient.email) {
      await sendEmail({
        to: appointment.patient.email,
        subject: 'Appointment Confirmation - Nova Check EHR',
        template: 'appointment-confirmation',
        data: {
          patientName: `${appointment.patient.firstName} ${appointment.patient.lastName}`,
          providerName: `${appointment.provider.user.firstName} ${appointment.provider.user.lastName}`,
          appointmentDate: format(scheduledDate, 'MMMM dd, yyyy'),
          appointmentTime: format(scheduledDate, 'h:mm a'),
          appointmentType: type,
          reason,
          duration,
          location: provider.address || 'TBD',
          cancelUrl: `${config.app.frontendUrl}/appointments/${appointment.id}/cancel`,
        },
      });
    }

    // Email to provider
    await sendEmail({
      to: appointment.provider.user.email,
      subject: 'New Appointment Scheduled - Nova Check EHR',
      template: 'appointment-provider-notification',
      data: {
        providerName: `${appointment.provider.user.firstName} ${appointment.provider.user.lastName}`,
        patientName: `${appointment.patient.firstName} ${appointment.patient.lastName}`,
        appointmentDate: format(scheduledDate, 'MMMM dd, yyyy'),
        appointmentTime: format(scheduledDate, 'h:mm a'),
        appointmentType: type,
        reason,
        duration,
        isUrgent,
        patientUrl: `${config.app.frontendUrl}/patients/${patientId}`,
      },
    });
  } catch (error) {
    logger.error('Failed to send appointment confirmation emails', {
      error,
      appointmentId: appointment.id,
    });
  }

  // Send SMS confirmation if phone number available
  if (appointment.patient.phone && reminderPreferences?.sms) {
    try {
      await sendSMS({
        to: appointment.patient.phone,
        message: `Appointment confirmed for ${format(scheduledDate, 'MMM dd, yyyy')} at ${format(scheduledDate, 'h:mm a')} with Dr. ${appointment.provider.user.lastName}. Reply CANCEL to cancel.`,
      });
    } catch (error) {
      logger.error('Failed to send SMS confirmation', {
        error,
        appointmentId: appointment.id,
      });
    }
  }

  // Log appointment creation
  await prisma.auditLog.create({
    data: {
      userId: createdBy,
      action: 'APPOINTMENT_CREATE',
      resource: 'Appointment',
      resourceId: appointment.id,
      details: {
        patientId,
        providerId,
        scheduledAt: scheduledDate.toISOString(),
        type,
        isUrgent,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Appointment created successfully', {
    appointmentId: appointment.id,
    patientId,
    providerId,
    scheduledAt: scheduledDate.toISOString(),
    createdBy,
  });

  res.status(201).json({
    success: true,
    message: 'Appointment scheduled successfully',
    data: { appointment },
  });
});

/**
 * Get appointments with filtering and pagination
 */
export const getAppointments = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {
    page = 1,
    limit = 20,
    patientId,
    providerId,
    status,
    type,
    startDate,
    endDate,
    isUrgent,
    sortBy = 'scheduledAt',
    sortOrder = 'asc',
  } = req.query;

  const offset = (Number(page) - 1) * Number(limit);
  const user = req.user!;

  // Build where clause
  const where: any = {};

  // Role-based filtering
  if (user.role === UserRole.PATIENT && user.patientId) {
    where.patientId = user.patientId;
  } else if (user.role === UserRole.PROVIDER && user.providerId) {
    where.providerId = user.providerId;
  }

  // Additional filters
  if (patientId) {
    where.patientId = patientId;
  }

  if (providerId) {
    where.providerId = providerId;
  }

  if (status) {
    where.status = status;
  }

  if (type) {
    where.type = type;
  }

  if (isUrgent !== undefined) {
    where.isUrgent = isUrgent === 'true';
  }

  // Date range filter
  if (startDate || endDate) {
    where.scheduledAt = {};
    if (startDate) {
      where.scheduledAt.gte = new Date(startDate as string);
    }
    if (endDate) {
      where.scheduledAt.lte = new Date(endDate as string);
    }
  }

  // Build order by
  const orderBy: any = {};
  orderBy[sortBy as string] = sortOrder;

  const [appointments, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      include: {
        patient: {
          select: {
            id: true,
            patientId: true,
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            email: true,
            phone: true,
          },
        },
        provider: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            specialties: true,
          },
        },
        encounter: {
          select: {
            id: true,
            status: true,
            chiefComplaint: true,
          },
        },
      },
      orderBy,
      skip: offset,
      take: Number(limit),
    }),
    prisma.appointment.count({ where }),
  ]);

  const totalPages = Math.ceil(total / Number(limit));

  res.json({
    success: true,
    data: {
      appointments,
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
 * Get appointment by ID
 */
export const getAppointmentById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;

  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: {
      patient: {
        include: {
          allergies: true,
          medications: {
            where: { status: 'ACTIVE' },
          },
        },
      },
      provider: {
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          specialties: true,
          licenses: true,
        },
      },
      encounter: {
        include: {
          vitalSigns: true,
          diagnoses: true,
          procedures: true,
        },
      },
      reminders: {
        orderBy: { scheduledAt: 'desc' },
      },
    },
  });

  if (!appointment) {
    throw new NotFoundError('Appointment not found');
  }

  // Check access permissions
  if (user.role === UserRole.PATIENT && user.patientId !== appointment.patientId) {
    throw new ForbiddenError('Access denied');
  }

  if (user.role === UserRole.PROVIDER && user.providerId !== appointment.providerId) {
    throw new ForbiddenError('Access denied');
  }

  // Log appointment access
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'APPOINTMENT_VIEW',
      resource: 'Appointment',
      resourceId: id,
      details: {
        appointmentDate: appointment.scheduledAt.toISOString(),
        patientId: appointment.patientId,
        providerId: appointment.providerId,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  res.json({
    success: true,
    data: { appointment },
  });
});

/**
 * Update appointment
 */
export const updateAppointment = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const {
    scheduledAt,
    duration,
    type,
    reason,
    notes,
    status,
    isUrgent,
    reminderPreferences,
  } = req.body;

  const user = req.user!;
  const updatedBy = user.id;

  // Get existing appointment
  const existingAppointment = await prisma.appointment.findUnique({
    where: { id },
    include: {
      patient: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      provider: {
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      },
    },
  });

  if (!existingAppointment) {
    throw new NotFoundError('Appointment not found');
  }

  // Check access permissions
  if (user.role === UserRole.PATIENT && user.patientId !== existingAppointment.patientId) {
    throw new ForbiddenError('Access denied');
  }

  if (user.role === UserRole.PROVIDER && user.providerId !== existingAppointment.providerId) {
    throw new ForbiddenError('Access denied');
  }

  // Validate new scheduled time if provided
  let newScheduledDate = existingAppointment.scheduledAt;
  let newEndTime = addMinutes(newScheduledDate, existingAppointment.duration);

  if (scheduledAt) {
    newScheduledDate = new Date(scheduledAt);
    newEndTime = addMinutes(newScheduledDate, duration || existingAppointment.duration);

    if (isBefore(newScheduledDate, new Date())) {
      throw new ValidationError('Cannot reschedule appointments to the past');
    }

    // Check for conflicts if time is changing
    if (newScheduledDate.getTime() !== existingAppointment.scheduledAt.getTime()) {
      const conflictingAppointments = await prisma.appointment.findMany({
        where: {
          id: { not: id },
          providerId: existingAppointment.providerId,
          status: {
            in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.IN_PROGRESS],
          },
          OR: [
            {
              scheduledAt: {
                gte: newScheduledDate,
                lt: newEndTime,
              },
            },
            {
              AND: [
                {
                  scheduledAt: {
                    lte: newScheduledDate,
                  },
                },
                {
                  scheduledAt: {
                    gte: addMinutes(newScheduledDate, -(duration || existingAppointment.duration)),
                  },
                },
              ],
            },
          ],
        },
      });

      if (conflictingAppointments.length > 0) {
        throw new ConflictError('Provider has conflicting appointments at the new time');
      }
    }
  }

  // Update appointment
  const appointment = await prisma.appointment.update({
    where: { id },
    data: {
      scheduledAt: newScheduledDate,
      duration,
      type,
      reason,
      notes,
      status,
      isUrgent,
      reminderPreferences,
      updatedBy,
      updatedAt: new Date(),
    },
    include: {
      patient: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      provider: {
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      },
    },
  });

  // Update calendar event if time changed
  if (scheduledAt && existingAppointment.calendarEventId) {
    try {
      await updateCalendarEvent(existingAppointment.calendarEventId, {
        startTime: newScheduledDate,
        endTime: newEndTime,
        title: `Appointment: ${appointment.patient.firstName} ${appointment.patient.lastName}`,
        description: `${appointment.type} appointment${appointment.reason ? ` - ${appointment.reason}` : ''}`,
      });
    } catch (error) {
      logger.error('Failed to update calendar event', {
        error,
        appointmentId: id,
        calendarEventId: existingAppointment.calendarEventId,
      });
    }
  }

  // Send update notifications if time changed
  if (scheduledAt && newScheduledDate.getTime() !== existingAppointment.scheduledAt.getTime()) {
    try {
      // Email to patient
      if (appointment.patient.email) {
        await sendEmail({
          to: appointment.patient.email,
          subject: 'Appointment Rescheduled - Nova Check EHR',
          template: 'appointment-rescheduled',
          data: {
            patientName: `${appointment.patient.firstName} ${appointment.patient.lastName}`,
            providerName: `${appointment.provider.user.firstName} ${appointment.provider.user.lastName}`,
            oldDate: format(existingAppointment.scheduledAt, 'MMMM dd, yyyy'),
            oldTime: format(existingAppointment.scheduledAt, 'h:mm a'),
            newDate: format(newScheduledDate, 'MMMM dd, yyyy'),
            newTime: format(newScheduledDate, 'h:mm a'),
            appointmentType: appointment.type,
            reason: appointment.reason,
          },
        });
      }

      // SMS notification
      if (appointment.patient.phone && appointment.reminderPreferences?.sms) {
        await sendSMS({
          to: appointment.patient.phone,
          message: `Your appointment has been rescheduled to ${format(newScheduledDate, 'MMM dd, yyyy')} at ${format(newScheduledDate, 'h:mm a')} with Dr. ${appointment.provider.user.lastName}.`,
        });
      }
    } catch (error) {
      logger.error('Failed to send appointment update notifications', {
        error,
        appointmentId: id,
      });
    }
  }

  // Log appointment update
  await prisma.auditLog.create({
    data: {
      userId: updatedBy,
      action: 'APPOINTMENT_UPDATE',
      resource: 'Appointment',
      resourceId: id,
      details: {
        updatedFields: Object.keys(req.body),
        oldScheduledAt: existingAppointment.scheduledAt.toISOString(),
        newScheduledAt: newScheduledDate.toISOString(),
        patientId: appointment.patientId,
        providerId: appointment.providerId,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Appointment updated successfully', {
    appointmentId: id,
    updatedBy,
    updatedFields: Object.keys(req.body),
  });

  res.json({
    success: true,
    message: 'Appointment updated successfully',
    data: { appointment },
  });
});

/**
 * Cancel appointment
 */
export const cancelAppointment = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { reason, notifyPatient = true } = req.body;
  const user = req.user!;

  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: {
      patient: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      provider: {
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      },
    },
  });

  if (!appointment) {
    throw new NotFoundError('Appointment not found');
  }

  // Check access permissions
  if (user.role === UserRole.PATIENT && user.patientId !== appointment.patientId) {
    throw new ForbiddenError('Access denied');
  }

  if (user.role === UserRole.PROVIDER && user.providerId !== appointment.providerId) {
    throw new ForbiddenError('Access denied');
  }

  // Check if appointment can be cancelled
  if (appointment.status === AppointmentStatus.CANCELLED) {
    throw new ValidationError('Appointment is already cancelled');
  }

  if (appointment.status === AppointmentStatus.COMPLETED) {
    throw new ValidationError('Cannot cancel completed appointments');
  }

  // Update appointment status
  const updatedAppointment = await prisma.appointment.update({
    where: { id },
    data: {
      status: AppointmentStatus.CANCELLED,
      cancellationReason: reason,
      cancelledBy: user.id,
      cancelledAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Delete calendar event
  if (appointment.calendarEventId) {
    try {
      await deleteCalendarEvent(appointment.calendarEventId);
    } catch (error) {
      logger.error('Failed to delete calendar event', {
        error,
        appointmentId: id,
        calendarEventId: appointment.calendarEventId,
      });
    }
  }

  // Send cancellation notifications
  if (notifyPatient) {
    try {
      // Email notification
      if (appointment.patient.email) {
        await sendEmail({
          to: appointment.patient.email,
          subject: 'Appointment Cancelled - Nova Check EHR',
          template: 'appointment-cancelled',
          data: {
            patientName: `${appointment.patient.firstName} ${appointment.patient.lastName}`,
            providerName: `${appointment.provider.user.firstName} ${appointment.provider.user.lastName}`,
            appointmentDate: format(appointment.scheduledAt, 'MMMM dd, yyyy'),
            appointmentTime: format(appointment.scheduledAt, 'h:mm a'),
            reason,
            rescheduleUrl: `${config.app.frontendUrl}/appointments/schedule?providerId=${appointment.providerId}`,
          },
        });
      }

      // SMS notification
      if (appointment.patient.phone && appointment.reminderPreferences?.sms) {
        await sendSMS({
          to: appointment.patient.phone,
          message: `Your appointment on ${format(appointment.scheduledAt, 'MMM dd, yyyy')} at ${format(appointment.scheduledAt, 'h:mm a')} with Dr. ${appointment.provider.user.lastName} has been cancelled. ${reason ? `Reason: ${reason}` : ''}`,
        });
      }
    } catch (error) {
      logger.error('Failed to send cancellation notifications', {
        error,
        appointmentId: id,
      });
    }
  }

  // Log appointment cancellation
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'APPOINTMENT_CANCEL',
      resource: 'Appointment',
      resourceId: id,
      details: {
        reason,
        cancelledBy: user.role,
        scheduledAt: appointment.scheduledAt.toISOString(),
        patientId: appointment.patientId,
        providerId: appointment.providerId,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Appointment cancelled successfully', {
    appointmentId: id,
    cancelledBy: user.id,
    reason,
  });

  res.json({
    success: true,
    message: 'Appointment cancelled successfully',
    data: { appointment: updatedAppointment },
  });
});

/**
 * Get available time slots for a provider
 */
export const getAvailableSlots = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { providerId } = req.params;
  const { date, duration = 30 } = req.query;

  if (!date) {
    throw new ValidationError('Date is required');
  }

  const requestedDate = new Date(date as string);
  const dayOfWeek = requestedDate.getDay();

  // Get provider schedule for the day
  const providerSchedule = await prisma.providerSchedule.findFirst({
    where: {
      providerId,
      dayOfWeek,
      isActive: true,
    },
  });

  if (!providerSchedule) {
    return res.json({
      success: true,
      data: { availableSlots: [] },
    });
  }

  // Get existing appointments for the day
  const startOfDay = new Date(requestedDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(requestedDate);
  endOfDay.setHours(23, 59, 59, 999);

  const existingAppointments = await prisma.appointment.findMany({
    where: {
      providerId,
      scheduledAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
      status: {
        in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED, AppointmentStatus.IN_PROGRESS],
      },
    },
    select: {
      scheduledAt: true,
      duration: true,
    },
  });

  // Generate available slots
  const availableSlots = [];
  const slotDuration = Number(duration);
  const startTime = new Date(`${date}T${providerSchedule.startTime}`);
  const endTime = new Date(`${date}T${providerSchedule.endTime}`);

  let currentSlot = new Date(startTime);

  while (currentSlot < endTime) {
    const slotEnd = addMinutes(currentSlot, slotDuration);
    
    // Check if slot conflicts with existing appointments
    const hasConflict = existingAppointments.some(appointment => {
      const appointmentStart = appointment.scheduledAt;
      const appointmentEnd = addMinutes(appointmentStart, appointment.duration);
      
      return (
        (currentSlot >= appointmentStart && currentSlot < appointmentEnd) ||
        (slotEnd > appointmentStart && slotEnd <= appointmentEnd) ||
        (currentSlot <= appointmentStart && slotEnd >= appointmentEnd)
      );
    });

    if (!hasConflict && slotEnd <= endTime) {
      availableSlots.push({
        startTime: currentSlot.toISOString(),
        endTime: slotEnd.toISOString(),
        duration: slotDuration,
      });
    }

    currentSlot = addMinutes(currentSlot, slotDuration);
  }

  res.json({
    success: true,
    data: { availableSlots },
  });
});

/**
 * Get appointment statistics
 */
export const getAppointmentStats = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { startDate, endDate } = req.query;

  // Build base where clause for role-based filtering
  const baseWhere: any = {};
  if (user.role === UserRole.PROVIDER && user.providerId) {
    baseWhere.providerId = user.providerId;
  } else if (user.role === UserRole.PATIENT && user.patientId) {
    baseWhere.patientId = user.patientId;
  }

  // Add date range filter
  if (startDate || endDate) {
    baseWhere.scheduledAt = {};
    if (startDate) {
      baseWhere.scheduledAt.gte = new Date(startDate as string);
    }
    if (endDate) {
      baseWhere.scheduledAt.lte = new Date(endDate as string);
    }
  }

  const [totalAppointments, appointmentsByStatus, appointmentsByType, urgentAppointments] = await Promise.all([
    prisma.appointment.count({ where: baseWhere }),
    prisma.appointment.groupBy({
      by: ['status'],
      where: baseWhere,
      _count: true,
    }),
    prisma.appointment.groupBy({
      by: ['type'],
      where: baseWhere,
      _count: true,
    }),
    prisma.appointment.count({
      where: {
        ...baseWhere,
        isUrgent: true,
      },
    }),
  ]);

  const stats = {
    totalAppointments,
    urgentAppointments,
    appointmentsByStatus: appointmentsByStatus.map(group => ({
      status: group.status,
      count: group._count,
    })),
    appointmentsByType: appointmentsByType.map(group => ({
      type: group.type,
      count: group._count,
    })),
  };

  res.json({
    success: true,
    data: { stats },
  });
});

/**
 * Check in patient for appointment
 */
export const checkInPatient = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;

  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: {
      patient: true,
      provider: true,
    },
  });

  if (!appointment) {
    throw new NotFoundError('Appointment not found');
  }

  // Check if appointment is today
  const today = new Date();
  const appointmentDate = new Date(appointment.scheduledAt);
  if (appointmentDate.toDateString() !== today.toDateString()) {
    throw new ValidationError('Can only check in for today\'s appointments');
  }

  // Update appointment status
  const updatedAppointment = await prisma.appointment.update({
    where: { id },
    data: {
      status: AppointmentStatus.CHECKED_IN,
      checkedInAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Log check-in
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'APPOINTMENT_CHECKIN',
      resource: 'Appointment',
      resourceId: id,
      details: {
        patientId: appointment.patientId,
        providerId: appointment.providerId,
        scheduledAt: appointment.scheduledAt.toISOString(),
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown',
    },
  });

  logger.info('Patient checked in for appointment', {
    appointmentId: id,
    patientId: appointment.patientId,
    checkedInBy: user.id,
  });

  res.json({
    success: true,
    message: 'Patient checked in successfully',
    data: { appointment: updatedAppointment },
  });
});