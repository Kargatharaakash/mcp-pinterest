FROM node:20-slim

# Install Chromium and required OS dependencies for Puppeteer headless browser
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer executable path to installed Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PORT=3000

WORKDIR /usr/src/app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# Ensure non-transpiled files are in dist
RUN cp pinterest-scraper.js dist/

EXPOSE 3000

CMD ["node", "dist/pinterest-mcp-server.js"]
