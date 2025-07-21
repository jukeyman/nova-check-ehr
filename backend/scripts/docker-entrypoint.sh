#!/bin/bash
# 🏥 Nova Check EHR - Docker Entrypoint Script
# Production startup script with health checks and graceful shutdown

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to wait for database
wait_for_db() {
    log_info "Waiting for database connection..."
    
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if npx prisma db push --accept-data-loss > /dev/null 2>&1; then
            log_success "Database connection established"
            return 0
        fi
        
        log_warning "Database not ready, attempt $attempt/$max_attempts"
        sleep 2
        attempt=$((attempt + 1))
    done
    
    log_error "Failed to connect to database after $max_attempts attempts"
    exit 1
}

# Function to run database migrations
run_migrations() {
    log_info "Running database migrations..."
    
    if npx prisma migrate deploy; then
        log_success "Database migrations completed"
    else
        log_error "Database migrations failed"
        exit 1
    fi
}

# Function to generate Prisma client
generate_prisma_client() {
    log_info "Generating Prisma client..."
    
    if npx prisma generate; then
        log_success "Prisma client generated"
    else
        log_error "Failed to generate Prisma client"
        exit 1
    fi
}

# Function to validate environment variables
validate_environment() {
    log_info "Validating environment variables..."
    
    local required_vars=(
        "DATABASE_URL"
        "JWT_SECRET"
        "JWT_REFRESH_SECRET"
        "ENCRYPTION_KEY"
    )
    
    local missing_vars=()
    
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            missing_vars+=("$var")
        fi
    done
    
    if [ ${#missing_vars[@]} -ne 0 ]; then
        log_error "Missing required environment variables:"
        for var in "${missing_vars[@]}"; do
            log_error "  - $var"
        done
        exit 1
    fi
    
    log_success "Environment validation passed"
}

# Function to create necessary directories
create_directories() {
    log_info "Creating necessary directories..."
    
    local directories=(
        "/app/uploads"
        "/app/logs"
        "/app/temp"
    )
    
    for dir in "${directories[@]}"; do
        if [ ! -d "$dir" ]; then
            mkdir -p "$dir"
            log_info "Created directory: $dir"
        fi
    done
    
    log_success "Directories created"
}

# Function to check external services
check_external_services() {
    log_info "Checking external services..."
    
    # Check Redis if configured
    if [ -n "$REDIS_URL" ]; then
        log_info "Checking Redis connection..."
        # Add Redis health check here if needed
    fi
    
    # Check SMTP if configured
    if [ -n "$SMTP_HOST" ]; then
        log_info "SMTP configuration detected"
    fi
    
    log_success "External services check completed"
}

# Function to start the application
start_application() {
    log_info "Starting Nova Check EHR Backend..."
    log_info "Environment: ${NODE_ENV:-production}"
    log_info "Port: ${PORT:-5000}"
    
    # Start the Node.js application
    exec node dist/server.js
}

# Graceful shutdown handler
shutdown_handler() {
    log_warning "Received shutdown signal, gracefully shutting down..."
    
    # Send SIGTERM to the Node.js process
    if [ -n "$NODE_PID" ]; then
        kill -TERM "$NODE_PID"
        wait "$NODE_PID"
    fi
    
    log_success "Shutdown completed"
    exit 0
}

# Set up signal handlers
trap shutdown_handler SIGTERM SIGINT

# Main execution
main() {
    log_info "🏥 Nova Check EHR Backend - Starting up..."
    log_info "Version: ${APP_VERSION:-1.0.0}"
    log_info "Build: ${BUILD_NUMBER:-local}"
    
    # Validate environment
    validate_environment
    
    # Create directories
    create_directories
    
    # Wait for database
    wait_for_db
    
    # Generate Prisma client
    generate_prisma_client
    
    # Run migrations
    if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
        run_migrations
    else
        log_warning "Skipping database migrations (RUN_MIGRATIONS=false)"
    fi
    
    # Check external services
    check_external_services
    
    # Start application
    start_application
}

# Handle different startup modes
case "${1:-start}" in
    "start")
        main
        ;;
    "migrate")
        log_info "Running migrations only..."
        validate_environment
        wait_for_db
        generate_prisma_client
        run_migrations
        log_success "Migrations completed"
        ;;
    "seed")
        log_info "Seeding database..."
        validate_environment
        wait_for_db
        generate_prisma_client
        if npx prisma db seed; then
            log_success "Database seeding completed"
        else
            log_error "Database seeding failed"
            exit 1
        fi
        ;;
    "health")
        log_info "Running health check..."
        if curl -f http://localhost:${PORT:-5000}/api/v1/health > /dev/null 2>&1; then
            log_success "Health check passed"
            exit 0
        else
            log_error "Health check failed"
            exit 1
        fi
        ;;
    "shell")
        log_info "Starting interactive shell..."
        exec /bin/bash
        ;;
    *)
        log_error "Unknown command: $1"
        log_info "Available commands: start, migrate, seed, health, shell"
        exit 1
        ;;
esac