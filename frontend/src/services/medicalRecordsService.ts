import { apiService, ApiResponse, PaginationParams } from './api';
import {
  MedicalRecord,
  MedicalRecordCreateData,
  MedicalRecordUpdateData,
  MedicalRecordFilters,
} from '@/types/medicalRecords';
import {
  VitalSigns,
  Allergy,
  Medication,
  LabResult,
  ImagingResult,
  Procedure,
  Diagnosis,
  ClinicalNote,
  Immunization,
  FamilyHistory,
  SocialHistory,
} from '@/types/medicalRecords';

// ============================================================================
// TYPES
// ============================================================================

export interface MedicalRecordsListResponse {
  records: MedicalRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface MedicalRecordSearchParams extends PaginationParams {
  patientId?: string;
  providerId?: string;
  recordType?: string[];
  startDate?: string;
  endDate?: string;
  diagnosis?: string;
  medication?: string;
  allergy?: string;
  status?: string[];
  priority?: string[];
}

export interface VitalSignsData {
  patientId: string;
  providerId: string;
  recordedAt: string;
  temperature?: number;
  temperatureUnit?: 'F' | 'C';
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  heartRate?: number;
  respiratoryRate?: number;
  oxygenSaturation?: number;
  weight?: number;
  weightUnit?: 'lbs' | 'kg';
  height?: number;
  heightUnit?: 'in' | 'cm';
  bmi?: number;
  painLevel?: number;
  notes?: string;
}

export interface AllergyData {
  patientId: string;
  allergen: string;
  allergenType: 'medication' | 'food' | 'environmental' | 'other';
  severity: 'mild' | 'moderate' | 'severe' | 'life-threatening';
  reaction: string[];
  onsetDate?: string;
  notes?: string;
  status: 'active' | 'inactive' | 'resolved';
}

export interface MedicationData {
  patientId: string;
  providerId: string;
  name: string;
  genericName?: string;
  dosage: string;
  frequency: string;
  route: string;
  startDate: string;
  endDate?: string;
  quantity?: number;
  refills?: number;
  instructions?: string;
  indication?: string;
  status: 'active' | 'discontinued' | 'completed' | 'on-hold';
  prescribedBy?: string;
  pharmacy?: string;
  notes?: string;
}

export interface LabResultData {
  patientId: string;
  providerId: string;
  testName: string;
  testCode?: string;
  category: string;
  orderedDate: string;
  collectedDate?: string;
  resultDate?: string;
  results: {
    name: string;
    value: string;
    unit?: string;
    referenceRange?: string;
    status: 'normal' | 'abnormal' | 'critical' | 'pending';
    notes?: string;
  }[];
  interpretation?: string;
  status: 'ordered' | 'collected' | 'in-progress' | 'completed' | 'cancelled';
  priority: 'routine' | 'urgent' | 'stat';
  notes?: string;
}

export interface ImagingResultData {
  patientId: string;
  providerId: string;
  studyType: string;
  bodyPart: string;
  orderedDate: string;
  performedDate?: string;
  reportDate?: string;
  findings: string;
  impression: string;
  recommendations?: string;
  radiologist?: string;
  facility?: string;
  status: 'ordered' | 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
  priority: 'routine' | 'urgent' | 'stat';
  images?: {
    url: string;
    type: string;
    description?: string;
  }[];
  notes?: string;
}

export interface ProcedureData {
  patientId: string;
  providerId: string;
  name: string;
  cptCode?: string;
  icd10Code?: string;
  performedDate: string;
  duration?: number;
  location?: string;
  anesthesia?: string;
  complications?: string;
  outcome: string;
  followUpInstructions?: string;
  assistants?: string[];
  notes?: string;
  status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
}

export interface DiagnosisData {
  patientId: string;
  providerId: string;
  condition: string;
  icd10Code: string;
  diagnosisDate: string;
  severity?: 'mild' | 'moderate' | 'severe';
  status: 'active' | 'resolved' | 'chronic' | 'rule-out';
  onsetDate?: string;
  resolvedDate?: string;
  notes?: string;
  isPrimary?: boolean;
}

export interface ClinicalNoteData {
  patientId: string;
  providerId: string;
  appointmentId?: string;
  type: 'progress' | 'consultation' | 'discharge' | 'admission' | 'procedure' | 'other';
  title: string;
  content: string;
  template?: string;
  tags?: string[];
  isConfidential?: boolean;
  signedAt?: string;
  signedBy?: string;
}

export interface ImmunizationData {
  patientId: string;
  providerId: string;
  vaccine: string;
  manufacturer?: string;
  lotNumber?: string;
  administeredDate: string;
  expirationDate?: string;
  site: string;
  route: string;
  dose: string;
  series?: string;
  reaction?: string;
  administeredBy?: string;
  facility?: string;
  notes?: string;
}

export interface FamilyHistoryData {
  patientId: string;
  relationship: string;
  condition: string;
  ageAtOnset?: number;
  ageAtDeath?: number;
  causeOfDeath?: string;
  notes?: string;
  isAlive?: boolean;
}

export interface SocialHistoryData {
  patientId: string;
  smokingStatus: 'never' | 'former' | 'current' | 'unknown';
  smokingDetails?: {
    packsPerDay?: number;
    yearsSmoked?: number;
    quitDate?: string;
  };
  alcoholUse: 'never' | 'occasional' | 'moderate' | 'heavy' | 'former';
  alcoholDetails?: {
    drinksPerWeek?: number;
    type?: string[];
    quitDate?: string;
  };
  drugUse: 'never' | 'former' | 'current' | 'unknown';
  drugDetails?: {
    substances?: string[];
    frequency?: string;
    quitDate?: string;
  };
  occupation?: string;
  education?: string;
  maritalStatus?: string;
  livingArrangement?: string;
  exerciseFrequency?: string;
  diet?: string;
  notes?: string;
}

export interface DocumentUploadData {
  patientId: string;
  type: 'lab' | 'imaging' | 'referral' | 'insurance' | 'consent' | 'other';
  title: string;
  description?: string;
  file: File;
  tags?: string[];
  isConfidential?: boolean;
}

export interface MedicalRecordStats {
  totalRecords: number;
  recordsByType: Record<string, number>;
  recentActivity: {
    date: string;
    count: number;
    type: string;
  }[];
  criticalAlerts: {
    type: 'allergy' | 'medication' | 'lab' | 'vital';
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    date: string;
  }[];
  upcomingTests: {
    testName: string;
    dueDate: string;
    type: string;
  }[];
  medicationAdherence: {
    total: number;
    adherent: number;
    nonAdherent: number;
    percentage: number;
  };
}

// ============================================================================
// MEDICAL RECORDS SERVICE CLASS
// ============================================================================

export class MedicalRecordsService {
  private static instance: MedicalRecordsService;

