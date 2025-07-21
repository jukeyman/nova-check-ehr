import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  CalendarDaysIcon,
  ClockIcon,
  UserIcon,
  PhoneIcon,
  EnvelopeIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { format, addDays, isSameDay, parseISO, startOfDay } from 'date-fns';
import { appointmentService } from '../../services/appointmentService';
import { patientService } from '../../services/patientService';
import { useAuth } from '../../contexts/AuthContext';

interface TimeSlot {
  time: string;
  available: boolean;
  duration: number;
}

interface Provider {
  id: string;
  firstName: string;
  lastName: string;
  specialization: string;
  title: string;
  avatar?: string;
}

interface AppointmentFormData {
  patientId: string;
  providerId: string;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  type: 'ROUTINE' | 'URGENT' | 'EMERGENCY' | 'FOLLOW_UP' | 'CONSULTATION' | 'PROCEDURE';
  reason: string;
  notes?: string;
  duration: number;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
}

const AppointmentBooking: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isEditing = Boolean(id);

  // Form state
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [selectedPatient, setSelectedPatient] = useState<string>(user?.role === 'PATIENT' ? user.id : '');
  const [appointmentType, setAppointmentType] = useState<AppointmentFormData['type']>('ROUTINE');
  const [reason, setReason] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [priority, setPriority] = useState<AppointmentFormData['priority']>('MEDIUM');
  const [duration, setDuration] = useState<number>(30);
  const [step, setStep] = useState<number>(1);

  // Fetch existing appointment if editing
  const { data: existingAppointment, isLoading: appointmentLoading } = useQuery({
    queryKey: ['appointment', id],
    queryFn: () => appointmentService.getAppointment(id!),
    enabled: isEditing,
  });

  // Fetch providers
  const { data: providers, isLoading: providersLoading } = useQuery({
    queryKey: ['providers'],
    queryFn: () => appointmentService.getProviders(),
  });

  // Fetch patients (for non-patient users)
  const { data: patients, isLoading: patientsLoading } = useQuery({
    queryKey: ['patients'],
    queryFn: () => patientService.getPatients(),
    enabled: user?.role !== 'PATIENT',
  });

  // Fetch available time slots
  const { data: timeSlots, isLoading: slotsLoading } = useQuery({
    queryKey: ['timeSlots', selectedProvider, selectedDate],
    queryFn: () => appointmentService.getAvailableTimeSlots({
      providerId: selectedProvider,
      date: format(selectedDate, 'yyyy-MM-dd'),
      duration,
    }),
    enabled: Boolean(selectedProvider && selectedDate),
  });

  // Create/Update appointment mutation
  const appointmentMutation = useMutation({
    mutationFn: (data: AppointmentFormData) => {
      if (isEditing) {
        return appointmentService.updateAppointment(id!, data);
      }
      return appointmentService.createAppointment(data);
    },
    onSuccess: () => {
      toast.success(isEditing ? 'Appointment updated successfully!' : 'Appointment booked successfully!');
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      navigate('/appointments');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to save appointment');
    },
  });

  // Check for conflicts
  const { data: conflicts } = useQuery({
    queryKey: ['conflicts', selectedProvider, selectedDate, selectedTime],
    queryFn: () => appointmentService.checkConflicts({
      providerId: selectedProvider,
      date: format(selectedDate, 'yyyy-MM-dd'),
      startTime: selectedTime,
      duration,
    }),
    enabled: Boolean(selectedProvider && selectedDate && selectedTime),
  });

  // Load existing appointment data
  useEffect(() => {
    if (existingAppointment) {
      setSelectedDate(parseISO(existingAppointment.appointmentDate));
      setSelectedTime(existingAppointment.startTime);
      setSelectedProvider(existingAppointment.providerId);
      setSelectedPatient(existingAppointment.patientId);
      setAppointmentType(existingAppointment.type);
      setReason(existingAppointment.reason);
      setNotes(existingAppointment.notes || '');
      setPriority(existingAppointment.priority);
      setDuration(existingAppointment.duration);
    }
  }, [existingAppointment]);

  // Mock data for development
  const mockProviders: Provider[] = [
    {
      id: '1',
      firstName: 'Dr. Sarah',
      lastName: 'Johnson',
      specialization: 'Cardiology',
      title: 'MD',
    },
    {
      id: '2',
      firstName: 'Dr. Michael',
      lastName: 'Brown',
      specialization: 'Internal Medicine',
      title: 'MD',
    },
    {
      id: '3',
      firstName: 'Dr. Emily',
      lastName: 'Davis',
      specialization: 'Pediatrics',
      title: 'MD',
    },
  ];

  const mockTimeSlots: TimeSlot[] = [
    { time: '09:00', available: true, duration: 30 },
    { time: '09:30', available: true, duration: 30 },
    { time: '10:00', available: false, duration: 30 },
    { time: '10:30', available: true, duration: 30 },
    { time: '11:00', available: true, duration: 30 },
    { time: '11:30', available: false, duration: 30 },
    { time: '14:00', available: true, duration: 30 },
    { time: '14:30', available: true, duration: 30 },
    { time: '15:00', available: true, duration: 30 },
    { time: '15:30', available: true, duration: 30 },
    { time: '16:00', available: false, duration: 30 },
    { time: '16:30', available: true, duration: 30 },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedPatient || !selectedProvider || !selectedDate || !selectedTime || !reason.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (conflicts && conflicts.length > 0) {
      toast.error('There are scheduling conflicts. Please choose a different time.');
      return;
    }

    const endTime = calculateEndTime(selectedTime, duration);

    const appointmentData: AppointmentFormData = {
      patientId: selectedPatient,
      providerId: selectedProvider,
      appointmentDate: format(selectedDate, 'yyyy-MM-dd'),
      startTime: selectedTime,
      endTime,
      type: appointmentType,
      reason: reason.trim(),
      notes: notes.trim() || undefined,
      duration,
      priority,
    };

    appointmentMutation.mutate(appointmentData);
  };

  const calculateEndTime = (startTime: string, durationMinutes: number): string => {
    const [hours, minutes] = startTime.split(':').map(Number);
    const startDate = new Date();
    startDate.setHours(hours, minutes, 0, 0);
    
    const endDate = new Date(startDate.getTime() + durationMinutes * 60000);
    return format(endDate, 'HH:mm');
  };

  const generateDateOptions = () => {
    const dates = [];
    for (let i = 0; i < 30; i++) {
      dates.push(addDays(new Date(), i));
    }
    return dates;
  };

  const nextStep = () => {
    if (step === 1 && (!selectedPatient || (user?.role !== 'PATIENT' && !selectedProvider))) {
      toast.error('Please select a patient and provider');
      return;
    }
    if (step === 2 && (!selectedDate || !selectedTime)) {
      toast.error('Please select a date and time');
      return;
    }
    setStep(step + 1);
  };

  const prevStep = () => {
    setStep(step - 1);
  };

  if (appointmentLoading || providersLoading || patientsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-lg shadow-lg overflow-hidden"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">
                {isEditing ? 'Edit Appointment' : 'Book New Appointment'}
              </h1>
              <p className="text-blue-100 mt-1">
                {isEditing ? 'Update appointment details' : 'Schedule your appointment with our healthcare providers'}
              </p>
            </div>
            <button
              onClick={() => navigate('/appointments')}
              className="text-white hover:text-blue-200 transition-colors"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            {[1, 2, 3].map((stepNumber) => (
              <div key={stepNumber} className="flex items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                    step >= stepNumber
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {step > stepNumber ? (
                    <CheckCircleIcon className="h-5 w-5" />
                  ) : (
                    stepNumber
                  )}
                </div>
                {stepNumber < 3 && (
                  <div
                    className={`w-16 h-1 mx-2 ${
                      step > stepNumber ? 'bg-blue-600' : 'bg-gray-200'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2 text-sm">
            <span className={step >= 1 ? 'text-blue-600 font-medium' : 'text-gray-500'}>
              Select Provider
            </span>
            <span className={step >= 2 ? 'text-blue-600 font-medium' : 'text-gray-500'}>
              Choose Date & Time
            </span>
            <span className={step >= 3 ? 'text-blue-600 font-medium' : 'text-gray-500'}>
              Appointment Details
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {/* Step 1: Select Patient and Provider */}
          {step === 1 && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Select Patient and Provider
              </h2>

              {/* Patient Selection (for non-patient users) */}
              {user?.role !== 'PATIENT' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Patient *
                  </label>
                  <select
                    value={selectedPatient}
                    onChange={(e) => setSelectedPatient(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    <option value="">Select a patient</option>
                    {patients?.map((patient: any) => (
                      <option key={patient.id} value={patient.id}>
                        {patient.firstName} {patient.lastName} - {patient.email}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Provider Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Healthcare Provider *
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(providers || mockProviders).map((provider) => (
                    <motion.div
                      key={provider.id}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                        selectedProvider === provider.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                      onClick={() => setSelectedProvider(provider.id)}
                    >
                      <div className="flex items-center space-x-3">
                        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                          <UserIcon className="h-6 w-6 text-blue-600" />
                        </div>
                        <div>
                          <h3 className="font-medium text-gray-900">
                            {provider.firstName} {provider.lastName}
                          </h3>
                          <p className="text-sm text-gray-600">
                            {provider.specialization}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 2: Select Date and Time */}
          {step === 2 && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Choose Date and Time
              </h2>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Date Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Appointment Date *
                  </label>
                  <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                    {generateDateOptions().map((date) => (
                      <motion.button
                        key={date.toISOString()}
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className={`p-3 text-left border rounded-lg transition-all ${
                          isSameDay(selectedDate, date)
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                        onClick={() => setSelectedDate(date)}
                      >
                        <div className="font-medium">
                          {format(date, 'MMM dd')}
                        </div>
                        <div className="text-sm text-gray-600">
                          {format(date, 'EEEE')}
                        </div>
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* Time Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Available Times *
                  </label>
                  {slotsLoading ? (
                    <div className="flex items-center justify-center h-32">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                      {(timeSlots || mockTimeSlots).map((slot) => (
                        <motion.button
                          key={slot.time}
                          type="button"
                          disabled={!slot.available}
                          whileHover={slot.available ? { scale: 1.02 } : {}}
                          whileTap={slot.available ? { scale: 0.98 } : {}}
                          className={`p-3 text-center border rounded-lg transition-all ${
                            selectedTime === slot.time
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : slot.available
                              ? 'border-gray-200 hover:border-gray-300'
                              : 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed'
                          }`}
                          onClick={() => slot.available && setSelectedTime(slot.time)}
                        >
                          <div className="flex items-center justify-center space-x-1">
                            <ClockIcon className="h-4 w-4" />
                            <span>{slot.time}</span>
                          </div>
                        </motion.button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Duration Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Duration (minutes)
                </label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={45}>45 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={90}>1.5 hours</option>
                  <option value={120}>2 hours</option>
                </select>
              </div>

              {/* Conflicts Warning */}
              {conflicts && conflicts.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-center space-x-2">
                    <ExclamationTriangleIcon className="h-5 w-5 text-red-600" />
                    <h3 className="font-medium text-red-800">Scheduling Conflicts</h3>
                  </div>
                  <ul className="mt-2 text-sm text-red-700">
                    {conflicts.map((conflict: any, index: number) => (
                      <li key={index}>• {conflict.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </motion.div>
          )}

          {/* Step 3: Appointment Details */}
          {step === 3 && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Appointment Details
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Appointment Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Appointment Type *
                  </label>
                  <select
                    value={appointmentType}
                    onChange={(e) => setAppointmentType(e.target.value as AppointmentFormData['type'])}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    <option value="ROUTINE">Routine Check-up</option>
                    <option value="CONSULTATION">Consultation</option>
                    <option value="FOLLOW_UP">Follow-up</option>
                    <option value="URGENT">Urgent Care</option>
                    <option value="EMERGENCY">Emergency</option>
                    <option value="PROCEDURE">Procedure</option>
                  </select>
                </div>

                {/* Priority */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Priority
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as AppointmentFormData['priority'])}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
              </div>

              {/* Reason */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reason for Visit *
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Please describe the reason for your appointment..."
                  required
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Additional Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Any additional information or special requests..."
                />
              </div>

              {/* Summary */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-medium text-gray-900 mb-3">Appointment Summary</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Provider:</span>
                    <span className="font-medium">
                      {(providers || mockProviders).find(p => p.id === selectedProvider)?.firstName}{' '}
                      {(providers || mockProviders).find(p => p.id === selectedProvider)?.lastName}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Date:</span>
                    <span className="font-medium">{format(selectedDate, 'MMMM dd, yyyy')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Time:</span>
                    <span className="font-medium">
                      {selectedTime} - {calculateEndTime(selectedTime, duration)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Duration:</span>
                    <span className="font-medium">{duration} minutes</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Type:</span>
                    <span className="font-medium">{appointmentType.replace('_', ' ')}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Navigation Buttons */}
          <div className="flex justify-between mt-8 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={prevStep}
              disabled={step === 1}
              className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                step === 1
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Previous
            </button>

            {step < 3 ? (
              <button
                type="button"
                onClick={nextStep}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                Next
              </button>
            ) : (
              <button
                type="submit"
                disabled={appointmentMutation.isPending}
                className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {appointmentMutation.isPending ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <CheckCircleIcon className="h-5 w-5" />
                    <span>{isEditing ? 'Update Appointment' : 'Book Appointment'}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </form>
      </motion.div>
    </div>
  );
};

export default AppointmentBooking;