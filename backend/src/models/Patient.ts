/**
 * ============================================================================
 * NOVA CHECK EHR - PATIENT MODEL
 * ============================================================================
 */

import { PrismaClient, Patient as PrismaPatient, Gender, MaritalStatus, BloodType } from '@prisma/client';
import { logger } from '../utils/logger';
import { AppError, NotFoundError, ValidationError } from '../utils/errors';
import { generateUniqueId } from '../utils/generators';
import { normalizeEmail, calculateAge, formatPhoneNumber, isValidSSN } from '../utils/helpers';
import { PatientCreateData, PatientUpdateData, PatientAddress, EmergencyContact, InsuranceInfo } from '../types';

// ============================================================================
// INTERFACES
// ============================================================================

export interface PatientWithRelations extends PrismaPatient {
  allergies?: any[];
  medications?: any[];
  appointments?: any[];
  encounters?: any[];
  documents?: any[];
  insurances?: any[];
  emergencyContacts?: any[];
  vitalSigns?: any[];
  labResults?: any[];
  prescriptions?: any[];
}

export interface PatientSearchFilters {
  search?: string;
  gender?: Gender;
  ageMin?: number;
  ageMax?: number;
  bloodType?: BloodType;
  maritalStatus?: MaritalStatus;
  city?: string;
  state?: string;
  zipCode?: string;
  insuranceProvider?: string;
  primaryProvider?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  hasAllergies?: boolean;
  hasMedications?: boolean;
  isActive?: boolean;
}

export interface PatientStats {
  totalPatients: number;
  activePatients: number;
  newPatientsThisMonth: number;
  patientsByGender: Record<Gender, number>;
  patientsByAgeGroup: Record<string, number>;
  patientsByBloodType: Record<BloodType, number>;
  averageAge: number;
}

export interface PatientSummary {
  id: string;
  patientId: string;
  fullName: string;
  age: number;
  gender: Gender;
  phone: string;
  email?: string;
  lastVisit?: Date;
  nextAppointment?: Date;
  primaryProvider?: string;
  allergiesCount: number;
  medicationsCount: number;
  chronicConditions: string[];
}

// ============================================================================
// PATIENT MODEL CLASS
// ============================================================================

