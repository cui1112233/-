FROM node:22-alpine AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
COPY --from=frontend-build /build/frontend/dist ./frontend/dist
RUN mkdir -p /app/data/users /app/data/system /app/data/shuihuo-objects /app/outputs
EXPOSE 3000
CMD ["node", "server.js"]
