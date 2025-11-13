# Imagem base com Node + Chromium
FROM ghcr.io/puppeteer/puppeteer:latest

# Define diretório de trabalho
WORKDIR /app

# Copia o package.json
COPY package.json .

# Instala dependências com npm
RUN npm install

# Copia todo o restante do código
COPY . .

# Porta exposta (opcional)
EXPOSE 3000

# Variável obrigatória para Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium-browser"

# Inicia o servidor
CMD ["node", "server-multitenant-clean.js"]
