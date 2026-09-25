FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci || npm install

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --schema packages/database/prisma/schema.prisma
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/next.config.ts ./apps/web/next.config.ts
COPY --from=build /app/apps/web/tailwind.config.ts ./apps/web/tailwind.config.ts
COPY --from=build /app/apps/web/postcss.config.js ./apps/web/postcss.config.js
COPY --from=build /app/package.json ./
COPY --from=build /app/packages ./packages

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy --schema packages/database/prisma/schema.prisma && npm start"]
