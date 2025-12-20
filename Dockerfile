# Wine Cellar App - Docker Image
FROM node:20-alpine

# Install dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (ci for reproducible builds)
RUN npm ci --only=production

# Copy application code
COPY src/ ./src/
COPY public/ ./public/
COPY data/schema.sql ./data/

# Create data directory for database
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/stats || exit 1

# Start the application
CMD ["node", "src/server.js"]
