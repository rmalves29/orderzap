# Imagem base
FROM node:20-bullseye

# Evita prompts interativos
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

# Diretório de trabalho
WORKDIR /app

# Instala Chromium e libs necessárias para puppeteer-core
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
    libgcc1 \
    libglib2.0-0 \
    libglib2.0-data \
    libgtk-3-0 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    wget \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# Deixe o puppeteer-core usar o chromium instalado pelo sistema
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Habilita Corepack (pnpm)
RUN corepack enable

# Só copia manifestos para cache de dependências
COPY package.json pnpm-lock.yaml ./

# Instala dependências (produção)
RUN corepack prepare pnpm@latest --activate \
 && pnpm install --frozen-lockfile --prefer-offline

# Copia o restante do backend
COPY . .

# Porta (Railway detecta automaticamente, mas deixo explícito)
EXPOSE 8080

# Comando de start do seu backend
# (ajuste se o seu entrypoint tiver outro nome/caminho)
CMD ["node", "server-multitenant-clean.js"]
