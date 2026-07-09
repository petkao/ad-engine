# Ad Engine API — Docker Container
# Peter Kao Associates

FROM node:20-alpine

# Set working directory
WORKDIR /app

# Set cache directory for Transformers.js models
ENV TRANSFORMERS_CACHE=/tmp/model_cache

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY server.js ./
COPY emailService.js ./
COPY geoService.js ./
COPY transcriptionService.js ./
COPY rerankerService.js ./

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

# Start server
CMD ["node", "server.js"]
