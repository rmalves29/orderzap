# ---------- Base com Node 20 slim (Debian) ----------
FROM node:20-bullseye-slim

# Evita prompts interativos e melhora cache
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

# ----- Dependências do Chromium e libs exigidas pelo Puppeteer -----
# (lista enxuta e testada em ambientes Railway/Heroku/Debian)
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
    libdrm2 \
    libexpat1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libnspr4 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    wget \
    xdg-utils \
 && rm -rf /var/lib/apt/lists/*

# Caminho do Chromium instalado via apt (bullseye)
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# Não baixar Chromium via npm (usamos o do sistema)
ENV PUPPETEER_SKIP_DOWNLOAD=1

# Habilita o pnpm (opcional) — pode manter npm se preferir
RUN corepack enable

# Diretório da app
WORKDIR /app

# Copia apenas arquivos de lock e package para cache de deps
COPY backend/package.json ./
# Se você usa pnpm, copie o lock; senão, remova a linha abaixo
COPY pnpm-lock.yaml ./

# Instala deps (sem travar em lockfile desatualizado em CI)
# Troque por "npm ci" se você preferir npm
RUN pnpm install --no-frozen-lockfile --prod

# Agora copia o resto do código do backend
COPY backend/ ./

# Porta exposta (opcional, Railway detecta automaticamente)
EXPOSE 8080

# Healthcheck simples (ajuste/remoção se preferir)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Comando de inicialização
CMD ["node", "server-multitenant-clean.js"]