  private constructor() {}

  public static getInstance(): MedicalRecordsService {
    if (!MedicalRecordsService.instance) {
      MedicalRecordsService.instance = new MedicalRecordsService();
    }
    return MedicalRecordsService.instance;
  }

  // ========================================================================
  // MEDICAL RECORDS MANAGEMENT
  // ========================================================================

  /**
   * Get medical records with filtering and pagination
   */
  async getMedicalRecords(params?: MedicalRecordSearchParams): Promise<MedicalRecordsListResponse> {
    const response = await apiService.getPaginated<MedicalRecord>('/medical-records', params);
    
    return {
      records: response.data,
      total: response.meta?.total || 0,
      page: response.meta?.page || 1,
      limit: response.meta?.limit || 20,
      totalPages: response.meta?.totalPages || 1,
    };
  }

  /**
   * Get medical record by ID
   */
  async getMedicalRecordById(id: string): Promise<MedicalRecord> {
    const response = await apiService.get<MedicalRecord>(`/medical-records/${id}`);
    return response.data;
  }

  /**
   * Create new medical record
   */
  async createMedicalRecord(data: MedicalRecordCreateData): Promise<MedicalRecord> {
    const response = await apiService.post<MedicalRecord>('/medical-records', data, {
      showSuccessToast: true,
      successMessage: 'Medical record created successfully!',
    });
    return response.data;
  }

  /**
   * Update medical record
   */
  async updateMedicalRecord(id: string, data: MedicalRecordUpdateData): Promise<MedicalRecord> {
    const response = await apiService.patch<MedicalRecord>(`/medical-records/${id}`, data, {
      showSuccessToast: true,
      successMessage: 'Medical record updated successfully!',
    });
    return response.data;
  }

