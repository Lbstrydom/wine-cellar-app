# Wine Cellar App - Docker Image
FROM node:20-alpine

# Install build tools (dos2unix, native deps) and Chromium for Puppeteer
RUN apk add --no-cache python3 make g++ dos2unix \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Configure Puppeteer to use system Chromium instead of downloading
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
# Required for running Chromium as root in Docker container
ENV PUPPETEER_ARGS="--no-sandbox --disable-setuid-sandbox"
# Chromium flags for headless in Docker
ENV CHROMIUM_FLAGS="--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage"

# Set UTF-8 locale for proper character handling
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (ci for reproducible builds)
RUN npm ci --only=production

# Copy application code
COPY src/ ./src/
COPY public/ ./public/
COPY data/schema.postgres.sql ./data/
COPY data/migrations/ ./data/migrations/

# Create data directory for runtime files
RUN mkdir -p /app/data

# Copy startup script and fix line endings
COPY scripts/start.sh ./scripts/
RUN dos2unix ./scripts/start.sh && chmod +x ./scripts/start.sh

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/stats || exit 1

# Start the application
CMD ["./scripts/start.sh"]
