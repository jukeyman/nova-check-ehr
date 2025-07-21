import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  DocumentTextIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  DocumentArrowDownIcon,
  ClockIcon,
  UserIcon,
  HeartIcon,
  BeakerIcon,
  CameraIcon,
  DocumentIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { format, parseISO } from 'date-fns';
import { medicalRecordService } from '../../services/medicalRecordService';
import { useAuth } from '../../contexts/AuthContext';

interface MedicalRecord {
  id: string;
  patientId: string;
  providerId: string;
  type: 'CONSULTATION' | 'LAB_RESULT' | 'IMAGING' | 'PRESCRIPTION' | 'PROCEDURE' | 'DIAGNOSIS' | 'VACCINATION' | 'ALLERGY' | 'VITAL_SIGNS';
  title: string;
  description: string;
  date: string;
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'COMPLETED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  attachments?: Attachment[];
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  patient?: {
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
  };
  provider?: {
    id: string;
    firstName: string;
    lastName: string;
    specialization: string;
  };
}

interface Attachment {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  url: string;
}

interface MedicalRecordFormData {
  patientId: string;
  type: MedicalRecord['type'];
  title: string;
  description: string;
  date: string;
  status: MedicalRecord['status'];
  priority: MedicalRecord['priority'];
  metadata?: Record<string, any>;
}

