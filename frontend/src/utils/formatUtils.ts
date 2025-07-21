// ============================================================================
// FORMAT UTILITIES
// ============================================================================

/**
 * Comprehensive formatting utilities for EHR system
 * Handles currency, numbers, text, medical data, and more
 */

// ============================================================================
// TYPES
// ============================================================================

export interface CurrencyOptions {
  currency?: string;
  locale?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

export interface NumberOptions {
  locale?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  useGrouping?: boolean;
}

export interface PercentageOptions {
  locale?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

export interface PhoneOptions {
  format?: 'national' | 'international' | 'e164' | 'rfc3966';
  country?: string;
}

export interface NameOptions {
  format?: 'first-last' | 'last-first' | 'first-middle-last' | 'last-first-middle' | 'initials';
  includeTitle?: boolean;
  includeSuffix?: boolean;
}

export interface AddressOptions {
  format?: 'single-line' | 'multi-line' | 'postal';
  includeCountry?: boolean;
}

// Medical formatting types
export interface VitalSignsFormat {
  temperature?: { unit: 'F' | 'C'; precision: number };
  bloodPressure?: { format: 'systolic/diastolic' | 'separate' };
  weight?: { unit: 'lbs' | 'kg'; precision: number };
  height?: { unit: 'ft-in' | 'cm' | 'in'; precision: number };
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_CURRENCY = 'USD';

// Medical units and conversions
const MEDICAL_UNITS = {
  temperature: {
    fahrenheitToCelsius: (f: number) => (f - 32) * 5/9,
    celsiusToFahrenheit: (c: number) => c * 9/5 + 32
  },
  weight: {
    lbsToKg: (lbs: number) => lbs * 0.453592,
    kgToLbs: (kg: number) => kg / 0.453592
  },
  height: {
    inchesToCm: (inches: number) => inches * 2.54,
    cmToInches: (cm: number) => cm / 2.54,
    inchesToFeet: (inches: number) => ({ feet: Math.floor(inches / 12), inches: inches % 12 })
  }
};

// Common medical abbreviations
const MEDICAL_ABBREVIATIONS = {
  'blood pressure': 'BP',
  'heart rate': 'HR',
  'respiratory rate': 'RR',
  'temperature': 'Temp',
  'oxygen saturation': 'O2 Sat',
  'body mass index': 'BMI',
  'milligrams': 'mg',
  'grams': 'g',
  'milliliters': 'ml',
  'micrograms': 'mcg',
  'international units': 'IU',
  'milliequivalents': 'mEq'
};

// ============================================================================
// CURRENCY FORMATTING
// ============================================================================

/**
 * Format currency value
 */
export const formatCurrency = (
  amount: number,
  options: CurrencyOptions = {}
): string => {
  const {
    currency = DEFAULT_CURRENCY,
    locale = DEFAULT_LOCALE,
    minimumFractionDigits = 2,
    maximumFractionDigits = 2
  } = options;

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits,
      maximumFractionDigits
    }).format(amount);
  } catch (error) {
    console.warn('Currency formatting failed:', error);
    return `$${amount.toFixed(2)}`;
  }
};

/**
 * Format currency with accounting style (negative in parentheses)
 */
export const formatCurrencyAccounting = (
  amount: number,
  options: CurrencyOptions = {}
): string => {
  const {
    currency = DEFAULT_CURRENCY,
    locale = DEFAULT_LOCALE,
    minimumFractionDigits = 2,
    maximumFractionDigits = 2
  } = options;

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencySign: 'accounting',
      minimumFractionDigits,
      maximumFractionDigits
    }).format(amount);
  } catch (error) {
    console.warn('Accounting currency formatting failed:', error);
    return amount < 0 ? `($${Math.abs(amount).toFixed(2)})` : `$${amount.toFixed(2)}`;
  }
};

// ============================================================================
// NUMBER FORMATTING
// ============================================================================

/**
 * Format number with locale-specific formatting
 */
export const formatNumber = (
  value: number,
  options: NumberOptions = {}
): string => {
  const {
    locale = DEFAULT_LOCALE,
    minimumFractionDigits = 0,
    maximumFractionDigits = 2,
    useGrouping = true
  } = options;

  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits,
      maximumFractionDigits,
      useGrouping
    }).format(value);
  } catch (error) {
    console.warn('Number formatting failed:', error);
    return value.toString();
  }
};

/**
 * Format percentage
 */