  /**
   * Delete medical record
   */
  async deleteMedicalRecord(id: string): Promise<void> {
    await apiService.delete(`/medical-records/${id}`, {
      showSuccessToast: true,
      successMessage: 'Medical record deleted successfully!',
    });
  }

  /**
   * Get patient medical summary
   */
  async getPatientMedicalSummary(patientId: string): Promise<{
    demographics: any;
    allergies: Allergy[];
    medications: Medication[];
    diagnoses: Diagnosis[];
    recentVitals: VitalSigns[];
    recentLabs: LabResult[];
    immunizations: Immunization[];
    familyHistory: FamilyHistory[];
    socialHistory: SocialHistory;
  }> {
    const response = await apiService.get<{
      demographics: any;
      allergies: Allergy[];
      medications: Medication[];
      diagnoses: Diagnosis[];
      recentVitals: VitalSigns[];
      recentLabs: LabResult[];
      immunizations: Immunization[];
      familyHistory: FamilyHistory[];
      socialHistory: SocialHistory;
    }>(`/medical-records/patients/${patientId}/summary`);
    return response.data;
  }

  // ========================================================================
  // VITAL SIGNS
  // ========================================================================

  /**
   * Get vital signs for patient
   */
  async getVitalSigns(
    patientId: string,
    startDate?: string,
    endDate?: string
  ): Promise<VitalSigns[]> {
    const response = await apiService.get<VitalSigns[]>(
      `/medical-records/patients/${patientId}/vitals`,
      { startDate, endDate }
    );
    return response.data;
  }

  /**
   * Add vital signs
   */
  async addVitalSigns(data: VitalSignsData): Promise<VitalSigns> {
    const response = await apiService.post<VitalSigns>('/medical-records/vitals', data, {
      showSuccessToast: true,
      successMessage: 'Vital signs recorded successfully!',
    });
    return response.data;
  }

  /**
   * Update vital signs
   */
  async updateVitalSigns(id: string, data: Partial<VitalSignsData>): Promise<VitalSigns> {
    const response = await apiService.patch<VitalSigns>(`/medical-records/vitals/${id}`, data, {
      showSuccessToast: true,
      successMessage: 'Vital signs updated successfully!',
    });
    return response.data;
  }

  /**
   * Delete vital signs
   */
  async deleteVitalSigns(id: string): Promise<void> {
    await apiService.delete(`/medical-records/vitals/${id}`, {
      showSuccessToast: true,
      successMessage: 'Vital signs deleted successfully!',
    });
  }

  // ========================================================================
  // ALLERGIES
  // ========================================================================

  /**
   * Get patient allergies
   */
  async getAllergies(patientId: string): Promise<Allergy[]> {
    const response = await apiService.get<Allergy[]>(
      `/medical-records/patients/${patientId}/allergies`
    );
    return response.data;
  }

  /**
   * Add allergy
   */
  async addAllergy(data: AllergyData): Promise<Allergy> {
    const response = await apiService.post<Allergy>('/medical-records/allergies', data, {
      showSuccessToast: true,
      successMessage: 'Allergy added successfully!',
    });
    return response.data;
  }

  /**
   * Update allergy
   */
  async updateAllergy(id: string, data: Partial<AllergyData>): Promise<Allergy> {
    const response = await apiService.patch<Allergy>(`/medical-records/allergies/${id}`, data, {
      showSuccessToast: true,
      successMessage: 'Allergy updated successfully!',
    });
    return response.data;
  }

  /**
   * Delete allergy
   */
  async deleteAllergy(id: string): Promise<void> {
    await apiService.delete(`/medical-records/allergies/${id}`, {
      showSuccessToast: true,
      successMessage: 'Allergy deleted successfully!',
    });
  }

  // ========================================================================
  // MEDICATIONS
  // ========================================================================

  /**
   * Get patient medications
   */
  async getMedications(
    patientId: string,
    status?: 'active' | 'discontinued' | 'completed' | 'on-hold'
  ): Promise<Medication[]> {
    const response = await apiService.get<Medication[]>(
      `/medical-records/patients/${patientId}/medications`,
      { status }
    );
    return response.data;
  }

