# Use official Node.js alpine image for a lightweight container
FROM node:20-alpine

# Set working directory inside the container
WORKDIR /app

# Copy package files first to leverage Docker build cache
COPY package.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy the rest of the application files
COPY server.js ./
COPY public/ ./public/

# Set production environment defaults
ENV NODE_ENV=production
ENV PORT=21551

# Expose port 21551 to the docker network
EXPOSE 21551

# Run the backend server
CMD ["node", "server.js"]
