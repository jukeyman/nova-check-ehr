// ============================================================================
// DATE UTILITIES
// ============================================================================

/**
 * Comprehensive date utilities for EHR system
 * Handles formatting, calculations, medical-specific date operations
 */

// ============================================================================
// TYPES
// ============================================================================

export interface DateRange {
  start: Date;
  end: Date;
}

export interface TimeSlot {
  start: Date;
  end: Date;
  duration: number; // in minutes
}

export interface BusinessHours {
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, etc.
  startTime: string; // HH:mm format
  endTime: string; // HH:mm format
  isOpen: boolean;
}

export interface Holiday {
  date: Date;
  name: string;
  isRecurring: boolean;
}

export type DateFormat = 
  | 'MM/dd/yyyy'
  | 'dd/MM/yyyy'
  | 'yyyy-MM-dd'
  | 'MMM dd, yyyy'
  | 'MMMM dd, yyyy'
  | 'dd MMM yyyy'
  | 'EEE, MMM dd, yyyy'
  | 'EEEE, MMMM dd, yyyy';

export type TimeFormat = 
  | 'HH:mm'
  | 'hh:mm a'
  | 'HH:mm:ss'
  | 'hh:mm:ss a';

// ============================================================================
// CONSTANTS
// ============================================================================

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

const DAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
];

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const MILLISECONDS_PER_MINUTE = 60 * 1000;

// Common medical date ranges
const MEDICAL_DATE_RANGES = {
  TODAY: 'today',
  YESTERDAY: 'yesterday',
  LAST_7_DAYS: 'last7days',
  LAST_30_DAYS: 'last30days',
  LAST_90_DAYS: 'last90days',
  LAST_6_MONTHS: 'last6months',
  LAST_YEAR: 'lastyear',
  THIS_MONTH: 'thismonth',
  THIS_YEAR: 'thisyear',
  CUSTOM: 'custom'
} as const;

// ============================================================================
// BASIC DATE FUNCTIONS
// ============================================================================

/**
 * Check if a value is a valid date
 */
export const isValidDate = (date: any): date is Date => {
  return date instanceof Date && !isNaN(date.getTime());
};

/**
 * Parse date from various formats
 */
export const parseDate = (dateInput: string | number | Date): Date | null => {
  if (dateInput instanceof Date) {
    return isValidDate(dateInput) ? dateInput : null;
  }
  
  const parsed = new Date(dateInput);
  return isValidDate(parsed) ? parsed : null;
};

/**
 * Get current date without time
 */
export const today = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

/**
 * Get yesterday's date
 */
export const yesterday = (): Date => {
  const date = today();
  date.setDate(date.getDate() - 1);
  return date;
};

/**
 * Get tomorrow's date
 */
export const tomorrow = (): Date => {
  const date = today();
  date.setDate(date.getDate() + 1);
  return date;
};

/**
 * Get start of day
 */
export const startOfDay = (date: Date): Date => {
  const newDate = new Date(date);
  newDate.setHours(0, 0, 0, 0);
  return newDate;
};

/**
 * Get end of day
 */
export const endOfDay = (date: Date): Date => {
  const newDate = new Date(date);
  newDate.setHours(23, 59, 59, 999);
  return newDate;
};

/**
 * Get start of week (Sunday)
 */
export const startOfWeek = (date: Date): Date => {
  const newDate = new Date(date);
  const day = newDate.getDay();
  newDate.setDate(newDate.getDate() - day);
  return startOfDay(newDate);
};

/**
 * Get end of week (Saturday)
 */
export const endOfWeek = (date: Date): Date => {
  const newDate = new Date(date);
  const day = newDate.getDay();
  newDate.setDate(newDate.getDate() + (6 - day));
  return endOfDay(newDate);
};

/**
 * Get start of month
 */
export const startOfMonth = (date: Date): Date => {
  const newDate = new Date(date);
  newDate.setDate(1);
  return startOfDay(newDate);
};

/**
 * Get end of month
 */
export const endOfMonth = (date: Date): Date => {
  const newDate = new Date(date);
  newDate.setMonth(newDate.getMonth() + 1, 0);
  return endOfDay(newDate);
};

/**
 * Get start of year
 */
export const startOfYear = (date: Date): Date => {
  const newDate = new Date(date);
  newDate.setMonth(0, 1);
  return startOfDay(newDate);
};

/**
 * Get end of year
 */
