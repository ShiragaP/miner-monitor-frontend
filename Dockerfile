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
ENV PORT=3000

# Expose port 3000 to the docker network
EXPOSE 3000

# Run the backend server
CMD ["node", "server.js"]
