# Ad Engine API — Docker Container
# Peter Kao Associates

# Use full Node image (not Alpine) for onnxruntime-node compatibility
FROM node:20-slim

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
COPY fraudDetectionService.js ./

# Expose port
EXPOSE 8080

# Health check (use node instead of wget/curl for slim image)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/api/buyer/categories', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Start server
CMD ["node", "server.js"]