const MedicalRecords: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  // State management
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedPatient, setSelectedPatient] = useState<string>('');
  const [sortBy, setSortBy] = useState<'date' | 'title' | 'type'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);
  
  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
  
  // Form state
  const [formData, setFormData] = useState<MedicalRecordFormData>({
    patientId: user?.role === 'PATIENT' ? user.id : '',
    type: 'CONSULTATION',
    title: '',
    description: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    status: 'ACTIVE',
    priority: 'MEDIUM',
  });

  // Fetch medical records
  const { data: recordsData, isLoading, error } = useQuery({
    queryKey: [
      'medicalRecords',
      searchTerm,
      selectedType,
      selectedStatus,
      selectedPatient,
      sortBy,
      sortOrder,
      currentPage,
      pageSize,
    ],
    queryFn: () => medicalRecordService.getMedicalRecords({
      search: searchTerm,
      type: selectedType !== 'ALL' ? selectedType : undefined,
      status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
      patientId: selectedPatient || undefined,
      sortBy,
      sortOrder,
      page: currentPage,
      limit: pageSize,
    }),
  });

  // Fetch patients (for non-patient users)
  const { data: patients } = useQuery({
    queryKey: ['patients'],
    queryFn: () => medicalRecordService.getPatients(),
    enabled: user?.role !== 'PATIENT',
  });

  // Create medical record mutation
  const createMutation = useMutation({
    mutationFn: (data: MedicalRecordFormData) => medicalRecordService.createMedicalRecord(data),
    onSuccess: () => {
      toast.success('Medical record created successfully!');
      queryClient.invalidateQueries({ queryKey: ['medicalRecords'] });
      setShowCreateModal(false);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create medical record');
    },
  });

  // Update medical record mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<MedicalRecordFormData> }) =>
      medicalRecordService.updateMedicalRecord(id, data),
    onSuccess: () => {
      toast.success('Medical record updated successfully!');
      queryClient.invalidateQueries({ queryKey: ['medicalRecords'] });
      setShowEditModal(false);
      setSelectedRecord(null);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update medical record');
    },
  });

  // Delete medical record mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => medicalRecordService.deleteMedicalRecord(id),
    onSuccess: () => {
      toast.success('Medical record deleted successfully!');
      queryClient.invalidateQueries({ queryKey: ['medicalRecords'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete medical record');
    },
  });

  // Mock data for development
  const mockRecords: MedicalRecord[] = [
    {
      id: '1',
      patientId: 'patient-1',
      providerId: 'provider-1',
      type: 'CONSULTATION',
      title: 'Annual Physical Examination',
      description: 'Comprehensive annual physical examination including vital signs, blood work review, and general health assessment.',
      date: '2024-01-15',
      status: 'COMPLETED',
      priority: 'MEDIUM',
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T11:30:00Z',
      patient: {
        id: 'patient-1',
        firstName: 'John',
        lastName: 'Doe',
        dateOfBirth: '1985-06-15',
      },
      provider: {
        id: 'provider-1',
        firstName: 'Dr. Sarah',
        lastName: 'Johnson',
        specialization: 'Internal Medicine',
      },
    },
    {
      id: '2',
      patientId: 'patient-1',
      providerId: 'provider-2',
      type: 'LAB_RESULT',
      title: 'Complete Blood Count (CBC)',
      description: 'Laboratory results showing normal white blood cell count, hemoglobin levels within normal range.',
      date: '2024-01-10',
      status: 'ACTIVE',
      priority: 'LOW',
      createdAt: '2024-01-10T14:00:00Z',
      updatedAt: '2024-01-10T14:00:00Z',
      patient: {
        id: 'patient-1',
        firstName: 'John',
        lastName: 'Doe',
        dateOfBirth: '1985-06-15',
      },
      provider: {
        id: 'provider-2',
        firstName: 'Dr. Michael',
        lastName: 'Brown',
        specialization: 'Pathology',
      },
    },
    {
      id: '3',
      patientId: 'patient-2',
      providerId: 'provider-1',
      type: 'PRESCRIPTION',
      title: 'Hypertension Medication',
      description: 'Prescribed Lisinopril 10mg daily for blood pressure management. Patient to monitor BP at home.',
      date: '2024-01-08',
      status: 'ACTIVE',
      priority: 'HIGH',
      createdAt: '2024-01-08T09:00:00Z',
      updatedAt: '2024-01-08T09:00:00Z',
      patient: {
        id: 'patient-2',
        firstName: 'Jane',
        lastName: 'Smith',
        dateOfBirth: '1978-03-22',
      },
      provider: {
        id: 'provider-1',
        firstName: 'Dr. Sarah',
        lastName: 'Johnson',
        specialization: 'Internal Medicine',
      },
    },
  ];

  const records = recordsData?.records || mockRecords;
  const totalRecords = recordsData?.total || mockRecords.length;
  const totalPages = Math.ceil(totalRecords / pageSize);

  const resetForm = () => {
    setFormData({
      patientId: user?.role === 'PATIENT' ? user.id : '',
      type: 'CONSULTATION',
      title: '',
      description: '',
      date: format(new Date(), 'yyyy-MM-dd'),
      status: 'ACTIVE',
      priority: 'MEDIUM',
    });
  };

  const handleCreateRecord = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim() || !formData.description.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }
    createMutation.mutate(formData);
  };

  const handleUpdateRecord = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecord || !formData.title.trim() || !formData.description.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }
    updateMutation.mutate({ id: selectedRecord.id, data: formData });
  };

  const handleDeleteRecord = (record: MedicalRecord) => {
    if (window.confirm('Are you sure you want to delete this medical record?')) {
      deleteMutation.mutate(record.id);
    }
  };

  const openEditModal = (record: MedicalRecord) => {
    setSelectedRecord(record);
    setFormData({
      patientId: record.patientId,
      type: record.type,
      title: record.title,
      description: record.description,
      date: record.date,
      status: record.status,
      priority: record.priority,
      metadata: record.metadata,
    });
    setShowEditModal(true);
  };

  const getTypeIcon = (type: MedicalRecord['type']) => {
    switch (type) {
      case 'CONSULTATION':
        return <UserIcon className="h-5 w-5" />;
      case 'LAB_RESULT':
        return <BeakerIcon className="h-5 w-5" />;
      case 'IMAGING':
        return <CameraIcon className="h-5 w-5" />;
      case 'PRESCRIPTION':
        return <DocumentIcon className="h-5 w-5" />;
      case 'VITAL_SIGNS':
        return <HeartIcon className="h-5 w-5" />;
      default:
        return <DocumentTextIcon className="h-5 w-5" />;
    }
  };

  const getStatusColor = (status: MedicalRecord['status']) => {
    switch (status) {
      case 'ACTIVE':
        return 'bg-green-100 text-green-800';
      case 'COMPLETED':
        return 'bg-blue-100 text-blue-800';
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-800';
      case 'INACTIVE':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityColor = (priority: MedicalRecord['priority']) => {
    switch (priority) {
      case 'URGENT':
        return 'bg-red-100 text-red-800';
      case 'HIGH':
        return 'bg-orange-100 text-orange-800';
      case 'MEDIUM':
        return 'bg-blue-100 text-blue-800';
      case 'LOW':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
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
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error Loading Medical Records</h2>
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
            <h1 className="text-3xl font-bold text-gray-900">Medical Records</h1>
            <p className="text-gray-600 mt-1">
              Manage and view patient medical records and health information
            </p>
          </div>
          {(user?.role === 'ADMIN' || user?.role === 'PROVIDER' || user?.role === 'STAFF') && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
            >
              <PlusIcon className="h-5 w-5" />
              <span>Add Record</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Search */}
          <div className="relative">
            <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search records..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Type Filter */}
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Types</option>
            <option value="CONSULTATION">Consultation</option>
            <option value="LAB_RESULT">Lab Result</option>
            <option value="IMAGING">Imaging</option>
            <option value="PRESCRIPTION">Prescription</option>
            <option value="PROCEDURE">Procedure</option>
            <option value="DIAGNOSIS">Diagnosis</option>
            <option value="VACCINATION">Vaccination</option>
            <option value="ALLERGY">Allergy</option>
            <option value="VITAL_SIGNS">Vital Signs</option>
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="COMPLETED">Completed</option>
            <option value="PENDING">Pending</option>
            <option value="INACTIVE">Inactive</option>
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
        </div>

        {/* Sort Options */}
        <div className="flex items-center space-x-4 mt-4">
          <span className="text-sm font-medium text-gray-700">Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'date' | 'title' | 'type')}
            className="px-3 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="date">Date</option>
            <option value="title">Title</option>
            <option value="type">Type</option>
          </select>
          <button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
          >
            {sortOrder === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {/* Records List */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {records.length === 0 ? (
          <div className="text-center py-12">
            <DocumentTextIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Medical Records Found</h3>
            <p className="text-gray-600">No records match your current filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Record
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Patient
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Provider
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Priority
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {records.map((record) => (
                  <motion.tr
                    key={record.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="flex-shrink-0">
                          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600">
                            {getTypeIcon(record.type)}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {record.title}
                          </div>
                          <div className="text-sm text-gray-500">
                            {record.type.replace('_', ' ')}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">
                        {record.patient?.firstName} {record.patient?.lastName}
                      </div>
                      <div className="text-sm text-gray-500">
                        DOB: {record.patient?.dateOfBirth && format(parseISO(record.patient.dateOfBirth), 'MMM dd, yyyy')}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">
                        {record.provider?.firstName} {record.provider?.lastName}
                      </div>
                      <div className="text-sm text-gray-500">
                        {record.provider?.specialization}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">
                        {format(parseISO(record.date), 'MMM dd, yyyy')}
                      </div>
                      <div className="text-sm text-gray-500">
                        {format(parseISO(record.createdAt), 'HH:mm')}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(record.status)}`}>
                        {record.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getPriorityColor(record.priority)}`}>
                        {record.priority}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => {
                            setSelectedRecord(record);
                            setShowViewModal(true);
                          }}
                          className="text-blue-600 hover:text-blue-800 transition-colors"
                          title="View Record"
                        >
                          <EyeIcon className="h-4 w-4" />
                        </button>
                        {(user?.role === 'ADMIN' || user?.role === 'PROVIDER') && (
                          <>
                            <button
                              onClick={() => openEditModal(record)}
                              className="text-green-600 hover:text-green-800 transition-colors"
                              title="Edit Record"
                            >
                              <PencilIcon className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteRecord(record)}
                              className="text-red-600 hover:text-red-800 transition-colors"
                              title="Delete Record"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, totalRecords)} of {totalRecords} records
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="px-3 py-1 text-sm text-gray-700">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <AnimatePresence>
        {(showCreateModal || showEditModal) && (
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
              className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-semibold text-gray-900">
                    {showCreateModal ? 'Create Medical Record' : 'Edit Medical Record'}
                  </h2>
                  <button
                    onClick={() => {
                      setShowCreateModal(false);
                      setShowEditModal(false);
                      setSelectedRecord(null);
                      resetForm();
                    }}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>

                <form onSubmit={showCreateModal ? handleCreateRecord : handleUpdateRecord} className="space-y-4">
                  {/* Patient Selection (for non-patient users) */}
                  {user?.role !== 'PATIENT' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Patient *
                      </label>
                      <select
                        value={formData.patientId}
                        onChange={(e) => setFormData({ ...formData, patientId: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      >
                        <option value="">Select a patient</option>
                        {patients?.map((patient: any) => (
                          <option key={patient.id} value={patient.id}>
                            {patient.firstName} {patient.lastName}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Type */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Type *
                      </label>
                      <select
                        value={formData.type}
                        onChange={(e) => setFormData({ ...formData, type: e.target.value as MedicalRecord['type'] })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      >
                        <option value="CONSULTATION">Consultation</option>
                        <option value="LAB_RESULT">Lab Result</option>
                        <option value="IMAGING">Imaging</option>
                        <option value="PRESCRIPTION">Prescription</option>
                        <option value="PROCEDURE">Procedure</option>
                        <option value="DIAGNOSIS">Diagnosis</option>
                        <option value="VACCINATION">Vaccination</option>
                        <option value="ALLERGY">Allergy</option>
                        <option value="VITAL_SIGNS">Vital Signs</option>
                      </select>
                    </div>

                    {/* Date */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Date *
                      </label>
                      <input
                        type="date"
                        value={formData.date}
                        onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      />
                    </div>
                  </div>

                  {/* Title */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Title *
                    </label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Enter record title"
                      required
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Description *
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      rows={4}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Enter detailed description"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Status */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Status
                      </label>
                      <select
                        value={formData.status}
                        onChange={(e) => setFormData({ ...formData, status: e.target.value as MedicalRecord['status'] })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="ACTIVE">Active</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="PENDING">Pending</option>
                        <option value="INACTIVE">Inactive</option>
                      </select>
                    </div>

                    {/* Priority */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Priority
                      </label>
                      <select
                        value={formData.priority}
                        onChange={(e) => setFormData({ ...formData, priority: e.target.value as MedicalRecord['priority'] })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="LOW">Low</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="HIGH">High</option>
                        <option value="URGENT">Urgent</option>
                      </select>
                    </div>
                  </div>

                  {/* Form Actions */}
                  <div className="flex justify-end space-x-3 pt-6">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateModal(false);
                        setShowEditModal(false);
                        setSelectedRecord(null);
                        resetForm();
                      }}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={createMutation.isPending || updateMutation.isPending}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                    >
                      {(createMutation.isPending || updateMutation.isPending) ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          <span>Saving...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircleIcon className="h-4 w-4" />
                          <span>{showCreateModal ? 'Create Record' : 'Update Record'}</span>
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

      {/* View Modal */}
      <AnimatePresence>
        {showViewModal && selectedRecord && (
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
              className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-semibold text-gray-900">Medical Record Details</h2>
                  <button
                    onClick={() => {
                      setShowViewModal(false);
                      setSelectedRecord(null);
                    }}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>

                <div className="space-y-6">
                  {/* Header Info */}
                  <div className="flex items-start space-x-4">
                    <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600">
                      {getTypeIcon(selectedRecord.type)}
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-medium text-gray-900">{selectedRecord.title}</h3>
                      <p className="text-gray-600">{selectedRecord.type.replace('_', ' ')}</p>
                      <div className="flex items-center space-x-4 mt-2">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(selectedRecord.status)}`}>
                          {selectedRecord.status}
                        </span>
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getPriorityColor(selectedRecord.priority)}`}>
                          {selectedRecord.priority}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Patient & Provider Info */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Patient Information</h4>
                      <div className="space-y-1 text-sm">
                        <p><span className="font-medium">Name:</span> {selectedRecord.patient?.firstName} {selectedRecord.patient?.lastName}</p>
                        <p><span className="font-medium">Date of Birth:</span> {selectedRecord.patient?.dateOfBirth && format(parseISO(selectedRecord.patient.dateOfBirth), 'MMM dd, yyyy')}</p>
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-2">Provider Information</h4>
                      <div className="space-y-1 text-sm">
                        <p><span className="font-medium">Name:</span> {selectedRecord.provider?.firstName} {selectedRecord.provider?.lastName}</p>
                        <p><span className="font-medium">Specialization:</span> {selectedRecord.provider?.specialization}</p>
                      </div>
                    </div>
                  </div>

                  {/* Record Details */}
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">Description</h4>
                    <p className="text-gray-700 whitespace-pre-wrap">{selectedRecord.description}</p>
                  </div>

                  {/* Dates */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="font-medium text-gray-900">Record Date:</span>
                      <p className="text-gray-600">{format(parseISO(selectedRecord.date), 'MMM dd, yyyy')}</p>
                    </div>
                    <div>
                      <span className="font-medium text-gray-900">Created:</span>
                      <p className="text-gray-600">{format(parseISO(selectedRecord.createdAt), 'MMM dd, yyyy HH:mm')}</p>
                    </div>
                    <div>
                      <span className="font-medium text-gray-900">Updated:</span>
                      <p className="text-gray-600">{format(parseISO(selectedRecord.updatedAt), 'MMM dd, yyyy HH:mm')}</p>
                    </div>
                  </div>

                  {/* Attachments */}
                  {selectedRecord.attachments && selectedRecord.attachments.length > 0 && (
                    <div>
                      <h4 className="font-medium text-gray-900 mb-2">Attachments</h4>
                      <div className="space-y-2">
                        {selectedRecord.attachments.map((attachment) => (
                          <div key={attachment.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                            <div className="flex items-center space-x-3">
                              <DocumentArrowDownIcon className="h-5 w-5 text-gray-400" />
                              <div>
                                <p className="text-sm font-medium text-gray-900">{attachment.fileName}</p>
                                <p className="text-xs text-gray-500">{(attachment.fileSize / 1024).toFixed(1)} KB</p>
                              </div>
                            </div>
                            <button
                              onClick={() => window.open(attachment.url, '_blank')}
                              className="text-blue-600 hover:text-blue-800 transition-colors"
                            >
                              Download
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MedicalRecords;