#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUNTIME="${PI_CONTAINER_RUNTIME:-docker}"

if ! command -v "${RUNTIME}" >/dev/null 2>&1; then
	echo "pi-sandbox-build: container runtime not found: ${RUNTIME}" >&2
	exit 1
fi

echo "pi-sandbox-build: rebuilding workspace dist files ..."
# The sandbox mounts the repo checkout, so refresh the host workspace outputs
# before building the container image.
(
	cd "${REPO_ROOT}"
	npm --workspace packages/tui run build \
		&& npm --workspace packages/ai run build \
		&& npm --workspace packages/agent run build \
		&& npm --workspace packages/coding-agent run build
)

IMAGE="$(node "${REPO_ROOT}/scripts/pi-sandbox-image-tag.mjs" --repo-root "${REPO_ROOT}" --image "${PI_SANDBOX_IMAGE:-pi-sandbox:latest}")"

exec "${RUNTIME}" build \
	-f "${REPO_ROOT}/docker/pi-sandbox/Dockerfile" \
	-t "${IMAGE}" \
	"${REPO_ROOT}"
