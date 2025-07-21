import { apiService, ApiResponse, PaginationParams } from './api';
import { Patient, PatientCreateData, PatientUpdateData, PatientSearchFilters } from '@/types/patient';
import { MedicalRecord, VitalSigns, Allergy, Medication, LabResult, ImagingResult } from '@/types/medical';
import { Insurance } from '@/types/billing';

// Additional interfaces for enhanced functionality
export interface PatientSearchParams extends PaginationParams {
  search?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  sortBy?: 'firstName' | 'lastName' | 'dateOfBirth' | 'lastVisit' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

export interface PatientStats {
  total: number;
  active: number;
  inactive: number;
  archived: number;
  newThisMonth: number;
  averageAge: number;
  genderDistribution: {
    male: number;
    female: number;
    other: number;
  };
}

// ============================================================================
// TYPES
// ============================================================================

export interface PatientListResponse {
  patients: Patient[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PatientStatsResponse {
  totalPatients: number;
  newPatientsThisMonth: number;
  activePatients: number;
  averageAge: number;
  genderDistribution: {
    male: number;
    female: number;
    other: number;
  };
  ageGroups: {
    '0-18': number;
    '19-35': number;
    '36-50': number;
    '51-65': number;
    '65+': number;
  };
}

export interface PatientSearchParams extends PaginationParams {
  query?: string;
  filters?: PatientSearchFilters;
  includeInactive?: boolean;
}

export interface MedicalRecordCreateData {
  patientId: string;
  providerId: string;
  type: 'consultation' | 'procedure' | 'lab' | 'imaging' | 'prescription' | 'vaccination' | 'other';
  title: string;
  description?: string;
  diagnosis?: string[];
  treatment?: string;
  notes?: string;
  attachments?: File[];
  followUpDate?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}

export interface VitalSignsCreateData {
  patientId: string;
  providerId?: string;
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  heartRate?: number;
  temperature?: number;
  respiratoryRate?: number;
  oxygenSaturation?: number;
  weight?: number;
  height?: number;
  bmi?: number;
  notes?: string;
  recordedAt?: string;
}

export interface AllergyCreateData {
  patientId: string;
  allergen: string;
  reaction: string;
  severity: 'mild' | 'moderate' | 'severe' | 'life-threatening';
  onsetDate?: string;
  notes?: string;
}

export interface MedicationCreateData {
  patientId: string;
  providerId: string;
  name: string;
  dosage: string;
  frequency: string;
  route: string;
  startDate: string;
  endDate?: string;
  instructions?: string;
  prescriptionNumber?: string;
  refills?: number;
  isActive?: boolean;
}

export interface EmergencyContactData {
  name: string;
  relationship: string;
  phone: string;
  email?: string;
  address?: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country?: string;
  };
  isPrimary?: boolean;
}

export interface InsuranceCreateData {
  patientId: string;
  provider: string;
  policyNumber: string;
  groupNumber?: string;
  subscriberId?: string;
  subscriberName?: string;
  relationship: 'self' | 'spouse' | 'child' | 'other';
  effectiveDate: string;
  expirationDate?: string;
  copay?: number;
  deductible?: number;
  isPrimary?: boolean;
}

// ============================================================================
// PATIENT SERVICE CLASS
// ============================================================================

export class PatientService {
  private static instance: PatientService;

  private constructor() {}

  public static getInstance(): PatientService {
    if (!PatientService.instance) {
      PatientService.instance = new PatientService();
    }
    return PatientService.instance;
  }

  // ========================================================================
  // PATIENT MANAGEMENT
  // ========================================================================

  /**
   * Get all patients with pagination and filtering
   */
  async getPatients(params?: PatientSearchParams): Promise<PatientListResponse> {
    const response = await apiService.getPaginated<Patient>('/patients', params);
    
    return {
      patients: response.data,
      total: response.meta?.total || 0,
      page: response.meta?.page || 1,
      limit: response.meta?.limit || 20,
      totalPages: response.meta?.totalPages || 1,
    };
  }

  /**
   * Get patient by ID
   */
  async getPatientById(id: string): Promise<Patient> {
    const response = await apiService.get<Patient>(`/patients/${id}`);
    return response.data;
  }

  /**
   * Create new patient
   */
  async createPatient(data: PatientCreateData): Promise<Patient> {
    const response = await apiService.post<Patient>('/patients', data, {
      showSuccessToast: true,
      successMessage: 'Patient created successfully!',
    });
    return response.data;
  }

  /**
   * Update patient
   */
  async updatePatient(id: string, data: PatientUpdateData): Promise<Patient> {
    const response = await apiService.patch<Patient>(`/patients/${id}`, data, {
      showSuccessToast: true,
      successMessage: 'Patient updated successfully!',
    });
    return response.data;
  }

