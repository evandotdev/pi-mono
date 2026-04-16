# FROM cgr.dev/chainguard/node:latest-dev@sha256:d201cee80fc4bd2881571d9d7c25c3551a32281d655409c80d9c600214afa5cf
FROM node:24-alpine3.22

USER root

WORKDIR /home/pisandbox/pi-mono

RUN apk add --no-cache \
	bash \
	ca-certificates \
	fd \
	git \
	openssh-client \
	ripgrep \
	tmux

COPY package.json package-lock.json tsconfig.base.json tsconfig.json biome.json ./
COPY packages/ai ./packages/ai
COPY packages/agent ./packages/agent
COPY packages/tui ./packages/tui
COPY packages/coding-agent ./packages/coding-agent

RUN npm ci --ignore-scripts

RUN npm --workspace packages/tui run build \
	&& npm --workspace packages/ai run build \
	&& npm --workspace packages/agent run build \
	&& npm --workspace packages/coding-agent run build

ENTRYPOINT ["/home/pisandbox/pi-mono/packages/coding-agent/dist/cli.js"]
