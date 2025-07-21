/**
 * ============================================================================
 * NOVA CHECK EHR - EMAIL SERVICE
 * ============================================================================
 */

import nodemailer from 'nodemailer';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { PrismaClient } from '@prisma/client';
import logger from '../config/logger';
import { config } from '../config/config';
import { format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

interface EmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  from?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
  priority?: 'high' | 'normal' | 'low';
  template?: string;
  templateData?: Record<string, any>;
}

interface EmailTemplate {
  subject: string;
  html: string;
  text?: string;
}

class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private sesClient: SESClient | null = null;
  private useAWSSES: boolean;

  constructor() {
    this.useAWSSES = config.email.provider === 'aws-ses';
    this.initializeTransporter();
  }

  private initializeTransporter() {
    if (this.useAWSSES) {
      this.sesClient = new SESClient({
        region: config.aws.region,
        credentials: {
          accessKeyId: config.aws.accessKeyId,
          secretAccessKey: config.aws.secretAccessKey,
        },
      });
    } else {
      // Use SMTP (Gmail, Outlook, etc.)
      this.transporter = nodemailer.createTransporter({
        host: config.email.smtp.host,
        port: config.email.smtp.port,
        secure: config.email.smtp.secure,
        auth: {
          user: config.email.smtp.user,
          pass: config.email.smtp.password,
        },
        tls: {
          rejectUnauthorized: false,
        },
      });
    }
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      const emailId = uuidv4();
      const recipients = Array.isArray(options.to) ? options.to : [options.to];

      // Process template if provided
      let { subject, html, text } = options;
      if (options.template && options.templateData) {
        const template = await this.getTemplate(options.template, options.templateData);
        subject = template.subject;
        html = template.html;
        text = template.text || text;
      }

      const emailData = {
        from: options.from || config.email.from,
        to: recipients,
        subject,
        text,
        html,
        replyTo: options.replyTo,
        attachments: options.attachments,
      };

      let result;
      if (this.useAWSSES && this.sesClient) {
        result = await this.sendWithSES(emailData);
      } else if (this.transporter) {
        result = await this.sendWithSMTP(emailData);
      } else {
        throw new Error('No email transport configured');
      }

      // Log email sent
      await this.logEmail({
        id: emailId,
        to: recipients,
        subject,
        status: 'sent',
        provider: this.useAWSSES ? 'aws-ses' : 'smtp',
        messageId: result.messageId,
      });

      logger.info('Email sent successfully', {
        emailId,
        to: recipients,
        subject,
        provider: this.useAWSSES ? 'aws-ses' : 'smtp',
      });

      return true;
    } catch (error) {
      logger.error('Failed to send email', {
        error: error.message,
        to: options.to,
        subject: options.subject,
      });

      // Log failed email
      await this.logEmail({
        id: uuidv4(),
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        status: 'failed',
        error: error.message,
        provider: this.useAWSSES ? 'aws-ses' : 'smtp',
      });

      return false;
    }
  }

  private async sendWithSES(emailData: any) {
    const command = new SendEmailCommand({
      Source: emailData.from,
      Destination: {
        ToAddresses: emailData.to,
      },
      Message: {
        Subject: {
          Data: emailData.subject,
          Charset: 'UTF-8',
        },
        Body: {
          Text: emailData.text ? {
            Data: emailData.text,
            Charset: 'UTF-8',
          } : undefined,
          Html: emailData.html ? {
            Data: emailData.html,
            Charset: 'UTF-8',
          } : undefined,
        },
      },
      ReplyToAddresses: emailData.replyTo ? [emailData.replyTo] : undefined,
    });

    const result = await this.sesClient!.send(command);
    return { messageId: result.MessageId };
  }

  private async sendWithSMTP(emailData: any) {
    return await this.transporter!.sendMail(emailData);
  }

  private async getTemplate(templateName: string, data: Record<string, any>): Promise<EmailTemplate> {
    const templates: Record<string, (data: any) => EmailTemplate> = {
      welcome: (data) => ({
        subject: `Welcome to Nova Check EHR, ${data.firstName}!`,
        html: this.generateWelcomeTemplate(data),
        text: `Welcome to Nova Check EHR, ${data.firstName}! Your account has been created successfully.`,
      }),
      appointmentReminder: (data) => ({
        subject: `Appointment Reminder - ${format(new Date(data.appointmentDate), 'PPP p')}`,
        html: this.generateAppointmentReminderTemplate(data),
        text: `You have an appointment scheduled for ${format(new Date(data.appointmentDate), 'PPP p')} with Dr. ${data.providerName}.`,
      }),
      appointmentConfirmation: (data) => ({
        subject: `Appointment Confirmed - ${format(new Date(data.appointmentDate), 'PPP p')}`,
        html: this.generateAppointmentConfirmationTemplate(data),
        text: `Your appointment has been confirmed for ${format(new Date(data.appointmentDate), 'PPP p')} with Dr. ${data.providerName}.`,
      }),
      passwordReset: (data) => ({
        subject: 'Password Reset Request - Nova Check EHR',
        html: this.generatePasswordResetTemplate(data),
        text: `You requested a password reset. Use this token: ${data.resetToken}`,
      }),
      emailVerification: (data) => ({
        subject: 'Verify Your Email - Nova Check EHR',
        html: this.generateEmailVerificationTemplate(data),
        text: `Please verify your email using this token: ${data.verificationToken}`,
      }),
      labResults: (data) => ({
        subject: 'Lab Results Available - Nova Check EHR',
        html: this.generateLabResultsTemplate(data),
        text: `Your lab results are now available in your patient portal.`,
      }),
      medicationReminder: (data) => ({
        subject: 'Medication Reminder - Nova Check EHR',
        html: this.generateMedicationReminderTemplate(data),
        text: `Reminder: Take your ${data.medicationName} as prescribed.`,
      }),
    };

    const templateFunction = templates[templateName];
    if (!templateFunction) {
      throw new Error(`Email template '${templateName}' not found`);
    }

    return templateFunction(data);
  }

  private generateWelcomeTemplate(data: any): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="utf-8">
          <title>Welcome to Nova Check EHR</title>
          <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #2563eb; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { padding: 30px; background: #f9fafb; border-radius: 0 0 8px 8px; }
              .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
              .footer { padding: 20px; text-align: center; color: #6b7280; font-size: 14px; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>Welcome to Nova Check EHR!</h1>
              </div>
              <div class="content">
                  <h2>Hello ${data.firstName},</h2>
                  <p>Welcome to Nova Check EHR! Your account has been successfully created.</p>
                  <p><strong>Account Details:</strong></p>
                  <ul>
                      <li>Email: ${data.email}</li>
                      <li>Role: ${data.role}</li>
                      <li>Account Created: ${format(new Date(), 'PPP')}</li>
                  </ul>
                  ${data.temporaryPassword ? `
                  <p><strong>Temporary Password:</strong> ${data.temporaryPassword}</p>
                  <p style="color: #dc2626;">Please change your password after your first login.</p>
                  ` : ''}
                  <a href="${config.frontend.url}/login" class="button">Login to Your Account</a>
                  <p>If you have any questions, please contact our support team.</p>
              </div>
              <div class="footer">
                  <p>This is an automated message from Nova Check EHR.</p>
                  <p>© ${new Date().getFullYear()} Nova Check EHR. All rights reserved.</p>
              </div>
          </div>
      </body>
      </html>
    `;
  }

  private generateAppointmentReminderTemplate(data: any): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="utf-8">
          <title>Appointment Reminder</title>
          <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #059669; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { padding: 30px; background: #f9fafb; border-radius: 0 0 8px 8px; }
              .appointment-details { background: white; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #059669; }
              .button { display: inline-block; background: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
              .footer { padding: 20px; text-align: center; color: #6b7280; font-size: 14px; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>Appointment Reminder</h1>
              </div>
              <div class="content">
                  <h2>Hello ${data.patientName},</h2>
                  <p>This is a reminder about your upcoming appointment.</p>
                  <div class="appointment-details">
                      <h3>Appointment Details</h3>
                      <p><strong>Date & Time:</strong> ${format(new Date(data.appointmentDate), 'PPP p')}</p>
                      <p><strong>Provider:</strong> Dr. ${data.providerName}</p>
                      <p><strong>Type:</strong> ${data.appointmentType}</p>
                      ${data.location ? `<p><strong>Location:</strong> ${data.location}</p>` : ''}
                      ${data.notes ? `<p><strong>Notes:</strong> ${data.notes}</p>` : ''}
                  </div>
                  <p>Please arrive 15 minutes early for check-in.</p>
                  <a href="${config.frontend.url}/appointments" class="button">View Appointment</a>
                  <p>If you need to reschedule or cancel, please contact us at least 24 hours in advance.</p>
              </div>
              <div class="footer">
                  <p>This is an automated reminder from Nova Check EHR.</p>
                  <p>© ${new Date().getFullYear()} Nova Check EHR. All rights reserved.</p>
              </div>
          </div>
      </body>
      </html>
    `;
  }

  private generateAppointmentConfirmationTemplate(data: any): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="utf-8">
          <title>Appointment Confirmed</title>
          <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #2563eb; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { padding: 30px; background: #f9fafb; border-radius: 0 0 8px 8px; }
              .appointment-details { background: white; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #2563eb; }
              .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
              .footer { padding: 20px; text-align: center; color: #6b7280; font-size: 14px; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>Appointment Confirmed</h1>
              </div>
              <div class="content">
                  <h2>Hello ${data.patientName},</h2>
                  <p>Your appointment has been confirmed!</p>
                  <div class="appointment-details">
                      <h3>Appointment Details</h3>
                      <p><strong>Date & Time:</strong> ${format(new Date(data.appointmentDate), 'PPP p')}</p>
                      <p><strong>Provider:</strong> Dr. ${data.providerName}</p>
                      <p><strong>Type:</strong> ${data.appointmentType}</p>
                      ${data.location ? `<p><strong>Location:</strong> ${data.location}</p>` : ''}
                      <p><strong>Confirmation Number:</strong> ${data.confirmationNumber}</p>
                  </div>
                  <p>We look forward to seeing you at your appointment.</p>
                  <a href="${config.frontend.url}/appointments" class="button">View Appointment</a>
                  <p>If you have any questions or need to make changes, please contact us.</p>
              </div>
              <div class="footer">
                  <p>This is an automated confirmation from Nova Check EHR.</p>
                  <p>© ${new Date().getFullYear()} Nova Check EHR. All rights reserved.</p>
              </div>
          </div>
      </body>
      </html>
    `;
  }

  private generatePasswordResetTemplate(data: any): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="utf-8">
          <title>Password Reset Request</title>
          <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #dc2626; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { padding: 30px; background: #f9fafb; border-radius: 0 0 8px 8px; }
              .button { display: inline-block; background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
              .token { background: #f3f4f6; padding: 15px; border-radius: 6px; font-family: monospace; font-size: 16px; text-align: center; margin: 20px 0; }
              .footer { padding: 20px; text-align: center; color: #6b7280; font-size: 14px; }
              .warning { background: #fef2f2; border: 1px solid #fecaca; padding: 15px; border-radius: 6px; margin: 20px 0; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>Password Reset Request</h1>
              </div>
              <div class="content">
                  <h2>Hello ${data.firstName},</h2>
                  <p>You requested a password reset for your Nova Check EHR account.</p>
                  <div class="warning">
                      <p><strong>Security Notice:</strong> If you did not request this password reset, please ignore this email and contact support immediately.</p>
                  </div>
                  <p>Use the link below to reset your password:</p>
                  <a href="${config.frontend.url}/reset-password?token=${data.resetToken}" class="button">Reset Password</a>
                  <p>Or copy and paste this token:</p>
                  <div class="token">${data.resetToken}</div>
                  <p>This link will expire in ${data.expiresIn || '1 hour'}.</p>
              </div>
              <div class="footer">
                  <p>This is an automated message from Nova Check EHR.</p>
                  <p>© ${new Date().getFullYear()} Nova Check EHR. All rights reserved.</p>
              </div>
          </div>
      </body>
      </html>
    `;
  }

  private generateEmailVerificationTemplate(data: any): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="utf-8">
          <title>Verify Your Email</title>
          <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #7c3aed; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { padding: 30px; background: #f9fafb; border-radius: 0 0 8px 8px; }
              .button { display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
              .token { background: #f3f4f6; padding: 15px; border-radius: 6px; font-family: monospace; font-size: 16px; text-align: center; margin: 20px 0; }
              .footer { padding: 20px; text-align: center; color: #6b7280; font-size: 14px; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>Verify Your Email</h1>
              </div>
              <div class="content">
                  <h2>Hello ${data.firstName},</h2>
                  <p>Please verify your email address to complete your Nova Check EHR account setup.</p>
                  <a href="${config.frontend.url}/verify-email?token=${data.verificationToken}" class="button">Verify Email</a>
                  <p>Or copy and paste this verification code:</p>
                  <div class="token">${data.verificationToken}</div>
                  <p>This verification link will expire in ${data.expiresIn || '24 hours'}.</p>
              </div>
              <div class="footer">
                  <p>This is an automated message from Nova Check EHR.</p>
                  <p>© ${new Date().getFullYear()} Nova Check EHR. All rights reserved.</p>
              </div>
          </div>
      </body>
      </html>
    `;
  }

  private generateLabResultsTemplate(data: any): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="utf-8">
          <title>Lab Results Available</title>
          <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #0891b2; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { padding: 30px; background: #f9fafb; border-radius: 0 0 8px 8px; }
              .button { display: inline-block; background: #0891b2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
              .footer { padding: 20px; text-align: center; color: #6b7280; font-size: 14px; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>Lab Results Available</h1>
              </div>
              <div class="content">
                  <h2>Hello ${data.patientName},</h2>
                  <p>Your lab results are now available in your patient portal.</p>
                  <p><strong>Test Date:</strong> ${format(new Date(data.testDate), 'PPP')}</p>
                  <p><strong>Ordered by:</strong> Dr. ${data.providerName}</p>
                  <a href="${config.frontend.url}/lab-results" class="button">View Results</a>
                  <p>If you have questions about your results, please contact your healthcare provider.</p>
              </div>
              <div class="footer">
                  <p>This is an automated notification from Nova Check EHR.</p>
                  <p>© ${new Date().getFullYear()} Nova Check EHR. All rights reserved.</p>
              </div>
          </div>
      </body>
      </html>
    `;
  }

  private generateMedicationReminderTemplate(data: any): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta charset="utf-8">
          <title>Medication Reminder</title>
          <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #f59e0b; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { padding: 30px; background: #f9fafb; border-radius: 0 0 8px 8px; }
              .medication-details { background: white; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #f59e0b; }
              .button { display: inline-block; background: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
              .footer { padding: 20px; text-align: center; color: #6b7280; font-size: 14px; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>Medication Reminder</h1>
              </div>
              <div class="content">
                  <h2>Hello ${data.patientName},</h2>
                  <p>This is a reminder to take your medication as prescribed.</p>
                  <div class="medication-details">
                      <h3>Medication Details</h3>
                      <p><strong>Medication:</strong> ${data.medicationName}</p>
                      <p><strong>Dosage:</strong> ${data.dosage}</p>
                      <p><strong>Frequency:</strong> ${data.frequency}</p>
                      ${data.instructions ? `<p><strong>Instructions:</strong> ${data.instructions}</p>` : ''}
                  </div>
                  <a href="${config.frontend.url}/medications" class="button">View All Medications</a>
                  <p>If you have questions about your medication, please contact your healthcare provider.</p>
              </div>
              <div class="footer">
                  <p>This is an automated reminder from Nova Check EHR.</p>
                  <p>© ${new Date().getFullYear()} Nova Check EHR. All rights reserved.</p>
              </div>
          </div>
      </body>
      </html>
    `;
  }

  private async logEmail(emailLog: {
    id: string;
    to: string[];
    subject: string;
    status: 'sent' | 'failed';
    provider: string;
    messageId?: string;
    error?: string;
  }) {
    try {
      await prisma.emailLog.create({
        data: {
          id: emailLog.id,
          recipients: emailLog.to,
          subject: emailLog.subject,
          status: emailLog.status,
          provider: emailLog.provider,
          messageId: emailLog.messageId,
          error: emailLog.error,
          sentAt: emailLog.status === 'sent' ? new Date() : null,
        },
      });
    } catch (error) {
      logger.error('Failed to log email', {
        error: error.message,
        emailId: emailLog.id,
      });
    }
  }

  async sendWelcomeEmail(userData: {
    email: string;
    firstName: string;
    role: string;
    temporaryPassword?: string;
  }): Promise<boolean> {
    return this.sendEmail({
      to: userData.email,
      template: 'welcome',
      templateData: userData,
      priority: 'normal',
    });
  }

  async sendAppointmentReminder(appointmentData: {
    patientEmail: string;
    patientName: string;
    providerName: string;
    appointmentDate: string;
    appointmentType: string;
    location?: string;
    notes?: string;
  }): Promise<boolean> {
    return this.sendEmail({
      to: appointmentData.patientEmail,
      template: 'appointmentReminder',
      templateData: appointmentData,
      priority: 'high',
    });
  }

  async sendAppointmentConfirmation(appointmentData: {
    patientEmail: string;
    patientName: string;
    providerName: string;
    appointmentDate: string;
    appointmentType: string;
    confirmationNumber: string;
    location?: string;
  }): Promise<boolean> {
    return this.sendEmail({
      to: appointmentData.patientEmail,
      template: 'appointmentConfirmation',
      templateData: appointmentData,
      priority: 'normal',
    });
  }

  async sendPasswordResetEmail(userData: {
    email: string;
    firstName: string;
    resetToken: string;
    expiresIn?: string;
  }): Promise<boolean> {
    return this.sendEmail({
      to: userData.email,
      template: 'passwordReset',
      templateData: userData,
      priority: 'high',
    });
  }

  async sendEmailVerification(userData: {
    email: string;
    firstName: string;
    verificationToken: string;
    expiresIn?: string;
  }): Promise<boolean> {
    return this.sendEmail({
      to: userData.email,
      template: 'emailVerification',
      templateData: userData,
      priority: 'high',
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      if (this.useAWSSES && this.sesClient) {
        // Test SES connection by sending a test email to a verified address
        return true;
      } else if (this.transporter) {
        await this.transporter.verify();
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Email service connection test failed', {
        error: error.message,
        provider: this.useAWSSES ? 'aws-ses' : 'smtp',
      });
      return false;
    }
  }
}

// Export singleton instance
const emailService = new EmailService();
export default emailService;

// Export individual functions for convenience
export const sendEmail = (options: EmailOptions) => emailService.sendEmail(options);
export const sendWelcomeEmail = (userData: any) => emailService.sendWelcomeEmail(userData);
export const sendAppointmentReminder = (appointmentData: any) => emailService.sendAppointmentReminder(appointmentData);
export const sendAppointmentConfirmation = (appointmentData: any) => emailService.sendAppointmentConfirmation(appointmentData);
export const sendPasswordResetEmail = (userData: any) => emailService.sendPasswordResetEmail(userData);
export const sendEmailVerification = (userData: any) => emailService.sendEmailVerification(userData);