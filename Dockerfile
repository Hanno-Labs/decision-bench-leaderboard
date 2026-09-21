# DecisionBench leaderboard for HF Spaces / GHCR. Builds the MTEB-derived
# SvelteKit frontend and serves it on :7860 via nginx-unprivileged (no root).
# The reviewed result matrix is shipped as static/leaderboard.json.

# ---------- Stage 1: build the static bundle ----------
FROM node:24-alpine AS build

ARG PUBLIC_SITE_URL=https://hanno-labs-decision-bench-leaderboard.hf.space
ARG BASE_PATH=
ENV PUBLIC_SITE_URL=${PUBLIC_SITE_URL} \
    BASE_PATH=${BASE_PATH} \
    BUILD_NO_PRERENDER=1 \
    CI=1

WORKDIR /src

# Install deps first so source-only changes don't bust the npm layer.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .

RUN npm run build \
    && test -f build/404.html \
    && test -f build/leaderboard.json \
    && test -d build/_app \
    && cp build/404.html build/index.html

# ---------- Stage 2: serve the prerendered output on :7860 ----------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY <<'NGINX' /etc/nginx/conf.d/default.conf
server {
    listen 7860;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # Hashed Vite asset bundles are content-addressed — cache forever.
    location /_app/ {
        access_log off;
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    # Don't leak the internal listen port into 301 Location headers
    # when nginx auto-redirects (e.g. trailing-slash on a directory).
    # Without this, hitting /models behind the HF Spaces reverse proxy
    # would 301 to `http://…:7860/models/`, which crawlers can't reach.
    port_in_redirect off;
    absolute_redirect off;

    location / {
        # adapter-static emits prerendered routes as `<route>.html` files
        # (e.g. /benchmark/BEIR/+page.svelte → build/benchmark/BEIR.html).
        # Without the `.html` lookup nginx never finds them — every deep
        # link falls through to /404.html (the SPA fallback), which has
        # no per-route meta tags so share-card crawlers see a blank
        # shell.
        #
        # Order matters: `$uri.html` MUST come before `$uri/`. Index
        # routes like `/models` have BOTH a `models.html` (the index
        # page) and a `models/` directory (containing nested
        # `/models/<org>/<name>.html` for detail pages). Checking the
        # directory first triggers nginx's auto-trailing-slash 301 to
        # `/models/`, and then there's no `index.html` inside so the
        # page never resolves.
        try_files $uri $uri.html $uri/ /404.html =404;
    }
}
NGINX

# The nginx base image ships a stock index.html. The Svelte build above uses
# 404.html as its SPA fallback, so clear the base document root before copying
# the validated application bundle or nginx will serve its welcome page at `/`.
USER 0
RUN rm -rf /usr/share/nginx/html \
    && mkdir -p /usr/share/nginx/html
USER 101

COPY --from=build /src/build/ /usr/share/nginx/html/

EXPOSE 7860
CMD ["nginx", "-g", "daemon off;"]
