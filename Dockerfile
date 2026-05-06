FROM node:20-alpine

WORKDIR /app

# bcrypt native build deps (제거 가능한 가상 패키지)
RUN apk add --no-cache --virtual .build-deps python3 make g++

COPY package*.json ./
RUN npm install

RUN apk del .build-deps

COPY . .
RUN npm run build

EXPOSE 4173

CMD ["node", "server.mjs"]
