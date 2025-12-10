FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY frontend/package.json ./
COPY frontend/scripts ./scripts

# Install dependencies
RUN npm install

# Copy source code
COPY frontend/ ./

# Build application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 6001

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
