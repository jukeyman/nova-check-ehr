import React from 'react';
import { Outlet } from 'react-router-dom';
import { motion } from 'framer-motion';
import { HeartIcon, ShieldCheckIcon, UserGroupIcon } from '@heroicons/react/24/outline';

const PublicLayout: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50">
      <div className="flex min-h-screen">
        {/* Left Side - Branding & Features */}
        <div className="hidden lg:flex lg:w-1/2 lg:flex-col lg:justify-center lg:px-12">
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            className="max-w-md"
          >
            {/* Logo */}
            <div className="mb-8">
              <div className="flex items-center space-x-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600">
                  <HeartIcon className="h-7 w-7 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Nova Check</h1>
                  <p className="text-sm text-gray-600">Electronic Health Records</p>
                </div>
              </div>
            </div>

            {/* Tagline */}
            <h2 className="mb-6 text-4xl font-bold leading-tight text-gray-900">
              Modern Healthcare
              <span className="text-blue-600"> Management</span>
            </h2>
            <p className="mb-8 text-lg text-gray-600">
              Streamline your healthcare operations with our comprehensive EHR system. 
              Secure, compliant, and designed for modern healthcare providers.
            </p>

            {/* Features */}
            <div className="space-y-4">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.6 }}
                className="flex items-center space-x-3"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100">
                  <ShieldCheckIcon className="h-5 w-5 text-green-600" />
                </div>
                <span className="text-gray-700">HIPAA Compliant & Secure</span>
              </motion.div>
              
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.6 }}
                className="flex items-center space-x-3"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
                  <UserGroupIcon className="h-5 w-5 text-blue-600" />
                </div>
                <span className="text-gray-700">Multi-Role Access Control</span>
              </motion.div>
              
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6, duration: 0.6 }}
                className="flex items-center space-x-3"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100">
                  <svg className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <span className="text-gray-700">Real-time Analytics & Reports</span>
              </motion.div>
            </div>

            {/* Stats */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8, duration: 0.6 }}
              className="mt-12 grid grid-cols-3 gap-4"
            >
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">99.9%</div>
                <div className="text-sm text-gray-600">Uptime</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">500+</div>
                <div className="text-sm text-gray-600">Providers</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">50K+</div>
                <div className="text-sm text-gray-600">Patients</div>
              </div>
            </motion.div>
          </motion.div>
        </div>

        {/* Right Side - Auth Forms */}
        <div className="flex w-full flex-col justify-center px-6 py-12 lg:w-1/2 lg:px-8">
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            className="mx-auto w-full max-w-md"
          >
            <Outlet />
          </motion.div>
        </div>
      </div>

      {/* Mobile Logo */}
      <div className="absolute top-6 left-6 lg:hidden">
        <div className="flex items-center space-x-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
            <HeartIcon className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-bold text-gray-900">Nova Check</span>
        </div>
      </div>
    </div>
  );
};

export default PublicLayout;