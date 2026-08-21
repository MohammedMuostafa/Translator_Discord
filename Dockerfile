FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data
EXPOSE 8080
CMD ["node", "dist/index.js"]
