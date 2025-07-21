import { api } from './api';

export interface FileItem {
  id: string;
  name: string;
  type: 'FILE' | 'FOLDER';
  mimeType?: string;
  size?: number;
  url?: string;
  thumbnailUrl?: string;
  parentId?: string;
  patientId?: string;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  description?: string;
  isShared: boolean;
  permissions: {
    canView: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canShare: boolean;
  };
  uploader?: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
  };
  patient?: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

export interface FileFilters {
  folderId?: string;
  search?: string;
  fileType?: string;
  patientId?: string;
  page?: number;
  limit?: number;
}

export interface FilesResponse {
  files: FileItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CreateFolderData {
  name: string;
  parentId?: string;
  patientId?: string;
  description?: string;
}

export interface UploadFileData {
  file: File;
  patientId?: string;
  folderId?: string;
  description?: string;
  tags?: string[];
}

export interface ShareFilesData {
  fileIds: string[];
  userIds: string[];
  permissions: string[];
  message?: string;
}

export interface FolderBreadcrumb {
  id: string;
  name: string;
  parentId?: string;
}

class FileService {
  private baseUrl = '/api/files';

  async getFiles(filters: FileFilters = {}): Promise<FilesResponse> {
    const params = new URLSearchParams();
    
    if (filters.folderId) params.append('folderId', filters.folderId);
    if (filters.search) params.append('search', filters.search);
    if (filters.fileType) params.append('fileType', filters.fileType);
    if (filters.patientId) params.append('patientId', filters.patientId);
    if (filters.page) params.append('page', filters.page.toString());
    if (filters.limit) params.append('limit', filters.limit.toString());

    const queryString = params.toString();
    const url = queryString ? `${this.baseUrl}?${queryString}` : this.baseUrl;
    
    const response = await api.get(url);
    return response.data;
  }

  async getFileById(fileId: string): Promise<FileItem> {
    const response = await api.get(`${this.baseUrl}/${fileId}`);
    return response.data;
  }

  async createFolder(data: CreateFolderData): Promise<FileItem> {
    const response = await api.post(`${this.baseUrl}/folders`, data);
    return response.data;
  }

  async uploadFile(data: UploadFileData): Promise<FileItem> {
    const formData = new FormData();
    formData.append('file', data.file);
    
    if (data.patientId) formData.append('patientId', data.patientId);
    if (data.folderId) formData.append('folderId', data.folderId);
    if (data.description) formData.append('description', data.description);
    if (data.tags) {
      data.tags.forEach(tag => formData.append('tags[]', tag));
    }

    const response = await api.post(`${this.baseUrl}/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }

  async uploadFiles(files: UploadFileData[]): Promise<FileItem[]> {
    const formData = new FormData();
    
    files.forEach((fileData, index) => {
      formData.append(`files[${index}]`, fileData.file);
      if (fileData.patientId) formData.append(`patientIds[${index}]`, fileData.patientId);
      if (fileData.folderId) formData.append(`folderIds[${index}]`, fileData.folderId);
      if (fileData.description) formData.append(`descriptions[${index}]`, fileData.description);
      if (fileData.tags) {
        fileData.tags.forEach(tag => formData.append(`tags[${index}][]`, tag));
      }
    });

    const response = await api.post(`${this.baseUrl}/upload/batch`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }

  async updateFile(fileId: string, data: Partial<FileItem>): Promise<FileItem> {
    const response = await api.put(`${this.baseUrl}/${fileId}`, data);
    return response.data;
  }

  async deleteFiles(fileIds: string[]): Promise<void> {
    await api.delete(`${this.baseUrl}/batch`, {
      data: { fileIds },
    });
  }

  async deleteFile(fileId: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${fileId}`);
  }

  async shareFiles(data: ShareFilesData): Promise<void> {
    await api.post(`${this.baseUrl}/share`, data);
  }

  async unshareFiles(fileIds: string[], userIds: string[]): Promise<void> {
    await api.post(`${this.baseUrl}/unshare`, {
      fileIds,
      userIds,
    });
  }

  async getSharedFiles(): Promise<FileItem[]> {
    const response = await api.get(`${this.baseUrl}/shared`);
    return response.data;
  }

  async getFolderBreadcrumbs(folderId: string): Promise<FolderBreadcrumb[]> {
    const response = await api.get(`${this.baseUrl}/folders/${folderId}/breadcrumbs`);
    return response.data;
  }

  async moveFiles(fileIds: string[], targetFolderId?: string): Promise<void> {
    await api.post(`${this.baseUrl}/move`, {
      fileIds,
      targetFolderId,
    });
  }

  async copyFiles(fileIds: string[], targetFolderId?: string): Promise<FileItem[]> {
    const response = await api.post(`${this.baseUrl}/copy`, {
      fileIds,
      targetFolderId,
    });
    return response.data;
  }