export const endOfYear = (date: Date): Date => {
  const newDate = new Date(date);
  newDate.setMonth(11, 31);
  return endOfDay(newDate);
};

// ============================================================================
// DATE ARITHMETIC
// ============================================================================

/**
 * Add days to a date
 */
export const addDays = (date: Date, days: number): Date => {
  const newDate = new Date(date);
  newDate.setDate(newDate.getDate() + days);
  return newDate;
};

/**
 * Add weeks to a date
 */
export const addWeeks = (date: Date, weeks: number): Date => {
  return addDays(date, weeks * 7);
};

/**
 * Add months to a date
 */
export const addMonths = (date: Date, months: number): Date => {
  const newDate = new Date(date);
  newDate.setMonth(newDate.getMonth() + months);
  return newDate;
};

/**
 * Add years to a date
 */
export const addYears = (date: Date, years: number): Date => {
  const newDate = new Date(date);
  newDate.setFullYear(newDate.getFullYear() + years);
  return newDate;
};

/**
 * Add hours to a date
 */
export const addHours = (date: Date, hours: number): Date => {
  const newDate = new Date(date);
  newDate.setHours(newDate.getHours() + hours);
  return newDate;
};

/**
 * Add minutes to a date
 */
export const addMinutes = (date: Date, minutes: number): Date => {
  const newDate = new Date(date);
  newDate.setMinutes(newDate.getMinutes() + minutes);
  return newDate;
};

/**
 * Subtract days from a date
 */
export const subtractDays = (date: Date, days: number): Date => {
  return addDays(date, -days);
};

/**
 * Subtract months from a date
 */
export const subtractMonths = (date: Date, months: number): Date => {
  return addMonths(date, -months);
};

/**
 * Subtract years from a date
 */
export const subtractYears = (date: Date, years: number): Date => {
  return addYears(date, -years);
};

// ============================================================================
// DATE COMPARISON
// ============================================================================

/**
 * Check if two dates are the same day
 */
export const isSameDay = (date1: Date, date2: Date): boolean => {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
};

/**
 * Check if two dates are in the same week
 */
export const isSameWeek = (date1: Date, date2: Date): boolean => {
  const start1 = startOfWeek(date1);
  const start2 = startOfWeek(date2);
  return isSameDay(start1, start2);
};

/**
 * Check if two dates are in the same month
 */
export const isSameMonth = (date1: Date, date2: Date): boolean => {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth()
  );
};

/**
 * Check if two dates are in the same year
 */
export const isSameYear = (date1: Date, date2: Date): boolean => {
  return date1.getFullYear() === date2.getFullYear();
};

/**
 * Check if date is today
 */
export const isToday = (date: Date): boolean => {
  return isSameDay(date, new Date());
};

/**
 * Check if date is yesterday
 */
export const isYesterday = (date: Date): boolean => {
  return isSameDay(date, yesterday());
};

/**
 * Check if date is tomorrow
 */
export const isTomorrow = (date: Date): boolean => {
  return isSameDay(date, tomorrow());
};

/**
 * Check if date is in the past
 */
export const isPast = (date: Date): boolean => {
  return date < new Date();
};

/**
 * Check if date is in the future
 */
export const isFuture = (date: Date): boolean => {
  return date > new Date();
};

/**
 * Check if date is a weekend
 */
export const isWeekend = (date: Date): boolean => {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday or Saturday
};

/**
 * Check if date is a weekday
 */
export const isWeekday = (date: Date): boolean => {
  return !isWeekend(date);
};

// ============================================================================
// DATE DIFFERENCES
// ============================================================================

/**
 * Get difference in days between two dates
 */
export const differenceInDays = (date1: Date, date2: Date): number => {
  const diffTime = Math.abs(date1.getTime() - date2.getTime());
  return Math.ceil(diffTime / MILLISECONDS_PER_DAY);
};

/**
 * Get difference in hours between two dates
 */
export const differenceInHours = (date1: Date, date2: Date): number => {
  const diffTime = Math.abs(date1.getTime() - date2.getTime());
  return Math.floor(diffTime / MILLISECONDS_PER_HOUR);
};

/**
 * Get difference in minutes between two dates
 */
export const differenceInMinutes = (date1: Date, date2: Date): number => {
  const diffTime = Math.abs(date1.getTime() - date2.getTime());
  return Math.floor(diffTime / MILLISECONDS_PER_MINUTE);
};

/**
 * Get difference in months between two dates
 */
