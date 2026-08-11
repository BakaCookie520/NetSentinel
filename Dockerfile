FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

RUN pnpm install --frozen-lockfile

ARG VITE_DEMO_MODE=false
ENV VITE_DEMO_MODE=${VITE_DEMO_MODE}

RUN pnpm turbo typecheck --filter=@netsentinel/api... --filter=@netsentinel/worker... --filter=@netsentinel/web...
RUN pnpm turbo test --filter=@netsentinel/api... --filter=@netsentinel/worker... --filter=@netsentinel/web...
RUN pnpm turbo build --filter=@netsentinel/api... --filter=@netsentinel/worker... --filter=@netsentinel/web...
# Prisma's generated native query engine must match the Debian runtime image,
# rather than any cached local build artifacts from another platform.
RUN pnpm --filter @netsentinel/database prisma:generate

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends openssh-client iputils-ping ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps ./apps

USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
