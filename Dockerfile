# For any host that runs Docker (a VPS, Fly.io, Railway, ...). Mount a persistent volume at /data.
FROM node:22-slim
WORKDIR /app
COPY package.json server.js backup.js ./
COPY public ./public
RUN mkdir -p /data && chown -R node:node /data /app
ENV PORT=3000 HOST=0.0.0.0 DATA_DIR=/data TRUST_PROXY=1
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server.js"]
