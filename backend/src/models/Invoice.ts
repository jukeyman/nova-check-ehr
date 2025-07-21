/**
 * ============================================================================
 * NOVA CHECK EHR - INVOICE MODEL
 * ============================================================================
 */

import { PrismaClient, Invoice as PrismaInvoice, InvoiceStatus, PaymentStatus, PaymentMethod } from '@prisma/client';
import { logger } from '../utils/logger';
import { AppError, NotFoundError, ValidationError } from '../utils/errors';
import { generateUniqueId } from '../utils/generators';
import { formatCurrency, formatDate, calculateAge } from '../utils/helpers';
import { InvoiceData, PaymentData, InvoiceItemData } from '../types';

// ============================================================================
// INTERFACES
// ============================================================================

export interface InvoiceWithRelations extends PrismaInvoice {
  patient?: any;
  provider?: any;
  encounter?: any;
  items?: any[];
  payments?: any[];
  insurance?: any;
}

export interface InvoiceSearchFilters {
  patientId?: string;
  providerId?: string;
  encounterId?: string;
  status?: InvoiceStatus;
  paymentStatus?: PaymentStatus;
  dateFrom?: Date;
  dateTo?: Date;
  dueDateFrom?: Date;
  dueDateTo?: Date;
  amountMin?: number;
  amountMax?: number;
  search?: string;
  insuranceId?: string;
}

export interface InvoiceStats {
  totalInvoices: number;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  overdueAmount: number;
  invoicesByStatus: Record<InvoiceStatus, number>;
  paymentsByStatus: Record<PaymentStatus, number>;
  averageInvoiceAmount: number;
  averagePaymentTime: number;
  collectionRate: number;
}

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  cptCode?: string;
  icdCode?: string;
  modifiers?: string[];
  isInsuranceCovered: boolean;
  insuranceAmount?: number;
  patientAmount?: number;
}

export interface PaymentRecord {
  id: string;
  amount: number;
  method: PaymentMethod;
  transactionId?: string;
  paidAt: Date;
  paidBy?: string;
  notes?: string;
  isRefund: boolean;
}

export interface InvoiceSummary {
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  insuranceAmount: number;
  patientAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
}

export interface AgingReport {
  current: number; // 0-30 days
  thirtyDays: number; // 31-60 days
  sixtyDays: number; // 61-90 days
  ninetyDays: number; // 91+ days
  total: number;
}

// ============================================================================
// INVOICE MODEL CLASS
// ============================================================================

