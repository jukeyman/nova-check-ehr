/**
 * ============================================================================
 * NOVA CHECK EHR - INVOICE ROUTES
 * ============================================================================
 * 
 * RESTful API routes for invoice and billing management.
 * Handles invoice creation, payments, and financial reporting.
 */

import { Router, Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { InvoiceModel, createApiResponse, createErrorResponse, validatePagination } from '../models';
import { authenticateToken, requireRole } from '../middleware/auth';
import { createAuditMiddleware } from '../models/Audit';
import { logger } from '../utils/logger';
import { PrismaClient } from '@prisma/client';

// ============================================================================
// ROUTER SETUP
// ============================================================================

const router = Router();
const prisma = new PrismaClient();
const invoiceModel = new InvoiceModel(prisma);
const auditMiddleware = createAuditMiddleware(prisma);

// ============================================================================
// VALIDATION RULES
// ============================================================================

const createInvoiceValidation = [
  body('patientId').isUUID(),
  body('appointmentId').optional().isUUID(),
  body('items').isArray({ min: 1 }),
  body('items.*.description').notEmpty().trim().isLength({ min: 1, max: 500 }),
  body('items.*.quantity').isInt({ min: 1, max: 1000 }),
  body('items.*.unitPrice').isFloat({ min: 0, max: 100000 }),
  body('items.*.total').isFloat({ min: 0, max: 100000 }),
  body('items.*.cptCode').optional().trim().isLength({ max: 20 }),
  body('items.*.category').optional().isIn(['CONSULTATION', 'PROCEDURE', 'MEDICATION', 'LAB', 'IMAGING', 'OTHER']),
  body('subtotal').isFloat({ min: 0, max: 1000000 }),
  body('taxAmount').optional().isFloat({ min: 0, max: 100000 }),
  body('discountAmount').optional().isFloat({ min: 0, max: 100000 }),
  body('totalAmount').isFloat({ min: 0, max: 1000000 }),
  body('dueDate').optional().isISO8601().toDate(),
  body('notes').optional().trim().isLength({ max: 1000 }),
  body('paymentTerms').optional().isIn(['NET_15', 'NET_30', 'NET_60', 'DUE_ON_RECEIPT']),
];

const updateInvoiceValidation = [
  param('id').isUUID(),
  body('items').optional().isArray({ min: 1 }),
  body('items.*.description').optional().notEmpty().trim().isLength({ min: 1, max: 500 }),
  body('items.*.quantity').optional().isInt({ min: 1, max: 1000 }),
  body('items.*.unitPrice').optional().isFloat({ min: 0, max: 100000 }),
  body('items.*.total').optional().isFloat({ min: 0, max: 100000 }),
  body('items.*.cptCode').optional().trim().isLength({ max: 20 }),
  body('items.*.category').optional().isIn(['CONSULTATION', 'PROCEDURE', 'MEDICATION', 'LAB', 'IMAGING', 'OTHER']),
  body('subtotal').optional().isFloat({ min: 0, max: 1000000 }),
  body('taxAmount').optional().isFloat({ min: 0, max: 100000 }),
  body('discountAmount').optional().isFloat({ min: 0, max: 100000 }),
  body('totalAmount').optional().isFloat({ min: 0, max: 1000000 }),
  body('dueDate').optional().isISO8601().toDate(),
  body('notes').optional().trim().isLength({ max: 1000 }),
  body('paymentTerms').optional().isIn(['NET_15', 'NET_30', 'NET_60', 'DUE_ON_RECEIPT']),
];

const addPaymentValidation = [
  param('id').isUUID(),
  body('amount').isFloat({ min: 0.01, max: 1000000 }),
  body('method').isIn(['CASH', 'CHECK', 'CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 'INSURANCE']),
  body('reference').optional().trim().isLength({ max: 100 }),
  body('notes').optional().trim().isLength({ max: 500 }),
  body('paidDate').optional().isISO8601().toDate(),
];

const searchValidation = [
  query('search').optional().trim().isLength({ min: 1, max: 200 }),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('sortBy').optional().isIn(['invoiceNumber', 'issueDate', 'dueDate', 'totalAmount', 'status']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
  query('status').optional().isIn(['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED']),
  query('patientId').optional().isUUID(),
  query('startDate').optional().isISO8601().toDate(),
  query('endDate').optional().isISO8601().toDate(),
  query('minAmount').optional().isFloat({ min: 0 }),
  query('maxAmount').optional().isFloat({ min: 0 }),
  query('paymentTerms').optional().isIn(['NET_15', 'NET_30', 'NET_60', 'DUE_ON_RECEIPT']),
];

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Validate request and handle errors
 */
const handleValidation = (req: Request, res: Response, next: any) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json(
      createErrorResponse('Validation failed', errors.array().map(e => e.msg).join(', '))
    );
  }
  next();
};

/**
 * Check if invoice exists and user has access
 */
const checkInvoiceAccess = async (req: Request, res: Response, next: any) => {
  try {
    const { id } = req.params;
    const invoice = await invoiceModel.findById(id);
    
    if (!invoice) {
      return res.status(404).json(
        createErrorResponse('Invoice not found')
      );
    }

    // Store invoice in request for use in route handlers
    (req as any).invoice = invoice;
    next();
  } catch (error) {
    logger.error('Error checking invoice access:', error);
    res.status(500).json(
      createErrorResponse('Internal server error')
    );
  }
};

// ============================================================================
// INVOICE ROUTES
// ============================================================================

/**
 * @route   POST /api/invoices
 * @desc    Create a new invoice
 * @access  Private (Admin, Provider, Staff)
 */
router.post('/',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  createInvoiceValidation,
  handleValidation,
  auditMiddleware('INVOICE_CREATE'),
  async (req: Request, res: Response) => {
    try {
      const invoiceData = req.body;
      const createdBy = (req as any).user.id;

      const invoice = await invoiceModel.create({
        ...invoiceData,
        createdBy,
      });

      logger.info(`Invoice created: ${invoice.id}`, {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        patientId: invoice.patientId,
        totalAmount: invoice.totalAmount,
        createdBy,
      });

      res.status(201).json(
        createApiResponse(invoice, true, 'Invoice created successfully')
      );
    } catch (error) {
      logger.error('Error creating invoice:', error);
      res.status(500).json(
        createErrorResponse('Failed to create invoice')
      );
    }
  }
);

/**
 * @route   GET /api/invoices
 * @desc    Get invoices with search and pagination
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  searchValidation,
  handleValidation,
  async (req: Request, res: Response) => {
    try {
      const pagination = validatePagination({
        page: req.query.page as any,
        limit: req.query.limit as any,
        sortBy: req.query.sortBy as string,
        sortOrder: req.query.sortOrder as 'asc' | 'desc',
      });

      const filters = {
        search: req.query.search as string,
        status: req.query.status as any,
        patientId: req.query.patientId as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        minAmount: req.query.minAmount as any,
        maxAmount: req.query.maxAmount as any,
        paymentTerms: req.query.paymentTerms as any,
      };

      // Remove undefined values
      Object.keys(filters).forEach(key => {
        if (filters[key as keyof typeof filters] === undefined) {
          delete filters[key as keyof typeof filters];
        }
      });

      const result = await invoiceModel.findMany(filters, pagination);

      res.json(
        createApiResponse(result.data, true, undefined, result.pagination)
      );
    } catch (error) {
      logger.error('Error fetching invoices:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch invoices')
      );
    }
  }
);

/**
 * @route   GET /api/invoices/overdue
 * @desc    Get overdue invoices
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/overdue',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  async (req: Request, res: Response) => {
    try {
      const overdueInvoices = await invoiceModel.getOverdueInvoices();

      res.json(
        createApiResponse(overdueInvoices, true, 'Overdue invoices retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching overdue invoices:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch overdue invoices')
      );
    }
  }
);

/**
 * @route   GET /api/invoices/stats
 * @desc    Get invoice statistics
 * @access  Private (Admin, Provider)
 */
router.get('/stats',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  async (req: Request, res: Response) => {
    try {
      const stats = await invoiceModel.getStats();

      res.json(
        createApiResponse(stats, true, 'Invoice statistics retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching invoice stats:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch invoice statistics')
      );
    }
  }
);

/**
 * @route   GET /api/invoices/aging-report
 * @desc    Get aging report
 * @access  Private (Admin, Provider)
 */
router.get('/aging-report',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  async (req: Request, res: Response) => {
    try {
      const agingReport = await invoiceModel.getAgingReport();

      res.json(
        createApiResponse(agingReport, true, 'Aging report retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching aging report:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch aging report')
      );
    }
  }
);

/**
 * @route   GET /api/invoices/:id
 * @desc    Get invoice by ID
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/:id',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [param('id').isUUID()],
  handleValidation,
  checkInvoiceAccess,
  auditMiddleware('INVOICE_VIEW'),
  async (req: Request, res: Response) => {
    try {
      const invoice = (req as any).invoice;

      res.json(
        createApiResponse(invoice, true, 'Invoice retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching invoice:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch invoice')
      );
    }
  }
);

/**
 * @route   GET /api/invoices/number/:invoiceNumber
 * @desc    Get invoice by invoice number
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/number/:invoiceNumber',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [param('invoiceNumber').notEmpty().trim()],
  handleValidation,
  auditMiddleware('INVOICE_VIEW'),
  async (req: Request, res: Response) => {
    try {
      const { invoiceNumber } = req.params;
      const invoice = await invoiceModel.findByInvoiceNumber(invoiceNumber);

      if (!invoice) {
        return res.status(404).json(
          createErrorResponse('Invoice not found')
        );
      }

      res.json(
        createApiResponse(invoice, true, 'Invoice retrieved successfully')
      );
    } catch (error) {
      logger.error('Error fetching invoice by number:', error);
      res.status(500).json(
        createErrorResponse('Failed to fetch invoice')
      );
    }
  }
);

/**
 * @route   PUT /api/invoices/:id
 * @desc    Update invoice
 * @access  Private (Admin, Provider, Staff)
 */
router.put('/:id',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  updateInvoiceValidation,
  handleValidation,
  checkInvoiceAccess,
  auditMiddleware('INVOICE_UPDATE'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const updatedBy = (req as any).user.id;

      const currentInvoice = (req as any).invoice;
      
      // Check if invoice can be updated
      if (currentInvoice.status === 'PAID' || currentInvoice.status === 'CANCELLED') {
        return res.status(400).json(
          createErrorResponse('Cannot update paid or cancelled invoice')
        );
      }

      const invoice = await invoiceModel.update(id, {
        ...updateData,
        updatedBy,
      });

      logger.info(`Invoice updated: ${id}`, {
        invoiceId: id,
        invoiceNumber: invoice.invoiceNumber,
        updatedBy,
      });

      res.json(
        createApiResponse(invoice, true, 'Invoice updated successfully')
      );
    } catch (error) {
      logger.error('Error updating invoice:', error);
      res.status(500).json(
        createErrorResponse('Failed to update invoice')
      );
    }
  }
);

/**
 * @route   POST /api/invoices/:id/payments
 * @desc    Add payment to invoice
 * @access  Private (Admin, Provider, Staff)
 */
router.post('/:id/payments',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  addPaymentValidation,
  handleValidation,
  checkInvoiceAccess,
  auditMiddleware('INVOICE_PAYMENT_ADD'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const paymentData = req.body;
      const recordedBy = (req as any).user.id;

      const currentInvoice = (req as any).invoice;
      
      // Check if invoice can receive payments
      if (currentInvoice.status === 'CANCELLED') {
        return res.status(400).json(
          createErrorResponse('Cannot add payment to cancelled invoice')
        );
      }

      if (currentInvoice.status === 'PAID') {
        return res.status(400).json(
          createErrorResponse('Invoice is already fully paid')
        );
      }

      const invoice = await invoiceModel.addPayment(id, {
        ...paymentData,
        recordedBy,
      });

      logger.info(`Payment added to invoice: ${id}`, {
        invoiceId: id,
        invoiceNumber: invoice.invoiceNumber,
        paymentAmount: paymentData.amount,
        paymentMethod: paymentData.method,
        recordedBy,
      });

      res.status(201).json(
        createApiResponse(invoice, true, 'Payment added successfully')
      );
    } catch (error) {
      logger.error('Error adding payment:', error);
      res.status(500).json(
        createErrorResponse('Failed to add payment')
      );
    }
  }
);

