import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  DocumentIcon,
  PhotoIcon,
  VideoCameraIcon,
  MusicalNoteIcon,
  ArchiveBoxIcon,
  DocumentTextIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  EyeIcon,
  ArrowDownTrayIcon,
  TrashIcon,
  ShareIcon,
  FolderIcon,
  FolderOpenIcon,
  CloudArrowUpIcon,
  XMarkIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { format, parseISO } from 'date-fns';
import { fileService } from '../../services/fileService';
import { useAuth } from '../../contexts/AuthContext';

interface FileItem {
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

interface UploadProgress {
  file: File;
  progress: number;
  status: 'uploading' | 'completed' | 'error';
  error?: string;
}

const FileManager: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // State management
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFileType, setSelectedFileType] = useState<string>('ALL');
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [uploadProgress, setUploadProgress] = useState<Map<string, UploadProgress>>(new Map());
  
  // Modal states
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [showFilePreview, setShowFilePreview] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  
  // Form states
  const [newFolderName, setNewFolderName] = useState('');
  const [uploadPatientId, setUploadPatientId] = useState(user?.role === 'PATIENT' ? user.id : '');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadTags, setUploadTags] = useState('');

  // Fetch files and folders
  const { data: filesData, isLoading, error } = useQuery({
    queryKey: ['files', currentFolderId, searchTerm, selectedFileType, selectedPatient],
    queryFn: () => fileService.getFiles({
      folderId: currentFolderId,
      search: searchTerm,
      fileType: selectedFileType !== 'ALL' ? selectedFileType : undefined,
      patientId: selectedPatient || undefined,
    }),
  });

  // Fetch patients (for non-patient users)
  const { data: patients } = useQuery({
    queryKey: ['patients'],
    queryFn: () => fileService.getPatients(),
    enabled: user?.role !== 'PATIENT',
  });

  // Fetch folder breadcrumbs
  const { data: breadcrumbs } = useQuery({
    queryKey: ['folderBreadcrumbs', currentFolderId],
    queryFn: () => fileService.getFolderBreadcrumbs(currentFolderId!),
    enabled: Boolean(currentFolderId),
  });

  // Create folder mutation
  const createFolderMutation = useMutation({
    mutationFn: (data: { name: string; parentId?: string; patientId?: string }) =>
      fileService.createFolder(data),
    onSuccess: () => {
      toast.success('Folder created successfully!');
      queryClient.invalidateQueries({ queryKey: ['files'] });
      setShowCreateFolderModal(false);
      setNewFolderName('');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create folder');
    },
  });

  // Delete files mutation
  const deleteMutation = useMutation({
    mutationFn: (fileIds: string[]) => fileService.deleteFiles(fileIds),
    onSuccess: () => {
      toast.success('Files deleted successfully!');
      queryClient.invalidateQueries({ queryKey: ['files'] });
      setSelectedFiles(new Set());
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete files');
    },
  });

  // Share files mutation
  const shareMutation = useMutation({
    mutationFn: (data: { fileIds: string[]; userIds: string[]; permissions: string[] }) =>
      fileService.shareFiles(data),
    onSuccess: () => {
      toast.success('Files shared successfully!');
      queryClient.invalidateQueries({ queryKey: ['files'] });
      setShowShareModal(false);
      setSelectedFiles(new Set());
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to share files');
    },
  });

  // Mock data for development
  const mockFiles: FileItem[] = [
    {
      id: '1',
      name: 'Lab Results - CBC',
      type: 'FILE',
      mimeType: 'application/pdf',
      size: 245760,
      url: '/files/lab-results-cbc.pdf',
      patientId: 'patient-1',
      uploadedBy: 'provider-1',
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
      tags: ['lab', 'blood-work', 'routine'],
      description: 'Complete Blood Count results from annual physical',
      isShared: false,
      permissions: {
        canView: true,
        canEdit: true,
        canDelete: true,
        canShare: true,
      },
      uploader: {
        id: 'provider-1',
        firstName: 'Dr. Sarah',
        lastName: 'Johnson',
        role: 'PROVIDER',
      },
      patient: {
        id: 'patient-1',
        firstName: 'John',
        lastName: 'Doe',
      },
    },
    {
      id: '2',
      name: 'X-Ray Images',
      type: 'FOLDER',
      uploadedBy: 'provider-2',
      createdAt: '2024-01-10T14:00:00Z',
      updatedAt: '2024-01-10T14:00:00Z',
      isShared: true,
      permissions: {
        canView: true,
        canEdit: false,
        canDelete: false,
        canShare: false,
      },
      uploader: {
        id: 'provider-2',
        firstName: 'Dr. Michael',
        lastName: 'Brown',
        role: 'PROVIDER',
      },
    },
    {
      id: '3',
      name: 'Chest X-Ray.jpg',
      type: 'FILE',
      mimeType: 'image/jpeg',
      size: 1024000,
      url: '/files/chest-xray.jpg',
      thumbnailUrl: '/files/thumbnails/chest-xray-thumb.jpg',
      patientId: 'patient-1',
      uploadedBy: 'provider-2',
      createdAt: '2024-01-08T09:00:00Z',
      updatedAt: '2024-01-08T09:00:00Z',
      tags: ['imaging', 'chest', 'x-ray'],
      description: 'Chest X-ray for respiratory symptoms evaluation',
      isShared: true,
      permissions: {
        canView: true,
        canEdit: false,
        canDelete: false,
        canShare: false,
      },
      uploader: {
        id: 'provider-2',
        firstName: 'Dr. Michael',
        lastName: 'Brown',
        role: 'PROVIDER',
      },
      patient: {
        id: 'patient-1',
        firstName: 'John',
        lastName: 'Doe',
      },
    },
  ];

  const files = filesData?.files || mockFiles;

  const handleFileUpload = useCallback(async (files: FileList) => {
    if (!uploadPatientId && user?.role !== 'PATIENT') {
      toast.error('Please select a patient for file upload');
      return;
    }

    const newProgress = new Map(uploadProgress);
    
    Array.from(files).forEach((file) => {
      const fileId = `${file.name}-${Date.now()}`;
      newProgress.set(fileId, {
        file,
        progress: 0,
        status: 'uploading',
      });
    });
    
    setUploadProgress(newProgress);

    // Simulate file upload with progress
    for (const file of Array.from(files)) {
      const fileId = `${file.name}-${Date.now()}`;
      
      try {
        // Simulate upload progress
        for (let progress = 0; progress <= 100; progress += 10) {
          await new Promise(resolve => setTimeout(resolve, 100));
          
          setUploadProgress(prev => {
            const updated = new Map(prev);
            const current = updated.get(fileId);
            if (current) {
              updated.set(fileId, { ...current, progress });
            }
            return updated;
          });
        }

        // Mark as completed
        setUploadProgress(prev => {
          const updated = new Map(prev);
          const current = updated.get(fileId);
          if (current) {
            updated.set(fileId, { ...current, status: 'completed' });
          }
          return updated;
        });

        // Remove from progress after delay
        setTimeout(() => {
          setUploadProgress(prev => {
            const updated = new Map(prev);
            updated.delete(fileId);
            return updated;
          });
        }, 2000);

      } catch (error) {
        setUploadProgress(prev => {
          const updated = new Map(prev);
          const current = updated.get(fileId);
          if (current) {
            updated.set(fileId, {
              ...current,
              status: 'error',
              error: 'Upload failed',
            });
          }
          return updated;
        });
      }
    }

    // Refresh file list
    queryClient.invalidateQueries({ queryKey: ['files'] });
    toast.success(`${files.length} file(s) uploaded successfully!`);
  }, [uploadPatientId, user?.role, uploadProgress, queryClient]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files);
    }
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const getFileIcon = (file: FileItem) => {
    if (file.type === 'FOLDER') {
      return <FolderIcon className="h-8 w-8 text-blue-500" />;
    }

    if (!file.mimeType) {
      return <DocumentIcon className="h-8 w-8 text-gray-500" />;
    }

    if (file.mimeType.startsWith('image/')) {
      return <PhotoIcon className="h-8 w-8 text-green-500" />;
    }
    if (file.mimeType.startsWith('video/')) {
      return <VideoCameraIcon className="h-8 w-8 text-purple-500" />;
    }
    if (file.mimeType.startsWith('audio/')) {
      return <MusicalNoteIcon className="h-8 w-8 text-pink-500" />;
    }
    if (file.mimeType === 'application/pdf') {
      return <DocumentTextIcon className="h-8 w-8 text-red-500" />;
    }
    if (file.mimeType.includes('zip') || file.mimeType.includes('archive')) {
      return <ArchiveBoxIcon className="h-8 w-8 text-yellow-500" />;
    }

    return <DocumentIcon className="h-8 w-8 text-gray-500" />;
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'Unknown size';
    
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const handleFileSelect = (fileId: string) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(fileId)) {
      newSelected.delete(fileId);
    } else {
      newSelected.add(fileId);
    }
    setSelectedFiles(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedFiles.size === files.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(files.map(f => f.id)));
    }
  };

  const handleDeleteSelected = () => {
    if (selectedFiles.size === 0) return;
    
    if (window.confirm(`Are you sure you want to delete ${selectedFiles.size} selected item(s)?`)) {
      deleteMutation.mutate(Array.from(selectedFiles));
    }
  };

  const handleCreateFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) {
      toast.error('Please enter a folder name');
      return;
    }

    createFolderMutation.mutate({
      name: newFolderName.trim(),
      parentId: currentFolderId || undefined,
      patientId: uploadPatientId || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <ExclamationTriangleIcon className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error Loading Files</h2>
          <p className="text-gray-600">Please try again later.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">File Manager</h1>
            <p className="text-gray-600 mt-1">
              Manage patient files, documents, and medical records
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowCreateFolderModal(true)}
              className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors flex items-center space-x-2"
            >
              <FolderIcon className="h-5 w-5" />
              <span>New Folder</span>
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
            >
              <CloudArrowUpIcon className="h-5 w-5" />
              <span>Upload Files</span>
            </button>
          </div>
        </div>
      </div>

      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <div className="mb-6">
          <nav className="flex items-center space-x-2 text-sm text-gray-600">
            <button
              onClick={() => setCurrentFolderId(null)}
              className="hover:text-blue-600 transition-colors"
            >
              Home
            </button>
            {breadcrumbs.map((folder: any, index: number) => (
              <React.Fragment key={folder.id}>
                <span>/</span>
                <button
                  onClick={() => setCurrentFolderId(folder.id)}
                  className="hover:text-blue-600 transition-colors"
                >
                  {folder.name}
                </button>
              </React.Fragment>
            ))}
          </nav>
        </div>
      )}

      {/* Filters and Search */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Search */}
          <div className="relative">
            <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search files..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* File Type Filter */}
          <select
            value={selectedFileType}
            onChange={(e) => setSelectedFileType(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Types</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
            <option value="audio">Audio</option>
            <option value="document">Documents</option>
            <option value="pdf">PDF</option>
            <option value="archive">Archives</option>
          </select>

          {/* Patient Filter (for non-patient users) */}
          {user?.role !== 'PATIENT' && (
            <select
              value={selectedPatient}
              onChange={(e) => setSelectedPatient(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Patients</option>
              {patients?.map((patient: any) => (
                <option key={patient.id} value={patient.id}>
                  {patient.firstName} {patient.lastName}
                </option>
              ))}
            </select>
          )}

          {/* View Mode Toggle */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded ${viewMode === 'grid' ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm6 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V4zm-6 6a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1v-4zm6 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded ${viewMode === 'list' ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M3 4a1 1 0 000 2h14a1 1 0 100-2H3zm0 4a1 1 0 000 2h14a1 1 0 100-2H3zm0 4a1 1 0 000 2h14a1 1 0 100-2H3z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Bulk Actions */}
      {selectedFiles.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <span className="text-sm font-medium text-blue-900">
                {selectedFiles.size} item(s) selected
              </span>
              <button
                onClick={handleSelectAll}
                className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
              >
                {selectedFiles.size === files.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setShowShareModal(true)}
                className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700 transition-colors flex items-center space-x-1"
              >
                <ShareIcon className="h-4 w-4" />
                <span>Share</span>
              </button>
              <button
                onClick={handleDeleteSelected}
                disabled={deleteMutation.isPending}
                className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center space-x-1"
              >
                <TrashIcon className="h-4 w-4" />
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Progress */}
      {uploadProgress.size > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
          <h3 className="font-medium text-gray-900 mb-3">Upload Progress</h3>
          <div className="space-y-2">
            {Array.from(uploadProgress.entries()).map(([fileId, progress]) => (
              <div key={fileId} className="flex items-center space-x-3">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700">
                      {progress.file.name}
                    </span>
                    <span className="text-sm text-gray-500">
                      {progress.status === 'completed' ? (
                        <CheckCircleIcon className="h-4 w-4 text-green-500" />
                      ) : progress.status === 'error' ? (
                        <ExclamationTriangleIcon className="h-4 w-4 text-red-500" />
                      ) : (
                        `${progress.progress}%`
                      )}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${
                        progress.status === 'completed'
                          ? 'bg-green-500'
                          : progress.status === 'error'
                          ? 'bg-red-500'
                          : 'bg-blue-500'
                      }`}
                      style={{ width: `${progress.progress}%` }}
                    />
                  </div>
                  {progress.error && (
                    <p className="text-xs text-red-600 mt-1">{progress.error}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* File Grid/List */}
      <div
        className="bg-white rounded-lg shadow-sm border border-gray-200 min-h-96"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {files.length === 0 ? (
          <div className="text-center py-12">
            <CloudArrowUpIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Files Found</h3>
            <p className="text-gray-600 mb-4">Drag and drop files here or click upload to get started.</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Upload Files
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4 p-6">
            {files.map((file) => (
              <motion.div
                key={file.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`relative group cursor-pointer border-2 rounded-lg p-4 transition-all hover:shadow-md ${
                  selectedFiles.has(file.id)
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => {
                  if (file.type === 'FOLDER') {
                    setCurrentFolderId(file.id);
                  } else {
                    handleFileSelect(file.id);
                  }
                }}
              >
                {/* Selection Checkbox */}
                {file.type === 'FILE' && (
                  <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <input
                      type="checkbox"
                      checked={selectedFiles.has(file.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleFileSelect(file.id);
                      }}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </div>
                )}

                {/* File Icon/Thumbnail */}
                <div className="flex justify-center mb-3">
                  {file.thumbnailUrl ? (
                    <img
                      src={file.thumbnailUrl}
                      alt={file.name}
                      className="w-16 h-16 object-cover rounded"
                    />
                  ) : (
                    getFileIcon(file)
                  )}
                </div>

                {/* File Info */}
                <div className="text-center">
                  <h3 className="text-sm font-medium text-gray-900 truncate" title={file.name}>
                    {file.name}
                  </h3>
                  {file.type === 'FILE' && (
                    <p className="text-xs text-gray-500 mt-1">
                      {formatFileSize(file.size)}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {format(parseISO(file.createdAt), 'MMM dd, yyyy')}
                  </p>
                </div>

                {/* Actions */}
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="flex items-center space-x-1">
                    {file.type === 'FILE' && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFile(file);
                            setShowFilePreview(true);
                          }}
                          className="p-1 bg-white rounded shadow hover:bg-gray-50 transition-colors"
                          title="Preview"
                        >
                          <EyeIcon className="h-3 w-3 text-gray-600" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(file.url, '_blank');
                          }}
                          className="p-1 bg-white rounded shadow hover:bg-gray-50 transition-colors"
                          title="Download"
                        >
                          <ArrowDownTrayIcon className="h-3 w-3 text-gray-600" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Shared Indicator */}
                {file.isShared && (
                  <div className="absolute bottom-2 right-2">
                    <ShareIcon className="h-3 w-3 text-blue-500" title="Shared" />
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedFiles.size === files.filter(f => f.type === 'FILE').length}
                      onChange={handleSelectAll}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Size
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Patient
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Uploaded By
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {files.map((file) => (
                  <motion.tr
                    key={file.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      {file.type === 'FILE' && (
                        <input
                          type="checkbox"
                          checked={selectedFiles.has(file.id)}
                          onChange={() => handleFileSelect(file.id)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="flex-shrink-0">
                          {getFileIcon(file)}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {file.name}
                          </div>
                          {file.description && (
                            <div className="text-sm text-gray-500 truncate max-w-xs">
                              {file.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {file.type === 'FILE' ? formatFileSize(file.size) : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {file.patient ? `${file.patient.firstName} ${file.patient.lastName}` : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {file.uploader ? `${file.uploader.firstName} ${file.uploader.lastName}` : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {format(parseISO(file.createdAt), 'MMM dd, yyyy')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        {file.type === 'FILE' ? (
                          <>
                            <button
                              onClick={() => {
                                setSelectedFile(file);
                                setShowFilePreview(true);
                              }}
                              className="text-blue-600 hover:text-blue-800 transition-colors"
                              title="Preview"
                            >
                              <EyeIcon className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => window.open(file.url, '_blank')}
                              className="text-green-600 hover:text-green-800 transition-colors"
                              title="Download"
                            >
                              <ArrowDownTrayIcon className="h-4 w-4" />
                            </button>
                            {file.permissions.canDelete && (
                              <button
                                onClick={() => deleteMutation.mutate([file.id])}
                                className="text-red-600 hover:text-red-800 transition-colors"
                                title="Delete"
                              >
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            )}
                          </>
                        ) : (
                          <button
                            onClick={() => setCurrentFolderId(file.id)}
                            className="text-blue-600 hover:text-blue-800 transition-colors"
                            title="Open Folder"
                          >
                            <FolderOpenIcon className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            handleFileUpload(e.target.files);
          }
        }}
      />

      {/* Create Folder Modal */}
      <AnimatePresence>
        {showCreateFolderModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-lg shadow-xl max-w-md w-full"
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">Create New Folder</h2>
                  <button
                    onClick={() => {
                      setShowCreateFolderModal(false);
                      setNewFolderName('');
                    }}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <form onSubmit={handleCreateFolder} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Folder Name *
                    </label>
                    <input
                      type="text"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Enter folder name"
                      required
                    />
                  </div>

                  {user?.role !== 'PATIENT' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Patient (Optional)
                      </label>
                      <select
                        value={uploadPatientId}
                        onChange={(e) => setUploadPatientId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">No specific patient</option>
                        {patients?.map((patient: any) => (
                          <option key={patient.id} value={patient.id}>
                            {patient.firstName} {patient.lastName}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="flex justify-end space-x-3 pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateFolderModal(false);
                        setNewFolderName('');
                      }}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={createFolderMutation.isPending}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                    >
                      {createFolderMutation.isPending ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          <span>Creating...</span>
                        </>
                      ) : (
                        <>
                          <FolderIcon className="h-4 w-4" />
                          <span>Create Folder</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* File Preview Modal */}
      <AnimatePresence>
        {showFilePreview && selectedFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
            >
              <div className="p-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">{selectedFile.name}</h2>
                  <button
                    onClick={() => {
                      setShowFilePreview(false);
                      setSelectedFile(null);
                    }}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>
              </div>

              <div className="p-6 max-h-[calc(90vh-120px)] overflow-y-auto">
                {selectedFile.mimeType?.startsWith('image/') ? (
                  <img
                    src={selectedFile.url}
                    alt={selectedFile.name}
                    className="max-w-full h-auto mx-auto"
                  />
                ) : selectedFile.mimeType === 'application/pdf' ? (
                  <iframe
                    src={selectedFile.url}
                    className="w-full h-96 border border-gray-300 rounded"
                    title={selectedFile.name}
                  />
                ) : (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 mx-auto mb-4">
                      {getFileIcon(selectedFile)}
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">{selectedFile.name}</h3>
                    <p className="text-gray-600 mb-4">Preview not available for this file type</p>
                    <button
                      onClick={() => window.open(selectedFile.url, '_blank')}
                      className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2 mx-auto"
                    >
                      <ArrowDownTrayIcon className="h-5 w-5" />
                      <span>Download File</span>
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default FileManager;