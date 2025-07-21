# ============================================================================
# NOVA CHECK EHR - BACKEND MAKEFILE
# ============================================================================

# Variables
DOCKER_IMAGE_NAME = nova-check-ehr-backend
DOCKER_TAG = latest
CONTAINER_NAME = nova-check-backend
NETWORK_NAME = nova-check-network
PORT = 3001

# Colors for output
RED = \033[0;31m
GREEN = \033[0;32m
YELLOW = \033[1;33m
BLUE = \033[0;34m
NC = \033[0m # No Color

# Default target
.DEFAULT_GOAL := help

# ============================================================================
# HELP
# ============================================================================
.PHONY: help
help: ## Show this help message
	@echo "$(BLUE)Nova Check EHR Backend - Available Commands$(NC)"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"; printf "Usage: make $(YELLOW)<target>$(NC)\n\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  $(GREEN)%-20s$(NC) %s\n", $$1, $$2 } /^##@/ { printf "\n$(BLUE)%s$(NC)\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

##@ Development

.PHONY: install
install: ## Install dependencies
	@echo "$(YELLOW)Installing dependencies...$(NC)"
	npm install
	@echo "$(GREEN)Dependencies installed successfully!$(NC)"

.PHONY: dev
dev: ## Start development server
	@echo "$(YELLOW)Starting development server...$(NC)"
	npm run dev

.PHONY: build
build: ## Build the application
	@echo "$(YELLOW)Building application...$(NC)"
	npm run build
	@echo "$(GREEN)Build completed successfully!$(NC)"

.PHONY: start
start: ## Start production server
	@echo "$(YELLOW)Starting production server...$(NC)"
	npm start

.PHONY: clean
clean: ## Clean build artifacts
	@echo "$(YELLOW)Cleaning build artifacts...$(NC)"
	rm -rf dist
	rm -rf node_modules/.cache
	npm run clean
	@echo "$(GREEN)Clean completed!$(NC)"

##@ Database

.PHONY: db-generate
db-generate: ## Generate Prisma client
	@echo "$(YELLOW)Generating Prisma client...$(NC)"
	npm run db:generate
	@echo "$(GREEN)Prisma client generated!$(NC)"

.PHONY: db-migrate
db-migrate: ## Run database migrations
	@echo "$(YELLOW)Running database migrations...$(NC)"
	npm run db:migrate
	@echo "$(GREEN)Migrations completed!$(NC)"

.PHONY: db-migrate-dev
db-migrate-dev: ## Create and apply new migration
	@echo "$(YELLOW)Creating new migration...$(NC)"
	npm run db:migrate:dev
	@echo "$(GREEN)Migration created and applied!$(NC)"

.PHONY: db-reset
db-reset: ## Reset database
	@echo "$(RED)Resetting database...$(NC)"
	npm run db:reset
	@echo "$(GREEN)Database reset completed!$(NC)"

.PHONY: db-seed
db-seed: ## Seed database with sample data
	@echo "$(YELLOW)Seeding database...$(NC)"
	npm run db:seed
	@echo "$(GREEN)Database seeded successfully!$(NC)"

.PHONY: db-studio
db-studio: ## Open Prisma Studio
	@echo "$(YELLOW)Opening Prisma Studio...$(NC)"
	npm run db:studio

##@ Testing

.PHONY: test
test: ## Run all tests
	@echo "$(YELLOW)Running tests...$(NC)"
	npm test

.PHONY: test-watch
test-watch: ## Run tests in watch mode
	@echo "$(YELLOW)Running tests in watch mode...$(NC)"
	npm run test:watch

.PHONY: test-coverage
test-coverage: ## Run tests with coverage
	@echo "$(YELLOW)Running tests with coverage...$(NC)"
	npm run test:coverage

.PHONY: test-integration
test-integration: ## Run integration tests
	@echo "$(YELLOW)Running integration tests...$(NC)"
	npm run test:integration

##@ Code Quality

.PHONY: lint
lint: ## Lint code
	@echo "$(YELLOW)Linting code...$(NC)"
	npm run lint

.PHONY: lint-fix
lint-fix: ## Fix linting issues
	@echo "$(YELLOW)Fixing linting issues...$(NC)"
	npm run lint:fix
	@echo "$(GREEN)Linting issues fixed!$(NC)"

.PHONY: format
format: ## Format code
	@echo "$(YELLOW)Formatting code...$(NC)"
	npm run format
	@echo "$(GREEN)Code formatted!$(NC)"

.PHONY: typecheck
typecheck: ## Run TypeScript type checking
	@echo "$(YELLOW)Running type checking...$(NC)"
	npm run typecheck
	@echo "$(GREEN)Type checking completed!$(NC)"

.PHONY: audit
audit: ## Run security audit
	@echo "$(YELLOW)Running security audit...$(NC)"
	npm audit
	npm run audit:fix
	@echo "$(GREEN)Security audit completed!$(NC)"

##@ Docker

.PHONY: docker-build
docker-build: ## Build Docker image
	@echo "$(YELLOW)Building Docker image...$(NC)"
	docker build -t $(DOCKER_IMAGE_NAME):$(DOCKER_TAG) .
	@echo "$(GREEN)Docker image built successfully!$(NC)"

.PHONY: docker-build-dev
docker-build-dev: ## Build Docker image for development
	@echo "$(YELLOW)Building Docker image for development...$(NC)"
	docker build --target development -t $(DOCKER_IMAGE_NAME):dev .
	@echo "$(GREEN)Development Docker image built successfully!$(NC)"

.PHONY: docker-run
docker-run: ## Run Docker container
	@echo "$(YELLOW)Running Docker container...$(NC)"
	docker run -d \
		--name $(CONTAINER_NAME) \
		--network $(NETWORK_NAME) \
		-p $(PORT):$(PORT) \
		--env-file .env \
		$(DOCKER_IMAGE_NAME):$(DOCKER_TAG)
	@echo "$(GREEN)Docker container started!$(NC)"

.PHONY: docker-stop
docker-stop: ## Stop Docker container
	@echo "$(YELLOW)Stopping Docker container...$(NC)"
	docker stop $(CONTAINER_NAME) || true
	docker rm $(CONTAINER_NAME) || true
	@echo "$(GREEN)Docker container stopped!$(NC)"

.PHONY: docker-logs
docker-logs: ## View Docker container logs
	@echo "$(YELLOW)Viewing Docker container logs...$(NC)"
	docker logs -f $(CONTAINER_NAME)

.PHONY: docker-shell
docker-shell: ## Access Docker container shell
	@echo "$(YELLOW)Accessing Docker container shell...$(NC)"
	docker exec -it $(CONTAINER_NAME) /bin/sh

##@ Docker Compose

.PHONY: up
up: ## Start all services with Docker Compose
	@echo "$(YELLOW)Starting all services...$(NC)"
	docker-compose up -d
	@echo "$(GREEN)All services started!$(NC)"

.PHONY: up-build
up-build: ## Start all services and rebuild images
	@echo "$(YELLOW)Starting all services and rebuilding...$(NC)"
	docker-compose up -d --build
	@echo "$(GREEN)All services started with fresh builds!$(NC)"

.PHONY: down
down: ## Stop all services
	@echo "$(YELLOW)Stopping all services...$(NC)"
	docker-compose down
	@echo "$(GREEN)All services stopped!$(NC)"

.PHONY: down-volumes
down-volumes: ## Stop all services and remove volumes
	@echo "$(RED)Stopping all services and removing volumes...$(NC)"
	docker-compose down -v
	@echo "$(GREEN)All services stopped and volumes removed!$(NC)"

.PHONY: logs
logs: ## View logs from all services
	@echo "$(YELLOW)Viewing logs from all services...$(NC)"
	docker-compose logs -f

.PHONY: logs-backend
logs-backend: ## View backend service logs
	@echo "$(YELLOW)Viewing backend service logs...$(NC)"
	docker-compose logs -f backend

.PHONY: logs-postgres
logs-postgres: ## View PostgreSQL service logs
	@echo "$(YELLOW)Viewing PostgreSQL service logs...$(NC)"
	docker-compose logs -f postgres

.PHONY: logs-redis
logs-redis: ## View Redis service logs
	@echo "$(YELLOW)Viewing Redis service logs...$(NC)"
	docker-compose logs -f redis

.PHONY: restart
restart: ## Restart all services
	@echo "$(YELLOW)Restarting all services...$(NC)"
	docker-compose restart
	@echo "$(GREEN)All services restarted!$(NC)"

.PHONY: restart-backend
restart-backend: ## Restart backend service
	@echo "$(YELLOW)Restarting backend service...$(NC)"
	docker-compose restart backend
	@echo "$(GREEN)Backend service restarted!$(NC)"

##@ Admin Tools

.PHONY: admin-up
admin-up: ## Start admin tools (pgAdmin, Redis Commander)
	@echo "$(YELLOW)Starting admin tools...$(NC)"
	docker-compose --profile admin up -d
	@echo "$(GREEN)Admin tools started!$(NC)"

.PHONY: monitoring-up
monitoring-up: ## Start monitoring tools (Prometheus, Grafana)
	@echo "$(YELLOW)Starting monitoring tools...$(NC)"
	docker-compose --profile monitoring up -d
	@echo "$(GREEN)Monitoring tools started!$(NC)"

##@ Health Checks

.PHONY: health
health: ## Check application health
	@echo "$(YELLOW)Checking application health...$(NC)"
	curl -f http://localhost:$(PORT)/api/v1/health || echo "$(RED)Health check failed!$(NC)"

.PHONY: status
status: ## Show service status
	@echo "$(YELLOW)Checking service status...$(NC)"
	docker-compose ps

##@ Utilities

.PHONY: setup
setup: ## Initial project setup
	@echo "$(YELLOW)Setting up project...$(NC)"
	@if [ ! -f .env ]; then \
		echo "$(YELLOW)Creating .env file from template...$(NC)"; \
		cp .env.example .env; \
		echo "$(GREEN).env file created! Please update it with your configuration.$(NC)"; \
	else \
		echo "$(GREEN).env file already exists.$(NC)"; \
	fi
	make install
	make db-generate
	@echo "$(GREEN)Project setup completed!$(NC)"

.PHONY: reset
reset: ## Reset everything (dangerous!)
	@echo "$(RED)This will reset everything! Are you sure? [y/N]$(NC)" && read ans && [ $${ans:-N} = y ]
	make down-volumes
	make clean
	rm -rf node_modules
	make setup
	@echo "$(GREEN)Everything has been reset!$(NC)"

.PHONY: backup-db
backup-db: ## Backup database
	@echo "$(YELLOW)Creating database backup...$(NC)"
	mkdir -p backups
	docker-compose exec postgres pg_dump -U postgres nova_check_ehr > backups/backup_$(shell date +%Y%m%d_%H%M%S).sql
	@echo "$(GREEN)Database backup created!$(NC)"

.PHONY: restore-db
restore-db: ## Restore database from backup (requires BACKUP_FILE variable)
	@echo "$(YELLOW)Restoring database from backup...$(NC)"
	@if [ -z "$(BACKUP_FILE)" ]; then \
		echo "$(RED)Please specify BACKUP_FILE variable$(NC)"; \
		echo "Usage: make restore-db BACKUP_FILE=backups/backup_20231201_120000.sql"; \
		exit 1; \
	fi
	docker-compose exec -T postgres psql -U postgres -d nova_check_ehr < $(BACKUP_FILE)
	@echo "$(GREEN)Database restored from backup!$(NC)"

.PHONY: update-deps
update-deps: ## Update dependencies
	@echo "$(YELLOW)Updating dependencies...$(NC)"
	npm update
	npm audit fix
	@echo "$(GREEN)Dependencies updated!$(NC)"

.PHONY: check-env
check-env: ## Check environment variables
	@echo "$(YELLOW)Checking environment variables...$(NC)"
	@if [ ! -f .env ]; then \
		echo "$(RED).env file not found!$(NC)"; \
		echo "Run 'make setup' to create it."; \
		exit 1; \
	fi
	@echo "$(GREEN).env file exists.$(NC)"
	@echo "$(YELLOW)Required variables:$(NC)"
	@grep -E '^[A-Z_]+=' .env.example | cut -d'=' -f1 | while read var; do \
		if grep -q "^$$var=" .env; then \
			echo "$(GREEN)✓ $$var$(NC)"; \
		else \
			echo "$(RED)✗ $$var$(NC)"; \
		fi; \
	done

##@ Information

.PHONY: info
info: ## Show project information
	@echo "$(BLUE)Nova Check EHR Backend$(NC)"
	@echo "Version: $(shell node -p "require('./package.json').version")"
	@echo "Node.js: $(shell node --version)"
	@echo "NPM: $(shell npm --version)"
	@echo "Docker: $(shell docker --version 2>/dev/null || echo 'Not installed')"
	@echo "Docker Compose: $(shell docker-compose --version 2>/dev/null || echo 'Not installed')"
	@echo ""
	@echo "$(YELLOW)Useful URLs:$(NC)"
	@echo "API: http://localhost:$(PORT)/api/v1"
	@echo "Health: http://localhost:$(PORT)/api/v1/health"
	@echo "pgAdmin: http://localhost:5050 (when admin profile is running)"
	@echo "Redis Commander: http://localhost:8081 (when admin profile is running)"
	@echo "Grafana: http://localhost:3000 (when monitoring profile is running)"
	@echo "Prometheus: http://localhost:9090 (when monitoring profile is running)"

.PHONY: ports
ports: ## Show used ports
	@echo "$(YELLOW)Used ports:$(NC)"
	@echo "3001 - Backend API"
	@echo "5432 - PostgreSQL"
	@echo "6379 - Redis"
	@echo "5050 - pgAdmin (admin profile)"
	@echo "8081 - Redis Commander (admin profile)"
	@echo "9090 - Prometheus (monitoring profile)"
	@echo "3000 - Grafana (monitoring profile)"

# Ensure .env file exists for Docker commands
.env:
	@echo "$(YELLOW)Creating .env file from template...$(NC)"
	cp .env.example .env
	@echo "$(GREEN).env file created! Please update it with your configuration.$(NC)"

# Make Docker commands depend on .env file
docker-run docker-build up up-build: .env