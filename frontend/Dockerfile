# ---- build (gera /dist) ----
FROM node:20-alpine AS build
WORKDIR /app

# Copia manifestos e instala com PNPM
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && corepack prepare pnpm@9.12.2 --activate \
 && pnpm install --frozen-lockfile

# Copia código e builda
COPY . .
RUN pnpm build

# ---- nginx para servir estático ----
FROM nginx:1.27-alpine
# Copia o build do Vite/Next (para Next estático) para o webroot
COPY --from=build /app/dist /usr/share/nginx/html

# Opcional: nginx conf custom (se tiver um frontend no /, o default já serve)
# COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
