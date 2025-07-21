# Nova Check EHR - Backend API

🏥 **Electronic Health Records Management System Backend**

A comprehensive, production-ready EHR backend API built with Node.js, TypeScript, Express, and Prisma.

## 🚀 Features

### Core Functionality
- **Patient Management** - Complete patient records, demographics, and medical history
- **Provider Management** - Healthcare provider profiles, schedules, and specializations
- **Appointment Scheduling** - Advanced booking system with availability checks
- **Clinical Data** - Medical records, vital signs, prescriptions, and lab results
- **File Management** - Secure file upload, storage, and retrieval
- **Notifications** - Real-time alerts, email, and SMS notifications
- **Analytics & Reporting** - Comprehensive dashboard and custom reports
- **Admin Panel** - User management, system settings, and audit logs

### Security & Compliance
- **HIPAA Compliant** - Healthcare data protection standards
- **JWT Authentication** - Secure token-based authentication
- **Role-Based Access Control** - Granular permissions system
- **Data Encryption** - End-to-end encryption for sensitive data
- **Audit Logging** - Complete activity tracking
- **Rate Limiting** - API protection against abuse

### Technical Features
- **RESTful API** - Clean, consistent API design
- **Real-time Updates** - WebSocket support for live data
- **Caching** - Redis-based caching for performance
- **File Storage** - Local and cloud storage options
- **Email/SMS** - Multi-provider communication services
- **Database** - PostgreSQL with Prisma ORM
- **Monitoring** - Comprehensive logging and error tracking

## 🛠️ Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Cache**: Redis
- **Authentication**: JWT
- **Validation**: Zod, Express Validator
- **File Upload**: Multer
- **Email**: Nodemailer, SendGrid
- **SMS**: Twilio
- **Logging**: Winston
- **Testing**: Jest
- **Documentation**: Swagger/OpenAPI

## 📋 Prerequisites

- Node.js 18.0.0 or higher
- npm 9.0.0 or higher
- PostgreSQL 13+ database
- Redis server (optional, for caching)
- SMTP server or email service (for notifications)

## 🚀 Quick Start

### 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/nova-check/ehr-backend.git
cd nova-check-ehr/backend

# Install dependencies
npm install
```

### 2. Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your configuration
nano .env
```

**Required Environment Variables:**
```env
DATABASE_URL="postgresql://username:password@localhost:5432/nova_check_ehr"
JWT_SECRET="your-super-secret-jwt-key"
JWT_REFRESH_SECRET="your-super-secret-refresh-key"
ENCRYPTION_KEY="your-32-character-encryption-key"
```

### 3. Database Setup

```bash
# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:migrate

# Seed the database (optional)
npm run db:seed
```

### 4. Start Development Server

```bash
# Start in development mode
npm run dev

# Or start in production mode
npm run build
npm start
```

The API will be available at `http://localhost:3001`

## 📁 Project Structure

```
backend/
├── src/
│   ├── config/          # Configuration files
│   │   ├── config.ts    # Main configuration
│   │   ├── database.ts  # Database connection
│   │   └── logger.ts    # Logging configuration
│   ├── middleware/      # Express middleware
│   │   ├── auth.ts      # Authentication middleware
│   │   ├── errorHandler.ts # Error handling
│   │   ├── logging.ts   # Request logging
│   │   └── security.ts  # Security middleware
│   ├── routes/          # API route definitions
│   │   ├── authRoutes.ts
│   │   ├── patientRoutes.ts
│   │   ├── providerRoutes.ts
│   │   ├── appointmentRoutes.ts
│   │   ├── clinicalRoutes.ts
│   │   ├── fileRoutes.ts
│   │   ├── notificationRoutes.ts
│   │   ├── analyticsRoutes.ts
│   │   ├── adminRoutes.ts
│   │   └── index.ts
│   ├── services/        # Business logic services
│   │   ├── auditService.ts
│   │   ├── cacheService.ts
│   │   ├── emailService.ts
│   │   ├── smsService.ts
│   │   ├── fileUploadService.ts
│   │   ├── notificationService.ts
│   │   ├── analyticsService.ts
│   │   └── calendarService.ts
│   ├── types/           # TypeScript type definitions
│   ├── utils/           # Utility functions
│   ├── app.ts           # Express app configuration
│   └── server.ts        # Server entry point
├── prisma/
│   ├── schema.prisma    # Database schema
│   ├── migrations/      # Database migrations
│   └── seed.ts          # Database seeding
├── uploads/             # File upload directory
├── logs/                # Application logs
├── docs/                # API documentation
├── tests/               # Test files
├── .env.example         # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

## 🔌 API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/logout` - User logout
- `POST /api/v1/auth/refresh` - Refresh access token
- `POST /api/v1/auth/forgot-password` - Request password reset
- `POST /api/v1/auth/reset-password` - Reset password

### Patients
- `GET /api/v1/patients` - Get all patients
- `GET /api/v1/patients/:id` - Get patient by ID
- `POST /api/v1/patients` - Create new patient
- `PUT /api/v1/patients/:id` - Update patient
- `GET /api/v1/patients/:id/medical-records` - Get patient medical records

### Providers
- `GET /api/v1/providers` - Get all providers
- `GET /api/v1/providers/:id` - Get provider by ID
- `POST /api/v1/providers` - Create new provider
- `PUT /api/v1/providers/:id` - Update provider
- `GET /api/v1/providers/:id/schedule` - Get provider schedule

