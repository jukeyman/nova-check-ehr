import { api } from './api';

export interface MedicalRecord {
  id: string;
  patientId: string;
  providerId: string;
  appointmentId?: string;
  type: 'CONSULTATION' | 'DIAGNOSIS' | 'TREATMENT' | 'LAB_RESULT' | 'IMAGING' | 'PRESCRIPTION' | 'PROCEDURE' | 'VACCINATION' | 'ALLERGY' | 'VITAL_SIGNS' | 'PROGRESS_NOTE' | 'DISCHARGE_SUMMARY';
  title: string;
  description: string;
  diagnosis?: string;
  treatment?: string;
  medications?: Array<{
    name: string;
    dosage: string;
    frequency: string;
    duration: string;
    instructions?: string;
  }>;
  vitals?: {
    temperature?: number;
    bloodPressure?: {
      systolic: number;
      diastolic: number;
    };
    heartRate?: number;
    respiratoryRate?: number;
    oxygenSaturation?: number;
    weight?: number;
    height?: number;
    bmi?: number;
  };
  labResults?: Array<{
    testName: string;
    value: string;
    unit: string;
    referenceRange: string;
    status: 'NORMAL' | 'ABNORMAL' | 'CRITICAL';
    notes?: string;
  }>;
  attachments?: Array<{
    id: string;
    name: string;
    url: string;
    type: string;
  }>;
  tags?: string[];
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  isConfidential: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  patient?: {
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    gender: string;
    email: string;
    phone: string;
  };
  provider?: {
    id: string;
    firstName: string;
    lastName: string;
    title: string;
    specialization: string;
    email: string;
  };
  appointment?: {
    id: string;
    date: string;
    time: string;
    type: string;
    status: string;
  };
}

export interface MedicalRecordFilters {
  patientId?: string;
  providerId?: string;
  type?: string;
  status?: string;
  priority?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  tags?: string[];
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface MedicalRecordsResponse {
  records: MedicalRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CreateMedicalRecordData {
  patientId: string;
  appointmentId?: string;
  type: MedicalRecord['type'];
  title: string;
  description: string;
  diagnosis?: string;
  treatment?: string;
  medications?: MedicalRecord['medications'];
  vitals?: MedicalRecord['vitals'];
  labResults?: MedicalRecord['labResults'];
  attachments?: string[]; // File IDs
  tags?: string[];
  priority?: MedicalRecord['priority'];
  isConfidential?: boolean;
}

export interface UpdateMedicalRecordData extends Partial<CreateMedicalRecordData> {
  status?: MedicalRecord['status'];
}

export interface MedicalRecordStats {
  totalRecords: number;
  recordsByType: Record<string, number>;
  recordsByStatus: Record<string, number>;
  recordsByPriority: Record<string, number>;
  recentRecords: MedicalRecord[];
  topDiagnoses: Array<{
    diagnosis: string;
    count: number;
  }>;
  topMedications: Array<{
    medication: string;
    count: number;
  }>;
}

export interface MedicalRecordTemplate {
  id: string;
  name: string;
  type: MedicalRecord['type'];
  description: string;
  template: {
    title: string;
    description: string;
    sections: Array<{
      name: string;
      fields: Array<{
        name: string;
        type: 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'date';
        label: string;
        required: boolean;
        options?: string[];
        defaultValue?: any;
      }>;
    }>;
  };
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

class MedicalRecordService {
  private baseUrl = '/api/medical-records';

  async getMedicalRecords(filters: MedicalRecordFilters = {}): Promise<MedicalRecordsResponse> {
    const params = new URLSearchParams();
    
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          value.forEach(v => params.append(`${key}[]`, v.toString()));
        } else {
          params.append(key, value.toString());
        }
      }
    });

    const queryString = params.toString();
    const url = queryString ? `${this.baseUrl}?${queryString}` : this.baseUrl;
    
