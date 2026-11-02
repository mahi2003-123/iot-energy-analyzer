# Use official Node.js 22 LTS Alpine image (lightweight & secure)
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Install curl for container health checks
RUN apk add --no-cache curl

# Copy dependency manifests
COPY package.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy application files
COPY server/ ./server/
COPY database/ ./database/
COPY index.html ./
COPY style.css ./
COPY script.js ./

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose web server port
EXPOSE 3000

# Health check to ensure the service is alive
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Start the Node.js application
CMD ["node", "server/server.js"]
