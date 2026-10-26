# syntax=docker/dockerfile:1

# Build the client.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime image: production dependencies, built client, server and modules (without the Dixnt cards).
FROM node:22-slim
# The Dixnt cards are mounted at /cards, not baked in.
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data DIXNT_CARDS_DIR=/cards
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY modules ./modules
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/config').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/index.js"]
