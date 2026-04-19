FROM node:20-alpine

WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install

COPY . .

RUN npm run build --workspace @service-levels/web

WORKDIR /app/apps/api

EXPOSE 8080

CMD ["npm", "exec", "tsx", "src/index.ts"]
