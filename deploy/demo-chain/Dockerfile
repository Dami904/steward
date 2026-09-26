# Hosted demo chain: Anvil loaded with the committed demo state, behind a read-only proxy.
# Build context is this directory (Render: Docker, root directory deploy/demo-chain).
FROM ghcr.io/foundry-rs/foundry:v1.8.3 AS foundry

FROM node:22-bookworm-slim
COPY --from=foundry /usr/local/bin/anvil /usr/local/bin/anvil
WORKDIR /app
COPY state.json allowlist.mjs proxy.mjs ./
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "proxy.mjs"]
