import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  MagnifyingGlassIcon,
  PlusIcon,
  FunnelIcon,
  UserIcon,
  PhoneIcon,
  EnvelopeIcon,
  CalendarDaysIcon,
  DocumentTextIcon,
  EllipsisVerticalIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useQuery } from '@tanstack/react-query';
import { patientService } from '../services/patientService';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { toast } from 'react-hot-toast';

interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
  };
  emergencyContact: {
    name: string;
    phone: string;
    relationship: string;
  };
  insurance: {
    provider: string;
    policyNumber: string;
    groupNumber: string;
  };
  medicalHistory: string[];
  allergies: string[];
  medications: string[];
  lastVisit?: string;
  nextAppointment?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  createdAt: string;
  updatedAt: string;
}

const Patients: React.FC = () => {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [genderFilter, setGenderFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<string>('lastName');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedPatients, setSelectedPatients] = useState<string[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);

  // Fetch patients data
  const { data: patients, isLoading, error, refetch } = useQuery({
    queryKey: ['patients', user?.id],
    queryFn: () => patientService.getPatients(),
    refetchInterval: 30000,
  });

  // Mock data for development
  const mockPatients: Patient[] = [
    {
      id: '1',
      firstName: 'Sarah',
      lastName: 'Johnson',
      email: 'sarah.johnson@email.com',
      phone: '(555) 123-4567',
      dateOfBirth: '1985-03-15',
      gender: 'FEMALE',
      address: {
        street: '123 Main St',
        city: 'New York',
        state: 'NY',
        zipCode: '10001',
      },
      emergencyContact: {
        name: 'John Johnson',
        phone: '(555) 987-6543',
        relationship: 'Spouse',
      },
      insurance: {
        provider: 'Blue Cross Blue Shield',
        policyNumber: 'BC123456789',
        groupNumber: 'GRP001',
      },
      medicalHistory: ['Hypertension', 'Diabetes Type 2'],
      allergies: ['Penicillin', 'Shellfish'],
      medications: ['Metformin', 'Lisinopril'],
      lastVisit: '2024-01-15',
      nextAppointment: '2024-02-15',
      status: 'ACTIVE',
      createdAt: '2023-01-01',
      updatedAt: '2024-01-15',
    },
    {
      id: '2',
      firstName: 'Michael',
      lastName: 'Brown',
      email: 'michael.brown@email.com',
      phone: '(555) 234-5678',
      dateOfBirth: '1978-07-22',
      gender: 'MALE',
      address: {
        street: '456 Oak Ave',
        city: 'Los Angeles',
        state: 'CA',
        zipCode: '90210',
      },
      emergencyContact: {
        name: 'Lisa Brown',
        phone: '(555) 876-5432',
        relationship: 'Wife',
      },
      insurance: {
        provider: 'Aetna',
        policyNumber: 'AET987654321',
        groupNumber: 'GRP002',
      },
      medicalHistory: ['Asthma'],
      allergies: ['Pollen'],
      medications: ['Albuterol'],
      lastVisit: '2024-01-10',
      status: 'ACTIVE',
      createdAt: '2023-02-15',
      updatedAt: '2024-01-10',
    },
    {
      id: '3',
      firstName: 'Emily',
      lastName: 'Davis',
      email: 'emily.davis@email.com',
      phone: '(555) 345-6789',
      dateOfBirth: '1992-11-08',
      gender: 'FEMALE',
      address: {
        street: '789 Pine St',
        city: 'Chicago',
        state: 'IL',
        zipCode: '60601',
      },
      emergencyContact: {
        name: 'Robert Davis',
        phone: '(555) 765-4321',
        relationship: 'Father',
      },
      insurance: {
        provider: 'Cigna',
        policyNumber: 'CIG456789123',
        groupNumber: 'GRP003',
      },
      medicalHistory: [],
      allergies: [],
      medications: [],
      lastVisit: '2024-01-20',
      nextAppointment: '2024-03-01',
      status: 'ACTIVE',
      createdAt: '2023-03-10',
      updatedAt: '2024-01-20',
    },
    {
      id: '4',
      firstName: 'David',
      lastName: 'Wilson',
      email: 'david.wilson@email.com',
      phone: '(555) 456-7890',
      dateOfBirth: '1965-05-30',
      gender: 'MALE',
      address: {
        street: '321 Elm St',
        city: 'Houston',
        state: 'TX',
        zipCode: '77001',
      },
      emergencyContact: {
        name: 'Mary Wilson',
        phone: '(555) 654-3210',
        relationship: 'Wife',
      },
      insurance: {
        provider: 'UnitedHealth',
        policyNumber: 'UH789123456',
        groupNumber: 'GRP004',
      },
      medicalHistory: ['Heart Disease', 'High Cholesterol'],
      allergies: ['Latex'],
      medications: ['Atorvastatin', 'Aspirin'],
      lastVisit: '2023-12-15',
      status: 'INACTIVE',
      createdAt: '2022-11-20',
      updatedAt: '2023-12-15',
    },
  ];

  // Use mock data if API fails
  const patientsData = patients || mockPatients;

  // Filter and sort patients
  const filteredPatients = useMemo(() => {
    let filtered = patientsData.filter((patient) => {
      const matchesSearch = 
        patient.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        patient.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        patient.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        patient.phone.includes(searchTerm);
      
      const matchesStatus = statusFilter === 'ALL' || patient.status === statusFilter;
      const matchesGender = genderFilter === 'ALL' || patient.gender === genderFilter;
      
      return matchesSearch && matchesStatus && matchesGender;
    });

    // Sort patients
    filtered.sort((a, b) => {
      let aValue: any = a[sortBy as keyof Patient];
      let bValue: any = b[sortBy as keyof Patient];
      
      if (sortBy === 'dateOfBirth' || sortBy === 'lastVisit') {
        aValue = new Date(aValue || 0);
        bValue = new Date(bValue || 0);
      }
      
      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }
      
      if (sortOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });

    return filtered;
  }, [patientsData, searchTerm, statusFilter, genderFilter, sortBy, sortOrder]);

  const handleSelectPatient = (patientId: string) => {
    setSelectedPatients(prev => 
      prev.includes(patientId) 
        ? prev.filter(id => id !== patientId)
        : [...prev, patientId]
    );
  };

  const handleSelectAll = () => {
    if (selectedPatients.length === filteredPatients.length) {
      setSelectedPatients([]);
    } else {
      setSelectedPatients(filteredPatients.map(p => p.id));
    }
  };

  const handleDeletePatient = async (patientId: string) => {
    if (window.confirm('Are you sure you want to delete this patient?')) {
      try {
        await patientService.deletePatient(patientId);
        toast.success('Patient deleted successfully');
        refetch();
      } catch (error) {
        toast.error('Failed to delete patient');
      }
    }
  };

  const calculateAge = (dateOfBirth: string) => {
    const today = new Date();
    const birthDate = new Date(dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Patients</h1>
          <p className="text-gray-600 mt-1">
            Manage patient records and information
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <FunnelIcon className="h-4 w-4 mr-2" />
            Filters
          </button>
          <Link
            to="/patients/new"
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <PlusIcon className="h-4 w-4 mr-2" />
            Add Patient
          </Link>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center space-x-4 mb-4">
          <div className="flex-1 relative">
            <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search patients by name, email, or phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="lastName">Sort by Last Name</option>
            <option value="firstName">Sort by First Name</option>
            <option value="dateOfBirth">Sort by Age</option>
            <option value="lastVisit">Sort by Last Visit</option>
            <option value="createdAt">Sort by Date Added</option>
          </select>
          <button
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            {sortOrder === 'asc' ? '↑' : '↓'}
          </button>
        </div>

        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-gray-200"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Gender
              </label>
              <select
                value={genderFilter}
                onChange={(e) => setGenderFilter(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="ALL">All Genders</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('ALL');
                  setGenderFilter('ALL');
                  setSortBy('lastName');
                  setSortOrder('asc');
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Clear Filters
              </button>
            </div>
          </motion.div>
        )}
      </div>

      {/* Results Summary */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Showing {filteredPatients.length} of {patientsData.length} patients
        </p>
        {selectedPatients.length > 0 && (
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">
              {selectedPatients.length} selected
            </span>
            <button
              onClick={() => setSelectedPatients([])}
              className="text-sm text-blue-600 hover:text-blue-500"
            >
              Clear selection
            </button>
          </div>
        )}
      </div>

      {/* Patients Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredPatients.map((patient, index) => (
          <motion.div
            key={patient.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.05 }}
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={selectedPatients.includes(patient.id)}
                  onChange={() => handleSelectPatient(patient.id)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mr-3"
                />
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                  <UserIcon className="h-6 w-6 text-gray-600" />
                </div>
              </div>
              <div className="relative">
                <button className="p-1 rounded-full hover:bg-gray-100">
                  <EllipsisVerticalIcon className="h-5 w-5 text-gray-400" />
                </button>
                {/* Dropdown menu would go here */}
              </div>
            </div>

            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {patient.firstName} {patient.lastName}
              </h3>
              <p className="text-sm text-gray-600">
                Age {calculateAge(patient.dateOfBirth)} • {patient.gender}
              </p>
              <span
                className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium mt-2 ${
                  patient.status === 'ACTIVE'
                    ? 'bg-green-100 text-green-800'
                    : patient.status === 'INACTIVE'
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                {patient.status}
              </span>
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex items-center text-sm text-gray-600">
                <EnvelopeIcon className="h-4 w-4 mr-2" />
                <span className="truncate">{patient.email}</span>
              </div>
              <div className="flex items-center text-sm text-gray-600">
                <PhoneIcon className="h-4 w-4 mr-2" />
                <span>{patient.phone}</span>
              </div>
              {patient.lastVisit && (
                <div className="flex items-center text-sm text-gray-600">
                  <CalendarDaysIcon className="h-4 w-4 mr-2" />
                  <span>Last visit: {format(parseISO(patient.lastVisit), 'MMM d, yyyy')}</span>
                </div>
              )}
            </div>

            {/* Medical Info Summary */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                <span>Medical Summary</span>
              </div>
              <div className="space-y-1">
                {patient.medicalHistory.length > 0 && (
                  <div className="text-xs">
                    <span className="font-medium text-gray-700">Conditions:</span>
                    <span className="ml-1 text-gray-600">
                      {patient.medicalHistory.slice(0, 2).join(', ')}
                      {patient.medicalHistory.length > 2 && '...'}
                    </span>
                  </div>
                )}
                {patient.allergies.length > 0 && (
                  <div className="text-xs">
                    <span className="font-medium text-gray-700">Allergies:</span>
                    <span className="ml-1 text-gray-600">
                      {patient.allergies.slice(0, 2).join(', ')}
                      {patient.allergies.length > 2 && '...'}
                    </span>
                  </div>
                )}
                {patient.medications.length > 0 && (
                  <div className="text-xs">
                    <span className="font-medium text-gray-700">Medications:</span>
                    <span className="ml-1 text-gray-600">
                      {patient.medications.slice(0, 2).join(', ')}
                      {patient.medications.length > 2 && '...'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <Link
                to={`/patients/${patient.id}`}
                className="inline-flex items-center px-3 py-1 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <EyeIcon className="h-3 w-3 mr-1" />
                View
              </Link>
              <Link
                to={`/patients/${patient.id}/edit`}
                className="inline-flex items-center px-3 py-1 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <PencilIcon className="h-3 w-3 mr-1" />
                Edit
              </Link>
              <Link
                to={`/appointments/new?patientId=${patient.id}`}
                className="inline-flex items-center px-3 py-1 border border-transparent rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <CalendarDaysIcon className="h-3 w-3 mr-1" />
                Schedule
              </Link>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Empty State */}
      {filteredPatients.length === 0 && (
        <div className="text-center py-12">
          <UserIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No patients found</h3>
          <p className="mt-1 text-sm text-gray-500">
            {searchTerm || statusFilter !== 'ALL' || genderFilter !== 'ALL'
              ? 'Try adjusting your search or filter criteria.'
              : 'Get started by adding your first patient.'}
          </p>
          {!searchTerm && statusFilter === 'ALL' && genderFilter === 'ALL' && (
            <div className="mt-6">
              <Link
                to="/patients/new"
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <PlusIcon className="h-4 w-4 mr-2" />
                Add Patient
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Patients;