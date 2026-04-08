#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check for --no-env flag
NO_ENV=false
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--no-env" ]]; then
    NO_ENV=true
  else
    ARGS+=("$arg")
  fi
done

if [[ "$NO_ENV" == "true" ]]; then
  # Unset API keys (see packages/ai/src/env-api-keys.ts)
  unset ANTHROPIC_API_KEY
  unset ANTHROPIC_OAUTH_TOKEN
  unset OPENAI_API_KEY
  unset GEMINI_API_KEY
  unset GROQ_API_KEY
  unset CEREBRAS_API_KEY
  unset XAI_API_KEY
  unset OPENROUTER_API_KEY
  unset ZAI_API_KEY
  unset MISTRAL_API_KEY
  unset MINIMAX_API_KEY
  unset MINIMAX_CN_API_KEY
  unset AI_GATEWAY_API_KEY
  unset OPENCODE_API_KEY
  unset COPILOT_GITHUB_TOKEN
  unset GH_TOKEN
  unset GITHUB_TOKEN
  unset GOOGLE_APPLICATION_CREDENTIALS
  unset GOOGLE_CLOUD_PROJECT
  unset GCLOUD_PROJECT
  unset GOOGLE_CLOUD_LOCATION
  unset AWS_PROFILE
  unset AWS_ACCESS_KEY_ID
  unset AWS_SECRET_ACCESS_KEY
  unset AWS_SESSION_TOKEN
  unset AWS_REGION
  unset AWS_DEFAULT_REGION
  unset AWS_BEARER_TOKEN_BEDROCK
  unset AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
  unset AWS_CONTAINER_CREDENTIALS_FULL_URI
  unset AWS_WEB_IDENTITY_TOKEN_FILE
  unset AZURE_OPENAI_API_KEY
  unset AZURE_OPENAI_BASE_URL
  unset AZURE_OPENAI_RESOURCE_NAME
  echo "Running without API keys..."
fi

DOWNLOAD_MODE=false
SANDBOX=""
WORKING_DIR=""
for ((i = 0; i < ${#ARGS[@]}; i++)); do
  arg="${ARGS[$i]}"
  if [[ "$arg" == --download=* ]]; then
    DOWNLOAD_MODE=true
  elif [[ "$arg" == "--download" ]]; then
    DOWNLOAD_MODE=true
    ((i += 1))
  elif [[ "$arg" == --sandbox=* ]]; then
    SANDBOX="${arg#--sandbox=}"
  elif [[ "$arg" == "--sandbox" ]]; then
    ((i += 1))
    if ((i < ${#ARGS[@]})); then
      SANDBOX="${ARGS[$i]}"
    fi
  elif [[ "$arg" != -* && -z "$WORKING_DIR" ]]; then
    WORKING_DIR="$arg"
  fi
done

if [[ "$DOWNLOAD_MODE" != "true" ]]; then
  if [[ -z "$WORKING_DIR" || ! -d "$WORKING_DIR" ]]; then
    echo "Working directory does not exist: ${WORKING_DIR:-<missing>}" >&2
    exit 1
  fi

  if [[ "$SANDBOX" == docker:* ]]; then
    if ! command -v docker >/dev/null 2>&1; then
      echo "docker is required for sandbox mode." >&2
      exit 1
    fi

    CONTAINER_NAME="${SANDBOX#docker:}"
    if [[ -z "$CONTAINER_NAME" ]]; then
      echo "Docker sandbox requires a container name." >&2
      exit 1
    fi

    if ! docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
      echo "Docker sandbox does not exist: $CONTAINER_NAME" >&2
      exit 1
    fi
  fi
fi

TSX_BIN="$SCRIPT_DIR/node_modules/.bin/tsx"
if [[ ! -x "$TSX_BIN" ]]; then
  echo "tsx not found at $TSX_BIN. Run npm install from the repo root first." >&2
  exit 1
fi

"$TSX_BIN" "$SCRIPT_DIR/packages/mom/src/main.ts" ${ARGS[@]+"${ARGS[@]}"}
