#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_HOST="${PI_HOST:-${1:-}}"
PI_PASSWORD="${PI_PASSWORD:-${2:-}}"
PI_USER="${PI_USER:-psfn}"

if [[ -z "${PI_HOST}" || -z "${PI_PASSWORD}" ]]; then
  echo "usage: PI_PASSWORD=<password> $0 <pi-host> [pi-password]" >&2
  exit 1
fi

if ! command -v expect >/dev/null 2>&1; then
  echo "expect is required" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

ENV_FILE="${TMP_DIR}/opanhome-ts-client.env"
cat > "${ENV_FILE}" <<EOF
HUB_WS_URL=${HUB_WS_URL:-ws://192.168.1.220:8787/}
DEVICE_ID=${DEVICE_ID:-pi5-ts}
DEVICE_NAME=${DEVICE_NAME:-Opanhome TS Pi Client}
CONVERSATION_ID=${CONVERSATION_ID:-psfn-amica:lab:pi5}
XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/1000}
DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/1000/bus}
PULSE_SERVER=${PULSE_SERVER:-/run/user/1000/pulse/native}
PULSE_COOKIE=${PULSE_COOKIE:-DISABLED}
AUDIO_DEVICE_CARD=${AUDIO_DEVICE_CARD:-P10S}
AUDIO_INPUT_DEVICE=${AUDIO_INPUT_DEVICE:-plughw:CARD=P10S,DEV=0}
AUDIO_OUTPUT_DEVICE=${AUDIO_OUTPUT_DEVICE:-default:CARD=P10S}
AUDIO_INPUT_COMMAND=${AUDIO_INPUT_COMMAND:-pw-record --raw --rate 16000 --channels 1 --format s16 -}
AUDIO_OUTPUT_COMMAND=${AUDIO_OUTPUT_COMMAND:-bash -lc "ffmpeg -hide_banner -loglevel error -fflags nobuffer -flags low_delay -probesize 32 -analyzeduration 0 -i pipe:0 -f s16le -acodec pcm_s16le -ar 44100 -ac 2 pipe:1 | pw-play --raw --rate 44100 --channels 2 --format s16 -"}
ALSA_DUCK_CARD=${ALSA_DUCK_CARD:-2}
ALSA_DUCK_CONTROL=${ALSA_DUCK_CONTROL:-PCM}
ALSA_DUCK_PERCENT=${ALSA_DUCK_PERCENT:-8}
MIC_GAIN=${MIC_GAIN:-1.0}
VOICE_START_THRESHOLD=${VOICE_START_THRESHOLD:-0.008}
VOICE_CONTINUE_THRESHOLD=${VOICE_CONTINUE_THRESHOLD:-0.004}
VOICE_AMBIENT_START_RATIO=${VOICE_AMBIENT_START_RATIO:-1.5}
VOICE_INTERRUPT_RATIO=${VOICE_INTERRUPT_RATIO:-1.0}
VOICE_START_CHUNKS=${VOICE_START_CHUNKS:-1}
VOICE_SPEECH_RELEASE_MS=${VOICE_SPEECH_RELEASE_MS:-180}
VOICE_INITIAL_SILENCE_MS=${VOICE_INITIAL_SILENCE_MS:-1800}
VOICE_END_SILENCE_MS=${VOICE_END_SILENCE_MS:-420}
VOICE_MAX_TURN_MS=${VOICE_MAX_TURN_MS:-20000}
VOICE_PREROLL_CHUNKS=${VOICE_PREROLL_CHUNKS:-24}
VOICE_PREROLL_LEAD_CHUNKS=${VOICE_PREROLL_LEAD_CHUNKS:-4}
EOF

if [[ -n "${AMICA_BRIDGE_TOKEN:-}" ]]; then
  cat >> "${ENV_FILE}" <<EOF
