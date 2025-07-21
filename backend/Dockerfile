# ============================================================================
# NOVA CHECK EHR - BACKEND DOCKERFILE
# ============================================================================

# Use official Node.js runtime as base image
FROM node:18-alpine AS base

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    dumb-init \
    curl \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# ============================================================================
# DEPENDENCIES STAGE
# ============================================================================
FROM base AS deps

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# ============================================================================
# BUILD STAGE
# ============================================================================
FROM base AS builder

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including dev dependencies)
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build the application
RUN npm run build

# ============================================================================
# DEVELOPMENT STAGE
# ============================================================================
FROM base AS development

# Set environment
ENV NODE_ENV=development

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Create uploads directory
RUN mkdir -p uploads && chown -R nodejs:nodejs uploads

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/api/v1/health || exit 1

# Start the application
CMD ["dumb-init", "npm", "run", "dev"]

# ============================================================================
# PRODUCTION STAGE
# ============================================================================
FROM base AS production

# Set environment
ENV NODE_ENV=production
ENV PORT=3001

# Copy production dependencies
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy built application
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

# Create necessary directories
RUN mkdir -p uploads logs && chown -R nodejs:nodejs uploads logs

# Generate Prisma client for production
RUN npx prisma generate

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/api/v1/health || exit 1

# Start the application
CMD ["dumb-init", "node", "dist/server.js"]

# ============================================================================
# METADATA
# ============================================================================
LABEL maintainer="Nova Check Team <dev@novacheck.com>"
LABEL version="1.0.0"
LABEL description="Nova Check EHR Backend API Server"
LABEL org.opencontainers.image.source="https://github.com/your-org/nova-check-ehr"
LABEL org.opencontainers.image.documentation="https://github.com/your-org/nova-check-ehr/blob/main/README.md"
LABEL org.opencontainers.image.licenses="MIT"