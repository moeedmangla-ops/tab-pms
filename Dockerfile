# Multi-stage build. Web: npx next start   Worker: npx tsx src/jobs/worker.ts
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
RUN npx prisma generate && NEXT_TELEMETRY_DISABLED=1 npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/* && useradd -r -u 1001 app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=app /app ./
USER app
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
