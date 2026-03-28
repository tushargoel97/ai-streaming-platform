FROM node:22-alpine

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install

# Source code mounted as volume in dev
COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
