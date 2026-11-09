FROM node:20-alpine
WORKDIR /app/keeper
COPY keeper/package*.json ./
RUN npm ci --omit=dev
COPY keeper/ ./
COPY contracts/deployments/ /app/contracts/deployments/
ENV PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:${PORT}/health || exit 1
CMD ["node", "index.mjs"]
