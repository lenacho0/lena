#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "ERROR: GITHUB_TOKEN is required." >&2
  echo "Tip: export GITHUB_TOKEN=<github_pat_with_repo_and_actions_read>" >&2
  exit 1
fi

if [[ -z "${GITHUB_REPOSITORY:-}" ]]; then
  echo "ERROR: GITHUB_REPOSITORY is required (format: owner/repo)." >&2
  exit 1
fi

api_get() {
  local path="$1"
  curl -fsSL \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/${GITHUB_REPOSITORY}${path}"
}

has_name() {
  local target="$1"
  shift
  local names=("$@")
  for name in "${names[@]}"; do
    if [[ "${name}" == "${target}" ]]; then
      return 0
    fi
  done
  return 1
}

readarray -t REQUIRED_SECRETS < <(printf "%s\n" "DATABASE_URL")
readarray -t OPTIONAL_VARIABLES < <(
  printf "%s\n" \
    "SCRIPT_GENERATION_PROVIDER" \
    "SCRIPT_GENERATION_MODEL" \
    "SCRIPT_GENERATION_BASE_URL" \
    "SCRIPT_GENERATION_TIMEOUT_MS" \
    "SCRIPT_GENERATION_LANGUAGE"
)

echo "[1/3] check repository secrets"
SECRETS_JSON="$(api_get "/actions/secrets?per_page=100")"
readarray -t SECRET_NAMES < <(echo "${SECRETS_JSON}" | jq -r '.secrets[].name')

MISSING_REQUIRED_SECRETS=()
for required_secret in "${REQUIRED_SECRETS[@]}"; do
  if ! has_name "${required_secret}" "${SECRET_NAMES[@]}"; then
    MISSING_REQUIRED_SECRETS+=("${required_secret}")
  fi
done

HAS_SCRIPT_KEY=false
HAS_OPENAI_KEY=false
HAS_GEMINI_KEY=false
if has_name "SCRIPT_GENERATION_API_KEY" "${SECRET_NAMES[@]}"; then
  HAS_SCRIPT_KEY=true
fi
if has_name "OPENAI_API_KEY" "${SECRET_NAMES[@]}"; then
  HAS_OPENAI_KEY=true
fi
if has_name "GEMINI_API_KEY" "${SECRET_NAMES[@]}"; then
  HAS_GEMINI_KEY=true
fi

if [[ "${HAS_SCRIPT_KEY}" == false && "${HAS_OPENAI_KEY}" == false && "${HAS_GEMINI_KEY}" == false ]]; then
  MISSING_REQUIRED_SECRETS+=("SCRIPT_GENERATION_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY")
fi

if [[ "${#MISSING_REQUIRED_SECRETS[@]}" -gt 0 ]]; then
  echo "ERROR: missing required secret(s): ${MISSING_REQUIRED_SECRETS[*]}" >&2
  exit 1
fi

echo "OK: required secrets exist."

echo "[2/3] check repository variables"
VARIABLES_JSON="$(api_get "/actions/variables?per_page=100")"
readarray -t VARIABLE_NAMES < <(echo "${VARIABLES_JSON}" | jq -r '.variables[].name')

PRESENT_OPTIONAL_VARIABLES=()
for optional_var in "${OPTIONAL_VARIABLES[@]}"; do
  if has_name "${optional_var}" "${VARIABLE_NAMES[@]}"; then
    PRESENT_OPTIONAL_VARIABLES+=("${optional_var}")
  fi
done

if [[ "${#PRESENT_OPTIONAL_VARIABLES[@]}" -eq 0 ]]; then
  echo "INFO: no optional workflow variables found, workflow defaults will be used."
else
  echo "OK: optional variables present: ${PRESENT_OPTIONAL_VARIABLES[*]}"
fi

echo "[3/3] check workflow run status"
check_workflow_success() {
  local workflow_file="$1"
  local workflow_label="$2"
  local runs_json
  runs_json="$(api_get "/actions/workflows/${workflow_file}/runs?per_page=1&status=completed")"

  local run_count
  run_count="$(echo "${runs_json}" | jq -r '.total_count')"
  if [[ "${run_count}" == "0" ]]; then
    echo "ERROR: workflow ${workflow_label} has no completed runs." >&2
    return 1
  fi

  local conclusion
  conclusion="$(echo "${runs_json}" | jq -r '.workflow_runs[0].conclusion')"
  local run_url
  run_url="$(echo "${runs_json}" | jq -r '.workflow_runs[0].html_url')"

  if [[ "${conclusion}" != "success" ]]; then
    echo "ERROR: workflow ${workflow_label} latest completed run is not success (${conclusion})." >&2
    echo "run: ${run_url}" >&2
    return 1
  fi

  echo "OK: ${workflow_label} latest completed run is success."
  echo "run: ${run_url}"
}

check_workflow_success "ci.yml" "CI"
check_workflow_success "worker-scripts-scheduler.yml" "Worker Scripts Scheduler"

echo "PASS: github release readiness check completed."
