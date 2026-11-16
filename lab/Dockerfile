FROM mcr.microsoft.com/playwright:v1.64.0-jammy@sha256:c064e7f355d2dda32f669801a1b09e86a1e9252395c844d2cfbbe5c44acb9b79
WORKDIR /app/tavern
COPY sillytavern/ ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && node docker/build-lib.js
COPY extensions/ public/scripts/extensions/third-party/
WORKDIR /app/runner
RUN npm init -y && npm install --save-exact playwright@1.64.0 esbuild@0.21.5 --ignore-scripts --no-audit --no-fund
COPY lab-bundle-native.mjs lab-pack-shared.mjs ./
RUN node lab-bundle-native.mjs
COPY worker.mjs ./
COPY browser-proxy.mjs ./
COPY worldbook-converter.mjs ./
COPY assets/ /app/assets/
COPY profile.json /app/profile.json
USER pwuser
ENV HOME=/tmp/home
ENV FORGE_PRECOMPILED_LIB=1
EXPOSE 8720
CMD ["node", "/app/runner/worker.mjs"]
