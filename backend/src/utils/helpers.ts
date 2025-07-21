/**
 * ============================================================================
 * NOVA CHECK EHR - HELPER UTILITIES
 * ============================================================================
 */

import crypto from 'crypto';
import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';
import validator from 'validator';
import { BloodType, Gender } from '@prisma/client';

/**
 * Calculate age from date of birth
 */
export function calculateAge(dateOfBirth: Date | string): number {
  const dob = typeof dateOfBirth === 'string' ? new Date(dateOfBirth) : dateOfBirth;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  
  return age;
}

/**
 * Format phone number to standard format
 */
export function formatPhoneNumber(phone: string, country: string = 'US'): string {
  try {
    if (!isValidPhoneNumber(phone, country as any)) {
      throw new Error('Invalid phone number');
    }
    
    const phoneNumber = parsePhoneNumber(phone, country as any);
    return phoneNumber.formatNational();
  } catch (error) {
    // Fallback to basic formatting for US numbers
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    return phone; // Return original if can't format
  }
}

/**
 * Validate and normalize email address
 */
export function normalizeEmail(email: string): string {
  if (!validator.isEmail(email)) {
    throw new Error('Invalid email address');
  }
  return validator.normalizeEmail(email) || email.toLowerCase().trim();
}

/**
 * Calculate BMI from height and weight
 */
export function calculateBMI(weight: number, height: number, weightUnit: 'lbs' | 'kg' = 'lbs', heightUnit: 'in' | 'cm' = 'in'): number {
  // Convert to metric if needed
  let weightKg = weight;
  let heightM = height;
  
  if (weightUnit === 'lbs') {
    weightKg = weight * 0.453592;
  }
  
  if (heightUnit === 'in') {
    heightM = height * 0.0254;
  } else if (heightUnit === 'cm') {
    heightM = height / 100;
  }
  
  const bmi = weightKg / (heightM * heightM);
  return Math.round(bmi * 10) / 10; // Round to 1 decimal place
}

/**
 * Get BMI category
 */
export function getBMICategory(bmi: number): string {
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Normal weight';
  if (bmi < 30) return 'Overweight';
  return 'Obese';
}

/**
 * Format currency amount
 */
export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
}

/**
 * Format date to readable string
 */
export function formatDate(date: Date | string, format: 'short' | 'long' | 'time' = 'short'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  
  switch (format) {
    case 'long':
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    case 'time':
      return d.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    default:
      return d.toLocaleDateString('en-US');
  }
}

/**
 * Generate a secure hash
 */
export function generateHash(data: string, algorithm: string = 'sha256'): string {
  return crypto.createHash(algorithm).update(data).digest('hex');
}

/**
 * Generate a checksum for file integrity
 */
export function generateChecksum(buffer: Buffer, algorithm: string = 'md5'): string {
  return crypto.createHash(algorithm).update(buffer).digest('hex');
}

/**
 * Mask sensitive data (e.g., SSN, credit card)
 */
export function maskSensitiveData(data: string, visibleChars: number = 4): string {
  if (data.length <= visibleChars) {
    return '*'.repeat(data.length);
  }
  
  const masked = '*'.repeat(data.length - visibleChars);
  const visible = data.slice(-visibleChars);
  return masked + visible;
}

/**
 * Validate SSN format
 */
export function isValidSSN(ssn: string): boolean {
  const ssnRegex = /^\d{3}-?\d{2}-?\d{4}$/;
  return ssnRegex.test(ssn);
}

/**
 * Format SSN
 */