export const differenceInMonths = (date1: Date, date2: Date): number => {
  const yearDiff = date1.getFullYear() - date2.getFullYear();
  const monthDiff = date1.getMonth() - date2.getMonth();
  return Math.abs(yearDiff * 12 + monthDiff);
};

/**
 * Get difference in years between two dates
 */
export const differenceInYears = (date1: Date, date2: Date): number => {
  return Math.abs(date1.getFullYear() - date2.getFullYear());
};

/**
 * Calculate age from date of birth
 */
export const calculateAge = (dateOfBirth: Date, referenceDate: Date = new Date()): number => {
  let age = referenceDate.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = referenceDate.getMonth() - dateOfBirth.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < dateOfBirth.getDate())) {
    age--;
  }
  
  return age;
};

/**
 * Calculate age with months for infants
 */
export const calculateAgeWithMonths = (dateOfBirth: Date, referenceDate: Date = new Date()): {
  years: number;
  months: number;
  totalMonths: number;
} => {
  const totalMonths = differenceInMonths(referenceDate, dateOfBirth);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  
  return { years, months, totalMonths };
};

// ============================================================================
// DATE FORMATTING
// ============================================================================

/**
 * Format date according to specified format
 */
export const formatDate = (date: Date, format: DateFormat = 'MM/dd/yyyy'): string => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const dayOfWeek = date.getDay();
  
  const pad = (num: number): string => num.toString().padStart(2, '0');
  
  switch (format) {
    case 'MM/dd/yyyy':
      return `${pad(month + 1)}/${pad(day)}/${year}`;
    case 'dd/MM/yyyy':
      return `${pad(day)}/${pad(month + 1)}/${year}`;
    case 'yyyy-MM-dd':
      return `${year}-${pad(month + 1)}-${pad(day)}`;
    case 'MMM dd, yyyy':
      return `${MONTHS_SHORT[month]} ${day}, ${year}`;
    case 'MMMM dd, yyyy':
      return `${MONTHS[month]} ${day}, ${year}`;
    case 'dd MMM yyyy':
      return `${day} ${MONTHS_SHORT[month]} ${year}`;
    case 'EEE, MMM dd, yyyy':
      return `${DAYS_SHORT[dayOfWeek]}, ${MONTHS_SHORT[month]} ${day}, ${year}`;
    case 'EEEE, MMMM dd, yyyy':
      return `${DAYS[dayOfWeek]}, ${MONTHS[month]} ${day}, ${year}`;
    default:
      return date.toLocaleDateString();
  }
};

/**
 * Format time according to specified format
 */
export const formatTime = (date: Date, format: TimeFormat = 'hh:mm a'): string => {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  
  const pad = (num: number): string => num.toString().padStart(2, '0');
  
  switch (format) {
    case 'HH:mm':
      return `${pad(hours)}:${pad(minutes)}`;
    case 'hh:mm a': {
      const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
      const ampm = hours >= 12 ? 'PM' : 'AM';
      return `${hour12}:${pad(minutes)} ${ampm}`;
    }
    case 'HH:mm:ss':
      return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    case 'hh:mm:ss a': {
      const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
      const ampm = hours >= 12 ? 'PM' : 'AM';
      return `${hour12}:${pad(minutes)}:${pad(seconds)} ${ampm}`;
    }
    default:
      return date.toLocaleTimeString();
  }
};

/**
 * Format date and time together
 */
export const formatDateTime = (
  date: Date,
  dateFormat: DateFormat = 'MM/dd/yyyy',
  timeFormat: TimeFormat = 'hh:mm a'
): string => {
  return `${formatDate(date, dateFormat)} ${formatTime(date, timeFormat)}`;
};

/**
 * Format relative time (e.g., "2 hours ago", "in 3 days")
 */
export const formatRelativeTime = (date: Date, referenceDate: Date = new Date()): string => {
  const diffMs = date.getTime() - referenceDate.getTime();
  const isPast = diffMs < 0;
  const absDiffMs = Math.abs(diffMs);
  
  const minutes = Math.floor(absDiffMs / MILLISECONDS_PER_MINUTE);
  const hours = Math.floor(absDiffMs / MILLISECONDS_PER_HOUR);
  const days = Math.floor(absDiffMs / MILLISECONDS_PER_DAY);
  
  if (minutes < 1) {
    return 'just now';
  } else if (minutes < 60) {
    return isPast ? `${minutes} minute${minutes > 1 ? 's' : ''} ago` : `in ${minutes} minute${minutes > 1 ? 's' : ''}`;
  } else if (hours < 24) {
    return isPast ? `${hours} hour${hours > 1 ? 's' : ''} ago` : `in ${hours} hour${hours > 1 ? 's' : ''}`;
  } else if (days < 7) {
    return isPast ? `${days} day${days > 1 ? 's' : ''} ago` : `in ${days} day${days > 1 ? 's' : ''}`;
  } else {
    return formatDate(date);
  }
};

