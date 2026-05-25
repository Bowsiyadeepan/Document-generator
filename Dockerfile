FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json ./
RUN npm install --omit=dev

# Copy source
COPY . .

# Default to webhook server; override CMD for worker
EXPOSE 3000

CMD ["node", "src/index.js"]