  /**
   * Delete patient (soft delete)
   */
  async deletePatient(id: string): Promise<void> {
    await apiService.delete(`/patients/${id}`, {
      showSuccessToast: true,
      successMessage: 'Patient deleted successfully!',
    });
  }

  /**
   * Restore deleted patient
   */
  async restorePatient(id: string): Promise<Patient> {
    const response = await apiService.post<Patient>(`/patients/${id}/restore`, {}, {
      showSuccessToast: true,
      successMessage: 'Patient restored successfully!',
    });
    return response.data;
  }

  /**
   * Search patients
   */
  async searchPatients(query: string, filters?: PatientSearchFilters): Promise<Patient[]> {
    const response = await apiService.get<Patient[]>('/patients/search', {
      q: query,
      ...filters,
    });
    return response.data;
  }

  /**
   * Get patient statistics
   */
  async getPatientStats(): Promise<PatientStatsResponse> {
    const response = await apiService.get<PatientStatsResponse>('/patients/stats');
    return response.data;
  }

  // ========================================================================
  // MEDICAL RECORDS
  // ========================================================================

  /**
   * Get patient's medical records
   */
  async getMedicalRecords(patientId: string, params?: PaginationParams): Promise<MedicalRecord[]> {
    const response = await apiService.getPaginated<MedicalRecord>(
      `/patients/${patientId}/medical-records`,
      params
    );
    return response.data;
  }

  /**
   * Get medical record by ID
   */
  async getMedicalRecordById(patientId: string, recordId: string): Promise<MedicalRecord> {
    const response = await apiService.get<MedicalRecord>(
      `/patients/${patientId}/medical-records/${recordId}`
    );
    return response.data;
  }

  /**
   * Create medical record
   */
  async createMedicalRecord(data: MedicalRecordCreateData): Promise<MedicalRecord> {
    const formData = new FormData();
    
    // Add text data
    Object.entries(data).forEach(([key, value]) => {
      if (key !== 'attachments' && value !== undefined) {
        formData.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
      }
    });
    
    // Add file attachments
    if (data.attachments) {
      data.attachments.forEach((file, index) => {
        formData.append(`attachments[${index}]`, file);
      });
    }

    const response = await apiService.post<MedicalRecord>(
      `/patients/${data.patientId}/medical-records`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        showSuccessToast: true,
        successMessage: 'Medical record created successfully!',
      }
    );
    return response.data;
  }

  /**
   * Update medical record
   */
  async updateMedicalRecord(
    patientId: string,
    recordId: string,
    data: Partial<MedicalRecordCreateData>
  ): Promise<MedicalRecord> {
    const response = await apiService.patch<MedicalRecord>(
      `/patients/${patientId}/medical-records/${recordId}`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Medical record updated successfully!',
      }
    );
    return response.data;
  }

  /**
   * Delete medical record
   */
  async deleteMedicalRecord(patientId: string, recordId: string): Promise<void> {
    await apiService.delete(`/patients/${patientId}/medical-records/${recordId}`, {
      showSuccessToast: true,
      successMessage: 'Medical record deleted successfully!',
    });
  }

  // ========================================================================
  // VITAL SIGNS
  // ========================================================================

  /**
   * Get patient's vital signs
   */
  async getVitalSigns(patientId: string, params?: PaginationParams): Promise<VitalSigns[]> {
    const response = await apiService.getPaginated<VitalSigns>(
      `/patients/${patientId}/vital-signs`,
      params
    );
    return response.data;
  }

