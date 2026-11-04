FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node import-service ./import-service
COPY --chown=node:node native-core/import.js native-core/records.js native-core/sheet-contract.js native-core/close.js ./native-core/
USER node
ENV KITTY_IMPORT_HOST=0.0.0.0
ENV KITTY_IMPORT_PORT=8787
EXPOSE 8787
CMD ["node", "import-service/server.mjs"]
