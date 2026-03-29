#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
#  StreamPlatform — Full Setup Script
#  Builds containers, runs migrations, seeds demo data.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }

echo ""
echo "================================================"
echo "   StreamPlatform — Setup"
echo "================================================"
echo ""

# ── 1. Environment ────────────────────────────────────────────
info "Checking environment..."
if [ ! -f .env ]; then
    cp .env.example .env
    ok "Created .env from .env.example"
else
    ok ".env already exists"
fi

# ── 2. Media directories ─────────────────────────────────────
info "Creating media directories..."
mkdir -p media/uploads media/transcoded media/thumbnails media/live
ok "Media directories ready"

# ── 3. Tear down existing state ───────────────────────────────
echo ""
info "Stopping any existing containers and removing volumes for a clean start..."
docker compose down -v --remove-orphans 2>/dev/null || true
ok "Previous state cleared"

# ── 4. Build images ───────────────────────────────────────────
echo ""
info "Building Docker images (this may take a while on first run)..."
if docker compose build; then
    ok "Docker images built"
else
    fail "Docker build failed. Check output above."
fi

# ── 5. Start services ────────────────────────────────────────
echo ""
info "Starting services..."
docker compose up -d
ok "Services starting"

# ── 6. Wait for health ───────────────────────────────────────
echo ""
info "Waiting for services to become healthy..."

wait_healthy() {
    local service=$1
    local max_wait=${2:-120}  # seconds
    local elapsed=0

    printf "  %-12s " "$service"
    while [ $elapsed -lt $max_wait ]; do
        # Check if container is running
        state=$(docker compose ps --format '{{.State}}' "$service" 2>/dev/null || echo "")
        if [ "$state" != "running" ] && [ $elapsed -gt 10 ]; then
            echo -e "${RED}not running${NC}"
            return 1
        fi

        # Check health status
        health=$(docker inspect --format='{{.State.Health.Status}}' "$(docker compose ps -q "$service" 2>/dev/null)" 2>/dev/null || echo "")
        if [ "$health" = "healthy" ]; then
            echo -e "${GREEN}healthy${NC}"
            return 0
        fi

        # Services without health checks — just check they're running
        if [ -z "$health" ] && [ "$state" = "running" ]; then
            echo -e "${GREEN}running${NC}"
            return 0
        fi

        sleep 2
        elapsed=$((elapsed + 2))
    done

    echo -e "${YELLOW}timeout after ${max_wait}s${NC}"
    return 1
}

wait_healthy postgres 60
wait_healthy redis 30
wait_healthy ai 120
wait_healthy backend 60
wait_healthy worker 60
wait_healthy frontend 60
wait_healthy nginx 30

# ── 7. Run migrations ────────────────────────────────────────
echo ""
info "Running database migrations..."
if docker compose exec -T -e PYTHONPATH=/app backend alembic upgrade head; then
    ok "Migrations applied"
else
    fail "Migration failed. Check logs: docker compose logs backend"
fi

# ── 8. Seed data ─────────────────────────────────────────────
echo ""
info "Seeding demo data (includes downloading sample videos)..."
echo ""
if docker compose exec -T -e PYTHONPATH=/app backend python -m scripts.seed_db; then
    ok "Seed completed"
else
    warn "Seed had issues. Check output above."
fi

# ── 9. Add /etc/hosts entries (optional) ─────────────────────
echo ""
info "Multi-tenant domains"
echo "  Add these to /etc/hosts for multi-tenant testing:"
echo ""
echo "    127.0.0.1  anime.localhost sports.localhost"
echo ""

# ── Done ──────────────────────────────────────────────────────
echo "================================================"
echo -e "   ${GREEN}Setup Complete!${NC}"
echo "================================================"
echo ""
echo "  Main site:    http://localhost:8080"
echo "  Admin panel:  http://localhost:8080/admin"
echo "  API docs:     http://localhost:8000/docs"
echo ""
echo "  Admin login:  admin@streamplatform.local / admin123"
echo "  Viewer:       john@example.com / viewer123 (Basic)"
echo "  Viewer:       jane@example.com / viewer123 (Free)"
echo ""
echo "  View logs:    docker compose logs -f"
echo "  Stop:         docker compose down"
echo ""
