# ---- base de execução (Debian para facilitar libs do Chromium) ----
FROM node:20-bullseye

# Diretório da aplicação
WORKDIR /app

# Copia manifestos primeiro (cache de dependências)
COPY package.json pnpm-lock.yaml* ./

# Habilita corepack e PNPM
RUN corepack enable && corepack prepare pnpm@9.12.2 --activate

# Instala dependências de produção
RUN pnpm install --frozen-lockfile --prod

# Copia o restante do código
COPY . .

# Dependências de SO para Chromium (Puppeteer)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxkbcommon0 \
  && rm -rf /var/lib/apt/lists/*

# Variáveis necessárias ao Puppeteer
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

# Porta (Railway detecta mas deixo explícito)
EXPOSE 8080

# Sobe o servidor
CMD ["node", "server-multitenant-clean.js"]
