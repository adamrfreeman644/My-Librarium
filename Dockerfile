FROM nginx:stable-alpine
ENV LIBRARIUM_UPSTREAM=http://host.docker.internal:3000
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY dist/ /usr/share/nginx/html/
EXPOSE 80
