FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
# Migration dùng cùng artifact đã build, trước khi mở cổng dịch vụ.
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/scripts ./scripts
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.cjs && node dist/main"]