export class PatientModel {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create a new patient
   */
  async create(patientData: PatientCreateData): Promise<PatientWithRelations> {
    try {
      // Validate required fields
      if (!patientData.firstName || !patientData.lastName || !patientData.dateOfBirth) {
        throw new ValidationError('Missing required fields: firstName, lastName, dateOfBirth');
      }

      // Validate SSN if provided
      if (patientData.ssn && !isValidSSN(patientData.ssn)) {
        throw new ValidationError('Invalid SSN format');
      }

      // Normalize email if provided
      const email = patientData.email ? normalizeEmail(patientData.email) : undefined;

      // Check if patient already exists by email or SSN
      if (email || patientData.ssn) {
        const existingPatient = await this.prisma.patient.findFirst({
          where: {
            OR: [
              email ? { email } : {},
              patientData.ssn ? { ssn: patientData.ssn } : {},
            ].filter(condition => Object.keys(condition).length > 0),
          },
        });

        if (existingPatient) {
          throw new ValidationError('Patient with this email or SSN already exists');
        }
      }

      // Generate patient ID
      const patientId = generateUniqueId('PAT');

      // Calculate age
      const age = calculateAge(patientData.dateOfBirth);

      // Format phone number
      const phone = patientData.phone ? formatPhoneNumber(patientData.phone) : undefined;

      // Create patient with transaction
      const patient = await this.prisma.$transaction(async (tx) => {
        // Create patient
        const newPatient = await tx.patient.create({
          data: {
            id: generateUniqueId('PT'),
            patientId,
            firstName: patientData.firstName,
            lastName: patientData.lastName,
            middleName: patientData.middleName,
            dateOfBirth: patientData.dateOfBirth,
            gender: patientData.gender,
            ssn: patientData.ssn,
            email,
            phone,
            address: patientData.address || {},
            emergencyContact: patientData.emergencyContact || {},
            maritalStatus: patientData.maritalStatus,
            bloodType: patientData.bloodType,
            primaryLanguage: patientData.primaryLanguage || 'English',
            occupation: patientData.occupation,
            employer: patientData.employer,
            primaryProvider: patientData.primaryProvider,
            referredBy: patientData.referredBy,
            notes: patientData.notes,
            preferences: patientData.preferences || {},
            socialHistory: patientData.socialHistory || {},
            isActive: true,
          },
          include: {
            allergies: true,
            medications: true,
            appointments: {
              orderBy: { scheduledAt: 'desc' },
              take: 5,
            },
            encounters: {
              orderBy: { date: 'desc' },
              take: 5,
            },
            insurances: true,
          },
        });

        // Create allergies if provided
        if (patientData.allergies && patientData.allergies.length > 0) {
          await Promise.all(
            patientData.allergies.map(allergy =>
              tx.allergy.create({
                data: {
                  id: generateUniqueId('ALG'),
                  patientId: newPatient.id,
                  allergen: allergy.allergen,
                  allergenType: allergy.allergenType,
                  severity: allergy.severity,
                  reaction: allergy.reaction,
                  notes: allergy.notes,
                  onsetDate: allergy.onsetDate,
                  isActive: allergy.isActive ?? true,
                },
              })
            )
          );
        }

        // Create medications if provided
        if (patientData.medications && patientData.medications.length > 0) {
          await Promise.all(
            patientData.medications.map(medication =>
              tx.medication.create({
                data: {
                  id: generateUniqueId('MED'),
                  patientId: newPatient.id,
                  name: medication.name,
                  dosage: medication.dosage,
                  frequency: medication.frequency,
                  route: medication.route,
                  startDate: medication.startDate,
                  endDate: medication.endDate,
                  prescribedBy: medication.prescribedBy,
                  instructions: medication.instructions,
                  notes: medication.notes,
                  isActive: medication.isActive ?? true,
                },
              })
            )
          );
        }

        // Create insurance information if provided
        if (patientData.insurances && patientData.insurances.length > 0) {
          await Promise.all(
            patientData.insurances.map(insurance =>
              tx.insurance.create({
                data: {
                  id: generateUniqueId('INS'),
                  patientId: newPatient.id,
                  provider: insurance.provider,
                  policyNumber: insurance.policyNumber,
                  groupNumber: insurance.groupNumber,
                  subscriberId: insurance.subscriberId,
                  subscriberName: insurance.subscriberName,
                  relationship: insurance.relationship,
                  effectiveDate: insurance.effectiveDate,
                  expirationDate: insurance.expirationDate,
                  copay: insurance.copay,
                  deductible: insurance.deductible,
                  isPrimary: insurance.isPrimary ?? false,
                  isActive: insurance.isActive ?? true,
                },
              })
            )
          );
        }

        return newPatient;
      });

      logger.info('Patient created successfully', {
        component: 'PatientModel',
        patientId: patient.patientId,
        firstName: patient.firstName,
        lastName: patient.lastName,
      });

      return patient;
    } catch (error) {
      logger.error('Error creating patient', {
        component: 'PatientModel',
        error: (error as Error).message,
        patientData: {
          firstName: patientData.firstName,
          lastName: patientData.lastName,
          email: patientData.email,
        },
      });
      throw error;
    }
  }

