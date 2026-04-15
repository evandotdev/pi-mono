#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUNTIME="${PI_CONTAINER_RUNTIME:-docker}"
IMAGE="$(node "${REPO_ROOT}/scripts/pi-sandbox-image-tag.mjs" --repo-root "${REPO_ROOT}" --image "${PI_SANDBOX_IMAGE:-pi-sandbox:latest}")"

if ! command -v "${RUNTIME}" >/dev/null 2>&1; then
	echo "pi-sandbox-build: container runtime not found: ${RUNTIME}" >&2
	exit 1
fi

exec "${RUNTIME}" build \
	-f "${REPO_ROOT}/docker/pi-sandbox/Dockerfile" \
	-t "${IMAGE}" \
	"${REPO_ROOT}"
