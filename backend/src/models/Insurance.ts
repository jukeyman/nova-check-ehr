/**
 * ============================================================================
 * NOVA CHECK EHR - INSURANCE MODEL
 * ============================================================================
 */

import { PrismaClient, Insurance as PrismaInsurance, InsuranceClaim, ClaimStatus, AuthorizationStatus } from '@prisma/client';
import { logger } from '../utils/logger';
import { AppError, NotFoundError, ValidationError } from '../utils/errors';
import { generateUniqueId } from '../utils/generators';
import { formatCurrency, formatDate, normalizeEmail, formatPhoneNumber } from '../utils/helpers';
import { InsuranceData, ClaimData, AuthorizationData } from '../types';

// ============================================================================
// INTERFACES
// ============================================================================

export interface InsuranceWithRelations extends PrismaInsurance {
  patient?: any;
  claims?: any[];
  authorizations?: any[];
}

export interface InsuranceSearchFilters {
  patientId?: string;
  insuranceCompany?: string;
  policyNumber?: string;
  groupNumber?: string;
  status?: string;
  isPrimary?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
}

export interface ClaimWithRelations extends InsuranceClaim {
  insurance?: any;
  patient?: any;
  provider?: any;
  encounter?: any;
  invoice?: any;
}

export interface ClaimSearchFilters {
  patientId?: string;
  insuranceId?: string;
  providerId?: string;
  status?: ClaimStatus;
  dateFrom?: Date;
  dateTo?: Date;
  amountMin?: number;
  amountMax?: number;
  search?: string;
}

export interface InsuranceStats {
  totalPolicies: number;
  activePolicies: number;
  expiredPolicies: number;
  totalClaims: number;
  claimsByStatus: Record<ClaimStatus, number>;
  totalClaimAmount: number;
  paidClaimAmount: number;
  deniedClaimAmount: number;
  pendingClaimAmount: number;
  averageClaimAmount: number;
  claimApprovalRate: number;
  averageProcessingTime: number;
}

export interface CoverageDetails {
  deductible: number;
  deductibleMet: number;
  outOfPocketMax: number;
  outOfPocketMet: number;
  copay: number;
  coinsurance: number;
  coveragePercentage: number;
  effectiveDate: Date;
  expirationDate: Date;
  benefits: CoverageBenefit[];
}

export interface CoverageBenefit {
  type: string;
  description: string;
  covered: boolean;
  copay?: number;
  coinsurance?: number;
  deductible?: number;
  annualLimit?: number;
  visitLimit?: number;
  notes?: string;
}

export interface Authorization {
  id: string;
  authorizationNumber: string;
  patientId: string;
  insuranceId: string;
  providerId: string;
  serviceType: string;
  cptCodes: string[];
  status: AuthorizationStatus;
  requestDate: Date;
  approvalDate?: Date;
  expirationDate?: Date;
  approvedUnits?: number;
  usedUnits?: number;
  notes?: string;
  metadata?: any;
}

export interface EligibilityResponse {
  isEligible: boolean;
  effectiveDate?: Date;
  expirationDate?: Date;
  deductible?: number;
  deductibleMet?: number;
  outOfPocketMax?: number;
  outOfPocketMet?: number;
  copay?: number;
  coinsurance?: number;
  benefits?: CoverageBenefit[];
  messages?: string[];
  errors?: string[];
}

// ============================================================================
// INSURANCE MODEL CLASS
// ============================================================================

