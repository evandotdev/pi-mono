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

TSX_BIN="$SCRIPT_DIR/node_modules/.bin/tsx"
if [[ ! -x "$TSX_BIN" ]]; then
  echo "tsx not found at $TSX_BIN. Run npm install from the repo root first." >&2
  exit 1
fi

cwd="$(pwd -P)"
needs_project_resource_flags=false
if [[ "$cwd" == "$SCRIPT_DIR/"* ]]; then
  if [[ "$cwd" != "$SCRIPT_DIR" ]]; then
    needs_project_resource_flags=true
  fi
else
  cd "$SCRIPT_DIR"
  cwd="$SCRIPT_DIR"
fi

resource_args=()
if [[ "$needs_project_resource_flags" == "true" ]]; then
  project_pi_relative="$(node -e 'const path = require("node:path"); process.stdout.write(path.relative(process.argv[1], process.argv[2]));' "$cwd" "$SCRIPT_DIR/.pi")"

  if [[ -d "$SCRIPT_DIR/.pi/extensions" ]]; then
    shopt -s nullglob
    for extension in "$SCRIPT_DIR/.pi/extensions"/*.ts "$SCRIPT_DIR/.pi/extensions"/*.js; do
      resource_args+=(--extension "${project_pi_relative}/extensions/$(basename "$extension")")
    done
    for extension in "$SCRIPT_DIR/.pi/extensions"/*/index.ts "$SCRIPT_DIR/.pi/extensions"/*/index.js; do
      relative_extension="${extension#"$SCRIPT_DIR/.pi/"}"
      resource_args+=(--extension "${project_pi_relative}/${relative_extension}")
    done
    shopt -u nullglob
  fi

  [[ -d "$SCRIPT_DIR/.pi/skills" ]] && resource_args+=(--skill "${project_pi_relative}/skills")
  [[ -d "$SCRIPT_DIR/.pi/prompts" ]] && resource_args+=(--prompt-template "${project_pi_relative}/prompts")
fi

"$TSX_BIN" "$SCRIPT_DIR/packages/coding-agent/src/cli.ts" "${resource_args[@]}" ${ARGS[@]+"${ARGS[@]}"}