  /**
   * Add medication
   */
  async addMedication(data: MedicationData): Promise<Medication> {
    const response = await apiService.post<Medication>('/medical-records/medications', data, {
      showSuccessToast: true,
      successMessage: 'Medication added successfully!',
    });
    return response.data;
  }

  /**
   * Update medication
   */
  async updateMedication(id: string, data: Partial<MedicationData>): Promise<Medication> {
    const response = await apiService.patch<Medication>(`/medical-records/medications/${id}`, data, {
      showSuccessToast: true,
      successMessage: 'Medication updated successfully!',
    });
    return response.data;
  }

  /**
   * Discontinue medication
   */
  async discontinueMedication(id: string, reason: string): Promise<Medication> {
    const response = await apiService.patch<Medication>(
      `/medical-records/medications/${id}/discontinue`,
      { reason },
      {
        showSuccessToast: true,
        successMessage: 'Medication discontinued successfully!',
      }
    );
    return response.data;
  }

  /**
   * Delete medication
   */
  async deleteMedication(id: string): Promise<void> {
    await apiService.delete(`/medical-records/medications/${id}`, {
      showSuccessToast: true,
      successMessage: 'Medication deleted successfully!',
    });
  }

  // ========================================================================
  // LAB RESULTS
  // ========================================================================

  /**
   * Get patient lab results
   */
  async getLabResults(
    patientId: string,
    startDate?: string,
    endDate?: string,
    category?: string
  ): Promise<LabResult[]> {
    const response = await apiService.get<LabResult[]>(
      `/medical-records/patients/${patientId}/labs`,
      { startDate, endDate, category }
    );
    return response.data;
  }

  /**
   * Add lab result
   */
  async addLabResult(data: LabResultData): Promise<LabResult> {
    const response = await apiService.post<LabResult>('/medical-records/labs', data, {
      showSuccessToast: true,
      successMessage: 'Lab result added successfully!',
    });
    return response.data;
  }

  /**
   * Update lab result
   */
  async updateLabResult(id: string, data: Partial<LabResultData>): Promise<LabResult> {
    const response = await apiService.patch<LabResult>(`/medical-records/labs/${id}`, data, {
      showSuccessToast: true,
      successMessage: 'Lab result updated successfully!',
    });
    return response.data;
  }

  /**
   * Upload lab result file
   */
  async uploadLabResultFile(labId: string, file: File, description?: string): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    if (description) {
      formData.append('description', description);
    }

