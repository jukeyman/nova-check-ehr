/**
 * ============================================================================
 * NOVA CHECK EHR - ID GENERATORS AND UTILITIES
 * ============================================================================
 */

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Generate a unique patient ID
 * Format: NC-YYYYMMDD-XXXX (NC = Nova Check, YYYY = year, MM = month, DD = day, XXXX = sequential)
 */
export async function generatePatientId(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${year}${month}${day}`;
  
  // Find the highest sequence number for today
  const prefix = `NC-${datePrefix}-`;
  const lastPatient = await prisma.patient.findFirst({
    where: {
      patientId: {
        startsWith: prefix,
      },
    },
    orderBy: {
      patientId: 'desc',
    },
  });
  
  let sequence = 1;
  if (lastPatient?.patientId) {
    const lastSequence = parseInt(lastPatient.patientId.split('-')[2]);
    sequence = lastSequence + 1;
  }
  
  const sequenceStr = String(sequence).padStart(4, '0');
  return `NC-${datePrefix}-${sequenceStr}`;
}

/**
 * Generate a unique appointment ID
 * Format: APT-YYYYMMDD-XXXX
 */
export async function generateAppointmentId(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${year}${month}${day}`;
  
  const prefix = `APT-${datePrefix}-`;
  const lastAppointment = await prisma.appointment.findFirst({
    where: {
      appointmentId: {
        startsWith: prefix,
      },
    },
    orderBy: {
      appointmentId: 'desc',
    },
  });
  
  let sequence = 1;
  if (lastAppointment?.appointmentId) {
    const lastSequence = parseInt(lastAppointment.appointmentId.split('-')[2]);
    sequence = lastSequence + 1;
  }
  
  const sequenceStr = String(sequence).padStart(4, '0');
  return `APT-${datePrefix}-${sequenceStr}`;
}

/**
 * Generate a unique encounter ID
 * Format: ENC-YYYYMMDD-XXXX
 */
export async function generateEncounterId(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${year}${month}${day}`;
  
  const prefix = `ENC-${datePrefix}-`;
  const lastEncounter = await prisma.encounter.findFirst({
    where: {
      encounterId: {
        startsWith: prefix,
      },
    },
    orderBy: {
      encounterId: 'desc',
    },
  });
  
  let sequence = 1;
  if (lastEncounter?.encounterId) {
    const lastSequence = parseInt(lastEncounter.encounterId.split('-')[2]);
    sequence = lastSequence + 1;
  }
  
  const sequenceStr = String(sequence).padStart(4, '0');
  return `ENC-${datePrefix}-${sequenceStr}`;
}

/**
 * Generate a unique invoice number
 * Format: INV-YYYYMMDD-XXXX
 */
export async function generateInvoiceNumber(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${year}${month}${day}`;
  
  const prefix = `INV-${datePrefix}-`;
  const lastBilling = await prisma.billingRecord.findFirst({
    where: {
      invoiceNumber: {
        startsWith: prefix,
      },
    },
    orderBy: {
      invoiceNumber: 'desc',
    },
  });
  
  let sequence = 1;
  if (lastBilling?.invoiceNumber) {
    const lastSequence = parseInt(lastBilling.invoiceNumber.split('-')[2]);
    sequence = lastSequence + 1;
  }
  
  const sequenceStr = String(sequence).padStart(4, '0');
  return `INV-${datePrefix}-${sequenceStr}`;
}

/**
 * Generate a secure random token
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Generate a random verification code
 */
export function generateVerificationCode(length: number = 6): string {
  const chars = '0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a secure API key
 */
export function generateApiKey(): string {
  const prefix = 'nc_';
  const randomPart = crypto.randomBytes(32).toString('base64url');
  return `${prefix}${randomPart}`;
}

/**
 * Generate a session ID
 */
export function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a request ID for tracking
 */
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = crypto.randomBytes(8).toString('hex');
  return `req_${timestamp}_${randomPart}`;
}

/**
 * Generate a file upload ID
 */
export function generateFileId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = crypto.randomBytes(16).toString('hex');
  return `file_${timestamp}_${randomPart}`;
}

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = crypto.randomBytes(8).toString('hex');
  return `msg_${timestamp}_${randomPart}`;
}

/**
 * Generate a notification ID
 */
export function generateNotificationId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = crypto.randomBytes(8).toString('hex');
  return `notif_${timestamp}_${randomPart}`;
}

/**
 * Generate a backup ID
 */
export function generateBackupId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const randomPart = crypto.randomBytes(4).toString('hex');
  
  return `backup_${year}${month}${day}_${hour}${minute}_${randomPart}`;
}

/**
 * Generate a report ID
 */
export function generateReportId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = crypto.randomBytes(8).toString('hex');
  return `rpt_${timestamp}_${randomPart}`;
}

/**
 * Generate a workflow ID
 */
export function generateWorkflowId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = crypto.randomBytes(8).toString('hex');
  return `wf_${timestamp}_${randomPart}`;
}

/**
 * Generate a task ID
 */
export function generateTaskId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = crypto.randomBytes(8).toString('hex');
  return `task_${timestamp}_${randomPart}`;
}

/**
 * Generate a template ID
 */
export function generateTemplateId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = crypto.randomBytes(8).toString('hex');
  return `tpl_${timestamp}_${randomPart}`;
}

/**
 * Generate a claim number
 */
export async function generateClaimNumber(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${year}${month}${day}`;
  
  const prefix = `CLM-${datePrefix}-`;
  const lastClaim = await prisma.claim.findFirst({
    where: {
      claimNumber: {
        startsWith: prefix,
      },
    },
    orderBy: {
      claimNumber: 'desc',
    },
  });
  
  let sequence = 1;
  if (lastClaim?.claimNumber) {
    const lastSequence = parseInt(lastClaim.claimNumber.split('-')[2]);
    sequence = lastSequence + 1;
  }
  
  const sequenceStr = String(sequence).padStart(4, '0');
  return `CLM-${datePrefix}-${sequenceStr}`;
}

/**
 * Generate a provider license number (for testing/demo purposes)
 */
export function generateProviderLicense(state: string = 'CA'): string {
  const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
  const numericPart = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
  return `${state}${numericPart}${randomPart}`;
}

/**
 * Generate a DEA number (for testing/demo purposes)
 */
export function generateDEANumber(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const firstLetter = letters.charAt(Math.floor(Math.random() * letters.length));
  const secondLetter = letters.charAt(Math.floor(Math.random() * letters.length));
  const numbers = Math.floor(Math.random() * 10000000).toString().padStart(7, '0');
  
  return `${firstLetter}${secondLetter}${numbers}`;
}

/**
 * Generate an NPI number (for testing/demo purposes)
 */
export function generateNPINumber(): string {
  // NPI is 10 digits, starting with 1 or 2
  const firstDigit = Math.random() < 0.5 ? '1' : '2';
  const remainingDigits = Math.floor(Math.random() * 1000000000).toString().padStart(9, '0');
  return `${firstDigit}${remainingDigits}`;
}