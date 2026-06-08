FROM node:18-alpine AS frontend-build

WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

COPY --from=frontend-build /frontend/build ./frontend/build

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "src/app.js"]
