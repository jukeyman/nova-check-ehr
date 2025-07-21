# 🏥 Nova Check EHR

**Modern Electronic Health Record System with AI-Powered Clinical Documentation**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.2-blue)](https://reactjs.org/)
[![FHIR R4](https://img.shields.io/badge/FHIR-R4-green)](https://hl7.org/fhir/R4/)
[![HIPAA Compliant](https://img.shields.io/badge/HIPAA-Compliant-red)](https://www.hhs.gov/hipaa/)

## 🌟 Overview

Nova Check EHR is a comprehensive, modern electronic health record system designed for healthcare providers of all sizes. Built with cutting-edge technologies and AI-powered features, it streamlines clinical workflows while ensuring HIPAA compliance and interoperability.

### ✨ Key Features

- 🤖 **AI-Powered Clinical Documentation** - Intelligent scribe and documentation assistance
- 📱 **Modern Responsive UI** - Built with React, Next.js, and Tailwind CSS
- 🔒 **HIPAA Compliant** - End-to-end encryption and comprehensive audit trails
- 🌐 **FHIR R4 Compatible** - Full interoperability with other healthcare systems
- 📊 **Advanced Analytics** - Real-time insights and reporting
- 💬 **Integrated Messaging** - Secure communication between providers and patients
- 📅 **Smart Scheduling** - Intelligent appointment management
- 💰 **Billing Integration** - Streamlined revenue cycle management
- 🔗 **EHR Integrations** - Connect with Epic, Cerner, Allscripts, and more
- 📱 **Telemedicine Ready** - Built-in video consultation capabilities

## 🏗️ Architecture

### Technology Stack

**Frontend:**
- React 18 with TypeScript
- Next.js 14 (App Router)
- Tailwind CSS + shadcn/ui
- Framer Motion for animations
- React Query for state management
- Socket.io for real-time features

**Backend:**
- Node.js with Express.js
- TypeScript
- PostgreSQL with Prisma ORM
- Redis for caching and sessions
- Socket.io for WebSocket connections
- Bull Queue for background jobs

**Infrastructure:**
- Docker & Docker Compose
- NGINX reverse proxy
- HAPI FHIR Server
- MinIO for object storage
- Elasticsearch for search
- Prometheus + Grafana for monitoring

**AI & ML:**
- OpenAI GPT-4 for clinical documentation
- Azure Cognitive Services
- Custom NLP models for medical text processing

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm 9+
- Docker and Docker Compose
- Git

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-org/nova-check-ehr.git
   cd nova-check-ehr
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Install dependencies:**
   ```bash
   npm run setup
   ```

4. **Start with Docker (Recommended):**
   ```bash
   npm run docker:up
   ```

5. **Or start development servers locally:**
   ```bash
   npm run dev
   ```

6. **Run database migrations:**
   ```bash
   npm run db:migrate
   npm run db:seed
   ```

### 🌐 Access Points

- **Frontend Application:** http://localhost:3000
- **Backend API:** http://localhost:3001
- **API Documentation:** http://localhost:3001/docs
- **FHIR Server:** http://localhost:8080/fhir
- **MinIO Console:** http://localhost:9001
- **Grafana Dashboard:** http://localhost:3002
- **Kibana Logs:** http://localhost:5601

## 📁 Project Structure

```
nova-check-ehr/
├── frontend/                 # React/Next.js frontend application
│   ├── src/
│   │   ├── components/       # Reusable UI components
│   │   ├── pages/           # Next.js pages
│   │   ├── hooks/           # Custom React hooks
│   │   ├── services/        # API services
│   │   ├── utils/           # Utility functions
│   │   └── types/           # TypeScript type definitions
│   └── public/              # Static assets
├── backend/                 # Node.js/Express backend API
│   ├── src/
│   │   ├── controllers/     # Route controllers
│   │   ├── services/        # Business logic
│   │   ├── models/          # Database models
│   │   ├── middleware/      # Express middleware
│   │   ├── routes/          # API routes
│   │   └── utils/           # Utility functions
│   └── scripts/             # Database and deployment scripts
├── database/                # Database schemas and migrations
│   ├── migrations/          # Database migration files
│   ├── seeds/              # Seed data
│   └── schemas/            # Database schemas
├── infrastructure/          # Infrastructure as code
│   ├── docker/             # Docker configurations
│   ├── kubernetes/         # K8s manifests
│   ├── terraform/          # Terraform configurations
│   └── nginx/              # NGINX configurations
├── tests/                  # Test suites
│   ├── e2e/               # End-to-end tests
│   ├── integration/       # Integration tests
│   └── performance/       # Performance tests
├── docs/                   # Documentation
│   ├── api/               # API documentation
│   ├── user/              # User guides
│   └── developer/         # Developer documentation
└── scripts/               # Utility scripts
```

## 🔧 Development

### Available Scripts

```bash
# Development
npm run dev                 # Start both frontend and backend in development mode
npm run dev:frontend        # Start only frontend
npm run dev:backend         # Start only backend

# Building
npm run build               # Build both frontend and backend
npm run build:frontend      # Build only frontend
npm run build:backend       # Build only backend

# Testing
npm run test                # Run all tests
npm run test:frontend       # Run frontend tests
npm run test:backend        # Run backend tests
npm run test:e2e           # Run end-to-end tests

# Linting & Formatting
npm run lint                # Lint all code
npm run format              # Format all code
npm run typecheck           # Type check all TypeScript

# Database
npm run db:migrate          # Run database migrations
npm run db:seed            # Seed database with sample data
npm run db:reset           # Reset database

# Docker
npm run docker:build        # Build Docker images
npm run docker:up          # Start all services
npm run docker:down        # Stop all services
npm run docker:logs        # View logs
```

### 🧪 Testing

The project includes comprehensive testing:

- **Unit Tests:** Jest + React Testing Library
- **Integration Tests:** Supertest for API testing
- **E2E Tests:** Playwright for browser automation
- **Performance Tests:** Artillery for load testing

```bash
# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:performance
```

## 🔐 Security & Compliance

### HIPAA Compliance

- ✅ End-to-end encryption (AES-256)
- ✅ Comprehensive audit logging
- ✅ Access controls and user permissions
- ✅ Data backup and recovery
- ✅ Secure communication protocols
- ✅ PHI de-identification tools

### Security Features

- JWT-based authentication
- Role-based access control (RBAC)
- API rate limiting
- Input validation and sanitization
- SQL injection prevention
- XSS protection
- CSRF protection
- Secure headers

## 🌐 API Documentation

The API is fully documented using OpenAPI 3.0 specification:

- **Interactive Docs:** http://localhost:3001/docs
- **OpenAPI Spec:** http://localhost:3001/api-docs.json
- **Postman Collection:** Available in `/docs/api/`

### Key API Endpoints

```
POST   /api/v1/auth/login              # User authentication
GET    /api/v1/patients               # List patients
POST   /api/v1/patients               # Create patient
GET    /api/v1/appointments           # List appointments
POST   /api/v1/clinical/notes         # Create clinical note
GET    /api/v1/fhir/Patient           # FHIR Patient resources
POST   /api/v1/ai/scribe              # AI documentation assistance
```

## 🔗 Integrations

### EHR Systems

- **Epic MyChart** - Patient portal integration
- **Cerner PowerChart** - Clinical data exchange
- **Allscripts** - Practice management integration
- **athenahealth** - Revenue cycle management

### Third-Party Services

- **Stripe/Square** - Payment processing
- **Twilio** - SMS and voice communications
- **SendGrid** - Email delivery
- **OpenAI** - AI-powered features
- **Google Cloud Healthcare API** - Additional ML capabilities

## 📊 Monitoring & Analytics

### Application Monitoring

- **Prometheus** - Metrics collection
- **Grafana** - Visualization dashboards
- **Elasticsearch + Kibana** - Log aggregation and analysis
- **Sentry** - Error tracking and performance monitoring

### Health Checks

```bash
# Check application health
curl http://localhost:3001/health

# Check database connectivity
curl http://localhost:3001/health/db

# Check external services
curl http://localhost:3001/health/services
```

## 🚀 Deployment

### Production Deployment

1. **Environment Setup:**
   ```bash
   cp .env.example .env.production
   # Configure production environment variables
   ```

2. **Build for Production:**
   ```bash
   npm run build
   ```

3. **Deploy with Docker:**
   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

### Cloud Deployment Options

- **AWS:** ECS, EKS, or Elastic Beanstalk
- **Google Cloud:** Cloud Run, GKE, or App Engine
- **Azure:** Container Instances, AKS, or App Service
- **DigitalOcean:** App Platform or Kubernetes

### Kubernetes Deployment

```bash
# Apply Kubernetes manifests
kubectl apply -f infrastructure/kubernetes/

# Check deployment status
kubectl get pods -n nova-check
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Run tests: `npm test`
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

### Code Style

- Use TypeScript for all new code
- Follow ESLint and Prettier configurations
- Write tests for new features
- Update documentation as needed

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

### Documentation

- [User Guide](docs/user/README.md)
- [Developer Documentation](docs/developer/README.md)
- [API Reference](docs/api/README.md)

### Getting Help

- 📧 Email: support@novacheck.com
- 💬 Discord: [Nova Check Community](https://discord.gg/novacheck)
- 🐛 Issues: [GitHub Issues](https://github.com/your-org/nova-check-ehr/issues)
- 📖 Wiki: [Project Wiki](https://github.com/your-org/nova-check-ehr/wiki)

### Professional Support

For enterprise support, implementation assistance, or custom development:

- 🌐 Website: https://novacheck.com
- 📧 Enterprise: enterprise@novacheck.com
- 📞 Phone: +1 (555) 123-4567

## 🙏 Acknowledgments

- [FHIR Foundation](https://fhir.org/) for healthcare interoperability standards
- [HL7 International](https://www.hl7.org/) for healthcare data exchange standards
- [HAPI FHIR](https://hapifhir.io/) for the excellent FHIR server implementation
- All the amazing open-source projects that make this possible

---

**Built with ❤️ by the Nova Check Team**

*Empowering healthcare providers with modern, intelligent EHR solutions.*