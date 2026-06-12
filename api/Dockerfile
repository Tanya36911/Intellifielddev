FROM python:3.12-slim

# uv for fast, reproducible installs
RUN pip install --no-cache-dir uv

WORKDIR /app

# install deps first (better layer caching)
COPY pyproject.toml ./
RUN uv pip install --system --no-cache \
    "fastapi>=0.115" "uvicorn[standard]>=0.30" \
    "sqlalchemy>=2.0" "psycopg[binary]>=3.2" "pydantic>=2.7"

COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