### Appointments
- `GET /api/v1/appointments` - Get all appointments
- `GET /api/v1/appointments/:id` - Get appointment by ID
- `POST /api/v1/appointments` - Create new appointment
- `PUT /api/v1/appointments/:id` - Update appointment
- `DELETE /api/v1/appointments/:id` - Cancel appointment

### Clinical Data
- `GET /api/v1/clinical/medical-records` - Get medical records
- `POST /api/v1/clinical/medical-records` - Create medical record
- `POST /api/v1/clinical/vital-signs` - Record vital signs
- `POST /api/v1/clinical/prescriptions` - Create prescription
- `POST /api/v1/clinical/lab-results` - Record lab results

### Files
- `POST /api/v1/files/upload` - Upload file
- `GET /api/v1/files` - Get all files
- `GET /api/v1/files/:id/download` - Download file
- `DELETE /api/v1/files/:id` - Delete file

### Notifications
- `GET /api/v1/notifications` - Get user notifications
- `POST /api/v1/notifications` - Create notification
- `PUT /api/v1/notifications/:id/read` - Mark as read

### Analytics
- `GET /api/v1/analytics/dashboard` - Get dashboard data
- `GET /api/v1/analytics/appointments` - Appointment analytics
- `GET /api/v1/analytics/patients` - Patient analytics
- `GET /api/v1/analytics/revenue` - Revenue analytics

### Admin
- `GET /api/v1/admin/users` - Get all users
- `POST /api/v1/admin/users` - Create new user
- `PUT /api/v1/admin/users/:id` - Update user
- `GET /api/v1/admin/audit-logs` - Get audit logs
- `GET /api/v1/admin/system/settings` - Get system settings

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run integration tests
npm run test:integration
```

## 🔧 Development

### Code Quality

```bash
# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format

# Type checking
npm run typecheck
```

### Database Operations

```bash
# Generate Prisma client
npm run db:generate

# Create new migration
npm run db:migrate:dev

# Deploy migrations to production
npm run db:migrate:prod

# Reset database
npm run db:reset

# Open Prisma Studio
npm run db:studio

# Seed database
npm run db:seed
```

### Building

```bash
# Build for production
npm run build

# Clean build directory
npm run clean

# Build and start
npm run build && npm start
```

## 🐳 Docker Deployment

### Using Docker Compose (Recommended)

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Using Docker

```bash
# Build image
npm run docker:build

# Run container
npm run docker:run
```

## 🌐 Production Deployment

### Environment Variables

Ensure these are set in production:

```env
NODE_ENV=production
DATABASE_URL=your_production_database_url
JWT_SECRET=your_production_jwt_secret
JWT_REFRESH_SECRET=your_production_refresh_secret
ENCRYPTION_KEY=your_production_encryption_key
REDIS_URL=your_production_redis_url
```

### Security Checklist

- [ ] Use strong, unique secrets for JWT and encryption
- [ ] Enable HTTPS in production
- [ ] Configure proper CORS origins
- [ ] Set up rate limiting
- [ ] Enable audit logging
- [ ] Configure backup strategy
- [ ] Set up monitoring and alerting
- [ ] Review and update dependencies regularly

### Performance Optimization

- [ ] Enable Redis caching
- [ ] Configure database connection pooling
- [ ] Set up CDN for file uploads
- [ ] Enable gzip compression
- [ ] Configure proper logging levels
- [ ] Set up database indexing
- [ ] Monitor and optimize slow queries

## 📊 Monitoring

### Health Checks

- **Health Endpoint**: `GET /api/v1/health`
- **Database**: Connection and query performance
- **Redis**: Cache connectivity and performance
- **External Services**: Email, SMS, file storage

### Logging

- **Application Logs**: Winston with daily rotation
- **Access Logs**: Morgan for HTTP requests
- **Error Logs**: Structured error logging
- **Audit Logs**: HIPAA-compliant activity tracking

### Metrics

- **API Performance**: Response times, error rates
- **Database**: Query performance, connection pool
- **Cache**: Hit rates, memory usage
- **Business**: Patient registrations, appointments

## 🔒 Security

### Authentication & Authorization

- **JWT Tokens**: Secure token-based authentication
- **Role-Based Access**: Granular permission system
- **Session Management**: Secure session handling
- **Password Security**: Bcrypt hashing with salt

### Data Protection

- **Encryption**: AES-256-GCM for sensitive data
- **HTTPS**: TLS 1.3 for data in transit
- **Input Validation**: Comprehensive request validation
- **SQL Injection**: Prisma ORM protection
- **XSS Protection**: Content Security Policy

### Compliance

- **HIPAA**: Healthcare data protection
- **GDPR**: European data protection
- **Audit Trails**: Complete activity logging
- **Data Retention**: Configurable retention policies

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow TypeScript best practices
- Write comprehensive tests
- Update documentation
- Follow conventional commit messages
- Ensure code passes all linting and tests

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: [API Docs](http://localhost:3001/api/v1)
- **Issues**: [GitHub Issues](https://github.com/nova-check/ehr-backend/issues)
- **Email**: support@novacheck.com
- **Discord**: [Nova Check Community](https://discord.gg/novacheck)

## 🙏 Acknowledgments

- Built with ❤️ by the Nova Check team
- Inspired by modern healthcare technology needs
- Thanks to all contributors and the open-source community

---

**Nova Check EHR** - Revolutionizing healthcare data management with modern technology.