/**
 * @route   PATCH /api/invoices/:id/cancel
 * @desc    Cancel invoice
 * @access  Private (Admin, Provider)
 */
router.patch('/:id/cancel',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER']),
  [
    param('id').isUUID(),
    body('reason').optional().trim().isLength({ max: 500 }),
  ],
  handleValidation,
  checkInvoiceAccess,
  auditMiddleware('INVOICE_CANCEL'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const cancelledBy = (req as any).user.id;

      const currentInvoice = (req as any).invoice;
      
      // Check if invoice can be cancelled
      if (currentInvoice.status === 'PAID') {
        return res.status(400).json(
          createErrorResponse('Cannot cancel paid invoice')
        );
      }

      if (currentInvoice.status === 'CANCELLED') {
        return res.status(400).json(
          createErrorResponse('Invoice is already cancelled')
        );
      }

      const invoice = await invoiceModel.cancel(id, cancelledBy, reason);

      logger.info(`Invoice cancelled: ${id}`, {
        invoiceId: id,
        invoiceNumber: invoice.invoiceNumber,
        reason,
        cancelledBy,
      });

      res.json(
        createApiResponse(invoice, true, 'Invoice cancelled successfully')
      );
    } catch (error) {
      logger.error('Error cancelling invoice:', error);
      res.status(500).json(
        createErrorResponse('Failed to cancel invoice')
      );
    }
  }
);