    const response = await api.get(url);
    return response.data;
  }

  async getMedicalRecordById(recordId: string): Promise<MedicalRecord> {
    const response = await api.get(`${this.baseUrl}/${recordId}`);
    return response.data;
  }

  async createMedicalRecord(data: CreateMedicalRecordData): Promise<MedicalRecord> {
    const response = await api.post(this.baseUrl, data);
    return response.data;
  }

  async updateMedicalRecord(recordId: string, data: UpdateMedicalRecordData): Promise<MedicalRecord> {
    const response = await api.put(`${this.baseUrl}/${recordId}`, data);
    return response.data;
  }

  async deleteMedicalRecord(recordId: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${recordId}`);
  }

  async archiveMedicalRecord(recordId: string): Promise<MedicalRecord> {
    const response = await api.patch(`${this.baseUrl}/${recordId}/archive`);
    return response.data;
  }

  async restoreMedicalRecord(recordId: string): Promise<MedicalRecord> {
    const response = await api.patch(`${this.baseUrl}/${recordId}/restore`);
    return response.data;
  }

  async duplicateMedicalRecord(recordId: string): Promise<MedicalRecord> {
    const response = await api.post(`${this.baseUrl}/${recordId}/duplicate`);
    return response.data;
  }

  async getPatientMedicalHistory(patientId: string, filters?: {
    type?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  }): Promise<MedicalRecord[]> {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined) {
          params.append(key, value.toString());
        }
      });
    }

    const queryString = params.toString();
    const url = queryString 
      ? `/api/patients/${patientId}/medical-records?${queryString}`
      : `/api/patients/${patientId}/medical-records`;
    
    const response = await api.get(url);
    return response.data;
  }

  async getProviderMedicalRecords(providerId: string, filters?: MedicalRecordFilters): Promise<MedicalRecordsResponse> {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            value.forEach(v => params.append(`${key}[]`, v.toString()));
          } else {
            params.append(key, value.toString());
          }
        }
      });
    }

    const queryString = params.toString();
    const url = queryString 
      ? `/api/providers/${providerId}/medical-records?${queryString}`
      : `/api/providers/${providerId}/medical-records`;
    
    const response = await api.get(url);
    return response.data;
  }

  async getMedicalRecordStats(filters?: {
    patientId?: string;
    providerId?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<MedicalRecordStats> {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined) {
          params.append(key, value);
        }
      });
    }

    const queryString = params.toString();
    const url = queryString ? `${this.baseUrl}/stats?${queryString}` : `${this.baseUrl}/stats`;
    
    const response = await api.get(url);
    return response.data;
  }

  async searchMedicalRecords(query: string, filters?: {
    patientId?: string;
    providerId?: string;
    type?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<MedicalRecord[]> {
    const params = new URLSearchParams();
    params.append('q', query);
    
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined) {
          params.append(key, value);
        }
      });
    }

    const response = await api.get(`${this.baseUrl}/search?${params.toString()}`);
    return response.data;
  }

  async getTemplates(): Promise<MedicalRecordTemplate[]> {
    const response = await api.get(`${this.baseUrl}/templates`);
    return response.data;
  }

  async getTemplateById(templateId: string): Promise<MedicalRecordTemplate> {
    const response = await api.get(`${this.baseUrl}/templates/${templateId}`);
    return response.data;
  }

  async createTemplate(data: Omit<MedicalRecordTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<MedicalRecordTemplate> {
    const response = await api.post(`${this.baseUrl}/templates`, data);
    return response.data;
  }

  async updateTemplate(templateId: string, data: Partial<MedicalRecordTemplate>): Promise<MedicalRecordTemplate> {
    const response = await api.put(`${this.baseUrl}/templates/${templateId}`, data);
    return response.data;
  }

  async deleteTemplate(templateId: string): Promise<void> {
    await api.delete(`${this.baseUrl}/templates/${templateId}`);
  }

  async createFromTemplate(templateId: string, data: {
    patientId: string;
    appointmentId?: string;
    values: Record<string, any>;
  }): Promise<MedicalRecord> {
    const response = await api.post(`${this.baseUrl}/templates/${templateId}/create`, data);
    return response.data;
  }

  async addAttachment(recordId: string, fileId: string): Promise<MedicalRecord> {
    const response = await api.post(`${this.baseUrl}/${recordId}/attachments`, {
      fileId,
    });
    return response.data;
  }

  async removeAttachment(recordId: string, attachmentId: string): Promise<MedicalRecord> {
    const response = await api.delete(`${this.baseUrl}/${recordId}/attachments/${attachmentId}`);
    return response.data;
  }

  async addTags(recordId: string, tags: string[]): Promise<MedicalRecord> {
    const response = await api.post(`${this.baseUrl}/${recordId}/tags`, { tags });
    return response.data;
  }

  async removeTags(recordId: string, tags: string[]): Promise<MedicalRecord> {
    const response = await api.delete(`${this.baseUrl}/${recordId}/tags`, {
      data: { tags },
    });
    return response.data;
  }

  async getAllTags(): Promise<Array<{
    name: string;
    count: number;
  }>> {
    const response = await api.get(`${this.baseUrl}/tags`);
    return response.data;
  }

  async exportMedicalRecords(filters: MedicalRecordFilters, format: 'pdf' | 'csv' | 'xlsx'): Promise<Blob> {
    const params = new URLSearchParams();
    params.append('format', format);
    
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          value.forEach(v => params.append(`${key}[]`, v.toString()));
        } else {
          params.append(key, value.toString());
        }
      }
    });

    const response = await api.get(`${this.baseUrl}/export?${params.toString()}`, {
      responseType: 'blob',
    });
    return response.data;
  }

  async generateReport(patientId: string, options?: {
    dateFrom?: string;
    dateTo?: string;
    types?: string[];
    includeVitals?: boolean;
    includeMedications?: boolean;
    includeLabResults?: boolean;
    format?: 'pdf' | 'html';
  }): Promise<Blob | string> {
    const params = new URLSearchParams();
    if (options) {
      Object.entries(options).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            value.forEach(v => params.append(`${key}[]`, v.toString()));
          } else {
            params.append(key, value.toString());
          }
        }
      });
    }

    const responseType = options?.format === 'pdf' ? 'blob' : 'text';
    const response = await api.get(
      `/api/patients/${patientId}/medical-records/report?${params.toString()}`,
      { responseType }
    );
    return response.data;
  }

  async getRecordHistory(recordId: string): Promise<Array<{
    id: string;
    action: string;
    changes: Record<string, { old: any; new: any }>;
    userId: string;
    userName: string;
    timestamp: string;
  }>> {
    const response = await api.get(`${this.baseUrl}/${recordId}/history`);
    return response.data;
  }

  async addComment(recordId: string, comment: string): Promise<{
    id: string;
    comment: string;
    userId: string;
    userName: string;
    createdAt: string;
  }> {
    const response = await api.post(`${this.baseUrl}/${recordId}/comments`, {
      comment,
    });
    return response.data;
  }

  async getComments(recordId: string): Promise<Array<{
    id: string;
    comment: string;
    userId: string;
    userName: string;
    createdAt: string;
  }>> {
    const response = await api.get(`${this.baseUrl}/${recordId}/comments`);
    return response.data;
  }

  async deleteComment(recordId: string, commentId: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${recordId}/comments/${commentId}`);
  }

  async shareRecord(recordId: string, data: {
    userIds: string[];
    permissions: string[];
    message?: string;
    expiresAt?: string;
  }): Promise<void> {
    await api.post(`${this.baseUrl}/${recordId}/share`, data);
  }

  async unshareRecord(recordId: string, userIds: string[]): Promise<void> {
    await api.post(`${this.baseUrl}/${recordId}/unshare`, { userIds });
  }

  async getSharedRecords(): Promise<MedicalRecord[]> {
    const response = await api.get(`${this.baseUrl}/shared`);
    return response.data;
  }

  async validateRecord(recordId: string): Promise<{
    isValid: boolean;
    errors: Array<{
      field: string;
      message: string;
      severity: 'error' | 'warning';
    }>;
  }> {
    const response = await api.post(`${this.baseUrl}/${recordId}/validate`);
    return response.data;
  }

  async signRecord(recordId: string, signature: {
    type: 'electronic' | 'digital';
    pin?: string;
    certificate?: string;
  }): Promise<MedicalRecord> {
    const response = await api.post(`${this.baseUrl}/${recordId}/sign`, signature);
    return response.data;
  }

  async getPatients(): Promise<Array<{
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    email: string;
    phone: string;
  }>> {
    const response = await api.get('/api/patients?fields=id,firstName,lastName,dateOfBirth,email,phone');
    return response.data.patients || [];
  }

  async getProviders(): Promise<Array<{
    id: string;
    firstName: string;
    lastName: string;
    title: string;
    specialization: string;
    email: string;
  }>> {
    const response = await api.get('/api/providers?fields=id,firstName,lastName,title,specialization,email');
    return response.data.providers || [];
  }

  async getAppointments(patientId?: string): Promise<Array<{
    id: string;
    date: string;
    time: string;
    type: string;
    status: string;
    patientId: string;
    providerId: string;
  }>> {
    const url = patientId 
      ? `/api/appointments?patientId=${patientId}&fields=id,date,time,type,status,patientId,providerId`
      : '/api/appointments?fields=id,date,time,type,status,patientId,providerId';
    
    const response = await api.get(url);
    return response.data.appointments || [];
  }

  // Utility methods
  getRecordTypeLabel(type: MedicalRecord['type']): string {
    const labels: Record<MedicalRecord['type'], string> = {
      CONSULTATION: 'Consultation',
      DIAGNOSIS: 'Diagnosis',
      TREATMENT: 'Treatment',
      LAB_RESULT: 'Lab Result',
      IMAGING: 'Imaging',
      PRESCRIPTION: 'Prescription',
      PROCEDURE: 'Procedure',
      VACCINATION: 'Vaccination',
      ALLERGY: 'Allergy',
      VITAL_SIGNS: 'Vital Signs',
      PROGRESS_NOTE: 'Progress Note',
      DISCHARGE_SUMMARY: 'Discharge Summary',
    };
    return labels[type] || type;
  }

  getStatusColor(status: MedicalRecord['status']): string {
    const colors: Record<MedicalRecord['status'], string> = {
      DRAFT: 'gray',
      ACTIVE: 'green',
      ARCHIVED: 'yellow',
      DELETED: 'red',
    };
    return colors[status] || 'gray';
  }

  getPriorityColor(priority: MedicalRecord['priority']): string {
    const colors: Record<MedicalRecord['priority'], string> = {
      LOW: 'green',
      MEDIUM: 'yellow',
      HIGH: 'orange',
      URGENT: 'red',
    };
    return colors[priority] || 'gray';
  }

  formatVitals(vitals: MedicalRecord['vitals']): string {
    if (!vitals) return 'No vitals recorded';
    
    const parts: string[] = [];
    if (vitals.temperature) parts.push(`Temp: ${vitals.temperature}°F`);
    if (vitals.bloodPressure) {
      parts.push(`BP: ${vitals.bloodPressure.systolic}/${vitals.bloodPressure.diastolic}`);
    }
    if (vitals.heartRate) parts.push(`HR: ${vitals.heartRate} bpm`);
    if (vitals.oxygenSaturation) parts.push(`O2: ${vitals.oxygenSaturation}%`);
    
    return parts.join(', ') || 'No vitals recorded';
  }

  formatMedications(medications?: MedicalRecord['medications']): string {
    if (!medications || medications.length === 0) return 'No medications';
    
    return medications.map(med => 
      `${med.name} ${med.dosage} ${med.frequency}`
    ).join(', ');
  }
}

export const medicalRecordService = new MedicalRecordService();
export default medicalRecordService;