  async getFileVersions(fileId: string): Promise<FileItem[]> {
    const response = await api.get(`${this.baseUrl}/${fileId}/versions`);
    return response.data;
  }

  async restoreFileVersion(fileId: string, versionId: string): Promise<FileItem> {
    const response = await api.post(`${this.baseUrl}/${fileId}/versions/${versionId}/restore`);
    return response.data;
  }

  async getFileStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    filesByType: Record<string, number>;
    recentUploads: FileItem[];
  }> {
    const response = await api.get(`${this.baseUrl}/stats`);
    return response.data;
  }

  async searchFiles(query: string, filters?: {
    fileType?: string;
    patientId?: string;
    dateFrom?: string;
    dateTo?: string;
    tags?: string[];
  }): Promise<FileItem[]> {
    const params = new URLSearchParams();
    params.append('q', query);
    
    if (filters?.fileType) params.append('fileType', filters.fileType);
    if (filters?.patientId) params.append('patientId', filters.patientId);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    if (filters?.tags) {
      filters.tags.forEach(tag => params.append('tags[]', tag));
    }

    const response = await api.get(`${this.baseUrl}/search?${params.toString()}`);
    return response.data;
  }

  async getPatients(): Promise<Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  }>> {
    const response = await api.get('/api/patients?fields=id,firstName,lastName,email');
    return response.data.patients || [];
  }

  async getUsers(): Promise<Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
  }>> {
    const response = await api.get('/api/users?fields=id,firstName,lastName,email,role');
    return response.data.users || [];
  }

  async downloadFile(fileId: string): Promise<Blob> {
    const response = await api.get(`${this.baseUrl}/${fileId}/download`, {
      responseType: 'blob',
    });
    return response.data;
  }

  async downloadFiles(fileIds: string[]): Promise<Blob> {
    const response = await api.post(`${this.baseUrl}/download/batch`, 
      { fileIds },
      { responseType: 'blob' }
    );
    return response.data;
  }

  async getFilePreview(fileId: string): Promise<{
    url: string;
    type: 'image' | 'pdf' | 'text' | 'video' | 'audio' | 'unsupported';
    content?: string;
  }> {
    const response = await api.get(`${this.baseUrl}/${fileId}/preview`);
    return response.data;
  }

  async generateFileLink(fileId: string, options?: {
    expiresIn?: number; // seconds
    password?: string;
    downloadLimit?: number;
  }): Promise<{
    url: string;
    token: string;
    expiresAt: string;
  }> {
    const response = await api.post(`${this.baseUrl}/${fileId}/link`, options);
    return response.data;
  }

  async revokeFileLink(fileId: string, token: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${fileId}/link/${token}`);
  }

  async getFileActivity(fileId: string): Promise<Array<{
    id: string;
    action: string;
    userId: string;
    userName: string;
    timestamp: string;
    details?: Record<string, any>;
  }>> {
    const response = await api.get(`${this.baseUrl}/${fileId}/activity`);
    return response.data;
  }

  async addFileComment(fileId: string, comment: string): Promise<{
    id: string;
    comment: string;
    userId: string;
    userName: string;
    createdAt: string;
  }> {
    const response = await api.post(`${this.baseUrl}/${fileId}/comments`, {
      comment,
    });
    return response.data;
  }

  async getFileComments(fileId: string): Promise<Array<{
    id: string;
    comment: string;
    userId: string;
    userName: string;
    createdAt: string;
  }>> {
    const response = await api.get(`${this.baseUrl}/${fileId}/comments`);
    return response.data;
  }

  async deleteFileComment(fileId: string, commentId: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${fileId}/comments/${commentId}`);
  }

  async addFileTags(fileId: string, tags: string[]): Promise<FileItem> {
    const response = await api.post(`${this.baseUrl}/${fileId}/tags`, { tags });
    return response.data;
  }

  async removeFileTags(fileId: string, tags: string[]): Promise<FileItem> {
    const response = await api.delete(`${this.baseUrl}/${fileId}/tags`, {
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

  // Utility methods
  getFileIcon(mimeType?: string): string {
    if (!mimeType) return 'document';
    
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType.includes('zip') || mimeType.includes('archive')) return 'archive';
    if (mimeType.includes('text') || mimeType.includes('document')) return 'document';
    
    return 'file';
  }

  formatFileSize(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  isImageFile(mimeType?: string): boolean {
    return Boolean(mimeType?.startsWith('image/'));
  }

  isVideoFile(mimeType?: string): boolean {
    return Boolean(mimeType?.startsWith('video/'));
  }

  isAudioFile(mimeType?: string): boolean {
    return Boolean(mimeType?.startsWith('audio/'));
  }

  isPdfFile(mimeType?: string): boolean {
    return mimeType === 'application/pdf';
  }

  isPreviewable(mimeType?: string): boolean {
    return this.isImageFile(mimeType) || this.isPdfFile(mimeType) || 
           mimeType?.includes('text') || false;
  }
}

export const fileService = new FileService();
export default fileService;