export function formatSSN(ssn: string): string {
  const cleaned = ssn.replace(/\D/g, '');
  if (cleaned.length === 9) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 5)}-${cleaned.slice(5)}`;
  }
  return ssn;
}

/**
 * Generate a random color (for UI purposes)
 */
export function generateRandomColor(): string {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * Convert string to title case
 */
export function toTitleCase(str: string): string {
  return str.replace(/\w\S*/g, (txt) => {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
}

/**
 * Sanitize filename for safe storage
 */
export function sanitizeFilename(filename: string): string {
  // Remove or replace unsafe characters
  return filename
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

/**
 * Check if file type is allowed
 */
export function isAllowedFileType(filename: string, allowedTypes: string[]): boolean {
  const extension = getFileExtension(filename);
  return allowedTypes.includes(extension);
}

/**
 * Convert bytes to human readable format
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Generate initials from name
 */
export function generateInitials(firstName: string, lastName: string): string {
  const first = firstName.charAt(0).toUpperCase();
  const last = lastName.charAt(0).toUpperCase();
  return `${first}${last}`;
}

/**
 * Check if date is in the past
 */
export function isDateInPast(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d < new Date();
}

/**
 * Check if date is in the future
 */
export function isDateInFuture(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d > new Date();
}

/**
 * Get days between two dates
 */
export function getDaysBetween(date1: Date | string, date2: Date | string): number {
  const d1 = typeof date1 === 'string' ? new Date(date1) : date1;
  const d2 = typeof date2 === 'string' ? new Date(date2) : date2;
  const timeDiff = Math.abs(d2.getTime() - d1.getTime());
  return Math.ceil(timeDiff / (1000 * 3600 * 24));
}

/**
 * Add days to a date
 */
export function addDays(date: Date | string, days: number): Date {
  const d = typeof date === 'string' ? new Date(date) : new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Check if time slot is available
 */
export function isTimeSlotAvailable(
  startTime: Date,
  endTime: Date,
  existingAppointments: Array<{ scheduledAt: Date; duration: number }>
): boolean {
  for (const appointment of existingAppointments) {
    const appointmentStart = appointment.scheduledAt;
    const appointmentEnd = new Date(appointmentStart.getTime() + appointment.duration * 60000);
    
    // Check for overlap
    if (
      (startTime >= appointmentStart && startTime < appointmentEnd) ||
      (endTime > appointmentStart && endTime <= appointmentEnd) ||
      (startTime <= appointmentStart && endTime >= appointmentEnd)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Generate time slots for a given date
 */
export function generateTimeSlots(
  date: Date,
  startHour: number = 9,
  endHour: number = 17,
  slotDuration: number = 30
): Date[] {
  const slots: Date[] = [];
  const slotDate = new Date(date);
  
  for (let hour = startHour; hour < endHour; hour++) {
    for (let minute = 0; minute < 60; minute += slotDuration) {
      const slot = new Date(slotDate);
      slot.setHours(hour, minute, 0, 0);
      slots.push(slot);
    }
  }
  
  return slots;
}

/**
 * Validate appointment time
 */
export function isValidAppointmentTime(dateTime: Date): boolean {
  const now = new Date();
  const appointmentDate = new Date(dateTime);
  
  // Must be in the future
  if (appointmentDate <= now) {
    return false;
  }
  
  // Must be during business hours (9 AM - 5 PM)
  const hour = appointmentDate.getHours();
  if (hour < 9 || hour >= 17) {
    return false;
  }
  
  // Must be on weekdays (Monday-Friday)
  const dayOfWeek = appointmentDate.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }
  
  return true;
}

/**
 * Get blood type compatibility
 */
export function getBloodTypeCompatibility(bloodType: BloodType): {
  canReceiveFrom: BloodType[];
  canDonateTo: BloodType[];
} {
  const compatibility: Record<BloodType, { canReceiveFrom: BloodType[]; canDonateTo: BloodType[] }> = {
    [BloodType.O_NEGATIVE]: {
      canReceiveFrom: [BloodType.O_NEGATIVE],
      canDonateTo: Object.values(BloodType).filter(bt => bt !== BloodType.UNKNOWN)
    },
    [BloodType.O_POSITIVE]: {
      canReceiveFrom: [BloodType.O_NEGATIVE, BloodType.O_POSITIVE],
      canDonateTo: [BloodType.O_POSITIVE, BloodType.A_POSITIVE, BloodType.B_POSITIVE, BloodType.AB_POSITIVE]
    },
    [BloodType.A_NEGATIVE]: {
      canReceiveFrom: [BloodType.O_NEGATIVE, BloodType.A_NEGATIVE],
      canDonateTo: [BloodType.A_NEGATIVE, BloodType.A_POSITIVE, BloodType.AB_NEGATIVE, BloodType.AB_POSITIVE]
    },
    [BloodType.A_POSITIVE]: {
      canReceiveFrom: [BloodType.O_NEGATIVE, BloodType.O_POSITIVE, BloodType.A_NEGATIVE, BloodType.A_POSITIVE],
      canDonateTo: [BloodType.A_POSITIVE, BloodType.AB_POSITIVE]
    },
    [BloodType.B_NEGATIVE]: {
      canReceiveFrom: [BloodType.O_NEGATIVE, BloodType.B_NEGATIVE],
      canDonateTo: [BloodType.B_NEGATIVE, BloodType.B_POSITIVE, BloodType.AB_NEGATIVE, BloodType.AB_POSITIVE]
    },
    [BloodType.B_POSITIVE]: {
      canReceiveFrom: [BloodType.O_NEGATIVE, BloodType.O_POSITIVE, BloodType.B_NEGATIVE, BloodType.B_POSITIVE],
      canDonateTo: [BloodType.B_POSITIVE, BloodType.AB_POSITIVE]
    },
    [BloodType.AB_NEGATIVE]: {
      canReceiveFrom: [BloodType.O_NEGATIVE, BloodType.A_NEGATIVE, BloodType.B_NEGATIVE, BloodType.AB_NEGATIVE],
      canDonateTo: [BloodType.AB_NEGATIVE, BloodType.AB_POSITIVE]
    },
    [BloodType.AB_POSITIVE]: {
      canReceiveFrom: Object.values(BloodType).filter(bt => bt !== BloodType.UNKNOWN),
      canDonateTo: [BloodType.AB_POSITIVE]
    },
    [BloodType.UNKNOWN]: {
      canReceiveFrom: [],
      canDonateTo: []
    }
  };
  
  return compatibility[bloodType] || { canReceiveFrom: [], canDonateTo: [] };
}

/**
 * Generate a patient summary
 */
export function generatePatientSummary(patient: any): string {
  const age = calculateAge(patient.dateOfBirth);
  const gender = patient.gender.toLowerCase();
  
  let summary = `${age}-year-old ${gender}`;
  
  if (patient.allergies && patient.allergies.length > 0) {
    const allergens = patient.allergies.map((a: any) => a.allergen).join(', ');
    summary += ` with allergies to ${allergens}`;
  }
  
  if (patient.conditions && patient.conditions.length > 0) {
    const activeConditions = patient.conditions
      .filter((c: any) => c.status === 'ACTIVE')
      .map((c: any) => c.description)
      .slice(0, 3)
      .join(', ');
    
    if (activeConditions) {
      summary += ` with active conditions: ${activeConditions}`;
    }
  }
  
  return summary;
}

/**
 * Validate medication dosage format
 */
export function isValidDosage(dosage: string): boolean {
  // Basic validation for common dosage formats
  const dosageRegex = /^\d+(\.\d+)?\s*(mg|g|ml|mcg|units?|iu|mEq)$/i;
  return dosageRegex.test(dosage.trim());
}

/**
 * Parse medication frequency to daily count
 */
export function parseFrequencyToDailyCount(frequency: string): number {
  const freq = frequency.toLowerCase().trim();
  
  if (freq.includes('once') || freq.includes('daily') || freq.includes('qd')) {
    return 1;
  } else if (freq.includes('twice') || freq.includes('bid')) {
    return 2;
  } else if (freq.includes('three times') || freq.includes('tid')) {
    return 3;
  } else if (freq.includes('four times') || freq.includes('qid')) {
    return 4;
  } else if (freq.includes('every 8 hours') || freq.includes('q8h')) {
    return 3;
  } else if (freq.includes('every 6 hours') || freq.includes('q6h')) {
    return 4;
  } else if (freq.includes('every 4 hours') || freq.includes('q4h')) {
    return 6;
  } else if (freq.includes('as needed') || freq.includes('prn')) {
    return 0; // Variable
  }
  
  // Try to extract number from string
  const match = freq.match(/\d+/);
  return match ? parseInt(match[0]) : 1;
}

/**
 * Generate medication instructions
 */
export function generateMedicationInstructions(
  name: string,
  dosage: string,
  frequency: string,
  route: string
): string {
  const routeText = route.toLowerCase() === 'oral' ? 'by mouth' : route.toLowerCase();
  return `Take ${dosage} of ${name} ${routeText} ${frequency.toLowerCase()}`;
}