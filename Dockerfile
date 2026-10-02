FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    NODE_NO_WARNINGS=1 \
    PORT=3000 \
    DATA_DIR=/data \
    PROTOCOL_HEADER=x-forwarded-proto \
    HOST_HEADER=x-forwarded-host \
    BODY_SIZE_LIMIT=1G
COPY --from=build /app/build build
COPY --from=build /app/node_modules node_modules
COPY package.json server.js ./
RUN mkdir /data && chown node /data
VOLUME /data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
