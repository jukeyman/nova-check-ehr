/**
 * ============================================================================
 * NOVA CHECK EHR - CLINICAL MODEL
 * ============================================================================
 */

import { PrismaClient, Encounter as PrismaEncounter, Diagnosis, Procedure, Prescription, VitalSigns as PrismaVitalSigns, Priority, EncounterStatus, DiagnosisType, ProcedureStatus, PrescriptionStatus } from '@prisma/client';
import { logger } from '../utils/logger';
import { AppError, NotFoundError, ValidationError } from '../utils/errors';
import { generateUniqueId } from '../utils/generators';
import { calculateAge, calculateBMI, getBMICategory, formatDate } from '../utils/helpers';
import { EncounterData, DiagnosisData, ProcedureData, PrescriptionData, VitalSigns } from '../types';

// ============================================================================
// INTERFACES
// ============================================================================

export interface EncounterWithRelations extends PrismaEncounter {
  patient?: any;
  provider?: any;
  diagnoses?: Diagnosis[];
  procedures?: Procedure[];
  prescriptions?: Prescription[];
  vitalSigns?: PrismaVitalSigns[];
  notes?: any[];
  documents?: any[];
}

export interface ClinicalSearchFilters {
  patientId?: string;
  providerId?: string;
  encounterId?: string;
  encounterType?: string;
  status?: EncounterStatus;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  diagnosisCode?: string;
  procedureCode?: string;
}

export interface ClinicalStats {
  totalEncounters: number;
  encountersByType: Record<string, number>;
  encountersByStatus: Record<EncounterStatus, number>;
  totalDiagnoses: number;
  totalProcedures: number;
  totalPrescriptions: number;
  averageEncounterDuration: number;
  commonDiagnoses: Array<{ code: string; description: string; count: number }>;
  commonProcedures: Array<{ code: string; description: string; count: number }>;
}

export interface PatientClinicalSummary {
  patientId: string;
  totalEncounters: number;
  recentEncounters: EncounterWithRelations[];
  activeDiagnoses: Diagnosis[];
  activePrescriptions: Prescription[];
  recentVitalSigns: PrismaVitalSigns | null;
  allergies: any[];
  chronicConditions: Diagnosis[];
  riskFactors: string[];
  lastVisit: Date | null;
  nextAppointment: Date | null;
}

export interface VitalSignsTrend {
  date: Date;
  systolic?: number;
  diastolic?: number;
  heartRate?: number;
  temperature?: number;
  weight?: number;
  height?: number;
  bmi?: number;
  oxygenSaturation?: number;
  respiratoryRate?: number;
}

// ============================================================================
// CLINICAL MODEL CLASS
// ============================================================================

export class ClinicalModel {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  // ============================================================================
  // ENCOUNTER METHODS
  // ============================================================================