/**
 * @route   GET /api/invoices/:id/pdf
 * @desc    Generate invoice PDF
 * @access  Private (Admin, Provider, Staff)
 */
router.get('/:id/pdf',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [param('id').isUUID()],
  handleValidation,
  checkInvoiceAccess,
  auditMiddleware('INVOICE_PDF_GENERATE'),
  async (req: Request, res: Response) => {
    try {
      const invoice = (req as any).invoice;

      // TODO: Implement PDF generation
      // This would typically use a library like puppeteer, jsPDF, or PDFKit
      // For now, return the invoice data with a note about PDF generation
      
      logger.info(`Invoice PDF requested: ${invoice.id}`, {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        requestedBy: (req as any).user.id,
      });

      res.json(
        createApiResponse(
          { 
            message: 'PDF generation not yet implemented',
            invoice: invoice,
            downloadUrl: `/api/invoices/${invoice.id}/pdf` // Placeholder
          }, 
          true, 
          'Invoice PDF generation requested'
        )
      );
    } catch (error) {
      logger.error('Error generating invoice PDF:', error);
      res.status(500).json(
        createErrorResponse('Failed to generate invoice PDF')
      );
    }
  }
);

/**
 * @route   POST /api/invoices/:id/send
 * @desc    Send invoice to patient
 * @access  Private (Admin, Provider, Staff)
 */
