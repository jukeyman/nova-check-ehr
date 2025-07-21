import { apiService, ApiResponse, PaginationParams } from './api';
import { Invoice, InvoiceCreateData, InvoiceUpdateData, InvoiceFilters } from '@/types/billing';
import { Payment, PaymentCreateData, PaymentMethod } from '@/types/billing';
import { Insurance, InsuranceClaim } from '@/types/billing';

// ============================================================================
// TYPES
// ============================================================================

export interface BillingListResponse {
  invoices: Invoice[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaymentListResponse {
  payments: Payment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface BillingStatsResponse {
  totalRevenue: number;
  monthlyRevenue: number;
  outstandingBalance: number;
  paidInvoices: number;
  pendingInvoices: number;
  overdueInvoices: number;
  averagePaymentTime: number;
  collectionRate: number;
  revenueByMonth: {
    month: string;
    revenue: number;
    invoices: number;
    payments: number;
  }[];
  paymentMethodDistribution: Record<string, number>;
  insuranceClaimsStats: {
    submitted: number;
    approved: number;
    denied: number;
    pending: number;
    totalAmount: number;
    approvedAmount: number;
  };
}

export interface BillingSearchParams extends PaginationParams {
  patientId?: string;
  providerId?: string;
  status?: string[];
  startDate?: string;
  endDate?: string;
  minAmount?: number;
  maxAmount?: number;
  paymentStatus?: string;
  insuranceProvider?: string;
}

export interface PaymentSearchParams extends PaginationParams {
  patientId?: string;
  invoiceId?: string;
  method?: string[];
  status?: string[];
  startDate?: string;
  endDate?: string;
  minAmount?: number;
  maxAmount?: number;
}

export interface InvoiceItemData {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  cptCode?: string;
  diagnosisCode?: string;
  modifiers?: string[];
  serviceDate?: string;
}

export interface PaymentPlanData {
  invoiceId: string;
  totalAmount: number;
  downPayment?: number;
  numberOfPayments: number;
  paymentAmount: number;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  startDate: string;
  autoPayment?: boolean;
  paymentMethodId?: string;
}

export interface RefundData {
  paymentId: string;
  amount: number;
  reason: string;
  refundMethod: 'original' | 'check' | 'bank_transfer';
  notes?: string;
}

export interface InsuranceClaimData {
  patientId: string;
  providerId: string;
  insuranceId: string;
  serviceDate: string;
  diagnosisCodes: string[];
  procedureCodes: {
    code: string;
    modifier?: string;
    units: number;
    charges: number;
  }[];
  placeOfService: string;
  referringProvider?: string;
  authorizationNumber?: string;
  notes?: string;
}

export interface StatementData {
  patientId: string;
  statementDate: string;
  dueDate: string;
  includeInvoices: string[];
  message?: string;
  deliveryMethod: 'email' | 'mail' | 'both';
}

export interface BillingReport {
  type: 'aging' | 'revenue' | 'collections' | 'insurance' | 'provider_productivity';
  startDate: string;
  endDate: string;
  filters?: {
    providerId?: string;
    patientId?: string;
    insuranceProvider?: string;
    location?: string;
  };
  format: 'pdf' | 'excel' | 'csv';
}

// ============================================================================
// BILLING SERVICE CLASS
// ============================================================================

export class BillingService {
  private static instance: BillingService;

  private constructor() {}

  public static getInstance(): BillingService {
    if (!BillingService.instance) {
      BillingService.instance = new BillingService();
    }
    return BillingService.instance;
  }

  // ========================================================================
  // INVOICE MANAGEMENT
  // ========================================================================

  /**
   * Get invoices with filtering and pagination
   */
  async getInvoices(params?: BillingSearchParams): Promise<BillingListResponse> {
    const response = await apiService.getPaginated<Invoice>('/billing/invoices', params);
    
    return {
      invoices: response.data,
      total: response.meta?.total || 0,
      page: response.meta?.page || 1,
      limit: response.meta?.limit || 20,
      totalPages: response.meta?.totalPages || 1,
    };
  }

  /**
   * Get invoice by ID
   */
  async getInvoiceById(id: string): Promise<Invoice> {
    const response = await apiService.get<Invoice>(`/billing/invoices/${id}`);
    return response.data;
  }

  /**
   * Create new invoice
   */
  async createInvoice(data: InvoiceCreateData): Promise<Invoice> {
    const response = await apiService.post<Invoice>('/billing/invoices', data, {
      showSuccessToast: true,
      successMessage: 'Invoice created successfully!',
    });
    return response.data;
  }

  /**
   * Update invoice
   */
  async updateInvoice(id: string, data: InvoiceUpdateData): Promise<Invoice> {
    const response = await apiService.patch<Invoice>(`/billing/invoices/${id}`, data, {
      showSuccessToast: true,
      successMessage: 'Invoice updated successfully!',
    });
    return response.data;
  }

  /**
   * Delete invoice
   */
  async deleteInvoice(id: string): Promise<void> {
    await apiService.delete(`/billing/invoices/${id}`, {
      showSuccessToast: true,
      successMessage: 'Invoice deleted successfully!',
    });
  }

  /**
   * Send invoice to patient
   */
  async sendInvoice(
    id: string,
    method: 'email' | 'mail' | 'both',
    customMessage?: string
  ): Promise<void> {
    await apiService.post(
      `/billing/invoices/${id}/send`,
      { method, customMessage },
      {
        showSuccessToast: true,
        successMessage: 'Invoice sent successfully!',
      }
    );
  }

  /**
   * Mark invoice as paid
   */
  async markInvoicePaid(
    id: string,
    paymentData: {
      amount: number;
      method: string;
      reference?: string;
      notes?: string;
    }
  ): Promise<Invoice> {
    const response = await apiService.patch<Invoice>(
      `/billing/invoices/${id}/mark-paid`,
      paymentData,
      {
        showSuccessToast: true,
        successMessage: 'Invoice marked as paid!',
      }
    );
    return response.data;
  }

  /**
   * Void invoice
   */
  async voidInvoice(id: string, reason: string): Promise<Invoice> {
    const response = await apiService.patch<Invoice>(
      `/billing/invoices/${id}/void`,
      { reason },
      {
        showSuccessToast: true,
        successMessage: 'Invoice voided successfully!',
      }
    );
    return response.data;
  }

  /**
   * Apply discount to invoice
   */
  async applyDiscount(
    id: string,
    discount: {
      type: 'percentage' | 'fixed';
      value: number;
      reason: string;
    }
  ): Promise<Invoice> {
    const response = await apiService.patch<Invoice>(
      `/billing/invoices/${id}/discount`,
      discount,
      {
        showSuccessToast: true,
        successMessage: 'Discount applied successfully!',
      }
    );
    return response.data;
  }

  /**
   * Generate invoice PDF
   */
  async generateInvoicePDF(id: string): Promise<string> {
    const response = await apiService.get<{ url: string }>(`/billing/invoices/${id}/pdf`);
    return response.data.url;
  }

  /**
   * Download invoice PDF
   */
  async downloadInvoicePDF(id: string, filename?: string): Promise<void> {
    await apiService.downloadFile(`/billing/invoices/${id}/download`, filename);
  }

  // ========================================================================
  // PAYMENT MANAGEMENT
  // ========================================================================

  /**
   * Get payments with filtering and pagination
   */
  async getPayments(params?: PaymentSearchParams): Promise<PaymentListResponse> {
    const response = await apiService.getPaginated<Payment>('/billing/payments', params);
    
    return {
      payments: response.data,
      total: response.meta?.total || 0,
      page: response.meta?.page || 1,
      limit: response.meta?.limit || 20,
      totalPages: response.meta?.totalPages || 1,
    };
  }

  /**
   * Get payment by ID
   */
  async getPaymentById(id: string): Promise<Payment> {
    const response = await apiService.get<Payment>(`/billing/payments/${id}`);
    return response.data;
  }

  /**
   * Process payment
   */
  async processPayment(data: PaymentCreateData): Promise<Payment> {
    const response = await apiService.post<Payment>('/billing/payments', data, {
      showSuccessToast: true,
      successMessage: 'Payment processed successfully!',
    });
    return response.data;
  }

  /**
   * Refund payment
   */
  async refundPayment(data: RefundData): Promise<Payment> {
    const response = await apiService.post<Payment>('/billing/payments/refund', data, {
      showSuccessToast: true,
      successMessage: 'Refund processed successfully!',
    });
    return response.data;
  }

  /**
   * Void payment
   */
  async voidPayment(id: string, reason: string): Promise<Payment> {
    const response = await apiService.patch<Payment>(
      `/billing/payments/${id}/void`,
      { reason },
      {
        showSuccessToast: true,
        successMessage: 'Payment voided successfully!',
      }
    );
    return response.data;
  }

  /**
   * Get payment receipt
   */
  async getPaymentReceipt(id: string): Promise<string> {
    const response = await apiService.get<{ url: string }>(`/billing/payments/${id}/receipt`);
    return response.data.url;
  }

  // ========================================================================
  // PAYMENT METHODS
  // ========================================================================

  /**
   * Get patient payment methods
   */
  async getPaymentMethods(patientId: string): Promise<PaymentMethod[]> {
    const response = await apiService.get<PaymentMethod[]>(
      `/billing/patients/${patientId}/payment-methods`
    );
    return response.data;
  }

  /**
   * Add payment method
   */
  async addPaymentMethod(
    patientId: string,
    paymentMethod: Omit<PaymentMethod, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<PaymentMethod> {
    const response = await apiService.post<PaymentMethod>(
      `/billing/patients/${patientId}/payment-methods`,
      paymentMethod,
      {
        showSuccessToast: true,
        successMessage: 'Payment method added successfully!',
      }
    );
    return response.data;
  }

  /**
   * Update payment method
   */
  async updatePaymentMethod(
    patientId: string,
    methodId: string,
    data: Partial<PaymentMethod>
  ): Promise<PaymentMethod> {
    const response = await apiService.patch<PaymentMethod>(
      `/billing/patients/${patientId}/payment-methods/${methodId}`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Payment method updated successfully!',
      }
    );
    return response.data;
  }

  /**
   * Delete payment method
   */
  async deletePaymentMethod(patientId: string, methodId: string): Promise<void> {
    await apiService.delete(`/billing/patients/${patientId}/payment-methods/${methodId}`, {
      showSuccessToast: true,
      successMessage: 'Payment method deleted successfully!',
    });
  }

  /**
   * Set default payment method
   */
  async setDefaultPaymentMethod(patientId: string, methodId: string): Promise<void> {
    await apiService.patch(
      `/billing/patients/${patientId}/payment-methods/${methodId}/set-default`,
      {},
      {
        showSuccessToast: true,
        successMessage: 'Default payment method updated!',
      }
    );
  }

  // ========================================================================
  // PAYMENT PLANS
  // ========================================================================

  /**
   * Create payment plan
   */
  async createPaymentPlan(data: PaymentPlanData): Promise<any> {
    const response = await apiService.post<any>('/billing/payment-plans', data, {
      showSuccessToast: true,
      successMessage: 'Payment plan created successfully!',
    });
    return response.data;
  }

  /**
   * Get payment plans
   */
  async getPaymentPlans(patientId?: string): Promise<any[]> {
    const response = await apiService.get<any[]>('/billing/payment-plans', { patientId });
    return response.data;
  }

  /**
   * Update payment plan
   */
  async updatePaymentPlan(id: string, data: Partial<PaymentPlanData>): Promise<any> {
    const response = await apiService.patch<any>(`/billing/payment-plans/${id}`, data, {
      showSuccessToast: true,
      successMessage: 'Payment plan updated successfully!',
    });
    return response.data;
  }

  /**
   * Cancel payment plan
   */
  async cancelPaymentPlan(id: string, reason: string): Promise<void> {
    await apiService.patch(
      `/billing/payment-plans/${id}/cancel`,
      { reason },
      {
        showSuccessToast: true,
        successMessage: 'Payment plan cancelled successfully!',
      }
    );
  }

  // ========================================================================
  // INSURANCE CLAIMS
  // ========================================================================

  /**
   * Submit insurance claim
   */
  async submitInsuranceClaim(data: InsuranceClaimData): Promise<InsuranceClaim> {
    const response = await apiService.post<InsuranceClaim>('/billing/insurance-claims', data, {
      showSuccessToast: true,
      successMessage: 'Insurance claim submitted successfully!',
    });
    return response.data;
  }

  /**
   * Get insurance claims
   */
  async getInsuranceClaims(params?: {
    patientId?: string;
    providerId?: string;
    status?: string[];
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }): Promise<InsuranceClaim[]> {
    const response = await apiService.getPaginated<InsuranceClaim>(
      '/billing/insurance-claims',
      params
    );
    return response.data;
  }

  /**
   * Get insurance claim by ID
   */
  async getInsuranceClaimById(id: string): Promise<InsuranceClaim> {
    const response = await apiService.get<InsuranceClaim>(`/billing/insurance-claims/${id}`);
    return response.data;
  }

  /**
   * Update insurance claim
   */
  async updateInsuranceClaim(
    id: string,
    data: Partial<InsuranceClaimData>
  ): Promise<InsuranceClaim> {
    const response = await apiService.patch<InsuranceClaim>(
      `/billing/insurance-claims/${id}`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Insurance claim updated successfully!',
      }
    );
    return response.data;
  }

  /**
   * Resubmit insurance claim
   */
  async resubmitInsuranceClaim(id: string, notes?: string): Promise<InsuranceClaim> {
    const response = await apiService.patch<InsuranceClaim>(
      `/billing/insurance-claims/${id}/resubmit`,
      { notes },
      {
        showSuccessToast: true,
        successMessage: 'Insurance claim resubmitted successfully!',
      }
    );
    return response.data;
  }

  /**
   * Appeal insurance claim
   */
  async appealInsuranceClaim(
    id: string,
    appealReason: string,
    supportingDocuments?: File[]
  ): Promise<InsuranceClaim> {
    const formData = new FormData();
    formData.append('appealReason', appealReason);
    
    if (supportingDocuments) {
      supportingDocuments.forEach((file, index) => {
        formData.append(`documents[${index}]`, file);
      });
    }

    const response = await apiService.post<InsuranceClaim>(
      `/billing/insurance-claims/${id}/appeal`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        showSuccessToast: true,
        successMessage: 'Insurance claim appeal submitted successfully!',
      }
    );
    return response.data;
  }

  // ========================================================================
  // STATEMENTS
  // ========================================================================

  /**
   * Generate patient statement
   */
  async generateStatement(data: StatementData): Promise<{ id: string; url: string }> {
    const response = await apiService.post<{ id: string; url: string }>(
      '/billing/statements',
      data,
      {
        showSuccessToast: true,
        successMessage: 'Statement generated successfully!',
      }
    );
    return response.data;
  }

  /**
   * Send statement to patient
   */
  async sendStatement(
    statementId: string,
    method: 'email' | 'mail' | 'both'
  ): Promise<void> {
    await apiService.post(
      `/billing/statements/${statementId}/send`,
      { method },
      {
        showSuccessToast: true,
        successMessage: 'Statement sent successfully!',
      }
    );
  }

  /**
   * Get patient statements
   */
  async getPatientStatements(patientId: string): Promise<any[]> {
    const response = await apiService.get<any[]>(`/billing/patients/${patientId}/statements`);
    return response.data;
  }

  // ========================================================================
  // BILLING REPORTS
  // ========================================================================

  /**
   * Generate billing report
   */
  async generateBillingReport(reportData: BillingReport): Promise<{ url: string }> {
    const response = await apiService.post<{ url: string }>('/billing/reports', reportData, {
      showSuccessToast: true,
      successMessage: 'Report generated successfully!',
    });
    return response.data;
  }

  /**
   * Get aging report
   */
  async getAgingReport(asOfDate?: string): Promise<any> {
    const response = await apiService.get<any>('/billing/reports/aging', { asOfDate });
    return response.data;
  }

  /**
   * Get revenue report
   */
  async getRevenueReport(
    startDate: string,
    endDate: string,
    groupBy?: 'day' | 'week' | 'month'
  ): Promise<any> {
    const response = await apiService.get<any>('/billing/reports/revenue', {
      startDate,
      endDate,
      groupBy,
    });
    return response.data;
  }

  /**
   * Get collections report
   */
  async getCollectionsReport(
    startDate: string,
    endDate: string,
    providerId?: string
  ): Promise<any> {
    const response = await apiService.get<any>('/billing/reports/collections', {
      startDate,
      endDate,
      providerId,
    });
    return response.data;
  }

  // ========================================================================
  // BILLING STATISTICS
  // ========================================================================

  /**
   * Get billing statistics
   */
  async getBillingStats(
    startDate?: string,
    endDate?: string,
    providerId?: string
  ): Promise<BillingStatsResponse> {
    const response = await apiService.get<BillingStatsResponse>('/billing/stats', {
      startDate,
      endDate,
      providerId,
    });
    return response.data;
  }

  /**
   * Get outstanding balances
   */
  async getOutstandingBalances(params?: {
    patientId?: string;
    providerId?: string;
    ageGroup?: '0-30' | '31-60' | '61-90' | '90+';
  }): Promise<any[]> {
    const response = await apiService.get<any[]>('/billing/outstanding-balances', params);
    return response.data;
  }

  /**
   * Get payment trends
   */
  async getPaymentTrends(
    period: 'week' | 'month' | 'quarter' | 'year',
    providerId?: string
  ): Promise<any> {
    const response = await apiService.get<any>('/billing/payment-trends', {
      period,
      providerId,
    });
    return response.data;
  }

  // ========================================================================
  // BULK OPERATIONS
  // ========================================================================

  /**
   * Bulk send invoices
   */
  async bulkSendInvoices(
    invoiceIds: string[],
    method: 'email' | 'mail' | 'both',
    customMessage?: string
  ): Promise<{ sent: number; failed: number; errors: string[] }> {
    const response = await apiService.post<{ sent: number; failed: number; errors: string[] }>(
      '/billing/invoices/bulk-send',
      { invoiceIds, method, customMessage },
      {
        showSuccessToast: true,
        successMessage: 'Bulk invoice sending completed!',
      }
    );
    return response.data;
  }

  /**
   * Bulk apply discount
   */
  async bulkApplyDiscount(
    invoiceIds: string[],
    discount: {
      type: 'percentage' | 'fixed';
      value: number;
      reason: string;
    }
  ): Promise<{ updated: number; failed: number; errors: string[] }> {
    const response = await apiService.post<{ updated: number; failed: number; errors: string[] }>(
      '/billing/invoices/bulk-discount',
      { invoiceIds, discount },
      {
        showSuccessToast: true,
        successMessage: 'Bulk discount applied successfully!',
      }
    );
    return response.data;
  }

  // ========================================================================
  // INTEGRATION HELPERS
  // ========================================================================

  /**
   * Verify insurance eligibility
   */
  async verifyInsuranceEligibility(
    patientId: string,
    insuranceId: string,
    serviceDate: string
  ): Promise<{
    eligible: boolean;
    benefits: any;
    copay?: number;
    deductible?: number;
    coinsurance?: number;
    messages: string[];
  }> {
    const response = await apiService.post<{
      eligible: boolean;
      benefits: any;
      copay?: number;
      deductible?: number;
      coinsurance?: number;
      messages: string[];
    }>('/billing/verify-insurance', {
      patientId,
      insuranceId,
      serviceDate,
    });
    return response.data;
  }

  /**
   * Get CPT codes
   */
  async getCPTCodes(query?: string): Promise<any[]> {
    const response = await apiService.get<any[]>('/billing/cpt-codes', { q: query });
    return response.data;
  }

  /**
   * Get ICD-10 codes
   */
  async getICD10Codes(query?: string): Promise<any[]> {
    const response = await apiService.get<any[]>('/billing/icd10-codes', { q: query });
    return response.data;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const billingService = BillingService.getInstance();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export const getInvoices = (params?: BillingSearchParams): Promise<BillingListResponse> =>
  billingService.getInvoices(params);

export const getInvoiceById = (id: string): Promise<Invoice> =>
  billingService.getInvoiceById(id);

export const createInvoice = (data: InvoiceCreateData): Promise<Invoice> =>
  billingService.createInvoice(data);

export const processPayment = (data: PaymentCreateData): Promise<Payment> =>
  billingService.processPayment(data);

export const getPayments = (params?: PaymentSearchParams): Promise<PaymentListResponse> =>
  billingService.getPayments(params);

export const submitInsuranceClaim = (data: InsuranceClaimData): Promise<InsuranceClaim> =>
  billingService.submitInsuranceClaim(data);

export const getBillingStats = (
  startDate?: string,
  endDate?: string,
  providerId?: string
): Promise<BillingStatsResponse> => billingService.getBillingStats(startDate, endDate, providerId);

// ============================================================================
// EXPORTS
// ============================================================================

export default billingService;