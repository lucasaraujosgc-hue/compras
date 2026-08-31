FROM node:20-alpine

WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./
RUN npm install

# Copiar o resto do código e fazer o build
COPY . .
RUN npm run build

# Expor a porta que o Express está usando
EXPOSE 3000
ENV NODE_ENV=production

# Comando para iniciar o servidor
CMD ["npm", "run", "start"]