    const response = await apiService.post<any>(
      `/medical-records/labs/${labId}/upload`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        showSuccessToast: true,
        successMessage: 'Lab result file uploaded successfully!',
      }
    );
    return response.data;
  }

  // ========================================================================
  // IMAGING RESULTS
  // ========================================================================

  /**
   * Get patient imaging results
   */
  async getImagingResults(
    patientId: string,
    startDate?: string,
    endDate?: string,
    studyType?: string
  ): Promise<ImagingResult[]> {
    const response = await apiService.get<ImagingResult[]>(
      `/medical-records/patients/${patientId}/imaging`,
      { startDate, endDate, studyType }
    );
    return response.data;
  }

  /**
   * Add imaging result
   */
  async addImagingResult(data: ImagingResultData): Promise<ImagingResult> {
    const response = await apiService.post<ImagingResult>('/medical-records/imaging', data, {
      showSuccessToast: true,
      successMessage: 'Imaging result added successfully!',
    });
    return response.data;
  }

  /**
   * Update imaging result
   */
  async updateImagingResult(id: string, data: Partial<ImagingResultData>): Promise<ImagingResult> {
    const response = await apiService.patch<ImagingResult>(`/medical-records/imaging/${id}`, data, {
      showSuccessToast: true,
      successMessage: 'Imaging result updated successfully!',
    });
    return response.data;
  }

  /**
   * Upload imaging files
   */
  async uploadImagingFiles(
    imagingId: string,
    files: File[],
    descriptions?: string[]
  ): Promise<any> {
    const formData = new FormData();
    files.forEach((file, index) => {
      formData.append(`files[${index}]`, file);
      if (descriptions && descriptions[index]) {
        formData.append(`descriptions[${index}]`, descriptions[index]);
      }
    });

    const response = await apiService.post<any>(
      `/medical-records/imaging/${imagingId}/upload`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        showSuccessToast: true,
        successMessage: 'Imaging files uploaded successfully!',
      }
    );
    return response.data;
  }

  // ========================================================================
  // PROCEDURES
  // ========================================================================

  /**
   * Get patient procedures
   */
  async getProcedures(
    patientId: string,
    startDate?: string,
    endDate?: string
  ): Promise<Procedure[]> {
    const response = await apiService.get<Procedure[]>(
      `/medical-records/patients/${patientId}/procedures`,
      { startDate, endDate }
    );
    return response.data;
  }

  /**
   * Add procedure
   */
  async addProcedure(data: ProcedureData): Promise<Procedure> {
    const response = await apiService.post<Procedure>('/medical-records/procedures', data, {
      showSuccessToast: true,
      successMessage: 'Procedure added successfully!',
    });
    return response.data;
  }

  /**
   * Update procedure
   */
  async updateProcedure(id: string, data: Partial<ProcedureData>): Promise<Procedure> {
    const response = await apiService.patch<Procedure>(`/medical-records/procedures/${id}`, data, {
      showSuccessToast: true,
      successMessage: 'Procedure updated successfully!',
    });
    return response.data;
  }

  // ========================================================================
  // DIAGNOSES
  // ========================================================================

  /**
   * Get patient diagnoses
   */
  async getDiagnoses(
    patientId: string,
    status?: 'active' | 'resolved' | 'chronic' | 'rule-out'
  ): Promise<Diagnosis[]> {
    const response = await apiService.get<Diagnosis[]>(
      `/medical-records/patients/${patientId}/diagnoses`,
      { status }
    );
    return response.data;
  }

  /**
   * Add diagnosis
   */
  async addDiagnosis(data: DiagnosisData): Promise<Diagnosis> {
    const response = await apiService.post<Diagnosis>('/medical-records/diagnoses', data, {
      showSuccessToast: true,
      successMessage: 'Diagnosis added successfully!',
    });
    return response.data;
  }

  /**
   * Update diagnosis
   */
  async updateDiagnosis(id: string, data: Partial<DiagnosisData>): Promise<Diagnosis> {
    const response = await apiService.patch<Diagnosis>(`/medical-records/diagnoses/${id}`, data, {
      showSuccessToast: true,
      successMessage: 'Diagnosis updated successfully!',
    });
    return response.data;
  }

  /**
   * Resolve diagnosis
   */
  async resolveDiagnosis(id: string, resolvedDate: string, notes?: string): Promise<Diagnosis> {
    const response = await apiService.patch<Diagnosis>(
      `/medical-records/diagnoses/${id}/resolve`,
      { resolvedDate, notes },
      {
        showSuccessToast: true,
        successMessage: 'Diagnosis resolved successfully!',
      }
    );
    return response.data;
  }

  // ========================================================================
  // CLINICAL NOTES
  // ========================================================================

  /**
   * Get clinical notes
   */
  async getClinicalNotes(
    patientId: string,
    type?: string,
    startDate?: string,
    endDate?: string
  ): Promise<ClinicalNote[]> {
    const response = await apiService.get<ClinicalNote[]>(
      `/medical-records/patients/${patientId}/notes`,
      { type, startDate, endDate }
    );
    return response.data;
  }

  /**
   * Add clinical note
   */
  async addClinicalNote(data: ClinicalNoteData): Promise<ClinicalNote> {
    const response = await apiService.post<ClinicalNote>('/medical-records/notes', data, {
      showSuccessToast: true,
      successMessage: 'Clinical note added successfully!',
    });
    return response.data;
  }

  /**
   * Update clinical note
   */
  async updateClinicalNote(id: string, data: Partial<ClinicalNoteData>): Promise<ClinicalNote> {
    const response = await apiService.patch<ClinicalNote>(`/medical-records/notes/${id}`, data, {
      showSuccessToast: true,
      successMessage: 'Clinical note updated successfully!',
    });
    return response.data;
  }

  /**
   * Sign clinical note
   */
  async signClinicalNote(id: string): Promise<ClinicalNote> {
    const response = await apiService.patch<ClinicalNote>(
      `/medical-records/notes/${id}/sign`,
      {},
      {
        showSuccessToast: true,
        successMessage: 'Clinical note signed successfully!',
      }
    );
    return response.data;
  }

  // ========================================================================
  // IMMUNIZATIONS
  // ========================================================================

  /**
   * Get patient immunizations
   */
  async getImmunizations(patientId: string): Promise<Immunization[]> {
    const response = await apiService.get<Immunization[]>(
      `/medical-records/patients/${patientId}/immunizations`
    );
    return response.data;
  }

  /**
   * Add immunization
   */
  async addImmunization(data: ImmunizationData): Promise<Immunization> {
    const response = await apiService.post<Immunization>('/medical-records/immunizations', data, {
      showSuccessToast: true,
      successMessage: 'Immunization added successfully!',
    });
    return response.data;
  }

  /**
   * Update immunization
   */
  async updateImmunization(id: string, data: Partial<ImmunizationData>): Promise<Immunization> {
    const response = await apiService.patch<Immunization>(
      `/medical-records/immunizations/${id}`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Immunization updated successfully!',
      }
    );
    return response.data;
  }

  // ========================================================================
  // FAMILY HISTORY
  // ========================================================================

  /**
   * Get patient family history
   */
  async getFamilyHistory(patientId: string): Promise<FamilyHistory[]> {
    const response = await apiService.get<FamilyHistory[]>(
      `/medical-records/patients/${patientId}/family-history`
    );
    return response.data;
  }

  /**
   * Add family history
   */
  async addFamilyHistory(data: FamilyHistoryData): Promise<FamilyHistory> {
    const response = await apiService.post<FamilyHistory>('/medical-records/family-history', data, {
      showSuccessToast: true,
      successMessage: 'Family history added successfully!',
    });
    return response.data;
  }

  /**
   * Update family history
   */
  async updateFamilyHistory(id: string, data: Partial<FamilyHistoryData>): Promise<FamilyHistory> {
    const response = await apiService.patch<FamilyHistory>(
      `/medical-records/family-history/${id}`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Family history updated successfully!',
      }
    );
    return response.data;
  }

  // ========================================================================
  // SOCIAL HISTORY
  // ========================================================================

  /**
   * Get patient social history
   */
  async getSocialHistory(patientId: string): Promise<SocialHistory> {
    const response = await apiService.get<SocialHistory>(
      `/medical-records/patients/${patientId}/social-history`
    );
    return response.data;
  }

  /**
   * Update social history
   */
  async updateSocialHistory(patientId: string, data: SocialHistoryData): Promise<SocialHistory> {
    const response = await apiService.put<SocialHistory>(
      `/medical-records/patients/${patientId}/social-history`,
      data,
      {
        showSuccessToast: true,
        successMessage: 'Social history updated successfully!',
      }
    );
    return response.data;
  }

  // ========================================================================
  // DOCUMENTS
  // ========================================================================

  /**
   * Upload medical document
   */
  async uploadDocument(data: DocumentUploadData): Promise<any> {
    const formData = new FormData();
    formData.append('file', data.file);
    formData.append('patientId', data.patientId);
    formData.append('type', data.type);
    formData.append('title', data.title);
    
    if (data.description) {
      formData.append('description', data.description);
    }
    
    if (data.tags) {
      data.tags.forEach((tag, index) => {
        formData.append(`tags[${index}]`, tag);
      });
    }
    
    if (data.isConfidential !== undefined) {
      formData.append('isConfidential', data.isConfidential.toString());
    }

    const response = await apiService.post<any>('/medical-records/documents', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      showSuccessToast: true,
      successMessage: 'Document uploaded successfully!',
    });
    return response.data;
  }

  /**
   * Get patient documents
   */
  async getPatientDocuments(
    patientId: string,
    type?: string,
    tags?: string[]
  ): Promise<any[]> {
    const response = await apiService.get<any[]>(
      `/medical-records/patients/${patientId}/documents`,
      { type, tags }
    );
    return response.data;
  }

  /**
   * Download document
   */
  async downloadDocument(documentId: string, filename?: string): Promise<void> {
    await apiService.downloadFile(`/medical-records/documents/${documentId}/download`, filename);
  }

  /**
   * Delete document
   */
  async deleteDocument(documentId: string): Promise<void> {
    await apiService.delete(`/medical-records/documents/${documentId}`, {
      showSuccessToast: true,
      successMessage: 'Document deleted successfully!',
    });
  }

  // ========================================================================
  // TEMPLATES
  // ========================================================================

  /**
   * Get note templates
   */
  async getNoteTemplates(type?: string): Promise<any[]> {
    const response = await apiService.get<any[]>('/medical-records/templates', { type });
    return response.data;
  }

  /**
   * Create note template
   */
  async createNoteTemplate(template: {
    name: string;
    type: string;
    content: string;
    tags?: string[];
  }): Promise<any> {
    const response = await apiService.post<any>('/medical-records/templates', template, {
      showSuccessToast: true,
      successMessage: 'Template created successfully!',
    });
    return response.data;
  }

  // ========================================================================
  // STATISTICS AND ANALYTICS
  // ========================================================================

  /**
   * Get medical record statistics
   */
  async getMedicalRecordStats(
    patientId?: string,
    providerId?: string,
    startDate?: string,
    endDate?: string
  ): Promise<MedicalRecordStats> {
    const response = await apiService.get<MedicalRecordStats>('/medical-records/stats', {
      patientId,
      providerId,
      startDate,
      endDate,
    });
    return response.data;
  }

  /**
   * Get patient timeline
   */
  async getPatientTimeline(
    patientId: string,
    startDate?: string,
    endDate?: string,
    types?: string[]
  ): Promise<any[]> {
    const response = await apiService.get<any[]>(
      `/medical-records/patients/${patientId}/timeline`,
      { startDate, endDate, types }
    );
    return response.data;
  }

  /**
   * Search medical records
   */
  async searchMedicalRecords(
    query: string,
    patientId?: string,
    types?: string[],
    limit?: number
  ): Promise<any[]> {
    const response = await apiService.get<any[]>('/medical-records/search', {
      q: query,
      patientId,
      types,
      limit,
    });
    return response.data;
  }

  // ========================================================================
  // EXPORT AND SHARING
  // ========================================================================

  /**
   * Export patient records
   */
  async exportPatientRecords(
    patientId: string,
    format: 'pdf' | 'ccda' | 'fhir',
    includeTypes?: string[],
    startDate?: string,
    endDate?: string
  ): Promise<{ url: string }> {
    const response = await apiService.post<{ url: string }>(
      `/medical-records/patients/${patientId}/export`,
      {
        format,
        includeTypes,
        startDate,
        endDate,
      },
      {
        showSuccessToast: true,
        successMessage: 'Records exported successfully!',
      }
    );
    return response.data;
  }

  /**
   * Share records with provider
   */
  async shareRecordsWithProvider(
    patientId: string,
    providerId: string,
    recordIds: string[],
    expiresAt?: string,
    message?: string
  ): Promise<{ shareId: string; url: string }> {
    const response = await apiService.post<{ shareId: string; url: string }>(
      `/medical-records/patients/${patientId}/share`,
      {
        providerId,
        recordIds,
        expiresAt,
        message,
      },
      {
        showSuccessToast: true,
        successMessage: 'Records shared successfully!',
      }
    );
    return response.data;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const medicalRecordsService = MedicalRecordsService.getInstance();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export const getMedicalRecords = (
  params?: MedicalRecordSearchParams
): Promise<MedicalRecordsListResponse> => medicalRecordsService.getMedicalRecords(params);

export const getPatientMedicalSummary = (patientId: string) =>
  medicalRecordsService.getPatientMedicalSummary(patientId);

export const addVitalSigns = (data: VitalSignsData): Promise<VitalSigns> =>
  medicalRecordsService.addVitalSigns(data);

export const addAllergy = (data: AllergyData): Promise<Allergy> =>
  medicalRecordsService.addAllergy(data);

export const addMedication = (data: MedicationData): Promise<Medication> =>
  medicalRecordsService.addMedication(data);

export const addLabResult = (data: LabResultData): Promise<LabResult> =>
  medicalRecordsService.addLabResult(data);

export const addClinicalNote = (data: ClinicalNoteData): Promise<ClinicalNote> =>
  medicalRecordsService.addClinicalNote(data);

// ============================================================================
// EXPORTS
// ============================================================================

export default medicalRecordsService;