export const formatPercentage = (
  value: number,
  options: PercentageOptions = {}
): string => {
  const {
    locale = DEFAULT_LOCALE,
    minimumFractionDigits = 0,
    maximumFractionDigits = 1
  } = options;

  try {
    return new Intl.NumberFormat(locale, {
      style: 'percent',
      minimumFractionDigits,
      maximumFractionDigits
    }).format(value / 100);
  } catch (error) {
    console.warn('Percentage formatting failed:', error);
    return `${value.toFixed(1)}%`;
  }
};

/**
 * Format file size in human readable format
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

/**
 * Format large numbers with abbreviations (K, M, B)
 */
export const formatLargeNumber = (value: number): string => {
  if (value < 1000) {
    return value.toString();
  }
  
  const suffixes = ['', 'K', 'M', 'B', 'T'];
  const suffixNum = Math.floor(Math.log10(value) / 3);
  const shortValue = parseFloat((value / Math.pow(1000, suffixNum)).toFixed(1));
  
  return `${shortValue}${suffixes[suffixNum]}`;
};

// ============================================================================
// TEXT FORMATTING
// ============================================================================

/**
 * Capitalize first letter of each word
 */
export const toTitleCase = (text: string): string => {
  return text.replace(/\w\S*/g, (txt) => 
    txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  );
};

/**
 * Convert to sentence case
 */
export const toSentenceCase = (text: string): string => {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
};

/**
 * Convert camelCase to readable text
 */
export const camelCaseToText = (text: string): string => {
  return text
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
};

/**
 * Convert snake_case to readable text
 */
