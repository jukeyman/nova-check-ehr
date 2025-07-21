/**
 * ============================================================================
 * NOVA CHECK EHR - SMS SERVICE
 * ============================================================================
 */

import twilio from 'twilio';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { PrismaClient } from '@prisma/client';
import logger from '../config/logger';
import config from '../config/config';
import { format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

interface SMSOptions {
  to: string;
  message: string;
  from?: string;
  priority?: 'high' | 'normal' | 'low';
  template?: string;
  templateData?: Record<string, any>;
}

interface SMSTemplate {
  message: string;
}

class SMSService {
  private twilioClient: twilio.Twilio | null = null;
  private snsClient: SNSClient | null = null;
  private useAWSSNS: boolean;

  constructor() {
    this.useAWSSNS = config.sms.provider === 'aws-sns';
    this.initializeClient();
  }

  private initializeClient() {
    if (this.useAWSSNS) {
      this.snsClient = new SNSClient({
        region: config.aws.region,
        credentials: {
          accessKeyId: config.aws.accessKeyId,
          secretAccessKey: config.aws.secretAccessKey,
        },
      });
    } else {
      // Use Twilio
      this.twilioClient = twilio(
        config.sms.twilio.accountSid,
        config.sms.twilio.authToken
      );
    }
  }

  async sendSMS(options: SMSOptions): Promise<boolean> {
    try {
      const smsId = uuidv4();
      
      // Validate phone number format
      const phoneNumber = this.formatPhoneNumber(options.to);
      if (!phoneNumber) {
        throw new Error('Invalid phone number format');
      }

      // Process template if provided
      let { message } = options;
      if (options.template && options.templateData) {
        const template = await this.getTemplate(options.template, options.templateData);
        message = template.message;
      }

      // Truncate message if too long (SMS limit is typically 160 characters)
      if (message.length > 160) {
        message = message.substring(0, 157) + '...';
        logger.warn('SMS message truncated', {
          smsId,
          originalLength: options.message.length,
          truncatedLength: message.length,
        });
      }

      const smsData = {
        to: phoneNumber,
        message,
        from: options.from || config.sms.from,
      };

      let result;
      if (this.useAWSSNS && this.snsClient) {
        result = await this.sendWithSNS(smsData);
      } else if (this.twilioClient) {
        result = await this.sendWithTwilio(smsData);
      } else {
        throw new Error('No SMS service configured');
      }

      // Log SMS sent
      await this.logSMS({
        id: smsId,
        to: phoneNumber,
        message,
        status: 'sent',
        provider: this.useAWSSNS ? 'aws-sns' : 'twilio',
        messageId: result.messageId,
      });

      logger.info('SMS sent successfully', {
        smsId,
        to: phoneNumber,
        provider: this.useAWSSNS ? 'aws-sns' : 'twilio',
      });

      return true;
    } catch (error) {
      logger.error('Failed to send SMS', {
        error: error.message,
        to: options.to,
        message: options.message,
      });

      // Log failed SMS
      await this.logSMS({
        id: uuidv4(),
        to: options.to,
        message: options.message,
        status: 'failed',
        error: error.message,
        provider: this.useAWSSNS ? 'aws-sns' : 'twilio',
      });

      return false;
    }
  }

  private async sendWithSNS(smsData: any) {
    const command = new PublishCommand({
      PhoneNumber: smsData.to,
      Message: smsData.message,
      MessageAttributes: {
        'AWS.SNS.SMS.SenderID': {
          DataType: 'String',
          StringValue: 'NovaCheck',
        },
        'AWS.SNS.SMS.SMSType': {
          DataType: 'String',
          StringValue: 'Transactional',
        },
      },
    });

    const result = await this.snsClient!.send(command);
    return { messageId: result.MessageId };
  }

  private async sendWithTwilio(smsData: any) {
    const result = await this.twilioClient!.messages.create({
      body: smsData.message,
      from: smsData.from,
      to: smsData.to,
    });

    return { messageId: result.sid };
  }

  private formatPhoneNumber(phoneNumber: string): string | null {
    // Remove all non-digit characters
    const cleaned = phoneNumber.replace(/\D/g, '');
    
    // Check if it's a valid US phone number (10 digits) or international (11+ digits)
    if (cleaned.length === 10) {
      return `+1${cleaned}`;
    } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `+${cleaned}`;
    } else if (cleaned.length >= 10) {
      return `+${cleaned}`;
    }
    
    return null;
  }

  private async getTemplate(templateName: string, data: Record<string, any>): Promise<SMSTemplate> {
    const templates: Record<string, (data: any) => SMSTemplate> = {
      appointmentReminder: (data) => ({
        message: `Reminder: You have an appointment with Dr. ${data.providerName} on ${format(new Date(data.appointmentDate), 'M/d/yy')} at ${format(new Date(data.appointmentDate), 'h:mm a')}. Reply STOP to opt out.`,
      }),
      appointmentConfirmation: (data) => ({
        message: `Confirmed: Appointment with Dr. ${data.providerName} on ${format(new Date(data.appointmentDate), 'M/d/yy')} at ${format(new Date(data.appointmentDate), 'h:mm a')}. Confirmation #${data.confirmationNumber}`,
      }),
      appointmentCancellation: (data) => ({
        message: `Cancelled: Your appointment with Dr. ${data.providerName} on ${format(new Date(data.appointmentDate), 'M/d/yy')} has been cancelled. Please call to reschedule.`,
      }),
      appointmentRescheduled: (data) => ({
        message: `Rescheduled: Your appointment with Dr. ${data.providerName} is now on ${format(new Date(data.newAppointmentDate), 'M/d/yy')} at ${format(new Date(data.newAppointmentDate), 'h:mm a')}.`,
      }),
      labResults: (data) => ({
        message: `Your lab results from ${format(new Date(data.testDate), 'M/d/yy')} are ready. Log in to your patient portal to view them.`,
      }),
      medicationReminder: (data) => ({
        message: `Medication reminder: Take your ${data.medicationName} as prescribed. Contact your provider with questions.`,
      }),
      welcomeSMS: (data) => ({
        message: `Welcome to Nova Check EHR, ${data.firstName}! Your account is ready. Download our app or visit our portal to get started.`,
      }),
      passwordReset: (data) => ({
        message: `Nova Check EHR: Your password reset code is ${data.resetCode}. This code expires in 15 minutes. Do not share this code.`,
      }),
      verificationCode: (data) => ({
        message: `Nova Check EHR: Your verification code is ${data.verificationCode}. Enter this code to verify your phone number.`,
      }),
      emergencyAlert: (data) => ({
        message: `URGENT: ${data.message} Please contact your healthcare provider immediately or call 911 if this is a medical emergency.`,
      }),
      checkInReminder: (data) => ({
        message: `Check-in reminder: Your appointment with Dr. ${data.providerName} is in 15 minutes. Please arrive early for check-in.`,
      }),
    };

    const templateFunction = templates[templateName];
    if (!templateFunction) {
      throw new Error(`SMS template '${templateName}' not found`);
    }

    return templateFunction(data);
  }

  private async logSMS(smsLog: {
    id: string;
    to: string;
    message: string;
    status: 'sent' | 'failed';
    provider: string;
    messageId?: string;
    error?: string;
  }) {
    try {
      await prisma.smsLog.create({
        data: {
          id: smsLog.id,
          recipient: smsLog.to,
          message: smsLog.message,
          status: smsLog.status,
          provider: smsLog.provider,
          messageId: smsLog.messageId,
          error: smsLog.error,
          sentAt: smsLog.status === 'sent' ? new Date() : null,
        },
      });
    } catch (error) {
      logger.error('Failed to log SMS', {
        error: error.message,
        smsId: smsLog.id,
      });
    }
  }

  async sendAppointmentReminder(appointmentData: {
    patientPhone: string;
    patientName: string;
    providerName: string;
    appointmentDate: string;
  }): Promise<boolean> {
    return this.sendSMS({
      to: appointmentData.patientPhone,
      template: 'appointmentReminder',
      templateData: appointmentData,
      priority: 'high',
    });
  }

  async sendAppointmentConfirmation(appointmentData: {
    patientPhone: string;
    patientName: string;
    providerName: string;
    appointmentDate: string;
    confirmationNumber: string;
  }): Promise<boolean> {
    return this.sendSMS({
      to: appointmentData.patientPhone,
      template: 'appointmentConfirmation',
      templateData: appointmentData,
      priority: 'normal',
    });
  }

  async sendAppointmentCancellation(appointmentData: {
    patientPhone: string;
    patientName: string;
    providerName: string;
    appointmentDate: string;
  }): Promise<boolean> {
    return this.sendSMS({
      to: appointmentData.patientPhone,
      template: 'appointmentCancellation',
      templateData: appointmentData,
      priority: 'high',
    });
  }

  async sendAppointmentRescheduled(appointmentData: {
    patientPhone: string;
    patientName: string;
    providerName: string;
    oldAppointmentDate: string;
    newAppointmentDate: string;
  }): Promise<boolean> {
    return this.sendSMS({
      to: appointmentData.patientPhone,
      template: 'appointmentRescheduled',
      templateData: appointmentData,
      priority: 'high',
    });
  }

  async sendLabResultsNotification(labData: {
    patientPhone: string;
    patientName: string;
    testDate: string;
  }): Promise<boolean> {
    return this.sendSMS({
      to: labData.patientPhone,
      template: 'labResults',
      templateData: labData,
      priority: 'normal',
    });
  }

  async sendMedicationReminder(medicationData: {
    patientPhone: string;
    patientName: string;
    medicationName: string;
  }): Promise<boolean> {
    return this.sendSMS({
      to: medicationData.patientPhone,
      template: 'medicationReminder',
      templateData: medicationData,
      priority: 'normal',
    });
  }

  async sendWelcomeSMS(userData: {
    phone: string;
    firstName: string;
  }): Promise<boolean> {
    return this.sendSMS({
      to: userData.phone,
      template: 'welcomeSMS',
      templateData: userData,
      priority: 'normal',
    });
  }

  async sendPasswordResetCode(userData: {
    phone: string;
    firstName: string;
    resetCode: string;
  }): Promise<boolean> {
    return this.sendSMS({
      to: userData.phone,
      template: 'passwordReset',
      templateData: userData,
      priority: 'high',
    });
  }

  async sendVerificationCode(userData: {
    phone: string;
    verificationCode: string;
  }): Promise<boolean> {
    return this.sendSMS({
      to: userData.phone,
      template: 'verificationCode',
      templateData: userData,
      priority: 'high',
    });
  }

  async sendEmergencyAlert(alertData: {
    patientPhone: string;
    message: string;
  }): Promise<boolean> {
    return this.sendSMS({
      to: alertData.patientPhone,
      template: 'emergencyAlert',
      templateData: alertData,
      priority: 'high',
    });
  }

  async sendCheckInReminder(appointmentData: {
    patientPhone: string;
    patientName: string;
    providerName: string;
    appointmentDate: string;
  }): Promise<boolean> {
    return this.sendSMS({
      to: appointmentData.patientPhone,
      template: 'checkInReminder',
      templateData: appointmentData,
      priority: 'high',
    });
  }

  async sendBulkSMS(recipients: string[], message: string): Promise<{
    successful: number;
    failed: number;
    results: Array<{ phone: string; success: boolean; error?: string }>;
  }> {
    const results = [];
    let successful = 0;
    let failed = 0;

    for (const phone of recipients) {
      try {
        const success = await this.sendSMS({
          to: phone,
          message,
          priority: 'normal',
        });

        if (success) {
          successful++;
          results.push({ phone, success: true });
        } else {
          failed++;
          results.push({ phone, success: false, error: 'Send failed' });
        }
      } catch (error) {
        failed++;
        results.push({ phone, success: false, error: error.message });
      }
    }

    logger.info('Bulk SMS completed', {
      totalRecipients: recipients.length,
      successful,
      failed,
    });

    return { successful, failed, results };
  }

  async getDeliveryStatus(messageId: string): Promise<{
    status: string;
    deliveredAt?: Date;
    error?: string;
  } | null> {
    try {
      if (this.twilioClient && !this.useAWSSNS) {
        const message = await this.twilioClient.messages(messageId).fetch();
        return {
          status: message.status,
          deliveredAt: message.dateUpdated,
          error: message.errorMessage || undefined,
        };
      }
      
      // AWS SNS doesn't provide easy delivery status checking
      // You would need to set up SNS delivery status logging
      return null;
    } catch (error) {
      logger.error('Failed to get SMS delivery status', {
        error: error.message,
        messageId,
      });
      return null;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      if (this.useAWSSNS && this.snsClient) {
        // Test SNS connection
        return true;
      } else if (this.twilioClient) {
        // Test Twilio connection by fetching account info
        await this.twilioClient.api.accounts(config.sms.twilio.accountSid).fetch();
        return true;
      }
      return false;
    } catch (error) {
      logger.error('SMS service connection test failed', {
        error: error.message,
        provider: this.useAWSSNS ? 'aws-sns' : 'twilio',
      });
      return false;
    }
  }

  async getUsageStats(startDate: Date, endDate: Date): Promise<{
    totalSent: number;
    totalFailed: number;
    costEstimate: number;
    byProvider: Record<string, number>;
  }> {
    try {
      const logs = await prisma.smsLog.findMany({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        select: {
          status: true,
          provider: true,
        },
      });

      const totalSent = logs.filter(log => log.status === 'sent').length;
      const totalFailed = logs.filter(log => log.status === 'failed').length;
      
      // Estimate cost (Twilio: ~$0.0075 per SMS, AWS SNS: ~$0.00645 per SMS)
      const costPerSMS = this.useAWSSNS ? 0.00645 : 0.0075;
      const costEstimate = totalSent * costPerSMS;

      const byProvider = logs.reduce((acc, log) => {
        acc[log.provider] = (acc[log.provider] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return {
        totalSent,
        totalFailed,
        costEstimate,
        byProvider,
      };
    } catch (error) {
      logger.error('Failed to get SMS usage stats', {
        error: error.message,
        startDate,
        endDate,
      });
      
      return {
        totalSent: 0,
        totalFailed: 0,
        costEstimate: 0,
        byProvider: {},
      };
    }
  }
}

// Export singleton instance
const smsService = new SMSService();
export default smsService;

// Export individual functions for convenience
export const sendSMS = (options: SMSOptions) => smsService.sendSMS(options);
export const sendAppointmentReminder = (appointmentData: any) => smsService.sendAppointmentReminder(appointmentData);
export const sendAppointmentConfirmation = (appointmentData: any) => smsService.sendAppointmentConfirmation(appointmentData);
export const sendAppointmentCancellation = (appointmentData: any) => smsService.sendAppointmentCancellation(appointmentData);
export const sendAppointmentRescheduled = (appointmentData: any) => smsService.sendAppointmentRescheduled(appointmentData);
export const sendLabResultsNotification = (labData: any) => smsService.sendLabResultsNotification(labData);
export const sendMedicationReminder = (medicationData: any) => smsService.sendMedicationReminder(medicationData);
export const sendWelcomeSMS = (userData: any) => smsService.sendWelcomeSMS(userData);
export const sendPasswordResetCode = (userData: any) => smsService.sendPasswordResetCode(userData);
export const sendVerificationCode = (userData: any) => smsService.sendVerificationCode(userData);
export const sendEmergencyAlert = (alertData: any) => smsService.sendEmergencyAlert(alertData);
export const sendCheckInReminder = (appointmentData: any) => smsService.sendCheckInReminder(appointmentData);