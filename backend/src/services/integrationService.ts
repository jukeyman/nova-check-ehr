/**
 * ============================================================================
 * NOVA CHECK EHR - INTEGRATION SERVICE
 * ============================================================================
 */

import { PrismaClient } from '@prisma/client';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import logger from '../config/logger';
import config from '../config/config';
import auditService from './auditService';
import cacheService from './cacheService';
import emailService from './emailService';

const prisma = new PrismaClient();

interface IntegrationConfig {
  id: string;
  name: string;
  type: 'API' | 'WEBHOOK' | 'HL7' | 'FHIR' | 'CUSTOM';
  baseUrl?: string;
  apiKey?: string;
  secretKey?: string;
  headers?: Record<string, string>;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  rateLimitPerMinute?: number;
  active: boolean;
  settings?: Record<string, any>;
}

interface WebhookPayload {
  event: string;
  data: any;
  timestamp: Date;
  source: string;
  signature?: string;
}

interface APIRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  endpoint: string;
  data?: any;
  headers?: Record<string, string>;
  timeout?: number;
}

interface APIResponse {
  success: boolean;
  data?: any;
  error?: string;
  statusCode?: number;
  responseTime: number;
  requestId: string;
}

interface IntegrationStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  lastRequest?: Date;
  errorRate: number;
  rateLimitHits: number;
}

interface HL7Message {
  messageType: string;
  sendingApplication: string;
  receivingApplication: string;
  messageControlId: string;
  segments: HL7Segment[];
}

interface HL7Segment {
  type: string;
  fields: string[];
}

interface FHIRResource {
  resourceType: string;
  id?: string;
  meta?: {
    versionId?: string;
    lastUpdated?: string;
    profile?: string[];
  };
  [key: string]: any;
}

class IntegrationService {
  private integrations: Map<string, IntegrationConfig> = new Map();
  private apiClients: Map<string, AxiosInstance> = new Map();
  private rateLimiters: Map<string, { requests: number; resetTime: number }> = new Map();
  private webhookSecrets: Map<string, string> = new Map();

  constructor() {
    this.loadIntegrations();
    this.setupRateLimitReset();
  }

  private async loadIntegrations() {
    try {
      const integrations = await prisma.integration.findMany({
        where: { active: true },
      });

      for (const integration of integrations) {
        const config: IntegrationConfig = {
          id: integration.id,
          name: integration.name,
          type: integration.type as any,
          baseUrl: integration.baseUrl,
          apiKey: integration.apiKey,
          secretKey: integration.secretKey,
          headers: integration.headers ? JSON.parse(integration.headers) : {},
          timeout: integration.timeout || 30000,
          retryAttempts: integration.retryAttempts || 3,
          retryDelay: integration.retryDelay || 1000,
          rateLimitPerMinute: integration.rateLimitPerMinute || 60,
          active: integration.active,
          settings: integration.settings ? JSON.parse(integration.settings) : {},
        };

        this.integrations.set(integration.id, config);
        this.setupAPIClient(config);
        
        if (integration.webhookSecret) {
          this.webhookSecrets.set(integration.id, integration.webhookSecret);
        }
      }

      logger.info(`Loaded ${integrations.length} integrations`);
    } catch (error) {
      logger.error('Failed to load integrations', { error: error.message });
    }
  }

