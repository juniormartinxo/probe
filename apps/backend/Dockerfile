FROM node:24-slim

RUN npm install --global pnpm@12.8.1

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY apps/executor/package.json apps/executor/
RUN pnpm install --frozen-lockfile --filter @probe/backend

COPY apps/backend apps/backend
WORKDIR /app/apps/backend
EXPOSE 3000
CMD ["pnpm", "dev"]
