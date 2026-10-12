FROM node:24.8.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=/api/v1
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_API_URL=$VITE_API_URL \
    VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.29-alpine
USER root
RUN sed -i 's|/etc/nginx/conf.d/\*.conf|/tmp/default.conf|' /etc/nginx/nginx.conf
USER 101
# Render injects its private service address at runtime. /tmp also works with
# the read-only filesystem used by the local Compose deployment.
ENV BACKEND_ADDRESS=backend:8000 \
    NGINX_ENVSUBST_OUTPUT_DIR=/tmp \
    NGINX_ENVSUBST_FILTER=^BACKEND_ADDRESS$
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