export class InsuranceModel {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create a new insurance policy
   */
  async create(insuranceData: InsuranceData): Promise<InsuranceWithRelations> {
    try {
      // Validate required fields
      if (!insuranceData.patientId || !insuranceData.insuranceCompany || !insuranceData.policyNumber) {
        throw new ValidationError('Missing required fields: patientId, insuranceCompany, policyNumber');
      }

      // Verify patient exists
      const patient = await this.prisma.patient.findUnique({
        where: { id: insuranceData.patientId },
        select: {
          id: true,
          patientId: true,
          firstName: true,
          lastName: true,
          dateOfBirth: true,
        },
      });

      if (!patient) {
        throw new NotFoundError('Patient not found');
      }

      // Check if this is being set as primary insurance
      if (insuranceData.isPrimary) {
        // Set all other insurances for this patient as non-primary
        await this.prisma.insurance.updateMany({
          where: {
            patientId: insuranceData.patientId,
            isPrimary: true,
          },
          data: {
            isPrimary: false,
            updatedAt: new Date(),
          },
        });
      }

      // Generate insurance ID
      const insuranceId = generateUniqueId('INS');

      // Create insurance policy
      const insurance = await this.prisma.insurance.create({
        data: {
          id: insuranceId,
          insuranceId: insuranceId,
          patientId: insuranceData.patientId,
          insuranceCompany: insuranceData.insuranceCompany,
          policyNumber: insuranceData.policyNumber,
          groupNumber: insuranceData.groupNumber,
          subscriberId: insuranceData.subscriberId || insuranceData.policyNumber,
          subscriberName: insuranceData.subscriberName,
          subscriberRelationship: insuranceData.subscriberRelationship || 'SELF',
          subscriberDateOfBirth: insuranceData.subscriberDateOfBirth,
          isPrimary: insuranceData.isPrimary || false,
          effectiveDate: insuranceData.effectiveDate || new Date(),
          expirationDate: insuranceData.expirationDate,
          deductible: insuranceData.deductible || 0,
          deductibleMet: insuranceData.deductibleMet || 0,
          outOfPocketMax: insuranceData.outOfPocketMax || 0,
          outOfPocketMet: insuranceData.outOfPocketMet || 0,
          copay: insuranceData.copay || 0,
          coinsurance: insuranceData.coinsurance || 0,
          coveragePercentage: insuranceData.coveragePercentage || 80,
          planType: insuranceData.planType,
          networkType: insuranceData.networkType,
          rxBin: insuranceData.rxBin,
          rxPcn: insuranceData.rxPcn,
          rxGroup: insuranceData.rxGroup,
          customerServicePhone: formatPhoneNumber(insuranceData.customerServicePhone),
          claimsAddress: insuranceData.claimsAddress,
          notes: insuranceData.notes,
          isActive: insuranceData.isActive !== false,
          metadata: insuranceData.metadata || {},
        },
        include: {
          patient: {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
              ssn: true,
            },
          },
        },
      });

      logger.info('Insurance policy created successfully', {
        component: 'InsuranceModel',
        insuranceId: insurance.insuranceId,
        patientId: insuranceData.patientId,
        insuranceCompany: insuranceData.insuranceCompany,
        isPrimary: insuranceData.isPrimary,
      });

      return insurance;
    } catch (error) {
      logger.error('Error creating insurance policy', {
        component: 'InsuranceModel',
        error: (error as Error).message,
        insuranceData: {
          patientId: insuranceData.patientId,
          insuranceCompany: insuranceData.insuranceCompany,
          policyNumber: insuranceData.policyNumber,
        },
      });
      throw error;
    }
  }

  /**
   * Find insurance by ID
   */
  async findById(id: string, includeRelations: boolean = false): Promise<InsuranceWithRelations | null> {
    try {
      const insurance = await this.prisma.insurance.findUnique({
        where: { id },
        include: includeRelations ? {
          patient: {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
              ssn: true,
              phone: true,
              email: true,
            },
          },
          claims: {
            select: {
              id: true,
              claimNumber: true,
              status: true,
              submittedAt: true,
              claimAmount: true,
              paidAmount: true,
            },
            orderBy: {
              submittedAt: 'desc',
            },
            take: 10,
          },
          authorizations: {
            select: {
              id: true,
              authorizationNumber: true,
              status: true,
              serviceType: true,
              requestDate: true,
              expirationDate: true,
            },
            orderBy: {
              requestDate: 'desc',
            },
            take: 10,
          },
        } : undefined,
      });

      return insurance;
    } catch (error) {
      logger.error('Error finding insurance by ID', {
        component: 'InsuranceModel',
        error: (error as Error).message,
        insuranceId: id,
      });
      throw new AppError('Failed to find insurance', 500);
    }
  }

  /**
   * Update insurance policy
   */
  async update(id: string, updateData: Partial<InsuranceData>): Promise<InsuranceWithRelations> {
    try {
      const existingInsurance = await this.findById(id);
      if (!existingInsurance) {
        throw new NotFoundError('Insurance policy not found');
      }

      // Handle primary insurance change
      if (updateData.isPrimary && !existingInsurance.isPrimary) {
        // Set all other insurances for this patient as non-primary
        await this.prisma.insurance.updateMany({
          where: {
            patientId: existingInsurance.patientId,
            isPrimary: true,
            id: { not: id },
          },
          data: {
            isPrimary: false,
            updatedAt: new Date(),
          },
        });
      }

      const updatedInsurance = await this.prisma.insurance.update({
        where: { id },
        data: {
          insuranceCompany: updateData.insuranceCompany,
          policyNumber: updateData.policyNumber,
          groupNumber: updateData.groupNumber,
          subscriberId: updateData.subscriberId,
          subscriberName: updateData.subscriberName,
          subscriberRelationship: updateData.subscriberRelationship,
          subscriberDateOfBirth: updateData.subscriberDateOfBirth,
          isPrimary: updateData.isPrimary,
          effectiveDate: updateData.effectiveDate,
          expirationDate: updateData.expirationDate,
          deductible: updateData.deductible,
          deductibleMet: updateData.deductibleMet,
          outOfPocketMax: updateData.outOfPocketMax,
          outOfPocketMet: updateData.outOfPocketMet,
          copay: updateData.copay,
          coinsurance: updateData.coinsurance,
          coveragePercentage: updateData.coveragePercentage,
          planType: updateData.planType,
          networkType: updateData.networkType,
          rxBin: updateData.rxBin,
          rxPcn: updateData.rxPcn,
          rxGroup: updateData.rxGroup,
          customerServicePhone: updateData.customerServicePhone ? formatPhoneNumber(updateData.customerServicePhone) : undefined,
          claimsAddress: updateData.claimsAddress,
          notes: updateData.notes,
          isActive: updateData.isActive,
          metadata: updateData.metadata,
          updatedAt: new Date(),
        },
        include: {
          patient: {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
            },
          },
        },
      });

      logger.info('Insurance policy updated successfully', {
        component: 'InsuranceModel',
        insuranceId: id,
        updatedFields: Object.keys(updateData),
      });

      return updatedInsurance;
    } catch (error) {
      logger.error('Error updating insurance policy', {
        component: 'InsuranceModel',
        error: (error as Error).message,
        insuranceId: id,
      });
      throw error;
    }
  }

  /**
   * Get insurance policies with filters and pagination
   */
  async findMany(
    filters: InsuranceSearchFilters = {},
    page: number = 1,
    limit: number = 20,
    sortBy: string = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<{ insurances: InsuranceWithRelations[]; total: number; pages: number }> {
    try {
      const skip = (page - 1) * limit;
      
      // Build where clause
      const where: any = {};

      if (filters.patientId) {
        where.patientId = filters.patientId;
      }

      if (filters.insuranceCompany) {
        where.insuranceCompany = { contains: filters.insuranceCompany, mode: 'insensitive' };
      }

      if (filters.policyNumber) {
        where.policyNumber = { contains: filters.policyNumber, mode: 'insensitive' };
      }

      if (filters.groupNumber) {
        where.groupNumber = { contains: filters.groupNumber, mode: 'insensitive' };
      }

      if (filters.isPrimary !== undefined) {
        where.isPrimary = filters.isPrimary;
      }

      if (filters.dateFrom || filters.dateTo) {
        where.effectiveDate = {};
        if (filters.dateFrom) {
          where.effectiveDate.gte = filters.dateFrom;
        }
        if (filters.dateTo) {
          where.effectiveDate.lte = filters.dateTo;
        }
      }

      if (filters.search) {
        where.OR = [
          { insuranceCompany: { contains: filters.search, mode: 'insensitive' } },
          { policyNumber: { contains: filters.search, mode: 'insensitive' } },
          { groupNumber: { contains: filters.search, mode: 'insensitive' } },
          { subscriberName: { contains: filters.search, mode: 'insensitive' } },
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

      // Get insurances and total count
      const [insurances, total] = await Promise.all([
        this.prisma.insurance.findMany({
          where,
          include: {
            patient: {
              select: {
                patientId: true,
                firstName: true,
                lastName: true,
                dateOfBirth: true,
                phone: true,
                email: true,
              },
            },
            claims: {
              select: {
                id: true,
                status: true,
                claimAmount: true,
                submittedAt: true,
              },
              orderBy: {
                submittedAt: 'desc',
              },
              take: 3,
            },
          },
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        this.prisma.insurance.count({ where }),
      ]);

      const pages = Math.ceil(total / limit);

      return { insurances, total, pages };
    } catch (error) {
      logger.error('Error finding insurance policies', {
        component: 'InsuranceModel',
        error: (error as Error).message,
        filters,
      });
      throw new AppError('Failed to find insurance policies', 500);
    }
  }

  /**
   * Get patient's insurance policies
   */
  async getPatientInsurances(patientId: string): Promise<InsuranceWithRelations[]> {
    try {
      const insurances = await this.prisma.insurance.findMany({
        where: {
          patientId,
          isActive: true,
        },
        include: {
          patient: {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
            },
          },
        },
        orderBy: [
          { isPrimary: 'desc' },
          { createdAt: 'asc' },
        ],
      });

      return insurances;
    } catch (error) {
      logger.error('Error getting patient insurances', {
        component: 'InsuranceModel',
        error: (error as Error).message,
        patientId,
      });
      throw new AppError('Failed to get patient insurances', 500);
    }
  }

  /**
   * Get primary insurance for patient
   */
  async getPrimaryInsurance(patientId: string): Promise<InsuranceWithRelations | null> {
    try {
      const insurance = await this.prisma.insurance.findFirst({
        where: {
          patientId,
          isPrimary: true,
          isActive: true,
        },
        include: {
          patient: {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
            },
          },
        },
      });

      return insurance;
    } catch (error) {
      logger.error('Error getting primary insurance', {
        component: 'InsuranceModel',
        error: (error as Error).message,
        patientId,
      });
      throw new AppError('Failed to get primary insurance', 500);
    }
  }

  /**
   * Create insurance claim
   */
  async createClaim(claimData: ClaimData): Promise<ClaimWithRelations> {
    try {
      // Validate required fields
      if (!claimData.insuranceId || !claimData.patientId || !claimData.providerId) {
        throw new ValidationError('Missing required fields: insuranceId, patientId, providerId');
      }

      // Verify insurance exists
      const insurance = await this.findById(claimData.insuranceId);
      if (!insurance) {
        throw new NotFoundError('Insurance policy not found');
      }

      // Generate claim ID and number
      const claimId = generateUniqueId('CLM');
      const claimNumber = await this.generateClaimNumber();

      // Create claim
      const claim = await this.prisma.insuranceClaim.create({
        data: {
          id: claimId,
          claimId: claimId,
          claimNumber,
          insuranceId: claimData.insuranceId,
          patientId: claimData.patientId,
          providerId: claimData.providerId,
          encounterId: claimData.encounterId,
          invoiceId: claimData.invoiceId,
          status: claimData.status || ClaimStatus.SUBMITTED,
          submittedAt: claimData.submittedAt || new Date(),
          serviceDate: claimData.serviceDate,
          claimAmount: claimData.claimAmount,
          approvedAmount: claimData.approvedAmount,
          paidAmount: claimData.paidAmount || 0,
          deniedAmount: claimData.deniedAmount || 0,
          deductibleAmount: claimData.deductibleAmount || 0,
          coinsuranceAmount: claimData.coinsuranceAmount || 0,
          copayAmount: claimData.copayAmount || 0,
          diagnosisCodes: claimData.diagnosisCodes || [],
          procedureCodes: claimData.procedureCodes || [],
          placeOfService: claimData.placeOfService,
          typeOfService: claimData.typeOfService,
          denialReason: claimData.denialReason,
          notes: claimData.notes,
          metadata: claimData.metadata || {},
        },
        include: {
          insurance: {
            select: {
              insuranceCompany: true,
              policyNumber: true,
              groupNumber: true,
            },
          },
          patient: {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
            },
          },
          provider: {
            select: {
              firstName: true,
              lastName: true,
              title: true,
              npi: true,
            },
          },
          encounter: {
            select: {
              encounterId: true,
              startTime: true,
              type: true,
            },
          },
        },
      });

      logger.info('Insurance claim created successfully', {
        component: 'InsuranceModel',
        claimId: claim.claimId,
        claimNumber: claim.claimNumber,
        insuranceId: claimData.insuranceId,
        claimAmount: claimData.claimAmount,
      });

      return claim;
    } catch (error) {
      logger.error('Error creating insurance claim', {
        component: 'InsuranceModel',
        error: (error as Error).message,
        claimData: {
          insuranceId: claimData.insuranceId,
          patientId: claimData.patientId,
          providerId: claimData.providerId,
        },
      });
      throw error;
    }
  }

  /**
   * Update claim status
   */
  async updateClaimStatus(
    claimId: string,
    status: ClaimStatus,
    approvedAmount?: number,
    paidAmount?: number,
    deniedAmount?: number,
    denialReason?: string,
    notes?: string
  ): Promise<ClaimWithRelations> {
    try {
      const claim = await this.prisma.insuranceClaim.findUnique({
        where: { id: claimId },
      });

      if (!claim) {
        throw new NotFoundError('Claim not found');
      }

      const updateData: any = {
        status,
        updatedAt: new Date(),
      };

      if (approvedAmount !== undefined) {
        updateData.approvedAmount = approvedAmount;
      }

      if (paidAmount !== undefined) {
        updateData.paidAmount = paidAmount;
        updateData.paidAt = new Date();
      }

      if (deniedAmount !== undefined) {
        updateData.deniedAmount = deniedAmount;
      }

      if (denialReason) {
        updateData.denialReason = denialReason;
      }

      if (notes) {
        updateData.notes = notes;
      }

      if (status === ClaimStatus.APPROVED) {
        updateData.approvedAt = new Date();
      } else if (status === ClaimStatus.DENIED) {
        updateData.deniedAt = new Date();
      }

      const updatedClaim = await this.prisma.insuranceClaim.update({
        where: { id: claimId },
        data: updateData,
        include: {
          insurance: {
            select: {
              insuranceCompany: true,
              policyNumber: true,
            },
          },
          patient: {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      logger.info('Claim status updated', {
        component: 'InsuranceModel',
        claimId,
        status,
        approvedAmount,
        paidAmount,
      });

      return updatedClaim;
    } catch (error) {
      logger.error('Error updating claim status', {
        component: 'InsuranceModel',
        error: (error as Error).message,
        claimId,
        status,
      });
      throw error;
    }
  }

  /**
   * Get claims with filters
   */
  async getClaims(
    filters: ClaimSearchFilters = {},
    page: number = 1,
    limit: number = 20,
    sortBy: string = 'submittedAt',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<{ claims: ClaimWithRelations[]; total: number; pages: number }> {
    try {
      const skip = (page - 1) * limit;
      
      // Build where clause
      const where: any = {};

      if (filters.patientId) {
        where.patientId = filters.patientId;
      }

      if (filters.insuranceId) {
        where.insuranceId = filters.insuranceId;
      }

      if (filters.providerId) {
        where.providerId = filters.providerId;
      }

      if (filters.status) {
        where.status = filters.status;
      }

      if (filters.dateFrom || filters.dateTo) {
        where.submittedAt = {};
        if (filters.dateFrom) {
          where.submittedAt.gte = filters.dateFrom;
        }
        if (filters.dateTo) {
          where.submittedAt.lte = filters.dateTo;
        }
      }

      if (filters.amountMin !== undefined || filters.amountMax !== undefined) {
        where.claimAmount = {};
        if (filters.amountMin !== undefined) {
          where.claimAmount.gte = filters.amountMin;
        }
        if (filters.amountMax !== undefined) {
          where.claimAmount.lte = filters.amountMax;
        }
      }

      if (filters.search) {
        where.OR = [
          { claimNumber: { contains: filters.search, mode: 'insensitive' } },
          { claimId: { contains: filters.search, mode: 'insensitive' } },
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

      // Get claims and total count
      const [claims, total] = await Promise.all([
        this.prisma.insuranceClaim.findMany({
          where,
          include: {
            insurance: {
              select: {
                insuranceCompany: true,
                policyNumber: true,
                groupNumber: true,
              },
            },
            patient: {
              select: {
                patientId: true,
                firstName: true,
                lastName: true,
                dateOfBirth: true,
              },
            },
            provider: {
              select: {
                firstName: true,
                lastName: true,
                title: true,
              },
            },
            encounter: {
              select: {
                encounterId: true,
                startTime: true,
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
        this.prisma.insuranceClaim.count({ where }),
      ]);

      const pages = Math.ceil(total / limit);

      return { claims, total, pages };
    } catch (error) {
      logger.error('Error getting claims', {
        component: 'InsuranceModel',
        error: (error as Error).message,
        filters,
      });
      throw new AppError('Failed to get claims', 500);
    }
  }

  /**
   * Get insurance statistics
   */
  async getStats(dateFrom?: Date, dateTo?: Date): Promise<InsuranceStats> {
    try {
      const where: any = {};
      
      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) {
          where.createdAt.gte = dateFrom;
        }
        if (dateTo) {
          where.createdAt.lte = dateTo;
        }
      }

      const claimWhere: any = {};
      if (dateFrom || dateTo) {
        claimWhere.submittedAt = {};
        if (dateFrom) {
          claimWhere.submittedAt.gte = dateFrom;
        }
        if (dateTo) {
          claimWhere.submittedAt.lte = dateTo;
        }
      }

      const [totalPolicies, activePolicies, expiredPolicies, totalClaims, claimsByStatus, claimAmounts, processingTimes] = await Promise.all([
        this.prisma.insurance.count({ where }),
        this.prisma.insurance.count({
          where: {
            ...where,
            isActive: true,
            OR: [
              { expirationDate: null },
              { expirationDate: { gte: new Date() } },
            ],
          },
        }),
        this.prisma.insurance.count({
          where: {
            ...where,
            expirationDate: { lt: new Date() },
          },
        }),
        this.prisma.insuranceClaim.count({ where: claimWhere }),
        this.prisma.insuranceClaim.groupBy({
          by: ['status'],
          where: claimWhere,
          _count: true,
        }),
        this.prisma.insuranceClaim.aggregate({
          where: claimWhere,
          _sum: {
            claimAmount: true,
            paidAmount: true,
            deniedAmount: true,
          },
          _avg: {
            claimAmount: true,
          },
        }),
        this.prisma.insuranceClaim.aggregate({
          where: {
            ...claimWhere,
            status: { in: [ClaimStatus.APPROVED, ClaimStatus.PAID] },
            approvedAt: { not: null },
          },
          _avg: {
            processingTime: true,
          },
        }),
      ]);

      // Calculate pending amount
      const pendingAmount = await this.prisma.insuranceClaim.aggregate({
        where: {
          ...claimWhere,
          status: { in: [ClaimStatus.SUBMITTED, ClaimStatus.PENDING, ClaimStatus.UNDER_REVIEW] },
        },
        _sum: {
          claimAmount: true,
        },
      });

      // Format status stats
      const statusStats = claimsByStatus.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {} as Record<ClaimStatus, number>);

      // Ensure all statuses are represented
      Object.values(ClaimStatus).forEach(status => {
        if (!(status in statusStats)) {
          statusStats[status] = 0;
        }
      });

      // Calculate approval rate
      const approvedClaims = statusStats[ClaimStatus.APPROVED] + statusStats[ClaimStatus.PAID];
      const claimApprovalRate = totalClaims > 0 ? (approvedClaims / totalClaims) * 100 : 0;

      return {
        totalPolicies,
        activePolicies,
        expiredPolicies,
        totalClaims,
        claimsByStatus: statusStats,
        totalClaimAmount: claimAmounts._sum.claimAmount || 0,
        paidClaimAmount: claimAmounts._sum.paidAmount || 0,
        deniedClaimAmount: claimAmounts._sum.deniedAmount || 0,
        pendingClaimAmount: pendingAmount._sum.claimAmount || 0,
        averageClaimAmount: Math.round(claimAmounts._avg.claimAmount || 0),
        claimApprovalRate: Math.round(claimApprovalRate * 10) / 10,
        averageProcessingTime: Math.round(processingTimes._avg.processingTime || 0),
      };
    } catch (error) {
      logger.error('Error getting insurance stats', {
        component: 'InsuranceModel',
        error: (error as Error).message,
      });
      throw new AppError('Failed to get insurance statistics', 500);
    }
  }

  /**
   * Verify eligibility (placeholder for external API integration)
   */
  async verifyEligibility(insuranceId: string, serviceDate?: Date): Promise<EligibilityResponse> {
    try {
      const insurance = await this.findById(insuranceId, true);
      if (!insurance) {
        throw new NotFoundError('Insurance policy not found');
      }

      // This is a placeholder implementation
      // In a real system, this would integrate with insurance APIs
      const response: EligibilityResponse = {
        isEligible: insurance.isActive,
        effectiveDate: insurance.effectiveDate,
        expirationDate: insurance.expirationDate,
        deductible: insurance.deductible,
        deductibleMet: insurance.deductibleMet,
        outOfPocketMax: insurance.outOfPocketMax,
        outOfPocketMet: insurance.outOfPocketMet,
        copay: insurance.copay,
        coinsurance: insurance.coinsurance,
        benefits: [],
        messages: [],
        errors: [],
      };

      // Check if policy is active
      if (!insurance.isActive) {
        response.isEligible = false;
        response.errors?.push('Insurance policy is not active');
      }

      // Check if policy has expired
      if (insurance.expirationDate && insurance.expirationDate < new Date()) {
        response.isEligible = false;
        response.errors?.push('Insurance policy has expired');
      }

      logger.info('Eligibility verification completed', {
        component: 'InsuranceModel',
        insuranceId,
        isEligible: response.isEligible,
      });

      return response;
    } catch (error) {
      logger.error('Error verifying eligibility', {
        component: 'InsuranceModel',
        error: (error as Error).message,
        insuranceId,
      });
      throw error;
    }
  }

  /**
   * Deactivate insurance policy
   */
  async deactivate(id: string, reason?: string): Promise<InsuranceWithRelations> {
    try {
      const insurance = await this.findById(id);
      if (!insurance) {
        throw new NotFoundError('Insurance policy not found');
      }

      const updatedInsurance = await this.prisma.insurance.update({
        where: { id },
        data: {
          isActive: false,
          deactivatedAt: new Date(),
          deactivationReason: reason,
          updatedAt: new Date(),
        },
        include: {
          patient: {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      logger.info('Insurance policy deactivated', {
        component: 'InsuranceModel',
        insuranceId: id,
        reason,
      });

      return updatedInsurance;
    } catch (error) {
      logger.error('Error deactivating insurance policy', {
        component: 'InsuranceModel',
        error: (error as Error).message,
        insuranceId: id,
      });
      throw error;
    }
  }

  /**
   * Generate claim number
   */
  private async generateClaimNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    
    // Get the count of claims for this month
    const startOfMonth = new Date(year, new Date().getMonth(), 1);
    const endOfMonth = new Date(year, new Date().getMonth() + 1, 0);
    
    const count = await this.prisma.insuranceClaim.count({
      where: {
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
    });

    const sequence = String(count + 1).padStart(6, '0');
    return `CLM-${year}${month}-${sequence}`;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default InsuranceModel;