  /**
   * Create a new encounter
   */
  async createEncounter(encounterData: EncounterData): Promise<EncounterWithRelations> {
    try {
      // Validate required fields
      if (!encounterData.patientId || !encounterData.providerId) {
        throw new ValidationError('Missing required fields: patientId, providerId');
      }

      // Verify patient and provider exist
      const [patient, provider] = await Promise.all([
        this.prisma.patient.findUnique({ where: { id: encounterData.patientId } }),
        this.prisma.user.findUnique({ where: { id: encounterData.providerId } }),
      ]);

      if (!patient) {
        throw new NotFoundError('Patient not found');
      }

      if (!provider) {
        throw new NotFoundError('Provider not found');
      }

      // Generate encounter ID
      const encounterId = generateUniqueId('ENC');

      // Create encounter with transaction
      const encounter = await this.prisma.$transaction(async (tx) => {
        // Create encounter
        const newEncounter = await tx.encounter.create({
          data: {
            id: generateUniqueId('ENC'),
            encounterId,
            patientId: encounterData.patientId,
            providerId: encounterData.providerId,
            appointmentId: encounterData.appointmentId,
            type: encounterData.type || 'CONSULTATION',
            status: EncounterStatus.IN_PROGRESS,
            priority: encounterData.priority || Priority.MEDIUM,
            startTime: encounterData.startTime || new Date(),
            location: encounterData.location,
            chiefComplaint: encounterData.chiefComplaint,
            historyOfPresentIllness: encounterData.historyOfPresentIllness,
            reviewOfSystems: encounterData.reviewOfSystems,
            physicalExamination: encounterData.physicalExamination,
            assessment: encounterData.assessment,
            plan: encounterData.plan,
            notes: encounterData.notes,
            metadata: encounterData.metadata || {},
          },
          include: {
            patient: {
              select: {
                id: true,
                patientId: true,
                firstName: true,
                lastName: true,
                dateOfBirth: true,
                gender: true,
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

        // Create vital signs if provided
        if (encounterData.vitalSigns) {
          await this.createVitalSigns(tx, newEncounter.id, encounterData.vitalSigns);
        }

        // Create diagnoses if provided
        if (encounterData.diagnoses && encounterData.diagnoses.length > 0) {
          await Promise.all(
            encounterData.diagnoses.map(diagnosis =>
              this.createDiagnosis(tx, newEncounter.id, diagnosis)
            )
          );
        }

        // Create procedures if provided
        if (encounterData.procedures && encounterData.procedures.length > 0) {
          await Promise.all(
            encounterData.procedures.map(procedure =>
              this.createProcedure(tx, newEncounter.id, procedure)
            )
          );
        }

        // Create prescriptions if provided
        if (encounterData.prescriptions && encounterData.prescriptions.length > 0) {
          await Promise.all(
            encounterData.prescriptions.map(prescription =>
              this.createPrescription(tx, newEncounter.id, prescription)
            )
          );
        }

        return newEncounter;
      });

      logger.info('Encounter created successfully', {
        component: 'ClinicalModel',
        encounterId: encounter.encounterId,
        patientId: encounterData.patientId,
        providerId: encounterData.providerId,
      });

      return encounter;
    } catch (error) {
      logger.error('Error creating encounter', {
        component: 'ClinicalModel',
        error: (error as Error).message,
        encounterData: {
          patientId: encounterData.patientId,
          providerId: encounterData.providerId,
          type: encounterData.type,
        },
      });
      throw error;
    }
  }

  /**
   * Find encounter by ID
   */
  async findEncounterById(id: string, includeRelations: boolean = false): Promise<EncounterWithRelations | null> {
    try {
      const encounter = await this.prisma.encounter.findUnique({
        where: { id },
        include: includeRelations ? {
          patient: {
            select: {
              id: true,
              patientId: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
              gender: true,
              phone: true,
              email: true,
              allergies: {
                where: { isActive: true },
                select: {
                  allergen: true,
                  severity: true,
                  reaction: true,
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
            },
          },
          diagnoses: {
            orderBy: { createdAt: 'desc' },
          },
          procedures: {
            orderBy: { createdAt: 'desc' },
          },
          prescriptions: {
            orderBy: { createdAt: 'desc' },
          },
          vitalSigns: {
            orderBy: { recordedAt: 'desc' },
            take: 1,
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

      return encounter;
    } catch (error) {
      logger.error('Error finding encounter by ID', {
        component: 'ClinicalModel',
        error: (error as Error).message,
        encounterId: id,
      });
      throw new AppError('Failed to find encounter', 500);
    }
  }

  /**
   * Update encounter
   */
  async updateEncounter(id: string, updateData: Partial<EncounterData>): Promise<EncounterWithRelations> {
    try {
      // Check if encounter exists
      const existingEncounter = await this.findEncounterById(id);
      if (!existingEncounter) {
        throw new NotFoundError('Encounter not found');
      }

      // Check if encounter can be updated
      if (existingEncounter.status === EncounterStatus.COMPLETED) {
        throw new ValidationError('Cannot update completed encounter');
      }

      // Update encounter
      const updatedEncounter = await this.prisma.encounter.update({
        where: { id },
        data: {
          ...updateData,
          updatedAt: new Date(),
        },
        include: {
          patient: true,
          provider: true,
          diagnoses: true,
          procedures: true,
          prescriptions: true,
          vitalSigns: {
            orderBy: { recordedAt: 'desc' },
            take: 1,
          },
        },
      });

      logger.info('Encounter updated successfully', {
        component: 'ClinicalModel',
        encounterId: id,
        updatedFields: Object.keys(updateData),
      });

      return updatedEncounter;
    } catch (error) {
      logger.error('Error updating encounter', {
        component: 'ClinicalModel',
        error: (error as Error).message,
        encounterId: id,
      });
      throw error;
    }
  }

  /**
   * Complete encounter
   */
  async completeEncounter(id: string, completedBy?: string, summary?: string): Promise<EncounterWithRelations> {
    try {
      const encounter = await this.findEncounterById(id);
      if (!encounter) {
        throw new NotFoundError('Encounter not found');
      }

      if (encounter.status === EncounterStatus.COMPLETED) {
        throw new ValidationError('Encounter is already completed');
      }

      const updatedEncounter = await this.prisma.encounter.update({
        where: { id },
        data: {
          status: EncounterStatus.COMPLETED,
          endTime: new Date(),
          completedBy,
          summary,
          updatedAt: new Date(),
        },
        include: {
          patient: true,
          provider: true,
          diagnoses: true,
          procedures: true,
          prescriptions: true,
        },
      });

      logger.info('Encounter completed successfully', {
        component: 'ClinicalModel',
        encounterId: id,
        completedBy,
      });

      return updatedEncounter;
    } catch (error) {
      logger.error('Error completing encounter', {
        component: 'ClinicalModel',
        error: (error as Error).message,
        encounterId: id,
      });
      throw error;
    }
  }

  // ============================================================================
  // VITAL SIGNS METHODS
  // ============================================================================

  /**
   * Create vital signs
   */
  async createVitalSigns(tx: any, encounterId: string, vitalSignsData: VitalSigns): Promise<PrismaVitalSigns> {
    try {
      // Calculate BMI if height and weight are provided
      let bmi: number | undefined;
      let bmiCategory: string | undefined;
      
      if (vitalSignsData.height && vitalSignsData.weight) {
        bmi = calculateBMI(vitalSignsData.weight, vitalSignsData.height);
        bmiCategory = getBMICategory(bmi);
      }

      const vitalSigns = await tx.vitalSigns.create({
        data: {
          id: generateUniqueId('VIT'),
          encounterId,
          recordedAt: vitalSignsData.recordedAt || new Date(),
          recordedBy: vitalSignsData.recordedBy,
          systolicBP: vitalSignsData.systolicBP,
          diastolicBP: vitalSignsData.diastolicBP,
          heartRate: vitalSignsData.heartRate,
          temperature: vitalSignsData.temperature,
          temperatureUnit: vitalSignsData.temperatureUnit || 'F',
          weight: vitalSignsData.weight,
          weightUnit: vitalSignsData.weightUnit || 'lbs',
          height: vitalSignsData.height,
          heightUnit: vitalSignsData.heightUnit || 'in',
          bmi,
          bmiCategory,
          oxygenSaturation: vitalSignsData.oxygenSaturation,
          respiratoryRate: vitalSignsData.respiratoryRate,
          painLevel: vitalSignsData.painLevel,
          notes: vitalSignsData.notes,
          metadata: vitalSignsData.metadata || {},
        },
      });

      return vitalSigns;
    } catch (error) {
      logger.error('Error creating vital signs', {
        component: 'ClinicalModel',
        error: (error as Error).message,
        encounterId,
      });
      throw error;
    }
  }

  /**
   * Get vital signs trends for a patient
   */
  async getVitalSignsTrends(patientId: string, days: number = 30): Promise<VitalSignsTrend[]> {
    try {
      const dateFrom = new Date();
      dateFrom.setDate(dateFrom.getDate() - days);

      const vitalSigns = await this.prisma.vitalSigns.findMany({
        where: {
          encounter: {
            patientId,
          },
          recordedAt: {
            gte: dateFrom,
          },
        },
        orderBy: {
          recordedAt: 'asc',
        },
      });

      const trends: VitalSignsTrend[] = vitalSigns.map(vs => ({
        date: vs.recordedAt,
        systolic: vs.systolicBP || undefined,
        diastolic: vs.diastolicBP || undefined,
        heartRate: vs.heartRate || undefined,
        temperature: vs.temperature || undefined,
        weight: vs.weight || undefined,
        height: vs.height || undefined,
        bmi: vs.bmi || undefined,
        oxygenSaturation: vs.oxygenSaturation || undefined,
        respiratoryRate: vs.respiratoryRate || undefined,
      }));

      return trends;
    } catch (error) {
      logger.error('Error getting vital signs trends', {
        component: 'ClinicalModel',
        error: (error as Error).message,
        patientId,
        days,
      });
      throw new AppError('Failed to get vital signs trends', 500);
    }
  }

  // ============================================================================
  // DIAGNOSIS METHODS
  // ============================================================================

  /**
   * Create diagnosis
   */
  async createDiagnosis(tx: any, encounterId: string, diagnosisData: DiagnosisData): Promise<Diagnosis> {
    try {
      const diagnosis = await tx.diagnosis.create({
        data: {
          id: generateUniqueId('DIA'),
          encounterId,
          code: diagnosisData.code,
          codeSystem: diagnosisData.codeSystem || 'ICD-10',
          description: diagnosisData.description,
          type: diagnosisData.type || DiagnosisType.PRIMARY,
          severity: diagnosisData.severity,
          status: diagnosisData.status || 'ACTIVE',
          onsetDate: diagnosisData.onsetDate,
          resolvedDate: diagnosisData.resolvedDate,
          notes: diagnosisData.notes,
          isPrimary: diagnosisData.isPrimary || false,
          isChronic: diagnosisData.isChronic || false,
          metadata: diagnosisData.metadata || {},
        },
      });

      return diagnosis;
    } catch (error) {
      logger.error('Error creating diagnosis', {
        component: 'ClinicalModel',
        error: (error as Error).message,
        encounterId,
        diagnosisCode: diagnosisData.code,
      });
      throw error;
    }
  }

  /**
   * Get active diagnoses for a patient
   */
  async getActiveDiagnoses(patientId: string): Promise<Diagnosis[]> {
    try {
      const diagnoses = await this.prisma.diagnosis.findMany({
        where: {
          encounter: {
            patientId,
          },
          status: 'ACTIVE',
          resolvedDate: null,
        },
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          encounter: {
            select: {
              encounterId: true,
              startTime: true,
              provider: {
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

      return diagnoses;
    } catch (error) {
      logger.error('Error getting active diagnoses', {
        component: 'ClinicalModel',
        error: (error as Error).message,
        patientId,
      });
      throw new AppError('Failed to get active diagnoses', 500);
    }
  }

  // ============================================================================
  // PROCEDURE METHODS
  // ============================================================================

  /**
   * Create procedure
   */
  async createProcedure(tx: any, encounterId: string, procedureData: ProcedureData): Promise<Procedure> {
    try {
      const procedure = await tx.procedure.create({
        data: {
          id: generateUniqueId('PRO'),
          encounterId,
          code: procedureData.code,
          codeSystem: procedureData.codeSystem || 'CPT',
          description: procedureData.description,
          status: procedureData.status || ProcedureStatus.PLANNED,
          performedDate: procedureData.performedDate,
          performedBy: procedureData.performedBy,
          location: procedureData.location,
          duration: procedureData.duration,
          notes: procedureData.notes,
          complications: procedureData.complications,
          outcome: procedureData.outcome,
          metadata: procedureData.metadata || {},
        },
      });

      return procedure;
    } catch (error) {
      logger.error('Error creating procedure', {
        component: 'ClinicalModel',
        error: (error as Error).message,
        encounterId,
        procedureCode: procedureData.code,
      });
      throw error;
    }
  }

  // ============================================================================
  // PRESCRIPTION METHODS
  // ============================================================================

  /**
   * Create prescription
   */
  async createPrescription(tx: any, encounterId: string, prescriptionData: PrescriptionData): Promise<Prescription> {
    try {
      const prescription = await tx.prescription.create({
        data: {
          id: generateUniqueId('PRE'),
          encounterId,
          medicationName: prescriptionData.medicationName,
          medicationCode: prescriptionData.medicationCode,
          dosage: prescriptionData.dosage,
          dosageUnit: prescriptionData.dosageUnit,
          frequency: prescriptionData.frequency,
          route: prescriptionData.route,
          duration: prescriptionData.duration,
          quantity: prescriptionData.quantity,
          refills: prescriptionData.refills || 0,
          status: prescriptionData.status || PrescriptionStatus.ACTIVE,
          prescribedDate: prescriptionData.prescribedDate || new Date(),
          startDate: prescriptionData.startDate,
          endDate: prescriptionData.endDate,
          instructions: prescriptionData.instructions,
          indication: prescriptionData.indication,
          notes: prescriptionData.notes,
          isGenericAllowed: prescriptionData.isGenericAllowed || true,
          metadata: prescriptionData.metadata || {},
        },
      });

      return prescription;
    } catch (error) {
      logger.error('Error creating prescription', {
        component: 'ClinicalModel',
        error: (error as Error).message,
        encounterId,
        medicationName: prescriptionData.medicationName,
      });
      throw error;
    }
  }

  /**
   * Get active prescriptions for a patient
   */
  async getActivePrescriptions(patientId: string): Promise<Prescription[]> {
    try {
      const prescriptions = await this.prisma.prescription.findMany({
        where: {
          encounter: {
            patientId,
          },
          status: PrescriptionStatus.ACTIVE,
          OR: [
            { endDate: null },
            { endDate: { gte: new Date() } },
          ],
        },
        orderBy: {
          prescribedDate: 'desc',
        },
        include: {
          encounter: {
            select: {
              encounterId: true,
              startTime: true,
              provider: {
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

      return prescriptions;
    } catch (error) {
      logger.error('Error getting active prescriptions', {
        component: 'ClinicalModel',
        error: (error as Error).message,
        patientId,
      });
      throw new AppError('Failed to get active prescriptions', 500);
    }
  }

  // ============================================================================
  // SEARCH AND ANALYTICS METHODS
  // ============================================================================

  /**
   * Search encounters with filters
   */
  async searchEncounters(
    filters: ClinicalSearchFilters = {},
    page: number = 1,
    limit: number = 20,
    sortBy: string = 'startTime',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<{ encounters: EncounterWithRelations[]; total: number; pages: number }> {
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

      if (filters.encounterType) {
        where.type = filters.encounterType;
      }

      if (filters.status) {
        where.status = filters.status;
      }

      if (filters.dateFrom || filters.dateTo) {
        where.startTime = {};
        if (filters.dateFrom) {
          where.startTime.gte = filters.dateFrom;
        }
        if (filters.dateTo) {
          where.startTime.lte = filters.dateTo;
        }
      }

      if (filters.search) {
        where.OR = [
          { encounterId: { contains: filters.search, mode: 'insensitive' } },
          { chiefComplaint: { contains: filters.search, mode: 'insensitive' } },
          { assessment: { contains: filters.search, mode: 'insensitive' } },
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

      if (filters.diagnosisCode) {
        where.diagnoses = {
          some: {
            code: { contains: filters.diagnosisCode, mode: 'insensitive' },
          },
        };
      }

      if (filters.procedureCode) {
        where.procedures = {
          some: {
            code: { contains: filters.procedureCode, mode: 'insensitive' },
          },
        };
      }

      // Get encounters and total count
      const [encounters, total] = await Promise.all([
        this.prisma.encounter.findMany({
          where,
          include: {
            patient: {
              select: {
                id: true,
                patientId: true,
                firstName: true,
                lastName: true,
                dateOfBirth: true,
                gender: true,
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
            diagnoses: {
              take: 3,
              orderBy: { createdAt: 'desc' },
            },
            procedures: {
              take: 3,
              orderBy: { createdAt: 'desc' },
            },
            prescriptions: {
              take: 3,
              orderBy: { prescribedDate: 'desc' },
            },
          },
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        this.prisma.encounter.count({ where }),
      ]);

      const pages = Math.ceil(total / limit);

      return { encounters, total, pages };
    } catch (error) {
      logger.error('Error searching encounters', {
        component: 'ClinicalModel',
        error: (error as Error).message,
        filters,
      });
      throw new AppError('Failed to search encounters', 500);
    }
  }

  /**
   * Get clinical statistics
   */
  async getClinicalStats(dateFrom?: Date, dateTo?: Date): Promise<ClinicalStats> {
    try {
      const where: any = {};
      
      if (dateFrom || dateTo) {
        where.startTime = {};
        if (dateFrom) {
          where.startTime.gte = dateFrom;
        }
        if (dateTo) {
          where.startTime.lte = dateTo;
        }
      }

      const [totalEncounters, encountersByType, encountersByStatus, totalDiagnoses, totalProcedures, totalPrescriptions, avgDuration, commonDiagnoses, commonProcedures] = await Promise.all([
        this.prisma.encounter.count({ where }),
        this.prisma.encounter.groupBy({
          by: ['type'],
          where,
          _count: true,
        }),
        this.prisma.encounter.groupBy({
          by: ['status'],
          where,
          _count: true,
        }),
        this.prisma.diagnosis.count({
          where: {
            encounter: where,
          },
        }),
        this.prisma.procedure.count({
          where: {
            encounter: where,
          },
        }),
        this.prisma.prescription.count({
          where: {
            encounter: where,
          },
        }),
        this.prisma.encounter.aggregate({
          where: {
            ...where,
            endTime: { not: null },
          },
          _avg: {
            duration: true,
          },
        }),
        this.prisma.diagnosis.groupBy({
          by: ['code', 'description'],
          where: {
            encounter: where,
          },
          _count: true,
          orderBy: {
            _count: {
              code: 'desc',
            },
          },
          take: 10,
        }),
        this.prisma.procedure.groupBy({
          by: ['code', 'description'],
          where: {
            encounter: where,
          },
          _count: true,
          orderBy: {
            _count: {
              code: 'desc',
            },
          },
          take: 10,
        }),
      ]);

      // Format type stats
      const typeStats = encountersByType.reduce((acc, item) => {
        acc[item.type] = item._count;
        return acc;
      }, {} as Record<string, number>);

      // Format status stats
      const statusStats = encountersByStatus.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {} as Record<EncounterStatus, number>);

      // Ensure all statuses are represented
      Object.values(EncounterStatus).forEach(status => {
        if (!(status in statusStats)) {
          statusStats[status] = 0;
        }
      });

      return {
        totalEncounters,
        encountersByType: typeStats,
        encountersByStatus: statusStats,
        totalDiagnoses,
        totalProcedures,
        totalPrescriptions,
        averageEncounterDuration: Math.round(avgDuration._avg.duration || 0),
        commonDiagnoses: commonDiagnoses.map(d => ({
          code: d.code,
          description: d.description,
          count: d._count,
        })),
        commonProcedures: commonProcedures.map(p => ({
          code: p.code,
          description: p.description,
          count: p._count,
        })),
      };
    } catch (error) {
      logger.error('Error getting clinical stats', {
        component: 'ClinicalModel',
        error: (error as Error).message,
      });
      throw new AppError('Failed to get clinical statistics', 500);
    }
  }

  /**
   * Get patient clinical summary
   */
  async getPatientClinicalSummary(patientId: string): Promise<PatientClinicalSummary> {
    try {
      const [totalEncounters, recentEncounters, activeDiagnoses, activePrescriptions, recentVitalSigns, allergies, chronicConditions, lastVisit, nextAppointment] = await Promise.all([
        this.prisma.encounter.count({
          where: { patientId },
        }),
        this.prisma.encounter.findMany({
          where: { patientId },
          include: {
            provider: {
              select: {
                firstName: true,
                lastName: true,
                title: true,
              },
            },
            diagnoses: {
              take: 3,
            },
          },
          orderBy: { startTime: 'desc' },
          take: 5,
        }),
        this.getActiveDiagnoses(patientId),
        this.getActivePrescriptions(patientId),
        this.prisma.vitalSigns.findFirst({
          where: {
            encounter: {
              patientId,
            },
          },
          orderBy: { recordedAt: 'desc' },
        }),
        this.prisma.allergy.findMany({
          where: {
            patientId,
            isActive: true,
          },
        }),
        this.prisma.diagnosis.findMany({
          where: {
            encounter: {
              patientId,
            },
            isChronic: true,
            status: 'ACTIVE',
          },
        }),
        this.prisma.encounter.findFirst({
          where: {
            patientId,
            status: EncounterStatus.COMPLETED,
          },
          orderBy: { endTime: 'desc' },
          select: { endTime: true },
        }),
        this.prisma.appointment.findFirst({
          where: {
            patientId,
            scheduledAt: {
              gte: new Date(),
            },
            status: {
              in: ['SCHEDULED', 'CONFIRMED'],
            },
          },
          orderBy: { scheduledAt: 'asc' },
          select: { scheduledAt: true },
        }),
      ]);

      // Generate risk factors based on diagnoses and vital signs
      const riskFactors: string[] = [];
      
      if (recentVitalSigns) {
        if (recentVitalSigns.systolicBP && recentVitalSigns.systolicBP > 140) {
          riskFactors.push('Hypertension');
        }
        if (recentVitalSigns.bmi && recentVitalSigns.bmi > 30) {
          riskFactors.push('Obesity');
        }
      }

      chronicConditions.forEach(condition => {
        if (condition.code.includes('E11') || condition.description.toLowerCase().includes('diabetes')) {
          riskFactors.push('Diabetes');
        }
      });

      return {
        patientId,
        totalEncounters,
        recentEncounters,
        activeDiagnoses,
        activePrescriptions,
        recentVitalSigns,
        allergies,
        chronicConditions,
        riskFactors,
        lastVisit: lastVisit?.endTime || null,
        nextAppointment: nextAppointment?.scheduledAt || null,
      };
    } catch (error) {
      logger.error('Error getting patient clinical summary', {
        component: 'ClinicalModel',
        error: (error as Error).message,
        patientId,
      });
      throw new AppError('Failed to get patient clinical summary', 500);
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ClinicalModel;