  /**
   * Create vital signs record
   */
  async createVitalSigns(data: VitalSignsCreateData): Promise<VitalSigns> {
    const response = await apiService.post<VitalSigns>(
      `/patients/${data.patientId}/vital-signs`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Vital signs recorded successfully!',
      }
    );
    return response.data;
  }

  /**
   * Update vital signs record
   */
  async updateVitalSigns(
    patientId: string,
    vitalSignsId: string,
    data: Partial<VitalSignsCreateData>
  ): Promise<VitalSigns> {
    const response = await apiService.patch<VitalSigns>(
      `/patients/${patientId}/vital-signs/${vitalSignsId}`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Vital signs updated successfully!',
      }
    );
    return response.data;
  }

  /**
   * Delete vital signs record
   */
  async deleteVitalSigns(patientId: string, vitalSignsId: string): Promise<void> {
    await apiService.delete(`/patients/${patientId}/vital-signs/${vitalSignsId}`, {
      showSuccessToast: true,
      successMessage: 'Vital signs record deleted successfully!',
    });
  }

  // ========================================================================
  // ALLERGIES
  // ========================================================================

  /**
   * Get patient's allergies
   */
  async getAllergies(patientId: string): Promise<Allergy[]> {
    const response = await apiService.get<Allergy[]>(`/patients/${patientId}/allergies`);
    return response.data;
  }

  /**
   * Create allergy record
   */
  async createAllergy(data: AllergyCreateData): Promise<Allergy> {
    const response = await apiService.post<Allergy>(
      `/patients/${data.patientId}/allergies`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Allergy recorded successfully!',
      }
    );
    return response.data;
  }

  /**
   * Update allergy record
   */
  async updateAllergy(
    patientId: string,
    allergyId: string,
    data: Partial<AllergyCreateData>
  ): Promise<Allergy> {
    const response = await apiService.patch<Allergy>(
      `/patients/${patientId}/allergies/${allergyId}`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Allergy updated successfully!',
      }
    );
    return response.data;
  }

  /**
   * Delete allergy record
   */
  async deleteAllergy(patientId: string, allergyId: string): Promise<void> {
    await apiService.delete(`/patients/${patientId}/allergies/${allergyId}`, {
      showSuccessToast: true,
      successMessage: 'Allergy record deleted successfully!',
    });
  }

  // ========================================================================
  // MEDICATIONS
  // ========================================================================

  /**
   * Get patient's medications
   */
  async getMedications(patientId: string, activeOnly?: boolean): Promise<Medication[]> {
    const response = await apiService.get<Medication[]>(`/patients/${patientId}/medications`, {
      activeOnly,
    });
    return response.data;
  }

  /**
   * Create medication record
   */
  async createMedication(data: MedicationCreateData): Promise<Medication> {
    const response = await apiService.post<Medication>(
      `/patients/${data.patientId}/medications`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Medication prescribed successfully!',
      }
    );
    return response.data;
  }

  /**
   * Update medication record
   */
  async updateMedication(
    patientId: string,
    medicationId: string,
    data: Partial<MedicationCreateData>
  ): Promise<Medication> {
    const response = await apiService.patch<Medication>(
      `/patients/${patientId}/medications/${medicationId}`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Medication updated successfully!',
      }
    );
    return response.data;
  }

  /**
   * Discontinue medication
   */
  async discontinueMedication(patientId: string, medicationId: string, reason?: string): Promise<void> {
    await apiService.patch(
      `/patients/${patientId}/medications/${medicationId}/discontinue`,
      { reason },
      {
        showSuccessToast: true,
        successMessage: 'Medication discontinued successfully!',
      }
    );
  }

  // ========================================================================
  // LAB RESULTS
  // ========================================================================

  /**
   * Get patient's lab results
   */
  async getLabResults(patientId: string, params?: PaginationParams): Promise<LabResult[]> {
    const response = await apiService.getPaginated<LabResult>(
      `/patients/${patientId}/lab-results`,
      params
    );
    return response.data;
  }

  /**
   * Get lab result by ID
   */
  async getLabResultById(patientId: string, labResultId: string): Promise<LabResult> {
    const response = await apiService.get<LabResult>(
      `/patients/${patientId}/lab-results/${labResultId}`
    );
    return response.data;
  }

  /**
   * Upload lab result
   */
  async uploadLabResult(
    patientId: string,
    file: File,
    metadata: {
      testName: string;
      testDate: string;
      providerId: string;
      notes?: string;
    }
  ): Promise<LabResult> {
    const response = await apiService.uploadFile<LabResult>(
      `/patients/${patientId}/lab-results`,
      file,
      metadata,
      undefined,
      {
        showSuccessToast: true,
        successMessage: 'Lab result uploaded successfully!',
      }
    );
    return response.data;
  }

  // ========================================================================
  // IMAGING RESULTS
  // ========================================================================

  /**
   * Get patient's imaging results
   */
  async getImagingResults(patientId: string, params?: PaginationParams): Promise<ImagingResult[]> {
    const response = await apiService.getPaginated<ImagingResult>(
      `/patients/${patientId}/imaging-results`,
      params
    );
    return response.data;
  }

  /**
   * Upload imaging result
   */
  async uploadImagingResult(
    patientId: string,
    files: File[],
    metadata: {
      studyType: string;
      studyDate: string;
      providerId: string;
      findings?: string;
      notes?: string;
    }
  ): Promise<ImagingResult> {
    const response = await apiService.uploadMultipleFiles<ImagingResult>(
      `/patients/${patientId}/imaging-results`,
      files,
      metadata,
      undefined,
      {
        showSuccessToast: true,
        successMessage: 'Imaging result uploaded successfully!',
      }
    );
    return response.data;
  }

  // ========================================================================
  // EMERGENCY CONTACTS
  // ========================================================================

  /**
   * Get patient's emergency contacts
   */
  async getEmergencyContacts(patientId: string): Promise<EmergencyContactData[]> {
    const response = await apiService.get<EmergencyContactData[]>(
      `/patients/${patientId}/emergency-contacts`
    );
    return response.data;
  }

  /**
   * Add emergency contact
   */
  async addEmergencyContact(
    patientId: string,
    data: EmergencyContactData
  ): Promise<EmergencyContactData> {
    const response = await apiService.post<EmergencyContactData>(
      `/patients/${patientId}/emergency-contacts`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Emergency contact added successfully!',
      }
    );
    return response.data;
  }

  /**
   * Update emergency contact
   */
  async updateEmergencyContact(
    patientId: string,
    contactId: string,
    data: Partial<EmergencyContactData>
  ): Promise<EmergencyContactData> {
    const response = await apiService.patch<EmergencyContactData>(
      `/patients/${patientId}/emergency-contacts/${contactId}`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Emergency contact updated successfully!',
      }
    );
    return response.data;
  }

  /**
   * Delete emergency contact
   */
  async deleteEmergencyContact(patientId: string, contactId: string): Promise<void> {
    await apiService.delete(`/patients/${patientId}/emergency-contacts/${contactId}`, {
      showSuccessToast: true,
      successMessage: 'Emergency contact deleted successfully!',
    });
  }

  // ========================================================================
  // INSURANCE
  // ========================================================================

  /**
   * Get patient's insurance information
   */
  async getInsurance(patientId: string): Promise<Insurance[]> {
    const response = await apiService.get<Insurance[]>(`/patients/${patientId}/insurance`);
    return response.data;
  }

  /**
   * Add insurance
   */
  async addInsurance(data: InsuranceCreateData): Promise<Insurance> {
    const response = await apiService.post<Insurance>(
      `/patients/${data.patientId}/insurance`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Insurance added successfully!',
      }
    );
    return response.data;
  }

  /**
   * Update insurance
   */
  async updateInsurance(
    patientId: string,
    insuranceId: string,
    data: Partial<InsuranceCreateData>
  ): Promise<Insurance> {
    const response = await apiService.patch<Insurance>(
      `/patients/${patientId}/insurance/${insuranceId}`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Insurance updated successfully!',
      }
    );
    return response.data;
  }

  /**
   * Delete insurance
   */
  async deleteInsurance(patientId: string, insuranceId: string): Promise<void> {
    await apiService.delete(`/patients/${patientId}/insurance/${insuranceId}`, {
      showSuccessToast: true,
      successMessage: 'Insurance deleted successfully!',
    });
  }

  // ========================================================================
  // PATIENT DOCUMENTS
  // ========================================================================

  /**
   * Upload patient document
   */
  async uploadDocument(
    patientId: string,
    file: File,
    metadata: {
      title: string;
      category: string;
      description?: string;
    }
  ): Promise<{ id: string; url: string }> {
    const response = await apiService.uploadFile<{ id: string; url: string }>(
      `/patients/${patientId}/documents`,
      file,
      metadata,
      undefined,
      {
        showSuccessToast: true,
        successMessage: 'Document uploaded successfully!',
      }
    );
    return response.data;
  }

  /**
   * Download patient document
   */
  async downloadDocument(patientId: string, documentId: string, filename?: string): Promise<void> {
    await apiService.downloadFile(
      `/patients/${patientId}/documents/${documentId}/download`,
      filename
    );
  }

  // ========================================================================
  // PATIENT TIMELINE
  // ========================================================================

  /**
   * Get patient timeline (chronological view of all activities)
   */
  async getPatientTimeline(
    patientId: string,
    params?: {
      startDate?: string;
      endDate?: string;
      types?: string[];
      limit?: number;
    }
  ): Promise<any[]> {
    const response = await apiService.get<any[]>(`/patients/${patientId}/timeline`, params);
    return response.data;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const patientService = PatientService.getInstance();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export const getPatients = (params?: PatientSearchParams): Promise<PatientListResponse> =>
  patientService.getPatients(params);

export const getPatientById = (id: string): Promise<Patient> =>
  patientService.getPatientById(id);

export const createPatient = (data: PatientCreateData): Promise<Patient> =>
  patientService.createPatient(data);

export const updatePatient = (id: string, data: PatientUpdateData): Promise<Patient> =>
  patientService.updatePatient(id, data);

export const searchPatients = (query: string, filters?: PatientSearchFilters): Promise<Patient[]> =>
  patientService.searchPatients(query, filters);

export const getMedicalRecords = (patientId: string, params?: PaginationParams): Promise<MedicalRecord[]> =>
  patientService.getMedicalRecords(patientId, params);

export const createMedicalRecord = (data: MedicalRecordCreateData): Promise<MedicalRecord> =>
  patientService.createMedicalRecord(data);

export const getVitalSigns = (patientId: string, params?: PaginationParams): Promise<VitalSigns[]> =>
  patientService.getVitalSigns(patientId, params);

export const createVitalSigns = (data: VitalSignsCreateData): Promise<VitalSigns> =>
  patientService.createVitalSigns(data);

// ============================================================================
// EXPORTS
// ============================================================================

export default patientService;