/**
 * Format duration in minutes to human readable format
 */
export const formatDuration = (minutes: number): string => {
  if (minutes < 60) {
    return `${minutes} min${minutes !== 1 ? 's' : ''}`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  if (remainingMinutes === 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  
  return `${hours}h ${remainingMinutes}m`;
};

// ============================================================================
// MEDICAL DATE RANGES
// ============================================================================

/**
 * Get predefined medical date ranges
 */
export const getMedicalDateRange = (range: keyof typeof MEDICAL_DATE_RANGES): DateRange => {
  const now = new Date();
  const todayStart = startOfDay(now);
  
  switch (range) {
    case 'TODAY':
      return { start: todayStart, end: endOfDay(now) };
    
    case 'YESTERDAY':
      const yesterdayDate = yesterday();
      return { start: startOfDay(yesterdayDate), end: endOfDay(yesterdayDate) };
    
    case 'LAST_7_DAYS':
      return { start: subtractDays(todayStart, 6), end: endOfDay(now) };
    
    case 'LAST_30_DAYS':
      return { start: subtractDays(todayStart, 29), end: endOfDay(now) };
    
    case 'LAST_90_DAYS':
      return { start: subtractDays(todayStart, 89), end: endOfDay(now) };
    
    case 'LAST_6_MONTHS':
      return { start: subtractMonths(todayStart, 6), end: endOfDay(now) };
    
    case 'LAST_YEAR':
      return { start: subtractYears(todayStart, 1), end: endOfDay(now) };
    
    case 'THIS_MONTH':
      return { start: startOfMonth(now), end: endOfMonth(now) };
    
    case 'THIS_YEAR':
      return { start: startOfYear(now), end: endOfYear(now) };
    
    default:
      return { start: todayStart, end: endOfDay(now) };
  }
};

// ============================================================================
// APPOINTMENT SCHEDULING
// ============================================================================

/**
 * Generate time slots for a given date and business hours
 */
export const generateTimeSlots = (
  date: Date,
  businessHours: BusinessHours,
  slotDuration: number = 30, // minutes
  bufferTime: number = 0 // minutes between slots
): TimeSlot[] => {
  const slots: TimeSlot[] = [];
  
  if (!businessHours.isOpen) {
    return slots;
  }
  
  const [startHour, startMinute] = businessHours.startTime.split(':').map(Number);
  const [endHour, endMinute] = businessHours.endTime.split(':').map(Number);
  
  const startTime = new Date(date);
  startTime.setHours(startHour, startMinute, 0, 0);
  
  const endTime = new Date(date);
  endTime.setHours(endHour, endMinute, 0, 0);
  
  let currentTime = new Date(startTime);
  
  while (currentTime < endTime) {
    const slotEnd = addMinutes(currentTime, slotDuration);
    
    if (slotEnd <= endTime) {
      slots.push({
        start: new Date(currentTime),
        end: slotEnd,
        duration: slotDuration
      });
    }
    
    currentTime = addMinutes(currentTime, slotDuration + bufferTime);
  }
  
  return slots;
};

/**
 * Check if a time slot conflicts with existing appointments
 */
export const hasTimeConflict = (
  newSlot: TimeSlot,
  existingSlots: TimeSlot[]
): boolean => {
  return existingSlots.some(slot => {
    return (
      (newSlot.start >= slot.start && newSlot.start < slot.end) ||
      (newSlot.end > slot.start && newSlot.end <= slot.end) ||
      (newSlot.start <= slot.start && newSlot.end >= slot.end)
    );
  });
};

/**
 * Get available time slots excluding conflicts
 */
export const getAvailableTimeSlots = (
  date: Date,
  businessHours: BusinessHours,
  existingAppointments: TimeSlot[],
  slotDuration: number = 30,
  bufferTime: number = 0
): TimeSlot[] => {
  const allSlots = generateTimeSlots(date, businessHours, slotDuration, bufferTime);
  
  return allSlots.filter(slot => !hasTimeConflict(slot, existingAppointments));
};

// ============================================================================
// TIMEZONE UTILITIES
// ============================================================================

/**
 * Get user's timezone
 */
export const getUserTimezone = (): string => {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
};

/**
 * Convert date to specific timezone
 */
export const convertToTimezone = (date: Date, timezone: string): Date => {
  return new Date(date.toLocaleString('en-US', { timeZone: timezone }));
};

/**
 * Get timezone offset in minutes
 */
export const getTimezoneOffset = (date: Date = new Date()): number => {
  return date.getTimezoneOffset();
};

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Validate date range
 */
export const isValidDateRange = (start: Date, end: Date): boolean => {
  return isValidDate(start) && isValidDate(end) && start <= end;
};

/**
 * Validate business hours
 */
export const isValidBusinessHours = (hours: BusinessHours): boolean => {
  if (!hours.isOpen) return true;
  
  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  
  if (!timeRegex.test(hours.startTime) || !timeRegex.test(hours.endTime)) {
    return false;
  }
  
  const [startHour, startMinute] = hours.startTime.split(':').map(Number);
  const [endHour, endMinute] = hours.endTime.split(':').map(Number);
  
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  
  return startMinutes < endMinutes;
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get days in month
 */
export const getDaysInMonth = (year: number, month: number): number => {
  return new Date(year, month + 1, 0).getDate();
};

/**
 * Get first day of month (day of week)
 */
export const getFirstDayOfMonth = (year: number, month: number): number => {
  return new Date(year, month, 1).getDay();
};

/**
 * Get calendar grid for month view
 */
export const getCalendarGrid = (year: number, month: number): (Date | null)[][] => {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const grid: (Date | null)[][] = [];
  
  let currentDate = 1;
  
  for (let week = 0; week < 6; week++) {
    const weekDays: (Date | null)[] = [];
    
    for (let day = 0; day < 7; day++) {
      if (week === 0 && day < firstDay) {
        weekDays.push(null);
      } else if (currentDate > daysInMonth) {
        weekDays.push(null);
      } else {
        weekDays.push(new Date(year, month, currentDate));
        currentDate++;
      }
    }
    
    grid.push(weekDays);
    
    if (currentDate > daysInMonth) {
      break;
    }
  }
  
  return grid;
};

/**
 * Parse time string to minutes since midnight
 */
export const parseTimeToMinutes = (timeString: string): number => {
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * Convert minutes since midnight to time string
 */
export const minutesToTimeString = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};

/**
 * Get week number of year
 */
export const getWeekNumber = (date: Date): number => {
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
  const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / MILLISECONDS_PER_DAY;
  return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
};

/**
 * Get quarter of year
 */
export const getQuarter = (date: Date): number => {
  return Math.floor(date.getMonth() / 3) + 1;
};

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  // Basic functions
  isValidDate,
  parseDate,
  today,
  yesterday,
  tomorrow,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  
  // Arithmetic
  addDays,
  addWeeks,
  addMonths,
  addYears,
  addHours,
  addMinutes,
  subtractDays,
  subtractMonths,
  subtractYears,
  
  // Comparison
  isSameDay,
  isSameWeek,
  isSameMonth,
  isSameYear,
  isToday,
  isYesterday,
  isTomorrow,
  isPast,
  isFuture,
  isWeekend,
  isWeekday,
  
  // Differences
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  differenceInMonths,
  differenceInYears,
  calculateAge,
  calculateAgeWithMonths,
  
  // Formatting
  formatDate,
  formatTime,
  formatDateTime,
  formatRelativeTime,
  formatDuration,
  
  // Medical ranges
  getMedicalDateRange,
  
  // Scheduling
  generateTimeSlots,
  hasTimeConflict,
  getAvailableTimeSlots,
  
  // Timezone
  getUserTimezone,
  convertToTimezone,
  getTimezoneOffset,
  
  // Validation
  isValidDateRange,
  isValidBusinessHours,
  
  // Utilities
  getDaysInMonth,
  getFirstDayOfMonth,
  getCalendarGrid,
  parseTimeToMinutes,
  minutesToTimeString,
  getWeekNumber,
  getQuarter,
  
  // Constants
  MEDICAL_DATE_RANGES,
  MONTHS,
  MONTHS_SHORT,
  DAYS,
  DAYS_SHORT
};