AMICA_BRIDGE_URL=${AMICA_BRIDGE_URL:-http://127.0.0.1:3000/api/satelliteBridge/}
AMICA_BRIDGE_TOKEN=${AMICA_BRIDGE_TOKEN}
AMICA_BRIDGE_OWNER_MODE=${AMICA_BRIDGE_OWNER_MODE:-true}
AMICA_BRIDGE_TIMEOUT_MS=${AMICA_BRIDGE_TIMEOUT_MS:-5000}
EOF
fi

expect_ssh() {
  local remote_cmd="$1"
  local remote_b64
  remote_b64="$(printf '%s' "${remote_cmd}" | base64 | tr -d '\n')"
  EXPECT_PASSWORD="${PI_PASSWORD}" \
  EXPECT_PI_USER="${PI_USER}" \
  EXPECT_PI_HOST="${PI_HOST}" \
  EXPECT_REMOTE_B64="${remote_b64}" \
  expect <<'EOF'
set timeout 600
set password $env(EXPECT_PASSWORD)
set user $env(EXPECT_PI_USER)
set host $env(EXPECT_PI_HOST)
set remote_b64 $env(EXPECT_REMOTE_B64)
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${user}@${host} "printf %s ${remote_b64} | base64 -d | bash"
expect {
    -re ".*assword:" { send "${password}\r"; exp_continue }
    eof
}
EOF
}

expect_scp() {
  local joined=""
  local arg
  for arg in "$@"; do
    joined+="${arg}"$'\x1f'
  done
  EXPECT_PASSWORD="${PI_PASSWORD}" \
  EXPECT_SCP_ARGS="${joined}" \
  expect <<'EOF'
set timeout 600
set password $env(EXPECT_PASSWORD)
set raw_args $env(EXPECT_SCP_ARGS)
set args [lrange [split $raw_args "\u001f"] 0 end-1]
eval spawn [list scp -r -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null] $args
expect {
    -re ".*assword:" { send "${password}\r"; exp_continue }
    eof
}
EOF
}

REMOTE_DIR="/home/${PI_USER}/opanhome-ts-client"

expect_ssh "mkdir -p ${REMOTE_DIR}/src ${REMOTE_DIR}/client/ts_realtime"
expect_scp \
  "${ROOT_DIR}/package.json" \
  "${ROOT_DIR}/package-lock.json" \
  "${ROOT_DIR}/tsconfig.json" \
  "${ROOT_DIR}/client/ts_realtime/pi-ts-client.service" \
  "${ENV_FILE}" \
  "${PI_USER}@${PI_HOST}:${REMOTE_DIR}/"
expect_scp \
  "${ROOT_DIR}/src/ts" \
  "${PI_USER}@${PI_HOST}:${REMOTE_DIR}/src/"

REMOTE_SCRIPT="$(cat <<EOF
set -e
cd ${REMOTE_DIR}
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' '${PI_PASSWORD}' | sudo -S apt-get update
  printf '%s\n' '${PI_PASSWORD}' | sudo -S apt-get install -y nodejs npm ffmpeg alsa-utils
fi
npm install
printf '%s\n' '${PI_PASSWORD}' | sudo -S install -m 0644 ${REMOTE_DIR}/pi-ts-client.service /etc/systemd/system/opanhome-ts-client.service
printf '%s\n' '${PI_PASSWORD}' | sudo -S sed -i 's/%i/${PI_USER}/g' /etc/systemd/system/opanhome-ts-client.service
printf '%s\n' '${PI_PASSWORD}' | sudo -S install -m 0644 ${REMOTE_DIR}/opanhome-ts-client.env /etc/opanhome-ts-client.env
printf '%s\n' '${PI_PASSWORD}' | sudo -S systemctl daemon-reload
printf '%s\n' '${PI_PASSWORD}' | sudo -S systemctl disable --now linux-voice-assistant.service || true
printf '%s\n' '${PI_PASSWORD}' | sudo -S systemctl enable opanhome-ts-client.service
printf '%s\n' '${PI_PASSWORD}' | sudo -S systemctl restart opanhome-ts-client.service
systemctl is-active opanhome-ts-client.service
EOF
)"

expect_ssh "${REMOTE_SCRIPT}"
