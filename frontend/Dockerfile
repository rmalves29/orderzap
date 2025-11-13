# Base Node
FROM node:18-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* pnpm-lock.yaml* ./
COPY . .

RUN corepack enable
RUN pnpm install --no-frozen-lockfile
RUN pnpm build

# Production image
FROM node:18-alpine

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY package.json pnpm-lock.yaml* ./

RUN corepack enable
RUN pnpm install --prod --no-frozen-lockfile

EXPOSE 3000

CMD ["pnpm", "start"]
