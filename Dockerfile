FROM node:24.19.0-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY app.js server.js index.html ./
COPY lib/ ./lib/
COPY middleware/ ./middleware/
COPY pets/ ./pets/
COPY prompts/ ./prompts/
COPY public/ ./public/
COPY routes/ ./routes/
COPY frontend/dist/ ./frontend/dist/

EXPOSE 3000
CMD ["node", "server.js"]