  /**
   * Find patient by ID
   */
  async findById(id: string, includeRelations: boolean = false): Promise<PatientWithRelations | null> {
    try {
      const patient = await this.prisma.patient.findUnique({
        where: { id },
        include: includeRelations ? {
          allergies: {
            where: { isActive: true },
            orderBy: { createdAt: 'desc' },
          },
          medications: {
            where: { isActive: true },
            orderBy: { startDate: 'desc' },
          },
          appointments: {
            orderBy: { scheduledAt: 'desc' },
            take: 10,
            include: {
              provider: {
                select: {
                  firstName: true,
                  lastName: true,
                  title: true,
                },
              },
            },
          },
          encounters: {
            orderBy: { date: 'desc' },
            take: 10,
            include: {
              provider: {
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
            take: 10,
          },
          insurances: {
            where: { isActive: true },
            orderBy: { isPrimary: 'desc' },
          },
          vitalSigns: {
            orderBy: { recordedAt: 'desc' },
            take: 5,
          },
          labResults: {
            orderBy: { collectedAt: 'desc' },
            take: 10,
          },
          prescriptions: {
            where: { isActive: true },
            orderBy: { prescribedAt: 'desc' },
            take: 10,
          },
        } : undefined,
      });

      return patient;
    } catch (error) {
      logger.error('Error finding patient by ID', {
        component: 'PatientModel',
        error: (error as Error).message,
        patientId: id,
      });
      throw new AppError('Failed to find patient', 500);
    }
  }

  /**
   * Find patient by patient ID
   */
  async findByPatientId(patientId: string, includeRelations: boolean = false): Promise<PatientWithRelations | null> {
    try {
      const patient = await this.prisma.patient.findUnique({
        where: { patientId },
        include: includeRelations ? {
          allergies: { where: { isActive: true } },
          medications: { where: { isActive: true } },
          appointments: {
            orderBy: { scheduledAt: 'desc' },
            take: 5,
          },
          encounters: {
            orderBy: { date: 'desc' },
            take: 5,
          },
          insurances: { where: { isActive: true } },
        } : undefined,
      });

      return patient;
    } catch (error) {
      logger.error('Error finding patient by patient ID', {
        component: 'PatientModel',
        error: (error as Error).message,
        patientId,
      });
      throw new AppError('Failed to find patient', 500);
    }
  }

  /**
   * Update patient
   */
  async update(id: string, updateData: PatientUpdateData): Promise<PatientWithRelations> {
    try {
      // Check if patient exists
      const existingPatient = await this.findById(id);
      if (!existingPatient) {
        throw new NotFoundError('Patient not found');
      }

      // Prepare update data
      const updatePayload: any = { ...updateData };

      // Normalize email if provided
      if (updateData.email) {
        updatePayload.email = normalizeEmail(updateData.email);
        
        // Check if email is already taken by another patient
        const emailExists = await this.prisma.patient.findFirst({
          where: {
            email: updatePayload.email,
            id: { not: id },
          },
        });
        
        if (emailExists) {
          throw new ValidationError('Email is already taken by another patient');
        }
      }

      // Format phone number if provided
      if (updateData.phone) {
        updatePayload.phone = formatPhoneNumber(updateData.phone);
      }

      // Validate SSN if provided
      if (updateData.ssn && !isValidSSN(updateData.ssn)) {
        throw new ValidationError('Invalid SSN format');
      }

      // Update patient
      const updatedPatient = await this.prisma.patient.update({
        where: { id },
        data: {
          ...updatePayload,
          updatedAt: new Date(),
        },
        include: {
          allergies: { where: { isActive: true } },
          medications: { where: { isActive: true } },
          appointments: {
            orderBy: { scheduledAt: 'desc' },
            take: 5,
          },
          insurances: { where: { isActive: true } },
        },
      });

      logger.info('Patient updated successfully', {
        component: 'PatientModel',
        patientId: id,
        updatedFields: Object.keys(updateData),
      });

      return updatedPatient;
    } catch (error) {
      logger.error('Error updating patient', {
        component: 'PatientModel',
        error: (error as Error).message,
        patientId: id,
      });
      throw error;
    }
  }

  /**
   * Delete patient (soft delete)
   */
  async delete(id: string): Promise<boolean> {
    try {
      // Check if patient exists
      const existingPatient = await this.findById(id);
      if (!existingPatient) {
        throw new NotFoundError('Patient not found');
      }

      // Soft delete by updating isActive status
      await this.prisma.patient.update({
        where: { id },
        data: {
          isActive: false,
          deletedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      logger.info('Patient deleted successfully', {
        component: 'PatientModel',
        patientId: id,
      });

      return true;
    } catch (error) {
      logger.error('Error deleting patient', {
        component: 'PatientModel',
        error: (error as Error).message,
        patientId: id,
      });
      throw error;
    }
  }

  /**
   * Get patients with filters and pagination
   */
  async findMany(
    filters: PatientSearchFilters = {},
    page: number = 1,
    limit: number = 20,
    sortBy: string = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<{ patients: PatientWithRelations[]; total: number; pages: number }> {
    try {
      const skip = (page - 1) * limit;
      
      // Build where clause
      const where: any = {
        isActive: filters.isActive ?? true,
      };

      if (filters.search) {
        where.OR = [
          { firstName: { contains: filters.search, mode: 'insensitive' } },
          { lastName: { contains: filters.search, mode: 'insensitive' } },
          { patientId: { contains: filters.search, mode: 'insensitive' } },
          { email: { contains: filters.search, mode: 'insensitive' } },
          { phone: { contains: filters.search, mode: 'insensitive' } },
          { ssn: { contains: filters.search, mode: 'insensitive' } },
        ];
      }

      if (filters.gender) {
        where.gender = filters.gender;
      }

      if (filters.bloodType) {
        where.bloodType = filters.bloodType;
      }

      if (filters.maritalStatus) {
        where.maritalStatus = filters.maritalStatus;
      }

      if (filters.city || filters.state || filters.zipCode) {
        where.address = {};
        if (filters.city) {
          where.address.path = ['city'];
          where.address.equals = filters.city;
        }
        if (filters.state) {
          where.address.path = ['state'];
          where.address.equals = filters.state;
        }
        if (filters.zipCode) {
          where.address.path = ['zipCode'];
          where.address.equals = filters.zipCode;
        }
      }

      if (filters.ageMin || filters.ageMax) {
        const now = new Date();
        if (filters.ageMax) {
          const minDate = new Date(now.getFullYear() - filters.ageMax, now.getMonth(), now.getDate());
          where.dateOfBirth = { gte: minDate };
        }
        if (filters.ageMin) {
          const maxDate = new Date(now.getFullYear() - filters.ageMin, now.getMonth(), now.getDate());
          where.dateOfBirth = { ...where.dateOfBirth, lte: maxDate };
        }
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

      if (filters.hasAllergies !== undefined) {
        if (filters.hasAllergies) {
          where.allergies = { some: { isActive: true } };
        } else {
          where.allergies = { none: { isActive: true } };
        }
      }

      if (filters.hasMedications !== undefined) {
        if (filters.hasMedications) {
          where.medications = { some: { isActive: true } };
        } else {
          where.medications = { none: { isActive: true } };
        }
      }

      // Get patients and total count
      const [patients, total] = await Promise.all([
        this.prisma.patient.findMany({
          where,
          include: {
            allergies: {
              where: { isActive: true },
              select: { id: true, allergen: true, severity: true },
            },
            medications: {
              where: { isActive: true },
              select: { id: true, name: true, dosage: true },
            },
            appointments: {
              where: {
                scheduledAt: { gte: new Date() },
              },
              orderBy: { scheduledAt: 'asc' },
              take: 1,
              select: {
                id: true,
                scheduledAt: true,
                type: true,
                provider: {
                  select: {
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
            encounters: {
              orderBy: { date: 'desc' },
              take: 1,
              select: {
                id: true,
                date: true,
                type: true,
              },
            },
          },
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        this.prisma.patient.count({ where }),
      ]);

      const pages = Math.ceil(total / limit);

      return { patients, total, pages };
    } catch (error) {
      logger.error('Error finding patients', {
        component: 'PatientModel',
        error: (error as Error).message,
        filters,
      });
      throw new AppError('Failed to find patients', 500);
    }
  }

  /**
   * Search patients by various criteria
   */
  async search(
    query: string,
    filters: PatientSearchFilters = {},
    limit: number = 10
  ): Promise<PatientSummary[]> {
    try {
      const where: any = {
        isActive: true,
        OR: [
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
          { patientId: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query, mode: 'insensitive' } },
        ],
      };

      // Apply additional filters
      if (filters.gender) {
        where.gender = filters.gender;
      }

      if (filters.primaryProvider) {
        where.primaryProvider = filters.primaryProvider;
      }

      const patients = await this.prisma.patient.findMany({
        where,
        include: {
          allergies: {
            where: { isActive: true },
            select: { id: true },
          },
          medications: {
            where: { isActive: true },
            select: { id: true },
          },
          appointments: {
            where: {
              scheduledAt: { gte: new Date() },
            },
            orderBy: { scheduledAt: 'asc' },
            take: 1,
            select: {
              scheduledAt: true,
              provider: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
          encounters: {
            orderBy: { date: 'desc' },
            take: 1,
            select: {
              date: true,
            },
          },
          conditions: {
            where: {
              status: 'ACTIVE',
              category: 'CHRONIC',
            },
            select: {
              name: true,
            },
          },
        },
        orderBy: [
          { firstName: 'asc' },
          { lastName: 'asc' },
        ],
        take: limit,
      });

      return patients.map(patient => ({
        id: patient.id,
        patientId: patient.patientId,
        fullName: `${patient.firstName} ${patient.lastName}`,
        age: calculateAge(patient.dateOfBirth),
        gender: patient.gender,
        phone: patient.phone || '',
        email: patient.email,
        lastVisit: patient.encounters[0]?.date,
        nextAppointment: patient.appointments[0]?.scheduledAt,
        primaryProvider: patient.appointments[0]?.provider
          ? `${patient.appointments[0].provider.firstName} ${patient.appointments[0].provider.lastName}`
          : undefined,
        allergiesCount: patient.allergies.length,
        medicationsCount: patient.medications.length,
        chronicConditions: patient.conditions?.map(c => c.name) || [],
      }));
    } catch (error) {
      logger.error('Error searching patients', {
        component: 'PatientModel',
        error: (error as Error).message,
        query,
        filters,
      });
      throw new AppError('Failed to search patients', 500);
    }
  }

  /**
   * Get patient statistics
   */
  async getStats(): Promise<PatientStats> {
    try {
      const [totalPatients, activePatients, newPatientsThisMonth, patientsByGender, patientsByBloodType, ageData] = await Promise.all([
        this.prisma.patient.count(),
        this.prisma.patient.count({
          where: { isActive: true },
        }),
        this.prisma.patient.count({
          where: {
            createdAt: {
              gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            },
          },
        }),
        this.prisma.patient.groupBy({
          by: ['gender'],
          where: { isActive: true },
          _count: true,
        }),
        this.prisma.patient.groupBy({
          by: ['bloodType'],
          where: { 
            isActive: true,
            bloodType: { not: null },
          },
          _count: true,
        }),
        this.prisma.patient.findMany({
          where: { isActive: true },
          select: { dateOfBirth: true },
        }),
      ]);

      // Calculate age statistics
      const ages = ageData.map(p => calculateAge(p.dateOfBirth));
      const averageAge = ages.length > 0 ? ages.reduce((sum, age) => sum + age, 0) / ages.length : 0;

      // Group patients by age ranges
      const ageGroups = {
        '0-17': 0,
        '18-30': 0,
        '31-50': 0,
        '51-70': 0,
        '71+': 0,
      };

      ages.forEach(age => {
        if (age <= 17) ageGroups['0-17']++;
        else if (age <= 30) ageGroups['18-30']++;
        else if (age <= 50) ageGroups['31-50']++;
        else if (age <= 70) ageGroups['51-70']++;
        else ageGroups['71+']++;
      });

      // Format gender stats
      const genderStats = patientsByGender.reduce((acc, item) => {
        acc[item.gender] = item._count;
        return acc;
      }, {} as Record<Gender, number>);

      // Ensure all genders are represented
      Object.values(Gender).forEach(gender => {
        if (!(gender in genderStats)) {
          genderStats[gender] = 0;
        }
      });

      // Format blood type stats
      const bloodTypeStats = patientsByBloodType.reduce((acc, item) => {
        if (item.bloodType) {
          acc[item.bloodType] = item._count;
        }
        return acc;
      }, {} as Record<BloodType, number>);

      // Ensure all blood types are represented
      Object.values(BloodType).forEach(bloodType => {
        if (!(bloodType in bloodTypeStats)) {
          bloodTypeStats[bloodType] = 0;
        }
      });

      return {
        totalPatients,
        activePatients,
        newPatientsThisMonth,
        patientsByGender: genderStats,
        patientsByAgeGroup: ageGroups,
        patientsByBloodType: bloodTypeStats,
        averageAge: Math.round(averageAge * 10) / 10,
      };
    } catch (error) {
      logger.error('Error getting patient stats', {
        component: 'PatientModel',
        error: (error as Error).message,
      });
      throw new AppError('Failed to get patient statistics', 500);
    }
  }

  /**
   * Get patients by provider
   */
  async findByProvider(providerId: string, includeInactive: boolean = false): Promise<PatientWithRelations[]> {
    try {
      const where: any = {
        primaryProvider: providerId,
      };

      if (!includeInactive) {
        where.isActive = true;
      }

      const patients = await this.prisma.patient.findMany({
        where,
        include: {
          allergies: {
            where: { isActive: true },
            select: { id: true, allergen: true, severity: true },
          },
          medications: {
            where: { isActive: true },
            select: { id: true, name: true, dosage: true },
          },
          appointments: {
            where: {
              scheduledAt: { gte: new Date() },
            },
            orderBy: { scheduledAt: 'asc' },
            take: 1,
          },
        },
        orderBy: [
          { firstName: 'asc' },
          { lastName: 'asc' },
        ],
      });

      return patients;
    } catch (error) {
      logger.error('Error finding patients by provider', {
        component: 'PatientModel',
        error: (error as Error).message,
        providerId,
      });
      throw new AppError('Failed to find patients by provider', 500);
    }
  }

  /**
   * Get patient medical summary
   */
  async getMedicalSummary(id: string): Promise<any> {
    try {
      const patient = await this.prisma.patient.findUnique({
        where: { id },
        include: {
          allergies: {
            where: { isActive: true },
            orderBy: { severity: 'desc' },
          },
          medications: {
            where: { isActive: true },
            orderBy: { startDate: 'desc' },
          },
          conditions: {
            where: { status: 'ACTIVE' },
            orderBy: { diagnosedAt: 'desc' },
          },
          vitalSigns: {
            orderBy: { recordedAt: 'desc' },
            take: 5,
          },
          labResults: {
            where: { status: 'COMPLETED' },
            orderBy: { collectedAt: 'desc' },
            take: 10,
          },
          encounters: {
            orderBy: { date: 'desc' },
            take: 5,
            include: {
              provider: {
                select: {
                  firstName: true,
                  lastName: true,
                  title: true,
                },
              },
            },
          },
          prescriptions: {
            where: { isActive: true },
            orderBy: { prescribedAt: 'desc' },
            include: {
              prescriber: {
                select: {
                  firstName: true,
                  lastName: true,
                  title: true,
                },
              },
            },
          },
        },
      });

      if (!patient) {
        throw new NotFoundError('Patient not found');
      }

      return {
        patient: {
          id: patient.id,
          patientId: patient.patientId,
          fullName: `${patient.firstName} ${patient.lastName}`,
          age: calculateAge(patient.dateOfBirth),
          gender: patient.gender,
          bloodType: patient.bloodType,
          maritalStatus: patient.maritalStatus,
        },
        allergies: patient.allergies,
        medications: patient.medications,
        conditions: patient.conditions,
        recentVitals: patient.vitalSigns[0] || null,
        recentLabs: patient.labResults.slice(0, 5),
        recentEncounters: patient.encounters,
        activePrescriptions: patient.prescriptions,
        summary: {
          totalAllergies: patient.allergies.length,
          totalMedications: patient.medications.length,
          totalConditions: patient.conditions.length,
          lastVisit: patient.encounters[0]?.date || null,
          chronicConditions: patient.conditions.filter(c => c.category === 'CHRONIC').length,
          criticalAllergies: patient.allergies.filter(a => a.severity === 'SEVERE' || a.severity === 'CRITICAL').length,
        },
      };
    } catch (error) {
      logger.error('Error getting patient medical summary', {
        component: 'PatientModel',
        error: (error as Error).message,
        patientId: id,
      });
      throw error;
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default PatientModel;