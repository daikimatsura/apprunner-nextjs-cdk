FROM --platform=$BUILDPLATFORM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat

RUN npm install -g pnpm

# Copy only package files first
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/main-app/web-app/package.json ./apps/main-app/web-app/

# Install dependencies
RUN pnpm install

# Copy only necessary files
COPY apps/main-app/web-app ./apps/main-app/web-app/

# Build application
WORKDIR /app/apps/main-app/web-app
RUN pnpm build

FROM --platform=$TARGETPLATFORM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache \
    openssl \
    libc6-compat

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy only the necessary files from builder
COPY --from=builder --chown=nextjs:nodejs /app/apps/main-app/web-app/.next/standalone /app
COPY --from=builder --chown=nextjs:nodejs /app/apps/main-app/web-app/.next/static /app/apps/main-app/web-app/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/main-app/web-app/public /app/apps/main-app/web-app/public

USER nextjs

ENV PORT 3000
ENV HOSTNAME 0.0.0.0
ENV APP_ENV dev
ENV NODE_ENV production

EXPOSE 3000

# Use the correct path to server.js
CMD ["node", "apps/main-app/web-app/server.js"] 