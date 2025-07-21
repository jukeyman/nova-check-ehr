import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  CalendarDaysIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  ClockIcon,
  UserIcon,
  MapPinIcon,
  PhoneIcon,
  VideoCameraIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  TrashIcon,
  EyeIcon,
} from '@heroicons/react/24/outline';
import { useQuery } from '@tanstack/react-query';
import { appointmentService } from '../services/appointmentService';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';
import { format, parseISO, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, addWeeks, subWeeks } from 'date-fns';
import { toast } from 'react-hot-toast';

interface Appointment {
  id: string;
  patientId: string;
  providerId: string;
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    dateOfBirth: string;
  };
  provider: {
    id: string;
    firstName: string;
    lastName: string;
    specialization: string;
    department: string;
  };
  appointmentDate: string;
  startTime: string;
  endTime: string;
  duration: number;
  type: 'IN_PERSON' | 'TELEMEDICINE' | 'PHONE';
  status: 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  reason: string;
  notes?: string;
  location?: string;
  meetingLink?: string;
  reminderSent: boolean;
  createdAt: string;
  updatedAt: string;
}

type ViewMode = 'calendar' | 'list';
type CalendarView = 'week' | 'month';

const Appointments: React.FC = () => {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [calendarView, setCalendarView] = useState<CalendarView>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [providerFilter, setProviderFilter] = useState<string>('ALL');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedAppointments, setSelectedAppointments] = useState<string[]>([]);

  // Fetch appointments data
  const { data: appointments, isLoading, error, refetch } = useQuery({
    queryKey: ['appointments', user?.id, currentDate],
    queryFn: () => appointmentService.getAppointments({
      startDate: format(startOfWeek(currentDate), 'yyyy-MM-dd'),
      endDate: format(endOfWeek(currentDate), 'yyyy-MM-dd'),
    }),
    refetchInterval: 30000,
  });

  // Mock data for development
  const mockAppointments: Appointment[] = [
    {
      id: '1',
      patientId: '1',
      providerId: 'provider-1',
      patient: {
        id: '1',
        firstName: 'Sarah',
        lastName: 'Johnson',
        email: 'sarah.johnson@email.com',
        phone: '(555) 123-4567',
        dateOfBirth: '1985-03-15',
      },
      provider: {
        id: 'provider-1',
        firstName: 'Dr. Emily',
        lastName: 'Chen',
        specialization: 'Internal Medicine',
        department: 'Primary Care',
      },
      appointmentDate: '2024-02-15',
      startTime: '09:00',
      endTime: '09:30',
      duration: 30,
      type: 'IN_PERSON',
      status: 'SCHEDULED',
      reason: 'Annual checkup',
      notes: 'Patient requested early morning appointment',
      location: 'Room 101',
      reminderSent: false,
      createdAt: '2024-02-01',
      updatedAt: '2024-02-01',
    },
    {
      id: '2',
      patientId: '2',
      providerId: 'provider-2',
      patient: {
        id: '2',
        firstName: 'Michael',
        lastName: 'Brown',
        email: 'michael.brown@email.com',
        phone: '(555) 234-5678',
        dateOfBirth: '1978-07-22',
      },
      provider: {
        id: 'provider-2',
        firstName: 'Dr. James',
        lastName: 'Wilson',
        specialization: 'Cardiology',
        department: 'Cardiology',
      },
      appointmentDate: '2024-02-15',
      startTime: '14:00',
      endTime: '14:45',
      duration: 45,
      type: 'TELEMEDICINE',
      status: 'CONFIRMED',
      reason: 'Follow-up consultation',
      notes: 'Review recent test results',
      meetingLink: 'https://meet.example.com/abc123',
      reminderSent: true,
      createdAt: '2024-02-05',
      updatedAt: '2024-02-10',
    },
    {
      id: '3',
      patientId: '3',
      providerId: 'provider-1',
      patient: {
        id: '3',
        firstName: 'Emily',
        lastName: 'Davis',
        email: 'emily.davis@email.com',
        phone: '(555) 345-6789',
        dateOfBirth: '1992-11-08',
      },
      provider: {
        id: 'provider-1',
        firstName: 'Dr. Emily',
        lastName: 'Chen',
        specialization: 'Internal Medicine',
        department: 'Primary Care',
      },
      appointmentDate: '2024-02-16',
      startTime: '10:30',
      endTime: '11:00',
      duration: 30,
      type: 'IN_PERSON',
      status: 'COMPLETED',
      reason: 'Routine physical',
      location: 'Room 102',
      reminderSent: true,
      createdAt: '2024-02-08',
      updatedAt: '2024-02-16',
    },
    {
      id: '4',
      patientId: '4',
      providerId: 'provider-3',
      patient: {
        id: '4',
        firstName: 'David',
        lastName: 'Wilson',
        email: 'david.wilson@email.com',
        phone: '(555) 456-7890',
        dateOfBirth: '1965-05-30',
      },
      provider: {
        id: 'provider-3',
        firstName: 'Dr. Sarah',
        lastName: 'Martinez',
        specialization: 'Dermatology',
        department: 'Dermatology',
      },
      appointmentDate: '2024-02-17',
      startTime: '15:15',
      endTime: '16:00',
      duration: 45,
      type: 'PHONE',
      status: 'CANCELLED',
      reason: 'Skin consultation',
      notes: 'Patient cancelled due to scheduling conflict',
      reminderSent: false,
      createdAt: '2024-02-12',
      updatedAt: '2024-02-14',
    },
  ];

  // Use mock data if API fails
  const appointmentsData = appointments || mockAppointments;

  // Filter appointments
  const filteredAppointments = useMemo(() => {
    return appointmentsData.filter((appointment) => {
      const matchesSearch = 
        appointment.patient.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        appointment.patient.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        appointment.provider.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        appointment.provider.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        appointment.reason.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = statusFilter === 'ALL' || appointment.status === statusFilter;
      const matchesType = typeFilter === 'ALL' || appointment.type === typeFilter;
      const matchesProvider = providerFilter === 'ALL' || appointment.providerId === providerFilter;
      
      return matchesSearch && matchesStatus && matchesType && matchesProvider;
    });
  }, [appointmentsData, searchTerm, statusFilter, typeFilter, providerFilter]);

  // Get week days for calendar view
  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate);
    const end = endOfWeek(currentDate);
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  // Group appointments by date for calendar view
  const appointmentsByDate = useMemo(() => {
    const grouped: { [key: string]: Appointment[] } = {};
    filteredAppointments.forEach((appointment) => {
      const date = appointment.appointmentDate;
      if (!grouped[date]) {
        grouped[date] = [];
      }
      grouped[date].push(appointment);
    });
    
    // Sort appointments by start time
    Object.keys(grouped).forEach((date) => {
      grouped[date].sort((a, b) => a.startTime.localeCompare(b.startTime));
    });
    
    return grouped;
  }, [filteredAppointments]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'SCHEDULED':
        return 'bg-blue-100 text-blue-800';
      case 'CONFIRMED':
        return 'bg-green-100 text-green-800';
      case 'IN_PROGRESS':
        return 'bg-yellow-100 text-yellow-800';
      case 'COMPLETED':
        return 'bg-gray-100 text-gray-800';
      case 'CANCELLED':
        return 'bg-red-100 text-red-800';
      case 'NO_SHOW':
        return 'bg-orange-100 text-orange-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'IN_PERSON':
        return <MapPinIcon className="h-4 w-4" />;
      case 'TELEMEDICINE':
        return <VideoCameraIcon className="h-4 w-4" />;
      case 'PHONE':
        return <PhoneIcon className="h-4 w-4" />;
      default:
        return <CalendarDaysIcon className="h-4 w-4" />;
    }
  };

  const handleSelectAppointment = (appointmentId: string) => {
    setSelectedAppointments(prev => 
      prev.includes(appointmentId) 
        ? prev.filter(id => id !== appointmentId)
        : [...prev, appointmentId]
    );
  };

  const handleUpdateStatus = async (appointmentId: string, status: string) => {
    try {
      await appointmentService.updateAppointment(appointmentId, { status });
      toast.success('Appointment status updated');
      refetch();
    } catch (error) {
      toast.error('Failed to update appointment status');
    }
  };

  const handleDeleteAppointment = async (appointmentId: string) => {
    if (window.confirm('Are you sure you want to delete this appointment?')) {
      try {
        await appointmentService.deleteAppointment(appointmentId);
        toast.success('Appointment deleted successfully');
        refetch();
      } catch (error) {
        toast.error('Failed to delete appointment');
      }
    }
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
          <h1 className="text-2xl font-bold text-gray-900">Appointments</h1>
          <p className="text-gray-600 mt-1">
            Manage patient appointments and scheduling
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <div className="flex items-center bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'calendar'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Calendar
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'list'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              List
            </button>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <FunnelIcon className="h-4 w-4 mr-2" />
            Filters
          </button>
          <Link
            to="/appointments/new"
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <PlusIcon className="h-4 w-4 mr-2" />
            New Appointment
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
              placeholder="Search appointments by patient, provider, or reason..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          {viewMode === 'calendar' && (
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setCurrentDate(subWeeks(currentDate, 1))}
                className="p-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                ←
              </button>
              <span className="text-sm font-medium text-gray-900 min-w-[120px] text-center">
                {format(currentDate, 'MMM d, yyyy')}
              </span>
              <button
                onClick={() => setCurrentDate(addWeeks(currentDate, 1))}
                className="p-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                →
              </button>
              <button
                onClick={() => setCurrentDate(new Date())}
                className="px-3 py-2 text-sm font-medium text-blue-600 hover:text-blue-500"
              >
                Today
              </button>
            </div>
          )}
        </div>

        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4 border-t border-gray-200"
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
                <option value="SCHEDULED">Scheduled</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="NO_SHOW">No Show</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type
              </label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="ALL">All Types</option>
                <option value="IN_PERSON">In Person</option>
                <option value="TELEMEDICINE">Telemedicine</option>
                <option value="PHONE">Phone</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Provider
              </label>
              <select
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="ALL">All Providers</option>
                <option value="provider-1">Dr. Emily Chen</option>
                <option value="provider-2">Dr. James Wilson</option>
                <option value="provider-3">Dr. Sarah Martinez</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('ALL');
                  setTypeFilter('ALL');
                  setProviderFilter('ALL');
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Clear Filters
              </button>
            </div>
          </motion.div>
        )}
      </div>

      {/* Calendar View */}
      {viewMode === 'calendar' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          {/* Calendar Header */}
          <div className="grid grid-cols-7 border-b border-gray-200">
            {weekDays.map((day) => (
              <div key={day.toISOString()} className="p-4 text-center">
                <div className="text-sm font-medium text-gray-900">
                  {format(day, 'EEE')}
                </div>
                <div className="text-lg font-semibold text-gray-900 mt-1">
                  {format(day, 'd')}
                </div>
              </div>
            ))}
          </div>

          {/* Calendar Body */}
          <div className="grid grid-cols-7 min-h-[400px]">
            {weekDays.map((day) => {
              const dayKey = format(day, 'yyyy-MM-dd');
              const dayAppointments = appointmentsByDate[dayKey] || [];
              
              return (
                <div key={dayKey} className="border-r border-gray-200 last:border-r-0 p-2">
                  <div className="space-y-1">
                    {dayAppointments.map((appointment, index) => (
                      <motion.div
                        key={appointment.id}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.2, delay: index * 0.05 }}
                        className={`p-2 rounded-md text-xs cursor-pointer hover:shadow-sm transition-shadow ${
                          appointment.status === 'SCHEDULED'
                            ? 'bg-blue-50 border border-blue-200'
                            : appointment.status === 'CONFIRMED'
                            ? 'bg-green-50 border border-green-200'
                            : appointment.status === 'COMPLETED'
                            ? 'bg-gray-50 border border-gray-200'
                            : 'bg-red-50 border border-red-200'
                        }`}
                        onClick={() => handleSelectAppointment(appointment.id)}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-gray-900">
                            {appointment.startTime}
                          </span>
                          <div className="flex items-center space-x-1">
                            {getTypeIcon(appointment.type)}
                          </div>
                        </div>
                        <div className="text-gray-700 font-medium truncate">
                          {appointment.patient.firstName} {appointment.patient.lastName}
                        </div>
                        <div className="text-gray-600 truncate">
                          {appointment.reason}
                        </div>
                        <div className="text-gray-500 truncate">
                          {appointment.provider.firstName} {appointment.provider.lastName}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900">
                Appointments ({filteredAppointments.length})
              </h3>
              {selectedAppointments.length > 0 && (
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">
                    {selectedAppointments.length} selected
                  </span>
                  <button
                    onClick={() => setSelectedAppointments([])}
                    className="text-sm text-blue-600 hover:text-blue-500"
                  >
                    Clear selection
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="divide-y divide-gray-200">
            {filteredAppointments.map((appointment, index) => (
              <motion.div
                key={appointment.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                className="p-6 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <input
                      type="checkbox"
                      checked={selectedAppointments.includes(appointment.id)}
                      onChange={() => handleSelectAppointment(appointment.id)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <h4 className="text-lg font-medium text-gray-900">
                          {appointment.patient.firstName} {appointment.patient.lastName}
                        </h4>
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(appointment.status)}`}>
                          {appointment.status.replace('_', ' ')}
                        </span>
                        <div className="flex items-center text-gray-500">
                          {getTypeIcon(appointment.type)}
                          <span className="ml-1 text-sm">
                            {appointment.type.replace('_', ' ')}
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600">
                        <div className="flex items-center">
                          <CalendarDaysIcon className="h-4 w-4 mr-2" />
                          <span>
                            {format(parseISO(appointment.appointmentDate), 'MMM d, yyyy')}
                          </span>
                        </div>
                        <div className="flex items-center">
                          <ClockIcon className="h-4 w-4 mr-2" />
                          <span>
                            {appointment.startTime} - {appointment.endTime}
                          </span>
                        </div>
                        <div className="flex items-center">
                          <UserIcon className="h-4 w-4 mr-2" />
                          <span>
                            {appointment.provider.firstName} {appointment.provider.lastName}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2">
                        <p className="text-sm text-gray-700">
                          <span className="font-medium">Reason:</span> {appointment.reason}
                        </p>
                        {appointment.notes && (
                          <p className="text-sm text-gray-600 mt-1">
                            <span className="font-medium">Notes:</span> {appointment.notes}
                          </p>
                        )}
                        {appointment.location && (
                          <p className="text-sm text-gray-600 mt-1">
                            <span className="font-medium">Location:</span> {appointment.location}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {appointment.status === 'SCHEDULED' && (
                      <button
                        onClick={() => handleUpdateStatus(appointment.id, 'CONFIRMED')}
                        className="inline-flex items-center px-3 py-1 border border-green-300 rounded-md text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                      >
                        <CheckCircleIcon className="h-3 w-3 mr-1" />
                        Confirm
                      </button>
                    )}
                    {(appointment.status === 'SCHEDULED' || appointment.status === 'CONFIRMED') && (
                      <button
                        onClick={() => handleUpdateStatus(appointment.id, 'CANCELLED')}
                        className="inline-flex items-center px-3 py-1 border border-red-300 rounded-md text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                      >
                        <XCircleIcon className="h-3 w-3 mr-1" />
                        Cancel
                      </button>
                    )}
                    <Link
                      to={`/appointments/${appointment.id}`}
                      className="inline-flex items-center px-3 py-1 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      <EyeIcon className="h-3 w-3 mr-1" />
                      View
                    </Link>
                    <Link
                      to={`/appointments/${appointment.id}/edit`}
                      className="inline-flex items-center px-3 py-1 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      <PencilIcon className="h-3 w-3 mr-1" />
                      Edit
                    </Link>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Empty State */}
          {filteredAppointments.length === 0 && (
            <div className="text-center py-12">
              <CalendarDaysIcon className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No appointments found</h3>
              <p className="mt-1 text-sm text-gray-500">
                {searchTerm || statusFilter !== 'ALL' || typeFilter !== 'ALL' || providerFilter !== 'ALL'
                  ? 'Try adjusting your search or filter criteria.'
                  : 'Get started by scheduling your first appointment.'}
              </p>
              {!searchTerm && statusFilter === 'ALL' && typeFilter === 'ALL' && providerFilter === 'ALL' && (
                <div className="mt-6">
                  <Link
                    to="/appointments/new"
                    className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    <PlusIcon className="h-4 w-4 mr-2" />
                    New Appointment
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Appointments;