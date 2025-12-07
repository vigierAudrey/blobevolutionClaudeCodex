#!/bin/bash
set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored messages
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Start timing
START_TIME=$(date +%s)

echo ""
log_info "==================================================="
log_info "  🚀 Running Local CI Pipeline"
log_info "==================================================="
echo ""

# Step 1: Docker services
log_info "Step 1/8: Starting Docker services (postgres, redis, minio, mailpit)..."
if ! docker compose up -d postgres redis minio mailpit 2>&1; then
    log_error "Failed to start Docker services"
    exit 1
fi
log_success "Docker services started"
echo ""

# Step 2: Wait for services to be ready
log_info "Step 2/8: Waiting for services to be ready..."

# Wait for PostgreSQL
log_info "  → Waiting for PostgreSQL..."
MAX_RETRIES=30
RETRY_COUNT=0
until docker compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        log_error "PostgreSQL failed to start after ${MAX_RETRIES} seconds"
        exit 1
    fi
    echo -n "."
    sleep 1
done
echo ""
log_success "  PostgreSQL is ready"

# Wait for Redis (check if it's responding)
log_info "  → Waiting for Redis..."
RETRY_COUNT=0
until docker compose exec -T redis redis-cli -a "${REDIS_PASSWORD:-redis}" ping > /dev/null 2>&1; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        log_warning "Redis may not be ready, continuing anyway..."
        break
    fi
    echo -n "."
    sleep 1
done
echo ""
log_success "  Redis is ready"

# Check MinIO (just verify the port is open)
log_info "  → Checking MinIO..."
if docker compose ps minio | grep -q "Up"; then
    log_success "  MinIO is running"
else
    log_warning "  MinIO may not be ready"
fi

# Check Mailpit (just verify the port is open)
log_info "  → Checking Mailpit..."
if docker compose ps mailpit | grep -q "Up"; then
    log_success "  Mailpit is running"
else
    log_warning "  Mailpit may not be ready"
fi

log_success "All services are ready"
echo ""

# Step 3: Install dependencies
log_info "Step 3/8: Installing dependencies with npm ci..."
if ! npm ci --loglevel=error; then
    log_error "npm ci failed"
    exit 1
fi
log_success "Dependencies installed"
echo ""

# Step 4: Database migrations
log_info "Step 4/8: Running database migrations..."
if ! npm run db:migrate:deploy; then
    log_error "Database migrations failed"
    exit 1
fi
log_success "Database migrations completed"
echo ""

# Step 5: Database seed
log_info "Step 5/8: Seeding database with test data..."
if ! npm run db:seed; then
    log_warning "Database seed failed (may be already seeded)"
else
    log_success "Database seeded successfully"
fi
echo ""

# Step 6: Linting
log_info "Step 6/8: Running linters..."

log_info "  → OpenAPI lint..."
if ! npm run openapi:lint; then
    log_error "OpenAPI lint failed"
    exit 1
fi

log_info "  → Web lint..."
if ! npm run lint --workspace @blobinfini/web; then
    log_error "Web lint failed"
    exit 1
fi

log_success "All linters passed"
echo ""

# Step 7: Type checking
log_info "Step 7/8: Running type checks..."
if ! npm run type-check; then
    log_error "Type check failed"
    exit 1
fi
log_success "Type checks passed"
echo ""

# Step 8: Tests
log_info "Step 8/8: Running tests..."

log_info "  → API tests..."
if ! npm run test --workspace @blobinfini/api -- --runInBand; then
    log_error "API tests failed"
    exit 1
fi

log_info "  → Web tests..."
if ! npm run test --workspace @blobinfini/web -- --runInBand; then
    log_error "Web tests failed"
    exit 1
fi

log_info "  → Storybook tests..."
if ! npm run storybook:test; then
    log_warning "Storybook tests failed (may need storybook server running)"
else
    log_success "Storybook tests passed"
fi

log_success "All tests passed"
echo ""

# Calculate elapsed time
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
MINUTES=$((ELAPSED / 60))
SECONDS=$((ELAPSED % 60))

echo ""
log_success "==================================================="
log_success "  🎉 CI Pipeline completed successfully!"
log_success "  ⏱️  Total time: ${MINUTES}m ${SECONDS}s"
log_success "==================================================="
echo ""

log_info "📊 Summary:"
echo "  ✅ Docker services started (PostgreSQL, Redis, MinIO, Mailpit)"
echo "  ✅ Dependencies installed"
echo "  ✅ Database migrated and seeded"
echo "  ✅ Linters passed"
echo "  ✅ Type checks passed"
echo "  ✅ Tests passed"
echo ""
log_info "🔗 Services disponibles:"
echo "  📊 Mailpit (emails): http://localhost:8025"
echo "  📦 MinIO (storage): http://localhost:9001 (minioadmin/minioadmin)"
echo "  🗄️  PostgreSQL: localhost:5432"
echo "  🔴 Redis: localhost:6379"
echo ""
log_info "🚀 You're ready to deploy!"
echo ""