  private setupAPIClient(config: IntegrationConfig) {
    if (!config.baseUrl) return;

    const client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Nova-EHR/1.0',
        ...config.headers,
      },
    });

    // Add authentication
    if (config.apiKey) {
      client.defaults.headers.common['Authorization'] = `Bearer ${config.apiKey}`;
    }

    // Request interceptor for logging and rate limiting
    client.interceptors.request.use(
      async (requestConfig) => {
        const requestId = uuidv4();
        requestConfig.metadata = { requestId, startTime: Date.now() };
        
        // Check rate limit
        if (!(await this.checkRateLimit(config.id))) {
          throw new Error('Rate limit exceeded');
        }

        logger.debug('API request started', {
          integrationId: config.id,
          requestId,
          method: requestConfig.method,
          url: requestConfig.url,
        });

        return requestConfig;
      },
      (error) => {
        logger.error('API request setup failed', { error: error.message });
        return Promise.reject(error);
      }
    );

    // Response interceptor for logging and error handling
    client.interceptors.response.use(
      (response) => {
        const { requestId, startTime } = response.config.metadata || {};
        const responseTime = Date.now() - (startTime || Date.now());

        logger.debug('API request completed', {
          integrationId: config.id,
          requestId,
          statusCode: response.status,
          responseTime,
        });

        // Log successful request
        this.logAPIRequest(config.id, {
          requestId,
          method: response.config.method?.toUpperCase(),
          endpoint: response.config.url,
          statusCode: response.status,
          responseTime,
          success: true,
        });

        return response;
      },
      (error) => {
        const { requestId, startTime } = error.config?.metadata || {};
        const responseTime = Date.now() - (startTime || Date.now());

        logger.error('API request failed', {
          integrationId: config.id,
          requestId,
          error: error.message,
          statusCode: error.response?.status,
          responseTime,
        });

        // Log failed request
        this.logAPIRequest(config.id, {
          requestId,
          method: error.config?.method?.toUpperCase(),
          endpoint: error.config?.url,
          statusCode: error.response?.status,
          responseTime,
          success: false,
          error: error.message,
        });

        return Promise.reject(error);
      }
    );

    this.apiClients.set(config.id, client);
  }

  private setupRateLimitReset() {
    setInterval(() => {
      const now = Date.now();
      for (const [integrationId, limiter] of this.rateLimiters.entries()) {
        if (now >= limiter.resetTime) {
          limiter.requests = 0;
          limiter.resetTime = now + 60000; // Reset every minute
        }
      }
    }, 1000);
  }

  private async checkRateLimit(integrationId: string): Promise<boolean> {
    const config = this.integrations.get(integrationId);
    if (!config?.rateLimitPerMinute) return true;

    const now = Date.now();
    let limiter = this.rateLimiters.get(integrationId);
    
    if (!limiter) {
      limiter = { requests: 0, resetTime: now + 60000 };
      this.rateLimiters.set(integrationId, limiter);
    }

    if (limiter.requests >= config.rateLimitPerMinute) {
      await this.logAPIRequest(integrationId, {
        requestId: uuidv4(),
        method: 'RATE_LIMITED',
        endpoint: 'N/A',
        statusCode: 429,
        responseTime: 0,
        success: false,
        error: 'Rate limit exceeded',
      });
      return false;
    }

    limiter.requests++;
    return true;
  }

  private async logAPIRequest(integrationId: string, logData: any) {
    try {
      await prisma.integrationLog.create({
        data: {
          integrationId,
          requestId: logData.requestId,
          method: logData.method,
          endpoint: logData.endpoint,
          statusCode: logData.statusCode,
          responseTime: logData.responseTime,
          success: logData.success,
          error: logData.error,
          timestamp: new Date(),
        },
      });
    } catch (error) {
      logger.error('Failed to log API request', {
        integrationId,
        error: error.message,
      });
    }
  }

  async makeAPIRequest(integrationId: string, request: APIRequest): Promise<APIResponse> {
    const startTime = Date.now();
    const requestId = uuidv4();

    try {
      const config = this.integrations.get(integrationId);
      if (!config) {
        throw new Error(`Integration ${integrationId} not found`);
      }

      if (!config.active) {
        throw new Error(`Integration ${integrationId} is not active`);
      }

      const client = this.apiClients.get(integrationId);
      if (!client) {
        throw new Error(`API client for integration ${integrationId} not configured`);
      }

      const requestConfig: AxiosRequestConfig = {
        method: request.method,
        url: request.endpoint,
        data: request.data,
        headers: request.headers,
        timeout: request.timeout || config.timeout,
      };

      let response: AxiosResponse;
      let attempt = 0;
      const maxAttempts = config.retryAttempts || 1;

      while (attempt < maxAttempts) {
        try {
          response = await client.request(requestConfig);
          break;
        } catch (error) {
          attempt++;
          if (attempt >= maxAttempts) {
            throw error;
          }
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, config.retryDelay || 1000));
          logger.warn(`API request retry ${attempt}/${maxAttempts}`, {
            integrationId,
            requestId,
            error: error.message,
          });
        }
      }

      const responseTime = Date.now() - startTime;

      return {
        success: true,
        data: response!.data,
        statusCode: response!.status,
        responseTime,
        requestId,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      return {
        success: false,
        error: error.message,
        statusCode: error.response?.status,
        responseTime,
        requestId,
      };
    }
  }

  async processWebhook(integrationId: string, payload: any, signature?: string): Promise<boolean> {
    try {
      const config = this.integrations.get(integrationId);
      if (!config) {
        throw new Error(`Integration ${integrationId} not found`);
      }

      // Verify webhook signature if secret is configured
      const webhookSecret = this.webhookSecrets.get(integrationId);
      if (webhookSecret && signature) {
        const expectedSignature = crypto
          .createHmac('sha256', webhookSecret)
          .update(JSON.stringify(payload))
          .digest('hex');
        
        if (signature !== expectedSignature) {
          throw new Error('Invalid webhook signature');
        }
      }

      const webhookPayload: WebhookPayload = {
        event: payload.event || 'unknown',
        data: payload.data || payload,
        timestamp: new Date(),
        source: config.name,
        signature,
      };

      // Log webhook receipt
      await prisma.webhookLog.create({
        data: {
          integrationId,
          event: webhookPayload.event,
          payload: JSON.stringify(webhookPayload.data),
          signature,
          processed: false,
          timestamp: webhookPayload.timestamp,
        },
      });

      // Process webhook based on event type
      await this.handleWebhookEvent(integrationId, webhookPayload);

      // Mark as processed
      await prisma.webhookLog.updateMany({
        where: {
          integrationId,
          timestamp: webhookPayload.timestamp,
        },
        data: { processed: true },
      });

      logger.info('Webhook processed successfully', {
        integrationId,
        event: webhookPayload.event,
      });

      return true;
    } catch (error) {
      logger.error('Webhook processing failed', {
        integrationId,
        error: error.message,
      });
      
      await auditService.logSecurityEvent(
        'WEBHOOK_PROCESSING_FAILED',
        {
          integrationId,
          error: error.message,
        },
        'MEDIUM'
      );

      return false;
    }
  }

  private async handleWebhookEvent(integrationId: string, payload: WebhookPayload) {
    const config = this.integrations.get(integrationId);
    if (!config) return;

    switch (payload.event) {
      case 'patient.created':
      case 'patient.updated':
        await this.handlePatientWebhook(payload);
        break;
        
      case 'appointment.scheduled':
      case 'appointment.cancelled':
      case 'appointment.rescheduled':
        await this.handleAppointmentWebhook(payload);
        break;
        
      case 'lab.result.available':
        await this.handleLabResultWebhook(payload);
        break;
        
      case 'prescription.filled':
      case 'prescription.ready':
        await this.handlePrescriptionWebhook(payload);
        break;
        
      default:
        logger.warn('Unhandled webhook event', {
          integrationId,
          event: payload.event,
        });
    }
  }

  private async handlePatientWebhook(payload: WebhookPayload) {
    // Handle patient-related webhook events
    logger.info('Processing patient webhook', { event: payload.event });
    
    // Invalidate patient cache
    if (payload.data.patientId) {
      await cacheService.invalidatePatientCache(payload.data.patientId);
    }
  }

  private async handleAppointmentWebhook(payload: WebhookPayload) {
    // Handle appointment-related webhook events
    logger.info('Processing appointment webhook', { event: payload.event });
    
    // Send notifications, update calendars, etc.
    if (payload.data.appointmentId) {
      // Invalidate appointment cache
      await cacheService.delete(`appointment:${payload.data.appointmentId}`);
    }
  }

  private async handleLabResultWebhook(payload: WebhookPayload) {
    // Handle lab result webhook events
    logger.info('Processing lab result webhook', { event: payload.event });
    
    // Notify providers and patients about new results
    if (payload.data.patientId && payload.data.providerId) {
      // Send notification emails
      // Update patient portal
      // Log in audit trail
    }
  }

  private async handlePrescriptionWebhook(payload: WebhookPayload) {
    // Handle prescription-related webhook events
    logger.info('Processing prescription webhook', { event: payload.event });
    
    // Notify patients about prescription status
    if (payload.data.patientId) {
      // Send SMS/email notifications
      // Update medication list
    }
  }

  // HL7 Message Processing
  async processHL7Message(message: string): Promise<HL7Message> {
    try {
      const segments = message.split('\r').filter(segment => segment.trim());
      const parsedSegments: HL7Segment[] = [];
      
      let messageType = '';
      let sendingApplication = '';
      let receivingApplication = '';
      let messageControlId = '';

      for (const segment of segments) {
        const fields = segment.split('|');
        const segmentType = fields[0];
        
        parsedSegments.push({
          type: segmentType,
          fields: fields.slice(1),
        });

        // Extract header information
        if (segmentType === 'MSH') {
          sendingApplication = fields[3] || '';
          receivingApplication = fields[5] || '';
          messageType = fields[9] || '';
          messageControlId = fields[10] || '';
        }
      }

      const hl7Message: HL7Message = {
        messageType,
        sendingApplication,
        receivingApplication,
        messageControlId,
        segments: parsedSegments,
      };

      // Log HL7 message processing
      await auditService.logDataAccess(
        'HL7_MESSAGE_PROCESSED',
        {
          messageType,
          messageControlId,
          sendingApplication,
        },
        'MEDIUM'
      );

      return hl7Message;
    } catch (error) {
      logger.error('HL7 message processing failed', {
        error: error.message,
        message: message.substring(0, 200), // Log first 200 chars for debugging
      });
      throw new Error('Failed to process HL7 message');
    }
  }

  // FHIR Resource Processing
  async processFHIRResource(resource: FHIRResource): Promise<boolean> {
    try {
      // Validate FHIR resource structure
      if (!resource.resourceType) {
        throw new Error('Invalid FHIR resource: missing resourceType');
      }

      // Process based on resource type
      switch (resource.resourceType) {
        case 'Patient':
          await this.processFHIRPatient(resource);
          break;
          
        case 'Observation':
          await this.processFHIRObservation(resource);
          break;
          
        case 'Appointment':
          await this.processFHIRAppointment(resource);
          break;
          
        case 'MedicationRequest':
          await this.processFHIRMedicationRequest(resource);
          break;
          
        default:
          logger.warn('Unhandled FHIR resource type', {
            resourceType: resource.resourceType,
          });
      }

      // Log FHIR resource processing
      await auditService.logDataAccess(
        'FHIR_RESOURCE_PROCESSED',
        {
          resourceType: resource.resourceType,
          resourceId: resource.id,
        },
        'MEDIUM'
      );

      return true;
    } catch (error) {
      logger.error('FHIR resource processing failed', {
        error: error.message,
        resourceType: resource.resourceType,
        resourceId: resource.id,
      });
      return false;
    }
  }

  private async processFHIRPatient(resource: FHIRResource) {
    // Process FHIR Patient resource
    logger.info('Processing FHIR Patient resource', { id: resource.id });
    // Implementation would map FHIR Patient to internal patient model
  }

  private async processFHIRObservation(resource: FHIRResource) {
    // Process FHIR Observation resource (lab results, vitals, etc.)
    logger.info('Processing FHIR Observation resource', { id: resource.id });
    // Implementation would map FHIR Observation to internal observation model
  }

  private async processFHIRAppointment(resource: FHIRResource) {
    // Process FHIR Appointment resource
    logger.info('Processing FHIR Appointment resource', { id: resource.id });
    // Implementation would map FHIR Appointment to internal appointment model
  }

  private async processFHIRMedicationRequest(resource: FHIRResource) {
    // Process FHIR MedicationRequest resource
    logger.info('Processing FHIR MedicationRequest resource', { id: resource.id });
    // Implementation would map FHIR MedicationRequest to internal prescription model
  }

  async getIntegrationStats(integrationId: string): Promise<IntegrationStats> {
    try {
      const [totalRequests, successfulRequests, failedRequests, avgResponseTime, lastRequest] = await Promise.all([
        prisma.integrationLog.count({ where: { integrationId } }),
        prisma.integrationLog.count({ where: { integrationId, success: true } }),
        prisma.integrationLog.count({ where: { integrationId, success: false } }),
        prisma.integrationLog.aggregate({
          where: { integrationId, success: true },
          _avg: { responseTime: true },
        }),
        prisma.integrationLog.findFirst({
          where: { integrationId },
          orderBy: { timestamp: 'desc' },
        }),
      ]);

      const rateLimitHits = await prisma.integrationLog.count({
        where: {
          integrationId,
          statusCode: 429,
        },
      });

      return {
        totalRequests,
        successfulRequests,
        failedRequests,
        averageResponseTime: Number(avgResponseTime._avg.responseTime || 0),
        lastRequest: lastRequest?.timestamp,
        errorRate: totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0,
        rateLimitHits,
      };
    } catch (error) {
      logger.error('Failed to get integration stats', {
        integrationId,
        error: error.message,
      });
      throw new Error('Failed to get integration statistics');
    }
  }

  async testIntegration(integrationId: string): Promise<boolean> {
    try {
      const config = this.integrations.get(integrationId);
      if (!config) {
        throw new Error(`Integration ${integrationId} not found`);
      }

      // Test API connectivity
      if (config.type === 'API' && config.baseUrl) {
        const response = await this.makeAPIRequest(integrationId, {
          method: 'GET',
          endpoint: '/health', // Common health check endpoint
        });
        
        if (!response.success) {
          throw new Error(`API test failed: ${response.error}`);
        }
      }

      logger.info('Integration test passed', { integrationId });
      return true;
    } catch (error) {
      logger.error('Integration test failed', {
        integrationId,
        error: error.message,
      });
      return false;
    }
  }

  async createIntegration(integrationData: Partial<IntegrationConfig>): Promise<string> {
    try {
      const integration = await prisma.integration.create({
        data: {
          id: uuidv4(),
          name: integrationData.name!,
          type: integrationData.type!,
          baseUrl: integrationData.baseUrl,
          apiKey: integrationData.apiKey,
          secretKey: integrationData.secretKey,
          headers: integrationData.headers ? JSON.stringify(integrationData.headers) : null,
          timeout: integrationData.timeout || 30000,
          retryAttempts: integrationData.retryAttempts || 3,
          retryDelay: integrationData.retryDelay || 1000,
          rateLimitPerMinute: integrationData.rateLimitPerMinute || 60,
          active: integrationData.active ?? true,
          settings: integrationData.settings ? JSON.stringify(integrationData.settings) : null,
          webhookSecret: crypto.randomBytes(32).toString('hex'),
        },
      });

      // Load the new integration
      await this.loadIntegrations();

      logger.info('Integration created', {
        integrationId: integration.id,
        name: integration.name,
        type: integration.type,
      });

      return integration.id;
    } catch (error) {
      logger.error('Failed to create integration', {
        error: error.message,
        integrationData,
      });
      throw new Error('Failed to create integration');
    }
  }

  async updateIntegration(integrationId: string, updates: Partial<IntegrationConfig>): Promise<void> {
    try {
      await prisma.integration.update({
        where: { id: integrationId },
        data: {
          name: updates.name,
          baseUrl: updates.baseUrl,
          apiKey: updates.apiKey,
          secretKey: updates.secretKey,
          headers: updates.headers ? JSON.stringify(updates.headers) : undefined,
          timeout: updates.timeout,
          retryAttempts: updates.retryAttempts,
          retryDelay: updates.retryDelay,
          rateLimitPerMinute: updates.rateLimitPerMinute,
          active: updates.active,
          settings: updates.settings ? JSON.stringify(updates.settings) : undefined,
        },
      });

      // Reload integrations
      await this.loadIntegrations();

      logger.info('Integration updated', { integrationId });
    } catch (error) {
      logger.error('Failed to update integration', {
        integrationId,
        error: error.message,
      });
      throw new Error('Failed to update integration');
    }
  }

  async deleteIntegration(integrationId: string): Promise<void> {
    try {
      await prisma.integration.delete({
        where: { id: integrationId },
      });

      // Remove from memory
      this.integrations.delete(integrationId);
      this.apiClients.delete(integrationId);
      this.rateLimiters.delete(integrationId);
      this.webhookSecrets.delete(integrationId);

      logger.info('Integration deleted', { integrationId });
    } catch (error) {
      logger.error('Failed to delete integration', {
        integrationId,
        error: error.message,
      });
      throw new Error('Failed to delete integration');
    }
  }

  async getIntegrations(): Promise<IntegrationConfig[]> {
    return Array.from(this.integrations.values());
  }

  async getIntegration(integrationId: string): Promise<IntegrationConfig | null> {
    return this.integrations.get(integrationId) || null;
  }

  // Predefined integration templates
  static getEpicIntegrationTemplate(): Partial<IntegrationConfig> {
    return {
      name: 'Epic EHR Integration',
      type: 'FHIR',
      baseUrl: 'https://fhir.epic.com/interconnect-fhir-oauth',
      headers: {
        'Accept': 'application/fhir+json',
        'Content-Type': 'application/fhir+json',
      },
      timeout: 30000,
      retryAttempts: 3,
      rateLimitPerMinute: 120,
      settings: {
        fhirVersion: 'R4',
        scopes: ['patient/*.read', 'user/*.read'],
      },
    };
  }

  static getCernerIntegrationTemplate(): Partial<IntegrationConfig> {
    return {
      name: 'Cerner EHR Integration',
      type: 'FHIR',
      baseUrl: 'https://fhir-open.cerner.com/r4',
      headers: {
        'Accept': 'application/fhir+json',
        'Content-Type': 'application/fhir+json',
      },
      timeout: 30000,
      retryAttempts: 3,
      rateLimitPerMinute: 100,
      settings: {
        fhirVersion: 'R4',
        scopes: ['patient/*.read', 'user/*.read'],
      },
    };
  }

  static getLabCorpIntegrationTemplate(): Partial<IntegrationConfig> {
    return {
      name: 'LabCorp Integration',
      type: 'API',
      timeout: 45000,
      retryAttempts: 2,
      rateLimitPerMinute: 60,
      settings: {
        resultFormat: 'HL7',
        autoImport: true,
        notifyProviders: true,
      },
    };
  }

  static getTwilioIntegrationTemplate(): Partial<IntegrationConfig> {
    return {
      name: 'Twilio SMS Integration',
      type: 'API',
      baseUrl: 'https://api.twilio.com/2010-04-01',
      timeout: 15000,
      retryAttempts: 3,
      rateLimitPerMinute: 200,
      settings: {
        messagingService: true,
        deliveryCallbacks: true,
      },
    };
  }
}

// Export singleton instance
const integrationService = new IntegrationService();
export default integrationService;

// Export the class for testing
export { IntegrationService };