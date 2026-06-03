# Ubuntu 22.04 tiene GLIBC 2.35+ — compatible con sqlite3 y @libsql/client
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV PORT=3000

# Instalar Node.js 20 LTS + herramientas de build para sqlite3
RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    make \
    g++ \
    libsqlite3-dev \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar dependencias primero (cache de Docker)
COPY package.json ./
RUN npm install

# Copiar el resto del código
COPY . .

# Compilar TypeScript
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/web/apiServer.js"]
