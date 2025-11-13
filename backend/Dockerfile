# Imagem base com Node + Debian (precisamos do apt para instalar o Chromium)
FROM node:18-bullseye

# Instala o Chromium e dependências para o whatsapp-web.js (puppeteer-core)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    wget \
 && rm -rf /var/lib/apt/lists/*

# Variáveis usadas pelo puppeteer-core
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

# Copia apenas o package.json do backend e instala dependências
COPY backend/package.json ./package.json

RUN npm install --omit=dev

# Copia o código-fonte do backend
COPY backend/. .

EXPOSE 8080

CMD ["npm", "start"]