export class InvoiceModel {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create a new invoice
   */
  async create(invoiceData: InvoiceData): Promise<InvoiceWithRelations> {
    try {
      // Validate required fields
      if (!invoiceData.patientId || !invoiceData.providerId) {
        throw new ValidationError('Missing required fields: patientId, providerId');
      }

      // Verify patient exists
      const patient = await this.prisma.patient.findUnique({
        where: { id: invoiceData.patientId },
        select: {
          id: true,
          patientId: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          address: true,
          insurance: true,
        },
      });

      if (!patient) {
        throw new NotFoundError('Patient not found');
      }

      // Verify provider exists
      const provider = await this.prisma.user.findUnique({
        where: { id: invoiceData.providerId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          title: true,
          npi: true,
        },
      });

      if (!provider) {
        throw new NotFoundError('Provider not found');
      }

      // Calculate invoice totals
      const summary = this.calculateInvoiceSummary(invoiceData.items || [], invoiceData.taxRate, invoiceData.discountAmount);

      // Generate invoice ID and number
      const invoiceId = generateUniqueId('INV');
      const invoiceNumber = await this.generateInvoiceNumber();

      // Create invoice with items
      const invoice = await this.prisma.invoice.create({
        data: {
          id: invoiceId,
          invoiceId: invoiceId,
          invoiceNumber,
          patientId: invoiceData.patientId,
          providerId: invoiceData.providerId,
          encounterId: invoiceData.encounterId,
          status: invoiceData.status || InvoiceStatus.DRAFT,
          paymentStatus: PaymentStatus.PENDING,
          issueDate: invoiceData.issueDate || new Date(),
          dueDate: invoiceData.dueDate || this.calculateDueDate(),
          subtotal: summary.subtotal,
          taxRate: invoiceData.taxRate || 0,
          taxAmount: summary.taxAmount,
          discountAmount: summary.discountAmount,
          totalAmount: summary.totalAmount,
          paidAmount: 0,
          balanceAmount: summary.totalAmount,
          notes: invoiceData.notes,
          metadata: invoiceData.metadata || {},
          items: {
            create: (invoiceData.items || []).map(item => ({
              id: generateUniqueId('ITM'),
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.quantity * item.unitPrice,
              cptCode: item.cptCode,
              icdCode: item.icdCode,
              modifiers: item.modifiers || [],
              isInsuranceCovered: item.isInsuranceCovered || false,
              insuranceAmount: item.insuranceAmount || 0,
              patientAmount: item.patientAmount || (item.quantity * item.unitPrice),
            })),
          },
        },
        include: {
          patient: {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              address: true,
              insurance: true,
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
              chiefComplaint: true,
            },
          },
          items: true,
          payments: true,
        },
      });

      logger.info('Invoice created successfully', {
        component: 'InvoiceModel',
        invoiceId: invoice.invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        patientId: invoiceData.patientId,
        totalAmount: summary.totalAmount,
      });

      return invoice;
    } catch (error) {
      logger.error('Error creating invoice', {
        component: 'InvoiceModel',
        error: (error as Error).message,
        invoiceData: {
          patientId: invoiceData.patientId,
          providerId: invoiceData.providerId,
          encounterId: invoiceData.encounterId,
        },
      });
      throw error;
    }
  }

  /**
   * Find invoice by ID
   */
  async findById(id: string, includeRelations: boolean = false): Promise<InvoiceWithRelations | null> {
    try {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id },
        include: includeRelations ? {
          patient: {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              address: true,
              insurance: true,
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
              chiefComplaint: true,
            },
          },
          items: {
            orderBy: {
              createdAt: 'asc',
            },
          },
          payments: {
            orderBy: {
              paidAt: 'desc',
            },
          },
        } : undefined,
      });

      return invoice;
    } catch (error) {
      logger.error('Error finding invoice by ID', {
        component: 'InvoiceModel',
        error: (error as Error).message,
        invoiceId: id,
      });
      throw new AppError('Failed to find invoice', 500);
    }
  }

  /**
   * Find invoice by invoice number
   */
  async findByInvoiceNumber(invoiceNumber: string): Promise<InvoiceWithRelations | null> {
    try {
      const invoice = await this.prisma.invoice.findUnique({
        where: { invoiceNumber },
        include: {
          patient: {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          provider: {
            select: {
              firstName: true,
              lastName: true,
              title: true,
            },
          },
          items: true,
          payments: true,
        },
      });

      return invoice;
    } catch (error) {
      logger.error('Error finding invoice by number', {
        component: 'InvoiceModel',
        error: (error as Error).message,
        invoiceNumber,
      });
      throw new AppError('Failed to find invoice', 500);
    }
  }

  /**
   * Update invoice
   */
  async update(id: string, updateData: Partial<InvoiceData>): Promise<InvoiceWithRelations> {
    try {
      const existingInvoice = await this.findById(id, true);
      if (!existingInvoice) {
        throw new NotFoundError('Invoice not found');
      }

      // Prevent updates to paid invoices
      if (existingInvoice.paymentStatus === PaymentStatus.PAID && updateData.items) {
        throw new ValidationError('Cannot modify items of a paid invoice');
      }

      // Recalculate totals if items are updated
      let summary = {
        subtotal: existingInvoice.subtotal,
        taxAmount: existingInvoice.taxAmount,
        discountAmount: existingInvoice.discountAmount || 0,
        totalAmount: existingInvoice.totalAmount,
      };

      if (updateData.items) {
        summary = this.calculateInvoiceSummary(
          updateData.items,
          updateData.taxRate || existingInvoice.taxRate || 0,
          updateData.discountAmount || existingInvoice.discountAmount || 0
        );
      }

      const updatedInvoice = await this.prisma.invoice.update({
        where: { id },
        data: {
          status: updateData.status,
          issueDate: updateData.issueDate,
          dueDate: updateData.dueDate,
          subtotal: summary.subtotal,
          taxRate: updateData.taxRate,
          taxAmount: summary.taxAmount,
          discountAmount: summary.discountAmount,
          totalAmount: summary.totalAmount,
          balanceAmount: summary.totalAmount - existingInvoice.paidAmount,
          notes: updateData.notes,
          metadata: updateData.metadata,
          updatedAt: new Date(),
          // Update items if provided
          ...(updateData.items && {
            items: {
              deleteMany: {},
              create: updateData.items.map(item => ({
                id: generateUniqueId('ITM'),
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.quantity * item.unitPrice,
                cptCode: item.cptCode,
                icdCode: item.icdCode,
                modifiers: item.modifiers || [],
                isInsuranceCovered: item.isInsuranceCovered || false,
                insuranceAmount: item.insuranceAmount || 0,
                patientAmount: item.patientAmount || (item.quantity * item.unitPrice),
              })),
            },
          }),
        },
        include: {
          patient: {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          provider: {
            select: {
              firstName: true,
              lastName: true,
              title: true,
            },
          },
          items: true,
          payments: true,
        },
      });

      logger.info('Invoice updated successfully', {
        component: 'InvoiceModel',
        invoiceId: id,
        updatedFields: Object.keys(updateData),
      });

      return updatedInvoice;
    } catch (error) {
      logger.error('Error updating invoice', {
        component: 'InvoiceModel',
        error: (error as Error).message,
        invoiceId: id,
      });
      throw error;
    }
  }

  /**
   * Add payment to invoice
   */
  async addPayment(invoiceId: string, paymentData: PaymentData): Promise<InvoiceWithRelations> {
    try {
      const invoice = await this.findById(invoiceId, true);
      if (!invoice) {
        throw new NotFoundError('Invoice not found');
      }

      // Validate payment amount
      if (paymentData.amount <= 0) {
        throw new ValidationError('Payment amount must be greater than 0');
      }

      if (paymentData.amount > invoice.balanceAmount) {
        throw new ValidationError('Payment amount cannot exceed balance amount');
      }

      // Create payment record
      const payment = await this.prisma.payment.create({
        data: {
          id: generateUniqueId('PAY'),
          invoiceId,
          amount: paymentData.amount,
          method: paymentData.method,
          transactionId: paymentData.transactionId,
          paidAt: paymentData.paidAt || new Date(),
          paidBy: paymentData.paidBy,
          notes: paymentData.notes,
          isRefund: paymentData.isRefund || false,
          metadata: paymentData.metadata || {},
        },
      });

      // Update invoice amounts and status
      const newPaidAmount = invoice.paidAmount + paymentData.amount;
      const newBalanceAmount = invoice.totalAmount - newPaidAmount;
      
      let newPaymentStatus = PaymentStatus.PARTIAL;
      if (newBalanceAmount <= 0) {
        newPaymentStatus = PaymentStatus.PAID;
      } else if (newPaidAmount === 0) {
        newPaymentStatus = PaymentStatus.PENDING;
      }

      const updatedInvoice = await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          paidAmount: newPaidAmount,
          balanceAmount: newBalanceAmount,
          paymentStatus: newPaymentStatus,
          paidAt: newPaymentStatus === PaymentStatus.PAID ? new Date() : null,
          updatedAt: new Date(),
        },
        include: {
          patient: {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          provider: {
            select: {
              firstName: true,
              lastName: true,
              title: true,
            },
          },
          items: true,
          payments: {
            orderBy: {
              paidAt: 'desc',
            },
          },
        },
      });

      logger.info('Payment added to invoice', {
        component: 'InvoiceModel',
        invoiceId,
        paymentAmount: paymentData.amount,
        paymentMethod: paymentData.method,
        newPaymentStatus,
        newBalanceAmount,
      });

      return updatedInvoice;
    } catch (error) {
      logger.error('Error adding payment to invoice', {
        component: 'InvoiceModel',
        error: (error as Error).message,
        invoiceId,
        paymentAmount: paymentData.amount,
      });
      throw error;
    }
  }

  /**
   * Get invoices with filters and pagination
   */
  async findMany(
    filters: InvoiceSearchFilters = {},
    page: number = 1,
    limit: number = 20,
    sortBy: string = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<{ invoices: InvoiceWithRelations[]; total: number; pages: number }> {
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

      if (filters.encounterId) {
        where.encounterId = filters.encounterId;
      }

      if (filters.status) {
        where.status = filters.status;
      }

      if (filters.paymentStatus) {
        where.paymentStatus = filters.paymentStatus;
      }

      if (filters.dateFrom || filters.dateTo) {
        where.issueDate = {};
        if (filters.dateFrom) {
          where.issueDate.gte = filters.dateFrom;
        }
        if (filters.dateTo) {
          where.issueDate.lte = filters.dateTo;
        }
      }

      if (filters.dueDateFrom || filters.dueDateTo) {
        where.dueDate = {};
        if (filters.dueDateFrom) {
          where.dueDate.gte = filters.dueDateFrom;
        }
        if (filters.dueDateTo) {
          where.dueDate.lte = filters.dueDateTo;
        }
      }

      if (filters.amountMin !== undefined || filters.amountMax !== undefined) {
        where.totalAmount = {};
        if (filters.amountMin !== undefined) {
          where.totalAmount.gte = filters.amountMin;
        }
        if (filters.amountMax !== undefined) {
          where.totalAmount.lte = filters.amountMax;
        }
      }

      if (filters.search) {
        where.OR = [
          { invoiceNumber: { contains: filters.search, mode: 'insensitive' } },
          { invoiceId: { contains: filters.search, mode: 'insensitive' } },
          { notes: { contains: filters.search, mode: 'insensitive' } },
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

      // Get invoices and total count
      const [invoices, total] = await Promise.all([
        this.prisma.invoice.findMany({
          where,
          include: {
            patient: {
              select: {
                patientId: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
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
            items: {
              select: {
                description: true,
                quantity: true,
                unitPrice: true,
                totalPrice: true,
                cptCode: true,
              },
            },
            payments: {
              select: {
                amount: true,
                method: true,
                paidAt: true,
              },
              orderBy: {
                paidAt: 'desc',
              },
              take: 3, // Only show recent payments
            },
          },
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        this.prisma.invoice.count({ where }),
      ]);

      const pages = Math.ceil(total / limit);

      return { invoices, total, pages };
    } catch (error) {
      logger.error('Error finding invoices', {
        component: 'InvoiceModel',
        error: (error as Error).message,
        filters,
      });
      throw new AppError('Failed to find invoices', 500);
    }
  }

  /**
   * Get overdue invoices
   */
  async getOverdueInvoices(limit: number = 50): Promise<InvoiceWithRelations[]> {
    try {
      const today = new Date();
      
      const invoices = await this.prisma.invoice.findMany({
        where: {
          dueDate: {
            lt: today,
          },
          paymentStatus: {
            in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL],
          },
          status: {
            not: InvoiceStatus.CANCELLED,
          },
        },
        include: {
          patient: {
            select: {
              patientId: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          provider: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: {
          dueDate: 'asc',
        },
        take: limit,
      });

      return invoices;
    } catch (error) {
      logger.error('Error getting overdue invoices', {
        component: 'InvoiceModel',
        error: (error as Error).message,
      });
      throw new AppError('Failed to get overdue invoices', 500);
    }
  }

  /**
   * Get invoice statistics
   */
  async getStats(dateFrom?: Date, dateTo?: Date): Promise<InvoiceStats> {
    try {
      const where: any = {};
      
      if (dateFrom || dateTo) {
        where.issueDate = {};
        if (dateFrom) {
          where.issueDate.gte = dateFrom;
        }
        if (dateTo) {
          where.issueDate.lte = dateTo;
        }
      }

      const [totalInvoices, invoicesByStatus, paymentsByStatus, amountStats, paymentTimeStats] = await Promise.all([
        this.prisma.invoice.count({ where }),
        this.prisma.invoice.groupBy({
          by: ['status'],
          where,
          _count: true,
        }),
        this.prisma.invoice.groupBy({
          by: ['paymentStatus'],
          where,
          _count: true,
        }),
        this.prisma.invoice.aggregate({
          where,
          _sum: {
            totalAmount: true,
            paidAmount: true,
            balanceAmount: true,
          },
          _avg: {
            totalAmount: true,
          },
        }),
        this.prisma.invoice.aggregate({
          where: {
            ...where,
            paymentStatus: PaymentStatus.PAID,
            paidAt: { not: null },
          },
          _avg: {
            paymentTime: true,
          },
        }),
      ]);

      // Calculate overdue amount
      const overdueAmount = await this.prisma.invoice.aggregate({
        where: {
          ...where,
          dueDate: { lt: new Date() },
          paymentStatus: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL] },
        },
        _sum: {
          balanceAmount: true,
        },
      });

      // Format status stats
      const statusStats = invoicesByStatus.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {} as Record<InvoiceStatus, number>);

      // Ensure all statuses are represented
      Object.values(InvoiceStatus).forEach(status => {
        if (!(status in statusStats)) {
          statusStats[status] = 0;
        }
      });

      // Format payment status stats
      const paymentStatusStats = paymentsByStatus.reduce((acc, item) => {
        acc[item.paymentStatus] = item._count;
        return acc;
      }, {} as Record<PaymentStatus, number>);

      // Ensure all payment statuses are represented
      Object.values(PaymentStatus).forEach(status => {
        if (!(status in paymentStatusStats)) {
          paymentStatusStats[status] = 0;
        }
      });

      // Calculate collection rate
      const totalAmount = amountStats._sum.totalAmount || 0;
      const paidAmount = amountStats._sum.paidAmount || 0;
      const collectionRate = totalAmount > 0 ? (paidAmount / totalAmount) * 100 : 0;

      return {
        totalInvoices,
        totalAmount,
        paidAmount,
        pendingAmount: amountStats._sum.balanceAmount || 0,
        overdueAmount: overdueAmount._sum.balanceAmount || 0,
        invoicesByStatus: statusStats,
        paymentsByStatus: paymentStatusStats,
        averageInvoiceAmount: Math.round(amountStats._avg.totalAmount || 0),
        averagePaymentTime: Math.round(paymentTimeStats._avg.paymentTime || 0),
        collectionRate: Math.round(collectionRate * 10) / 10,
      };
    } catch (error) {
      logger.error('Error getting invoice stats', {
        component: 'InvoiceModel',
        error: (error as Error).message,
      });
      throw new AppError('Failed to get invoice statistics', 500);
    }
  }

  /**
   * Get aging report
   */
  async getAgingReport(): Promise<AgingReport> {
    try {
      const today = new Date();
      const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sixtyDaysAgo = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000);
      const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);

      const [current, thirtyDays, sixtyDays, ninetyDays] = await Promise.all([
        // Current (0-30 days)
        this.prisma.invoice.aggregate({
          where: {
            dueDate: { gte: thirtyDaysAgo },
            paymentStatus: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL] },
          },
          _sum: { balanceAmount: true },
        }),
        // 31-60 days
        this.prisma.invoice.aggregate({
          where: {
            dueDate: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
            paymentStatus: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL] },
          },
          _sum: { balanceAmount: true },
        }),
        // 61-90 days
        this.prisma.invoice.aggregate({
          where: {
            dueDate: { gte: ninetyDaysAgo, lt: sixtyDaysAgo },
            paymentStatus: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL] },
          },
          _sum: { balanceAmount: true },
        }),
        // 91+ days
        this.prisma.invoice.aggregate({
          where: {
            dueDate: { lt: ninetyDaysAgo },
            paymentStatus: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL] },
          },
          _sum: { balanceAmount: true },
        }),
      ]);

      const currentAmount = current._sum.balanceAmount || 0;
      const thirtyDaysAmount = thirtyDays._sum.balanceAmount || 0;
      const sixtyDaysAmount = sixtyDays._sum.balanceAmount || 0;
      const ninetyDaysAmount = ninetyDays._sum.balanceAmount || 0;

      return {
        current: currentAmount,
        thirtyDays: thirtyDaysAmount,
        sixtyDays: sixtyDaysAmount,
        ninetyDays: ninetyDaysAmount,
        total: currentAmount + thirtyDaysAmount + sixtyDaysAmount + ninetyDaysAmount,
      };
    } catch (error) {
      logger.error('Error getting aging report', {
        component: 'InvoiceModel',
        error: (error as Error).message,
      });
      throw new AppError('Failed to get aging report', 500);
    }
  }

  /**
   * Cancel invoice
   */
  async cancel(id: string, reason?: string): Promise<InvoiceWithRelations> {
    try {
      const invoice = await this.findById(id);
      if (!invoice) {
        throw new NotFoundError('Invoice not found');
      }

      if (invoice.paymentStatus === PaymentStatus.PAID) {
        throw new ValidationError('Cannot cancel a paid invoice');
      }

      const updatedInvoice = await this.prisma.invoice.update({
        where: { id },
        data: {
          status: InvoiceStatus.CANCELLED,
          paymentStatus: PaymentStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: reason,
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
          items: true,
          payments: true,
        },
      });

      logger.info('Invoice cancelled', {
        component: 'InvoiceModel',
        invoiceId: id,
        reason,
      });

      return updatedInvoice;
    } catch (error) {
      logger.error('Error cancelling invoice', {
        component: 'InvoiceModel',
        error: (error as Error).message,
        invoiceId: id,
      });
      throw error;
    }
  }

  /**
   * Generate invoice number
   */
  private async generateInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    
    // Get the count of invoices for this month
    const startOfMonth = new Date(year, new Date().getMonth(), 1);
    const endOfMonth = new Date(year, new Date().getMonth() + 1, 0);
    
    const count = await this.prisma.invoice.count({
      where: {
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
    });

    const sequence = String(count + 1).padStart(4, '0');
    return `INV-${year}${month}-${sequence}`;
  }

  /**
   * Calculate due date (default 30 days from issue date)
   */
  private calculateDueDate(issueDate?: Date, daysToAdd: number = 30): Date {
    const date = issueDate || new Date();
    const dueDate = new Date(date);
    dueDate.setDate(dueDate.getDate() + daysToAdd);
    return dueDate;
  }

  /**
   * Calculate invoice summary
   */
  private calculateInvoiceSummary(
    items: InvoiceItemData[],
    taxRate: number = 0,
    discountAmount: number = 0
  ): InvoiceSummary {
    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const taxAmount = subtotal * (taxRate / 100);
    const totalAmount = subtotal + taxAmount - discountAmount;
    
    const insuranceAmount = items.reduce((sum, item) => sum + (item.insuranceAmount || 0), 0);
    const patientAmount = totalAmount - insuranceAmount;

    return {
      subtotal,
      taxAmount,
      discountAmount,
      insuranceAmount,
      patientAmount,
      totalAmount,
      paidAmount: 0,
      balanceAmount: totalAmount,
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default InvoiceModel;