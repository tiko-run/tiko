.PHONY: help up down backup logs dev-api dev-web test lint fmt check smoke release clean-clone render-validate audit licenses

# The ports of this checkout's stack: a worktree set up by scripts/worktree-setup.sh has its own.
# Digits only: Compose also takes a quoted value and a comment after it.
port = $(or $(shell sed -n "s/^$(1)=[\"']*\([0-9][0-9]*\).*/\1/p" .env 2>/dev/null | tail -n 1),$(2))
API_URL ?= http://localhost:$(call port,TIKO_API_PORT,8000)
WEB_URL ?= http://localhost:$(call port,TIKO_PORT,3000)

help:  ## list targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-14s %s\n", $$1, $$2}'

up: backup  ## back up data, build and start everything in docker (starts the daemon if needed)
	@scripts/ensure-docker.sh
	docker compose up --build -d
	@echo "API: $(API_URL)/docs"
	@echo "UI:  $(WEB_URL)"

backup:  ## copy data/app.db to data/backups/ (keeps the newest 20)
	@python3 scripts/backup.py

down:  ## stop and remove containers (data/ is kept)
	docker compose down

logs:  ## follow container logs
	docker compose logs -f --tail=100

dev-api:  ## run API locally with reload
	cd backend && uv run uvicorn --factory app.main:create_app --ws-per-message-deflate false --reload --port 8000

dev-web:  ## run UI locally with hot reload (proxies /api to :8000)
	cd frontend && npm run dev

test:  ## unit and API tests
	cd backend && uv run pytest -q
	cd frontend && npm test

lint:  ## linters and format check
	cd backend && uv run ruff check . && uv run ruff format --check .
	cd frontend && npm run lint && npx tsc -b

fmt:  ## auto-format
	cd backend && uv run ruff check --fix . && uv run ruff format .
	cd frontend && npm run fmt

check: lint test  ## gate before every merge to main

smoke:  ## main scenario against a running stack (make up first)
	docker compose exec -T api python - < scripts/smoke.py

# Permissive and weak-copyleft only, so the maintainer can still relicense the code under the CLA;
# GPL-family, SSPL, BUSL, custom "see LICENSE" fail.
NPM_LICENSES := MIT;MIT-0;ISC;BSD-2-Clause;BSD-3-Clause;Apache-2.0;0BSD;CC0-1.0;CC-BY-4.0;BlueOak-1.0.0;Unlicense;OFL-1.1;Python-2.0;MPL-2.0

licenses:  ## fail on dependency licenses that block AGPL-3.0 and dual licensing
	cd backend && uv run -q --with pip-licenses pip-licenses --from=mixed --partial-match \
		--fail-on="GPL;SSPL;Server Side Public;Business Source;BUSL;Commons Clause;Elastic License" >/dev/null
	cd frontend && npx --yes license-checker-rseidelsohn --production --excludePrivatePackages --summary \
		--onlyAllow="$(NPM_LICENSES)"
	@echo "licenses ok"

release:  ## cut the next CalVer release vYYYY.M.N from CHANGELOG.md Unreleased (DRY=1 to preview, LEVEL=hotfix|breaking|security)
	LEVEL=$(LEVEL) scripts/release.sh $(if $(DRY),--dry-run)

clean-clone:  ## clone origin/main to a temp dir and run it by README
	scripts/clean-clone-check.sh

render-validate:  ## validate render.yaml against Render (needs render CLI + RENDER_API_KEY)
	render blueprints validate render.yaml

audit:  ## PageSpeed scores + what crawlers see without JS (URL=...)
	python3 scripts/audit.py $(URL)
