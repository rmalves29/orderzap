# /frontend/Dockerfile

# ---------- Build ---------- #
FROM node:20-bookworm AS build
WORKDIR /app/frontend

# PNPM
RUN corepack enable && corepack prepare pnpm@9.12.2 --activate

# Instala dependências com lockfile travado
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copia o restante do frontend e gera build
COPY frontend/ .
RUN pnpm build

# ---------- Runtime (Nginx) ---------- #
FROM nginx:1.25-alpine
# Copia o build para o Nginx
COPY --from=build /app/frontend/dist/ /usr/share/nginx/html
# Opcional: cache/brotli/gzip podem ser configurados via nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
