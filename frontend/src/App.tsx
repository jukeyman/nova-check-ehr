import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import { useAuthStore } from './stores/authStore';

// Layout Components
import Layout from './components/layout/Layout';
import PublicLayout from './components/layout/PublicLayout';

// Auth Pages
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';

// Dashboard Pages
import PatientDashboard from './pages/patient/PatientDashboard';
import ProviderDashboard from './pages/provider/ProviderDashboard';
import AdminDashboard from './pages/admin/AdminDashboard';
import SuperAdminDashboard from './pages/admin/SuperAdminDashboard';

// Patient Pages
import PatientProfile from './pages/patient/PatientProfile';
import PatientAppointments from './pages/patient/PatientAppointments';
import PatientMedicalRecords from './pages/patient/PatientMedicalRecords';
import PatientBilling from './pages/patient/PatientBilling';
import PatientMessages from './pages/patient/PatientMessages';

// Provider Pages
import ProviderSchedule from './pages/provider/ProviderSchedule';
import ProviderPatients from './pages/provider/ProviderPatients';
import ProviderAppointments from './pages/provider/ProviderAppointments';
import ProviderMessages from './pages/provider/ProviderMessages';
import ClinicalNotes from './pages/provider/ClinicalNotes';
import PrescriptionManagement from './pages/provider/PrescriptionManagement';

// Admin Pages
import UserManagement from './pages/admin/UserManagement';
import FacilityManagement from './pages/admin/FacilityManagement';
import ReportsAnalytics from './pages/admin/ReportsAnalytics';
import SystemSettings from './pages/admin/SystemSettings';
import AuditLogs from './pages/admin/AuditLogs';

// Shared Pages
import AppointmentBooking from './pages/shared/AppointmentBooking';
import MedicalRecords from './pages/shared/MedicalRecords';
import FileManager from './pages/shared/FileManager';
import Notifications from './pages/shared/Notifications';

// Error Pages
import NotFoundPage from './pages/error/NotFoundPage';
import UnauthorizedPage from './pages/error/UnauthorizedPage';

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

// Protected Route Component
const ProtectedRoute: React.FC<{ children: React.ReactNode; allowedRoles?: string[] }> = ({ 
  children, 
  allowedRoles 
}) => {
  const { user, isAuthenticated } = useAuthStore();

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
};

// Role-based Dashboard Redirect
const DashboardRedirect: React.FC = () => {
  const { user } = useAuthStore();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  switch (user.role) {
    case 'PATIENT':
      return <Navigate to="/patient/dashboard" replace />;
    case 'PROVIDER':
    case 'NURSE':
    case 'TECHNICIAN':
      return <Navigate to="/provider/dashboard" replace />;
    case 'ADMIN':
      return <Navigate to="/admin/dashboard" replace />;
    case 'SUPER_ADMIN':
      return <Navigate to="/super-admin/dashboard" replace />;
    default:
      return <Navigate to="/login" replace />;
  }
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SocketProvider>
          <Router>
            <div className="min-h-screen bg-gray-50">
              <Routes>
                {/* Public Routes */}
                <Route path="/" element={<PublicLayout />}>
                  <Route index element={<Navigate to="/login" replace />} />
                  <Route path="login" element={<LoginPage />} />
                  <Route path="register" element={<RegisterPage />} />
                  <Route path="forgot-password" element={<ForgotPasswordPage />} />
                  <Route path="unauthorized" element={<UnauthorizedPage />} />
                </Route>

                {/* Protected Routes */}
                <Route path="/" element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }>
                  {/* Dashboard Redirect */}
                  <Route path="dashboard" element={<DashboardRedirect />} />

                  {/* Patient Routes */}
                  <Route path="patient" element={
                    <ProtectedRoute allowedRoles={['PATIENT']}>
                      <PatientDashboard />
                    </ProtectedRoute>
                  }>
                    <Route path="dashboard" element={<PatientDashboard />} />
                    <Route path="profile" element={<PatientProfile />} />
                    <Route path="appointments" element={<PatientAppointments />} />
                    <Route path="medical-records" element={<PatientMedicalRecords />} />
                    <Route path="billing" element={<PatientBilling />} />
                    <Route path="messages" element={<PatientMessages />} />
                  </Route>

                  {/* Provider Routes */}
                  <Route path="provider" element={
                    <ProtectedRoute allowedRoles={['PROVIDER', 'NURSE', 'TECHNICIAN']}>
                      <ProviderDashboard />
                    </ProtectedRoute>
                  }>
                    <Route path="dashboard" element={<ProviderDashboard />} />
                    <Route path="schedule" element={<ProviderSchedule />} />
                    <Route path="patients" element={<ProviderPatients />} />
                    <Route path="appointments" element={<ProviderAppointments />} />
                    <Route path="messages" element={<ProviderMessages />} />
                    <Route path="clinical-notes" element={<ClinicalNotes />} />
                    <Route path="prescriptions" element={<PrescriptionManagement />} />
                  </Route>

                  {/* Admin Routes */}
                  <Route path="admin" element={
                    <ProtectedRoute allowedRoles={['ADMIN', 'SUPER_ADMIN']}>
                      <AdminDashboard />
                    </ProtectedRoute>
                  }>
                    <Route path="dashboard" element={<AdminDashboard />} />
                    <Route path="users" element={<UserManagement />} />
                    <Route path="facilities" element={<FacilityManagement />} />
                    <Route path="reports" element={<ReportsAnalytics />} />
                    <Route path="settings" element={<SystemSettings />} />
                    <Route path="audit-logs" element={<AuditLogs />} />
                  </Route>

                  {/* Super Admin Routes */}
                  <Route path="super-admin" element={
                    <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                      <SuperAdminDashboard />
                    </ProtectedRoute>
                  }>
                    <Route path="dashboard" element={<SuperAdminDashboard />} />
                  </Route>

                  {/* Shared Routes */}
                  <Route path="appointments">
                    <Route path="book" element={<AppointmentBooking />} />
                    <Route path=":id" element={<AppointmentBooking />} />
                  </Route>
                  <Route path="medical-records" element={<MedicalRecords />} />
                  <Route path="files" element={<FileManager />} />
                  <Route path="notifications" element={<Notifications />} />
                </Route>

                {/* 404 Route */}
                <Route path="*" element={<NotFoundPage />} />
              </Routes>

              {/* Global Toast Notifications */}
              <Toaster
                position="top-right"
                toastOptions={{
                  duration: 4000,
                  style: {
                    background: '#363636',
                    color: '#fff',
                  },
                  success: {
                    duration: 3000,
                    iconTheme: {
                      primary: '#10B981',
                      secondary: '#fff',
                    },
                  },
                  error: {
                    duration: 5000,
                    iconTheme: {
                      primary: '#EF4444',
                      secondary: '#fff',
                    },
                  },
                }}
              />
            </div>
          </Router>
        </SocketProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;