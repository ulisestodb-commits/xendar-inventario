# Ubuntu 22.04 tiene GLIBC 2.35+ — compatible con todos los módulos nativos
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Instalar Node.js 20 LTS
RUN apt-get update && apt-get install -y curl python3 make g++ \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar package.json primero (cache de layers)
COPY package.json ./

# Instalar TODAS las dependencias (dev incluidas) para poder compilar
RUN npm install --include=dev

# Copiar el resto del código
COPY . .

# Compilar TypeScript
RUN npm run build

# Limpiar devDependencies para imagen de producción más liviana
RUN npm prune --production

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/web/apiServer.js"]
