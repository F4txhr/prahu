# syntax=docker/dockerfile:1
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TZ=UTC \
    LANG=C.UTF-8

# System deps (curl for XRAY tester, ca-certs for HTTPS)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements early for better caching
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Expose port
EXPOSE 5000

# Default environment (override in runtime)
ENV SECRET_KEY=change-me \
    ALLOWED_ORIGINS=http://localhost:5000,http://127.0.0.1:5000 \
    LOG_LEVEL=INFO \
    XRAY_PATH=/app/xray \
    DNS_MODE=system \
    DOH_PROVIDER=cloudflare

# Run with gunicorn (threading). Socket.IO will use long-polling in this mode.
CMD ["gunicorn", "--worker-class", "gthread", "--threads", "8", "-w", "1", "-b", "0.0.0.0:5000", "app:app"]