export const snakeCaseToText = (text: string): string => {
  return text
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

/**
 * Truncate text with ellipsis
 */
export const truncateText = (text: string, maxLength: number, suffix: string = '...'): string => {
  if (text.length <= maxLength) {
    return text;
  }
  
  return text.substring(0, maxLength - suffix.length) + suffix;
};

/**
 * Extract initials from name
 */
export const getInitials = (name: string, maxInitials: number = 2): string => {
  return name
    .split(' ')
    .filter(word => word.length > 0)
    .slice(0, maxInitials)
    .map(word => word.charAt(0).toUpperCase())
    .join('');
};

/**
 * Pluralize word based on count
 */
export const pluralize = (word: string, count: number, pluralForm?: string): string => {
  if (count === 1) {
    return word;
  }
  
  if (pluralForm) {
    return pluralForm;
  }
  
  // Simple pluralization rules
  if (word.endsWith('y')) {
    return word.slice(0, -1) + 'ies';
  }
  
  if (word.endsWith('s') || word.endsWith('sh') || word.endsWith('ch') || word.endsWith('x') || word.endsWith('z')) {
    return word + 'es';
  }
  
  return word + 's';
};

// ============================================================================
// CONTACT INFORMATION FORMATTING
// ============================================================================

/**
 * Format phone number
 */
export const formatPhoneNumber = (phone: string, options: PhoneOptions = {}): string => {
  const { format = 'national' } = options;
  
  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, '');
  
  // Handle different formats
  switch (format) {
    case 'national':
      if (cleaned.length === 10) {
        return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
      }
      if (cleaned.length === 11 && cleaned.startsWith('1')) {
        return `(${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
      }
      break;
      
    case 'international':
      if (cleaned.length === 10) {
        return `+1 (${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
      }
      if (cleaned.length === 11 && cleaned.startsWith('1')) {
        return `+${cleaned.slice(0, 1)} (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
      }
      break;
      
    case 'e164':
      if (cleaned.length === 10) {
        return `+1${cleaned}`;
      }
      if (cleaned.length === 11 && cleaned.startsWith('1')) {
        return `+${cleaned}`;
      }
      break;
      
    case 'rfc3966':
      if (cleaned.length === 10) {
        return `tel:+1-${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
      }
      if (cleaned.length === 11 && cleaned.startsWith('1')) {
        return `tel:+${cleaned.slice(0, 1)}-${cleaned.slice(1, 4)}-${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
      }
      break;
  }
  
  return phone; // Return original if formatting fails
};

/**
 * Format Social Security Number
 */
export const formatSSN = (ssn: string, masked: boolean = false): string => {
  const cleaned = ssn.replace(/\D/g, '');
  
  if (cleaned.length !== 9) {
    return ssn;
  }
  
  if (masked) {
    return `XXX-XX-${cleaned.slice(5)}`;
  }
  
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 5)}-${cleaned.slice(5)}`;
};

/**
 * Format name
 */
export const formatName = (
  firstName: string,
  lastName: string,
  middleName?: string,
  title?: string,
  suffix?: string,
  options: NameOptions = {}
): string => {
  const {
    format = 'first-last',
    includeTitle = false,
    includeSuffix = false
  } = options;
  
  const parts: string[] = [];
  
  if (includeTitle && title) {
    parts.push(title);
  }
  
  switch (format) {
    case 'first-last':
      parts.push(firstName, lastName);
      break;
      
    case 'last-first':
      parts.push(`${lastName},`, firstName);
      break;
      
    case 'first-middle-last':
      parts.push(firstName);
      if (middleName) parts.push(middleName);
      parts.push(lastName);
      break;
      
    case 'last-first-middle':
      parts.push(`${lastName},`, firstName);
      if (middleName) parts.push(middleName);
      break;
      
    case 'initials':
      const initials = [firstName, middleName, lastName]
        .filter(Boolean)
        .map(name => name!.charAt(0).toUpperCase())
        .join('.');
      return initials;
  }
  
  if (includeSuffix && suffix) {
    parts.push(suffix);
  }
  
  return parts.filter(Boolean).join(' ');
};

/**
 * Format address
 */
export const formatAddress = (
  street: string,
  city: string,
  state: string,
  zipCode: string,
  country?: string,
  options: AddressOptions = {}
): string => {
  const { format = 'multi-line', includeCountry = false } = options;
  
  const parts = [street, `${city}, ${state} ${zipCode}`];
  
  if (includeCountry && country) {
    parts.push(country);
  }
  
  switch (format) {
    case 'single-line':
      return parts.join(', ');
      
    case 'multi-line':
      return parts.join('\n');
      
    case 'postal':
      return parts.join('\n').toUpperCase();
      
    default:
      return parts.join('\n');
  }
};

// ============================================================================
// MEDICAL DATA FORMATTING
// ============================================================================

/**
 * Format vital signs
 */
export const formatVitalSigns = (
  vitals: Record<string, number>,
  options: VitalSignsFormat = {}
): Record<string, string> => {
  const formatted: Record<string, string> = {};
  
  Object.entries(vitals).forEach(([key, value]) => {
    switch (key) {
      case 'temperature':
        const tempOptions = options.temperature || { unit: 'F', precision: 1 };
        if (tempOptions.unit === 'C') {
          const celsius = MEDICAL_UNITS.temperature.fahrenheitToCelsius(value);
          formatted[key] = `${celsius.toFixed(tempOptions.precision)}°C`;
        } else {
          formatted[key] = `${value.toFixed(tempOptions.precision)}°F`;
        }
        break;
        
      case 'bloodPressureSystolic':
      case 'bloodPressureDiastolic':
        // Handle blood pressure formatting in combination
        if (key === 'bloodPressureSystolic' && vitals.bloodPressureDiastolic) {
          const bpOptions = options.bloodPressure || { format: 'systolic/diastolic' };
          if (bpOptions.format === 'systolic/diastolic') {
            formatted['bloodPressure'] = `${value}/${vitals.bloodPressureDiastolic} mmHg`;
          } else {
            formatted['systolic'] = `${value} mmHg`;
            formatted['diastolic'] = `${vitals.bloodPressureDiastolic} mmHg`;
          }
        }
        break;
        
      case 'heartRate':
        formatted[key] = `${value} bpm`;
        break;
        
      case 'respiratoryRate':
        formatted[key] = `${value} breaths/min`;
        break;
        
      case 'oxygenSaturation':
        formatted[key] = `${value}%`;
        break;
        
      case 'weight':
        const weightOptions = options.weight || { unit: 'lbs', precision: 1 };
        if (weightOptions.unit === 'kg') {
          const kg = MEDICAL_UNITS.weight.lbsToKg(value);
          formatted[key] = `${kg.toFixed(weightOptions.precision)} kg`;
        } else {
          formatted[key] = `${value.toFixed(weightOptions.precision)} lbs`;
        }
        break;
        
      case 'height':
        const heightOptions = options.height || { unit: 'ft-in', precision: 0 };
        if (heightOptions.unit === 'cm') {
          const cm = MEDICAL_UNITS.height.inchesToCm(value);
          formatted[key] = `${cm.toFixed(heightOptions.precision)} cm`;
        } else if (heightOptions.unit === 'ft-in') {
          const { feet, inches } = MEDICAL_UNITS.height.inchesToFeet(value);
          formatted[key] = `${feet}'${inches}"`;
        } else {
          formatted[key] = `${value.toFixed(heightOptions.precision)} in`;
        }
        break;
        
      case 'bmi':
        formatted[key] = value.toFixed(1);
        break;
        
      default:
        formatted[key] = value.toString();
    }
  });
  
  return formatted;
};

/**
 * Format medication dosage
 */
export const formatMedicationDosage = (
  amount: number,
  unit: string,
  frequency: string
): string => {
  const abbreviatedUnit = MEDICAL_ABBREVIATIONS[unit.toLowerCase()] || unit;
  return `${amount} ${abbreviatedUnit} ${frequency}`;
};

/**
 * Format lab result
 */
export const formatLabResult = (
  value: number,
  unit: string,
  referenceRange?: { min: number; max: number },
  precision: number = 2
): string => {
  let result = `${value.toFixed(precision)} ${unit}`;
  
  if (referenceRange) {
    const { min, max } = referenceRange;
    let flag = '';
    
    if (value < min) {
      flag = ' (L)';
    } else if (value > max) {
      flag = ' (H)';
    }
    
    result += flag;
    result += ` [${min}-${max}]`;
  }
  
  return result;
};

/**
 * Format medical record number
 */
export const formatMRN = (mrn: string): string => {
  const cleaned = mrn.replace(/\W/g, '').toUpperCase();
  
  if (cleaned.length <= 6) {
    return cleaned;
  }
  
  // Format as XXX-XXX for longer MRNs
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
};

/**
 * Format NPI (National Provider Identifier)
 */
export const formatNPI = (npi: string): string => {
  const cleaned = npi.replace(/\D/g, '');
  
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6)}`;
  }
  
  return npi;
};

/**
 * Format diagnosis code (ICD-10)
 */
export const formatDiagnosisCode = (code: string): string => {
  const cleaned = code.replace(/[^A-Z0-9.]/g, '').toUpperCase();
  
  // ICD-10 format: A00.0
  if (cleaned.length >= 3 && !cleaned.includes('.')) {
    return `${cleaned.slice(0, 3)}.${cleaned.slice(3)}`;
  }
  
  return cleaned;
};

// ============================================================================
// DATE AND TIME FORMATTING
// ============================================================================

/**
 * Format duration in a human-readable way
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

/**
 * Format age with appropriate units
 */
export const formatAge = (ageInYears: number): string => {
  if (ageInYears < 1) {
    const months = Math.floor(ageInYears * 12);
    if (months < 1) {
      const days = Math.floor(ageInYears * 365);
      return `${days} day${days !== 1 ? 's' : ''}`;
    }
    return `${months} month${months !== 1 ? 's' : ''}`;
  }
  
  const years = Math.floor(ageInYears);
  return `${years} year${years !== 1 ? 's' : ''}`;
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Remove formatting from currency string
 */
export const parseCurrency = (currencyString: string): number => {
  const cleaned = currencyString.replace(/[^\d.-]/g, '');
  return parseFloat(cleaned) || 0;
};

/**
 * Remove formatting from phone number
 */
export const parsePhoneNumber = (phoneString: string): string => {
  return phoneString.replace(/\D/g, '');
};

/**
 * Mask sensitive data
 */
export const maskData = (data: string, visibleChars: number = 4, maskChar: string = '*'): string => {
  if (data.length <= visibleChars) {
    return data;
  }
  
  const masked = maskChar.repeat(data.length - visibleChars);
  return masked + data.slice(-visibleChars);
};

/**
 * Format list with proper conjunctions
 */
export const formatList = (
  items: string[],
  conjunction: string = 'and',
  oxfordComma: boolean = true
): string => {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  
  const lastItem = items[items.length - 1];
  const otherItems = items.slice(0, -1);
  const comma = oxfordComma ? ',' : '';
  
  return `${otherItems.join(', ')}${comma} ${conjunction} ${lastItem}`;
};

/**
 * Format range of values
 */
export const formatRange = (
  min: number,
  max: number,
  unit?: string,
  precision: number = 0
): string => {
  const minStr = min.toFixed(precision);
  const maxStr = max.toFixed(precision);
  const unitStr = unit ? ` ${unit}` : '';
  
  return `${minStr}-${maxStr}${unitStr}`;
};

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  // Currency
  formatCurrency,
  formatCurrencyAccounting,
  parseCurrency,
  
  // Numbers
  formatNumber,
  formatPercentage,
  formatFileSize,
  formatLargeNumber,
  
  // Text
  toTitleCase,
  toSentenceCase,
  camelCaseToText,
  snakeCaseToText,
  truncateText,
  getInitials,
  pluralize,
  
  // Contact
  formatPhoneNumber,
  formatSSN,
  formatName,
  formatAddress,
  parsePhoneNumber,
  
  // Medical
  formatVitalSigns,
  formatMedicationDosage,
  formatLabResult,
  formatMRN,
  formatNPI,
  formatDiagnosisCode,
  
  // Time
  formatDuration,
  formatAge,
  
  // Utilities
  maskData,
  formatList,
  formatRange,
  
  // Constants
  MEDICAL_UNITS,
  MEDICAL_ABBREVIATIONS
};