FROM mcr.microsoft.com/playwright:v1.55.0-noble

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src

RUN mkdir -p /data/sessions && chown -R pwuser:pwuser /app /data
USER pwuser

ENV HOST=0.0.0.0 \
    PORT=8787 \
    QIANTIE_121_SESSION_DIR=/data/sessions

EXPOSE 8787
CMD ["node", "src/server.js"]
