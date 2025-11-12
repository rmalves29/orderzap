# /backend/Dockerfile
FROM node:20-bookworm

# ---- Dependências do Chromium/Puppeteer ----
RUN apt-get update && apt-get install -y \
  chromium ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
  libc6 libcrypt1 libcups2 libdbus-1-3 libdrm2 libexpat1 libfontconfig1 libgbm1 \
  libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libx11-6 libx11-xcb1 \
  libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
  libxshmfence1 libxss1 libxtst6 wget xdg-utils --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# ---- PNPM ----
RUN corepack enable && corepack prepare pnpm@9.12.2 --activate

# ---- Diretório de trabalho raiz do backend ----
WORKDIR /app/backend

# Copiamos apenas manifestos para cache de dependências
COPY backend/package.json backend/pnpm-lock.yaml ./

# Instala dependências (produção) travadas
RUN pnpm install --frozen-lockfile --prod

# Agora copiamos o resto do código
COPY backend/ .

# Variáveis úteis ao puppeteer/whatsapp-web.js
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

# Opcional: diretório persistente para sessões (ative Storage no Railway e monte em /data)
ENV AUTH_DIR=/data/.wwebjs_auth

EXPOSE 8080

# Sobe seu servidor
CMD ["node", "server-multitenant-clean.js"]
