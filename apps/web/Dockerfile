FROM node:20-alpine AS build

WORKDIR /srv/web

ARG VITE_API_BASE_URL=/api/v1
ARG VITE_APP_TITLE=Regatta Control Center
ARG VITE_API_DOCS_URL=/api/docs

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_APP_TITLE=${VITE_APP_TITLE}
ENV VITE_API_DOCS_URL=${VITE_API_DOCS_URL}

COPY apps/web/package.json ./package.json
COPY apps/web/tsconfig.json ./tsconfig.json
COPY apps/web/tsconfig.node.json ./tsconfig.node.json
COPY apps/web/vite.config.ts ./vite.config.ts
COPY apps/web/index.html ./index.html
COPY apps/web/vite-env.d.ts ./vite-env.d.ts
COPY apps/web/src ./src

RUN npm install
RUN npm run build

FROM nginx:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /srv/web/dist /usr/share/nginx/html

EXPOSE 80
