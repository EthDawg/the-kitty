FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node service ./service
COPY --chown=node:node import-service/*.mjs ./import-service/
COPY --chown=node:node ai-service/*.mjs ./ai-service/
COPY --chown=node:node native-core/import.js ./native-core/import.js
USER node
ENV KITTY_SERVICE_HOST=0.0.0.0
ENV KITTY_SERVICE_PORT=8787
EXPOSE 8787
CMD ["node", "service/server.mjs"]
