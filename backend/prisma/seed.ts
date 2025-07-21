import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Clean existing data (in development only)
  if (process.env.NODE_ENV === 'development') {
    console.log('🧹 Cleaning existing data...');
    await prisma.analyticsEvent.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.message.deleteMany();
    await prisma.document.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.claim.deleteMany();
    await prisma.insurance.deleteMany();
    await prisma.diagnosticReport.deleteMany();
    await prisma.immunization.deleteMany();
    await prisma.prescription.deleteMany();
    await prisma.order.deleteMany();
    await prisma.procedure.deleteMany();
    await prisma.condition.deleteMany();
    await prisma.allergy.deleteMany();
    await prisma.vitalSign.deleteMany();
    await prisma.observation.deleteMany();
    await prisma.encounter.deleteMany();
    await prisma.appointment.deleteMany();
    await prisma.patientContact.deleteMany();
    await prisma.patientAddress.deleteMany();
    await prisma.patient.deleteMany();
    await prisma.providerAvailability.deleteMany();
    await prisma.providerSchedule.deleteMany();
    await prisma.provider.deleteMany();
    await prisma.staff.deleteMany();
    await prisma.apiKey.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  }

  // Create system admin user
  console.log('👤 Creating system admin...');
  const adminPassword = await bcrypt.hash('Admin123!@#', 12);
  const adminUser = await prisma.user.create({
    data: {
      id: uuidv4(),
      email: 'admin@novacheck.com',
      password: adminPassword,
      firstName: 'System',
      lastName: 'Administrator',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: true,
      phone: '+1234567890',
      timezone: 'UTC',
      lastLoginAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Create sample providers
  console.log('👨‍⚕️ Creating sample providers...');
  const providerUsers = [];
  const providers = [];

  // Dr. Sarah Johnson - Cardiologist
  const drJohnsonUser = await prisma.user.create({
    data: {
      id: uuidv4(),
      email: 'sarah.johnson@novacheck.com',
      password: await bcrypt.hash('Provider123!', 12),
      firstName: 'Sarah',
      lastName: 'Johnson',
      role: 'PROVIDER',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: true,
      phone: '+1234567891',
      timezone: 'America/New_York',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  providerUsers.push(drJohnsonUser);

  const drJohnson = await prisma.provider.create({
    data: {
      id: uuidv4(),
      userId: drJohnsonUser.id,
      npi: '1234567890',
      licenseNumber: 'MD123456',
      licenseState: 'NY',
      licenseExpiry: new Date('2025-12-31'),
      specialty: 'Cardiology',
      subSpecialty: 'Interventional Cardiology',
      boardCertified: true,
      yearsExperience: 15,
      education: 'Harvard Medical School',
      languages: ['English', 'Spanish'],
      acceptingNewPatients: true,
      consultationFee: 250.00,
      bio: 'Dr. Sarah Johnson is a board-certified cardiologist with over 15 years of experience in interventional cardiology.',
      address: '123 Medical Center Dr, New York, NY 10001',
      emergencyContact: '+1234567892',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  providers.push(drJohnson);

  // Dr. Michael Chen - Pediatrician
  const drChenUser = await prisma.user.create({
    data: {
      id: uuidv4(),
      email: 'michael.chen@novacheck.com',
      password: await bcrypt.hash('Provider123!', 12),
      firstName: 'Michael',
      lastName: 'Chen',
      role: 'PROVIDER',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: true,
      phone: '+1234567893',
      timezone: 'America/Los_Angeles',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  providerUsers.push(drChenUser);

  const drChen = await prisma.provider.create({
    data: {
      id: uuidv4(),
      userId: drChenUser.id,
      npi: '1234567891',
      licenseNumber: 'MD123457',
      licenseState: 'CA',
      licenseExpiry: new Date('2026-06-30'),
      specialty: 'Pediatrics',
      subSpecialty: 'Pediatric Cardiology',
      boardCertified: true,
      yearsExperience: 12,
      education: 'Stanford University School of Medicine',
      languages: ['English', 'Mandarin'],
      acceptingNewPatients: true,
      consultationFee: 200.00,
      bio: 'Dr. Michael Chen specializes in pediatric cardiology with a focus on congenital heart defects.',
      address: '456 Children\'s Hospital Way, Los Angeles, CA 90001',
      emergencyContact: '+1234567894',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  providers.push(drChen);

  // Create provider schedules
  console.log('📅 Creating provider schedules...');
  for (const provider of providers) {
    // Monday to Friday schedule
    for (let dayOfWeek = 1; dayOfWeek <= 5; dayOfWeek++) {
      await prisma.providerSchedule.create({
        data: {
          id: uuidv4(),
          providerId: provider.id,
          dayOfWeek,
          startTime: '09:00',
          endTime: '17:00',
          isAvailable: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
  }

  // Create sample staff
  console.log('👩‍💼 Creating sample staff...');
  const nurseUser = await prisma.user.create({
    data: {
      id: uuidv4(),
      email: 'nurse.williams@novacheck.com',
      password: await bcrypt.hash('Staff123!', 12),
      firstName: 'Jennifer',
      lastName: 'Williams',
      role: 'NURSE',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: true,
      phone: '+1234567895',
      timezone: 'America/New_York',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  await prisma.staff.create({
    data: {
      id: uuidv4(),
      userId: nurseUser.id,
      employeeId: 'EMP001',
      department: 'Nursing',
      position: 'Registered Nurse',
      hireDate: new Date('2020-01-15'),
      salary: 75000.00,
      isActive: true,
      supervisor: adminUser.id,
      workSchedule: {
        monday: { start: '07:00', end: '19:00' },
        tuesday: { start: '07:00', end: '19:00' },
        wednesday: { start: '07:00', end: '19:00' },
        thursday: { start: '07:00', end: '19:00' },
        friday: { start: '07:00', end: '19:00' },
      },
      emergencyContact: '+1234567896',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Create sample patients
  console.log('🏥 Creating sample patients...');
  const patients = [];

  // Patient 1: John Doe
  const johnDoeUser = await prisma.user.create({
    data: {
      id: uuidv4(),
      email: 'john.doe@email.com',
      password: await bcrypt.hash('Patient123!', 12),
      firstName: 'John',
      lastName: 'Doe',
      role: 'PATIENT',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: true,
      phone: '+1234567897',
      timezone: 'America/New_York',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  const johnDoe = await prisma.patient.create({
    data: {
      id: uuidv4(),
      userId: johnDoeUser.id,
      mrn: 'MRN001',
      dateOfBirth: new Date('1985-03-15'),
      gender: 'MALE',
      maritalStatus: 'MARRIED',
      bloodType: 'O_POSITIVE',
      ssn: '123-45-6789',
      emergencyContactName: 'Jane Doe',
      emergencyContactPhone: '+1234567898',
      emergencyContactRelation: 'Spouse',
      preferredLanguage: 'English',
      ethnicity: 'Caucasian',
      race: 'White',
      occupation: 'Software Engineer',
      employer: 'Tech Corp',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  patients.push(johnDoe);

  // Add address for John Doe
  await prisma.patientAddress.create({
    data: {
      id: uuidv4(),
      patientId: johnDoe.id,
      type: 'HOME',
      street: '123 Main Street',
      city: 'New York',
      state: 'NY',
      zipCode: '10001',
      country: 'USA',
      isPrimary: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Patient 2: Emily Smith
  const emilySmithUser = await prisma.user.create({
    data: {
      id: uuidv4(),
      email: 'emily.smith@email.com',
      password: await bcrypt.hash('Patient123!', 12),
      firstName: 'Emily',
      lastName: 'Smith',
      role: 'PATIENT',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: true,
      phone: '+1234567899',
      timezone: 'America/Los_Angeles',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  const emilySmith = await prisma.patient.create({
    data: {
      id: uuidv4(),
      userId: emilySmithUser.id,
      mrn: 'MRN002',
      dateOfBirth: new Date('1992-07-22'),
      gender: 'FEMALE',
      maritalStatus: 'SINGLE',
      bloodType: 'A_POSITIVE',
      ssn: '987-65-4321',
      emergencyContactName: 'Robert Smith',
      emergencyContactPhone: '+1234567800',
      emergencyContactRelation: 'Father',
      preferredLanguage: 'English',
      ethnicity: 'Hispanic',
      race: 'Mixed',
      occupation: 'Teacher',
      employer: 'Public School District',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  patients.push(emilySmith);

  // Add address for Emily Smith
  await prisma.patientAddress.create({
    data: {
      id: uuidv4(),
      patientId: emilySmith.id,
      type: 'HOME',
      street: '456 Oak Avenue',
      city: 'Los Angeles',
      state: 'CA',
      zipCode: '90001',
      country: 'USA',
      isPrimary: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Create sample appointments
  console.log('📅 Creating sample appointments...');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);

  const appointment1 = await prisma.appointment.create({
    data: {
      id: uuidv4(),
      patientId: johnDoe.id,
      providerId: drJohnson.id,
      appointmentNumber: 'APT001',
      scheduledAt: tomorrow,
      duration: 30,
      type: 'CONSULTATION',
      status: 'SCHEDULED',
      reason: 'Annual cardiac checkup',
      notes: 'Patient reports occasional chest discomfort',
      createdById: adminUser.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  nextWeek.setHours(14, 30, 0, 0);

  const appointment2 = await prisma.appointment.create({
    data: {
      id: uuidv4(),
      patientId: emilySmith.id,
      providerId: drChen.id,
      appointmentNumber: 'APT002',
      scheduledAt: nextWeek,
      duration: 45,
      type: 'FOLLOW_UP',
      status: 'SCHEDULED',
      reason: 'Follow-up for pediatric consultation',
      notes: 'Discuss test results and treatment plan',
      createdById: adminUser.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Create sample allergies
  console.log('🚨 Creating sample allergies...');
  await prisma.allergy.create({
    data: {
      id: uuidv4(),
      patientId: johnDoe.id,
      allergen: 'Penicillin',
      type: 'MEDICATION',
      severity: 'HIGH',
      reaction: 'Severe rash and difficulty breathing',
      onsetDate: new Date('2010-05-15'),
      isActive: true,
      notes: 'Documented during hospital admission in 2010',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  await prisma.allergy.create({
    data: {
      id: uuidv4(),
      patientId: emilySmith.id,
      allergen: 'Peanuts',
      type: 'FOOD',
      severity: 'MEDIUM',
      reaction: 'Hives and swelling',
      onsetDate: new Date('2005-08-20'),
      isActive: true,
      notes: 'Carries EpiPen at all times',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Create sample vital signs
  console.log('💓 Creating sample vital signs...');
  await prisma.vitalSign.create({
    data: {
      id: uuidv4(),
      patientId: johnDoe.id,
      type: 'BLOOD_PRESSURE',
      value: '120/80',
      unit: 'mmHg',
      recordedAt: new Date(),
      notes: 'Normal blood pressure reading',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  await prisma.vitalSign.create({
    data: {
      id: uuidv4(),
      patientId: johnDoe.id,
      type: 'HEART_RATE',
      value: '72',
      unit: 'bpm',
      recordedAt: new Date(),
      notes: 'Regular rhythm',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Create sample insurance
  console.log('🏥 Creating sample insurance...');
  await prisma.insurance.create({
    data: {
      id: uuidv4(),
      patientId: johnDoe.id,
      provider: 'Blue Cross Blue Shield',
      policyNumber: 'BCBS123456789',
      groupNumber: 'GRP001',
      subscriberId: 'SUB123456',
      subscriberName: 'John Doe',
      relationship: 'SELF',
      effectiveDate: new Date('2024-01-01'),
      expirationDate: new Date('2024-12-31'),
      copay: 25.00,
      deductible: 1000.00,
      outOfPocketMax: 5000.00,
      isPrimary: true,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Create sample notifications
  console.log('🔔 Creating sample notifications...');
  await prisma.notification.create({
    data: {
      id: uuidv4(),
      userId: johnDoeUser.id,
      patientId: johnDoe.id,
      appointmentId: appointment1.id,
      type: 'APPOINTMENT_REMINDER',
      title: 'Appointment Reminder',
      message: 'You have an appointment tomorrow at 10:00 AM with Dr. Sarah Johnson',
      status: 'SENT',
      scheduledFor: new Date(tomorrow.getTime() - 24 * 60 * 60 * 1000), // 24 hours before
      sentAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Create sample system settings (if not exists)
  console.log('⚙️ Updating system settings...');
  const existingSettings = await prisma.systemSetting.findMany();
  if (existingSettings.length === 0) {
    const settings = [
      {
        id: uuidv4(),
        key: 'app.name',
        value: 'Nova Check EHR',
        description: 'Application name',
        category: 'general',
        dataType: 'string',
      },
      {
        id: uuidv4(),
        key: 'app.version',
        value: '1.0.0',
        description: 'Application version',
        category: 'general',
        dataType: 'string',
      },
      {
        id: uuidv4(),
        key: 'security.session_timeout',
        value: '3600',
        description: 'Session timeout in seconds',
        category: 'security',
        dataType: 'number',
      },
      {
        id: uuidv4(),
        key: 'notifications.email_enabled',
        value: 'true',
        description: 'Enable email notifications',
        category: 'notifications',
        dataType: 'boolean',
      },
    ];

    for (const setting of settings) {
      await prisma.systemSetting.create({ data: setting });
    }
  }

  console.log('✅ Database seeding completed successfully!');
  console.log('\n📊 Seeded data summary:');
  console.log('- 1 System Administrator');
  console.log('- 2 Healthcare Providers');
  console.log('- 1 Nurse Staff Member');
  console.log('- 2 Patients');
  console.log('- 2 Appointments');
  console.log('- 2 Allergies');
  console.log('- 2 Vital Signs');
  console.log('- 1 Insurance Record');
  console.log('- 1 Notification');
  console.log('- System Settings');
  console.log('\n🔐 Default login credentials:');
  console.log('Admin: admin@novacheck.com / Admin123!@#');
  console.log('Provider: sarah.johnson@novacheck.com / Provider123!');
  console.log('Provider: michael.chen@novacheck.com / Provider123!');
  console.log('Nurse: nurse.williams@novacheck.com / Staff123!');
  console.log('Patient: john.doe@email.com / Patient123!');
  console.log('Patient: emily.smith@email.com / Patient123!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });