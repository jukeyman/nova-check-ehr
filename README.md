# Nova Check EHR - AI-Powered Healthcare Management System

🏥 **A comprehensive Electronic Health Record (EHR) system with AI-powered features, built for modern healthcare providers.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://python.org/)
[![React](https://img.shields.io/badge/React-18+-61DAFB.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-3178C6.svg)](https://typescriptlang.org/)

## 🌟 Features

### 🤖 AI-Powered Capabilities
- **AI Medical Scribe**: Voice-to-text transcription with structured medical note generation
- **Clinical Decision Support**: AI-powered differential diagnosis assistance
- **Smart Documentation**: Automated medical documentation with OpenAI GPT-4 integration
- **Intelligent Chat Assistant**: Medical knowledge base with context-aware responses

### 👥 Multi-Portal Architecture
- **Provider Portal**: Comprehensive clinical workflow management
- **Patient Portal**: Secure patient access to health records and communication
- **Admin Portal**: System administration and analytics dashboard

### 🔗 Healthcare Integrations
- **Athena Health API**: Complete EHR integration with patient data sync
- **Epic Integration**: FHIR-compliant data exchange
- **Cerner Integration**: Seamless healthcare data interoperability
- **Allscripts Support**: Multi-vendor EHR compatibility

### 🛡️ Security & Compliance
- **HIPAA Compliant**: End-to-end encryption and audit logging
- **Role-Based Access Control**: Granular permissions system
- **Data Encryption**: AES-256 encryption for sensitive data
- **Audit Trail**: Comprehensive activity logging

### 📊 Advanced Features
- **Real-time Analytics**: Healthcare metrics and reporting
- **Telemedicine Support**: Video consultations and remote care
- **Billing Integration**: Stripe and Square payment processing
- **Mobile Responsive**: Cross-platform compatibility

## 🏗️ Architecture

### Frontend (React + TypeScript)
```
frontend/
├── src/
│   ├── components/          # Reusable UI components
│   ├── pages/              # Application pages
│   ├── hooks/              # Custom React hooks
│   ├── services/           # API service layer
│   ├── store/              # State management (Zustand)
│   ├── types/              # TypeScript type definitions
│   └── utils/              # Utility functions
├── public/                 # Static assets
└── package.json           # Dependencies and scripts
```

### Backend Services
```
backend/
├── simple-chat-server.js   # Node.js chat API server
chat-server/
├── chat_server.py         # Python Flask chat server
ehr-backend/
├── ehr_server.py          # Main EHR backend server
```

### Key Technologies
- **Frontend**: React 18, TypeScript, Tailwind CSS, Vite
- **Backend**: Node.js, Python Flask, Express.js
- **Database**: PostgreSQL, Redis (caching)
- **AI/ML**: OpenAI GPT-4, Whisper API
- **Authentication**: JWT, OAuth 2.0
- **Deployment**: Docker, Kubernetes ready

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm/yarn
- Python 3.8+ and pip
- PostgreSQL 12+
- Redis (optional, for caching)
- OpenAI API key

### 1. Clone the Repository
```bash
git clone https://github.com/jukeyman/nova-check-ehr.git
cd nova-check-ehr
```

### 2. Environment Setup
```bash
# Copy environment template
cp .env.example .env

# Edit .env with your configuration
nano .env
```

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
Frontend will be available at `http://localhost:8081`

### 4. Backend Services

#### Node.js Chat Server
```bash
cd backend
npm install
node simple-chat-server.js
```
Chat API available at `http://localhost:3002`

#### Python Chat Server
```bash
cd chat-server
pip install -r requirements.txt
python chat_server.py
```
Python chat API available at `http://localhost:5000`

#### Main EHR Backend
```bash
cd ehr-backend
pip install -r requirements.txt
python ehr_server.py
```
EHR API available at `http://localhost:5001`

## 🔧 Configuration

### Required Environment Variables
```bash
# Application
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:8081

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/nova_check_ehr
REDIS_URL=redis://localhost:6379/0

# Security
JWT_SECRET=your-super-secret-jwt-key
ENCRYPTION_KEY=your-32-character-encryption-key

# AI Services
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4

# Athena Health Integration
ATHENA_CLIENT_ID=your-athena-client-id
ATHENA_CLIENT_SECRET=your-athena-client-secret
ATHENA_PRACTICE_ID=your-practice-id
```

### Optional Integrations
```bash
# Epic Integration
EPIC_CLIENT_ID=your-epic-client-id
EPIC_CLIENT_SECRET=your-epic-client-secret

# Payment Processing
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
SQUARE_ACCESS_TOKEN=your-square-access-token

# Communication
TWILIO_ACCOUNT_SID=your-twilio-account-sid
SENDGRID_API_KEY=your-sendgrid-api-key
```

## 📱 Usage

### Provider Workflow
1. **Login** to the provider portal
2. **Search/Select** patient from the database
3. **Create Encounter** for patient visit
4. **Use AI Scribe** for voice-to-text documentation
5. **Get AI Assistance** for clinical decision support
6. **Complete** encounter with diagnosis and treatment plan

### Patient Portal
1. **Secure Login** with patient credentials
2. **View** medical history and test results
3. **Schedule** appointments
4. **Communicate** with healthcare providers
5. **Access** educational materials

### AI Features
- **Chat with Nova**: Ask medical questions and get evidence-based responses
- **Voice Documentation**: Speak naturally and get structured medical notes
- **Differential Diagnosis**: Input symptoms and get diagnostic suggestions
- **Drug Interactions**: Check medication compatibility

## 🔌 API Documentation

### Authentication
```bash
# Login
POST /api/auth/login
{
  "username": "provider@example.com",
  "password": "password"
}
```

### Patient Management
```bash
# Get patients
GET /api/patients?page=1&per_page=20&search=john

# Get specific patient
GET /api/patients/123

# Create encounter
POST /api/encounters
{
  "patient_id": 123,
  "encounter_type": "office_visit",
  "chief_complaint": "Chest pain"
}
```

### AI Services
```bash
# Chat with AI
POST /api/chat
{
  "message": "What are the differential diagnoses for chest pain?",
  "context": "45-year-old male with hypertension"
}

# Medical Scribe
POST /api/scribe
{
  "transcription": "Patient presents with chest pain...",
  "encounter_type": "office_visit"
}
```

## 🧪 Testing

### Frontend Tests
```bash
cd frontend
npm run test
npm run test:coverage
```

### Backend Tests
```bash
# Node.js tests
cd backend
npm test

# Python tests
cd chat-server
python -m pytest

cd ehr-backend
python -m pytest
```

## 🚢 Deployment

### Docker Deployment
```bash
# Build and run with Docker Compose
docker-compose up -d
```

### Production Deployment
```bash
# Build frontend
cd frontend
npm run build

# Deploy to your preferred platform
# (AWS, GCP, Azure, DigitalOcean, etc.)
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow TypeScript/ESLint rules for frontend
- Use Black formatter for Python code
- Write tests for new features
- Update documentation
- Ensure HIPAA compliance

## 📋 Roadmap

### Phase 1 (Current)
- ✅ Core EHR functionality
- ✅ AI chat integration
- ✅ Provider portal
- ✅ Athena Health integration

### Phase 2 (Q2 2024)
- 🔄 Patient portal enhancement
- 🔄 Telemedicine features
- 🔄 Mobile app development
- 🔄 Advanced analytics

### Phase 3 (Q3 2024)
- 📋 FHIR R4 compliance
- 📋 Multi-tenant architecture
- 📋 Advanced AI features
- 📋 Blockchain integration

## 🛡️ Security

### Data Protection
- **Encryption**: All sensitive data encrypted at rest and in transit
- **Access Control**: Role-based permissions with audit logging
- **Compliance**: HIPAA, GDPR, and SOC 2 compliant
- **Monitoring**: Real-time security monitoring and alerting

### Vulnerability Reporting
Please report security vulnerabilities to: security@novacheck.com

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **OpenAI** for GPT-4 and Whisper API
- **Athena Health** for EHR integration
- **React Team** for the amazing frontend framework
- **Flask Team** for the Python web framework
- **Healthcare Community** for feedback and requirements

## 📞 Support

- **Documentation**: [docs.novacheck.com](https://docs.novacheck.com)
- **Issues**: [GitHub Issues](https://github.com/jukeyman/nova-check-ehr/issues)
- **Email**: support@novacheck.com
- **Discord**: [Nova Check Community](https://discord.gg/novacheck)

---

**Built with ❤️ for healthcare providers worldwide**

*Nova Check EHR - Transforming healthcare through AI-powered technology*

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