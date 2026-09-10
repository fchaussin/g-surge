# syntax=docker/dockerfile:1

# Development image for G-SURGE.
#
# It carries Node and nothing else: the sources are bind-mounted and Vite is
# taken from the mounted `node_modules`, so a change is a reload away and the
# image only needs rebuilding when this file changes.
#
# Debian and not Alpine, deliberately. `node_modules` comes from the host and
# holds native binaries — rollup, esbuild — published separately for glibc and
# for musl. Under `node:*-alpine`, a `node_modules` installed on a glibc host
# fails to load with MODULE_NOT_FOUND on @rollup/rollup-linux-x64-gnu.
FROM node:24-slim

WORKDIR /app

# No USER here: the right uid depends on the daemon, and is chosen in
# compose.yaml. See the "user:" comment there.

EXPOSE 5173

# --host so the server is reachable from outside the container, and the port
# forced to the one compose publishes.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]
