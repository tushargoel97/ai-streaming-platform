.PHONY: up down build logs restart shell-be shell-fe shell-ai db-migrate db-seed clean setup demo

# ─── Development ───────────────────────────────────────────
up:
	docker compose up --build

up-d:
	docker compose up --build -d

down:
	docker compose down

build:
	docker compose build

restart:
	docker compose restart

logs:
	docker compose logs -f

logs-be:
	docker compose logs -f backend

logs-fe:
	docker compose logs -f frontend

logs-ai:
	docker compose logs -f ai

# ─── Shell access ──────────────────────────────────────────
shell-be:
	docker compose exec backend bash

shell-fe:
	docker compose exec frontend sh

shell-ai:
	docker compose exec ai bash

shell-db:
	docker compose exec postgres psql -U stream -d streamdb

# ─── Database ──────────────────────────────────────────────
db-migrate:
	docker compose exec -e PYTHONPATH=/app backend alembic upgrade head

db-revision:
	docker compose exec -e PYTHONPATH=/app backend alembic revision --autogenerate -m "$(msg)"

db-seed:
	docker compose exec -e PYTHONPATH=/app backend python -m scripts.seed_db

# ─── Cleanup ───────────────────────────────────────────────
clean:
	docker compose down -v --remove-orphans
	rm -rf media/uploads/* media/transcoded/* media/thumbnails/* media/live/*

# ─── Setup & Demo ─────────────────────────────────────────
setup:
	@bash scripts/setup.sh

demo: setup
	@echo "Demo is running! Open http://localhost:8080"
