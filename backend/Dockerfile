# Dockerfile do BACKEND (api.orderzaps.com)

# Imagem base com Node 20 (Debian)
FROM node:20-bullseye

# Instala Chromium e dependências que o whatsapp-web.js precisa
RUN apt-get update && apt-get install -y \
  chromium \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libnss3 \
  libglib2.0-0 \
  libxrandr2 \
  libgbm1 \
  xdg-utils \
  wget \
  && rm -rf /var/lib/apt/lists/*

# Diretório de trabalho
WORKDIR /app

# Copia manifestos de dependência
COPY package.json pnpm-lock.yaml ./

# Habilita corepack e prepara pnpm
# IMPORTANTE: sem --frozen-lockfile para não dar erro de lock desatualizado
RUN corepack enable \
  && corepack prepare pnpm@latest --activate \
  && pnpm install --no-frozen-lockfile

# Copia o resto do código para dentro da imagem
COPY . .

# Variáveis de ambiente usadas pelo server-multitenant-clean.js
ENV CHROME_PATH=/usr/bin/chromium
ENV AUTH_DIR=/data/.wwebjs_auth
ENV NODE_ENV=production
ENV PORT=8080

# Porta exposta
EXPOSE 8080

# Comando de start
CMD ["node", "server-multitenant-clean.js"]
