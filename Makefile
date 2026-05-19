.PHONY: setup run clean lint format check

check: lint format

setup:
	uv sync
	@echo "Virtual environment created and dependencies synced."

run:
	uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

lint:
	uv run ruff check .
	@find . -type f -name "*.json" ! -path "*/.venv/*" | xargs -I {} python -m json.tool {} > /dev/null
	@echo "JSON checks passed!"

format:
	uv run ruff format .

clean:
	rm -rf .venv
	find . -type d -name "__pycache__" -exec rm -rf {} +
