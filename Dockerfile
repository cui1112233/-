FROM node:24.19.0-alpine

WORKDIR /app
ARG QIANTIE_RELEASE_SHA
LABEL org.opencontainers.image.revision=$QIANTIE_RELEASE_SHA \
      org.opencontainers.image.source="https://github.com/cui1112233/-"
ENV NODE_ENV=production
ENV QIANTIE_RELEASE_SHA=$QIANTIE_RELEASE_SHA

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

# Keep the legacy batch-rewrite workbench safe even when a candidate image is
# built from a previously generated frontend/dist. The React source also loads
# these guards after a fresh Vite build; stable script ids prevent duplicates.
COPY frontend/public/batch-rewrite/121-login-hotfix.js ./frontend/dist/batch-rewrite/121-login-hotfix.js
COPY frontend/public/batch-rewrite/interaction-feedback.js ./frontend/dist/batch-rewrite/interaction-feedback.js
COPY frontend/public/batch-rewrite/task-visibility-hotfix.js ./frontend/dist/batch-rewrite/task-visibility-hotfix.js
RUN sed -i 's#</body>#    <script id="qiantie-121-login-hotfix" src="./121-login-hotfix.js?v=20260831-config-guard1"></script>\n    <script id="qiantie-novel-fetch-interaction-feedback" src="./interaction-feedback.js?v=20260906-public-feedback1"></script>\n    <script id="qiantie-novel-fetch-task-visibility" src="./task-visibility-hotfix.js?v=20260906-task-visibility1"></script>\n  </body>#' ./frontend/dist/batch-rewrite/index.html

EXPOSE 3000
CMD ["node", "server.js"]