router.post('/:id/send',
  authenticateToken,
  requireRole(['ADMIN', 'PROVIDER', 'STAFF']),
  [
    param('id').isUUID(),
    body('method').isIn(['EMAIL', 'SMS', 'MAIL']),
    body('message').optional().trim().isLength({ max: 1000 }),
  ],
  handleValidation,
  checkInvoiceAccess,
  auditMiddleware('INVOICE_SEND'),
  async (req: Request, res: Response) => {
    try {
      const invoice = (req as any).invoice;
      const { method, message } = req.body;
      const sentBy = (req as any).user.id;

      // TODO: Implement invoice sending logic
      // This would integrate with email/SMS services
      
      logger.info(`Invoice sent: ${invoice.id}`, {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        method,
        sentBy,
      });

      res.json(
        createApiResponse(
          { 
            message: 'Invoice sending not yet implemented',
            invoice: invoice,
            method,
            customMessage: message
          }, 
          true, 
          `Invoice send via ${method} requested`
        )
      );
    } catch (error) {
      logger.error('Error sending invoice:', error);
      res.status(500).json(
        createErrorResponse('Failed to send invoice')
      );
    }
  }
);

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Global error handler for invoice routes
 */
router.use((error: any, req: Request, res: Response, next: any) => {
  logger.error('Invoice route error:', error);
  
  if (error.code === 'P2002') {
    return res.status(409).json(
      createErrorResponse('Invoice with this information already exists')
    );
  }
  
  if (error.code === 'P2025') {
    return res.status(404).json(
      createErrorResponse('Invoice not found')
    );
  }
  
  res.status(500).json(
    createErrorResponse('Internal server error')
  );
});

// ============================================================================
// EXPORTS
// ============================================================================

export default router;