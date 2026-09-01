FROM mcr.microsoft.com/playwright:v1.55.0-noble

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src
COPY start-worker.sh ./start-worker.sh

RUN mkdir -p /data/sessions && chown -R pwuser:pwuser /app /data
RUN chmod 755 /app/start-worker.sh
USER pwuser

ENV HOST=0.0.0.0 \
    PORT=8787 \
    QIANTIE_121_SESSION_DIR=/data/sessions

EXPOSE 8787
CMD ["./start-worker.sh"]
