# Opanhome

Dual-path voice hub for Hermes.

This repo is the middleware layer between voice endpoints and Hermes. It now has two device paths:

- a custom realtime websocket path for Pi-class devices that can do smooth bidirectional conversation
- an ESPHome Native API path for stock ESPHome voice devices and `linux-voice-assistant`

The current testing target is global Hermes deployment first. Treat this repo as a bridge into a normal `~/.hermes` install, not as a scoped Hermes environment.

## What This Repo Does

The hub in this repo does the heavy lifting:

- accepts either a custom realtime voice client or an ESPHome voice device
- streams microphone audio to Deepgram STT
- applies turn endpointing and timeout logic
- sends recognized text into Hermes
- streams Hermes text back into ElevenLabs TTS
- returns assistant audio either as websocket chunks or ESPHome playback media
- stores turn artifacts, transcripts, and reply metadata locally

Device behavior depends on the path:

- custom realtime client:
  local mic capture, local playback ownership, explicit interrupt, persistent websocket
- ESPHome fallback:
  wake word or button start, mic capture, speaker playback, ESPHome voice-assistant transport

No Home Assistant is in the runtime path.

## Current Architecture

```text
Pi-class realtime client
  <-> websocket voice server in this repo
      -> Deepgram live STT websocket
      -> Hermes conversation runtime
      -> ElevenLabs streaming TTS websocket
  <-> streamed text/audio chunks back to device

ESPHome device / linux-voice-assistant / ESP32 fallback
  <-> aioesphomeapi client in this repo
      -> Deepgram live STT websocket
      -> Hermes conversation runtime
      -> ElevenLabs streaming TTS websocket
      -> local HTTP audio stream server
  <-> streamed announcement playback back to device
```

## Current Status

Implemented:

- `hub probe` for metadata, entities, services, and state subscription
- `hub transport-spike` for raw transport capture and artifact logging
- `hub run` for the end-to-end voice loop
- `DEVICE_TRANSPORT=esphome|realtime|hybrid`
- custom realtime websocket transport for Pi-class clients
- ESPHome fallback transport kept intact
- persistent Deepgram websocket for STT
- persistent ElevenLabs websocket for streamed TTS
- persistent Hermes worker process with gateway-backed session context
- silence timeout, max-turn timeout, and reply timeout handling
- local artifact capture under `.artifacts/runtime/`

Current intent:

- make the voice loop feel fast and smooth enough for daily use
- target the global Hermes deployment first so the end-to-end path is real
- keep Hermes integration minimal so this can stay a sidecar first
- upstream only the smallest useful Hermes seam later if it proves out

## Why The Hub Exists

Hermes is not talking directly to the satellite.

This repo is the orchestration layer that translates:

- custom realtime voice transport
- ESPHome voice transport
- realtime STT/TTS provider streams
- Hermes conversation execution

That split is deliberate. It keeps ESPHome transport concerns out of Hermes core until the interface is proven stable, while still letting the bridge use the same global Hermes gateway/runtime configuration as a real deployment.

## Commands

Install dependencies:

```bash
uv sync --dev
```

Show CLI help:

```bash
uv run hub --help
```

Probe a device:

```bash
uv run hub probe --host <device-ip> --noise-psk <base64-psk>
```

Capture raw voice transport artifacts:

```bash
uv run hub transport-spike --host <device-ip> --noise-psk <base64-psk>
```

Bootstrap against the global Hermes install and run the live bridge:

```bash
./scripts/use-global-hermes.sh
uv run hub run
```

Run both the custom realtime server and the ESPHome fallback together:

```bash
DEVICE_TRANSPORT=hybrid uv run hub run
```

Apply the current `linux-voice-assistant` fork patch used for interrupt/follow-up behavior:

```bash
./scripts/apply-linux-voice-assistant-patch.sh /path/to/linux-voice-assistant
```

Deploy the dedicated Pi realtime client and disable `linux-voice-assistant` on that Pi:

```bash
PI_PASSWORD='<pi-password>' ./scripts/deploy-pi-realtime-client.sh <pi-host>
```

## Configuration

Runtime config comes from:

- project-local `.env`
- global Hermes config under `~/.hermes`

Load order is:

- project `.env` is read first only for `HERMES_HOME` and `HERMES_GATEWAY_HOME` hints
- `~/.hermes/.env` is then loaded as the shared Hermes/provider baseline
- project `.env` is applied again last so bridge-specific overrides still win

Important settings:

- `DEVICE_TRANSPORT`
- `ESPHOME_HOST`, `ESPHOME_PORT`, `ESPHOME_NOISE_PSK`
- `REALTIME_VOICE_BIND_HOST`, `REALTIME_VOICE_PORT`, `REALTIME_VOICE_PUBLIC_HOST`
- `DEEPGRAM_API_KEY`
- `ELEVENLABS_API_KEY`
- `HERMES_AGENT_BACKEND`
- `HERMES_GATEWAY_HOME`
- `HERMES_HOME`
- `HERMES_MODEL`
- `VOICE_REPLY_TIMEOUT_SECONDS`
- `VOICE_ENDPOINTING_GRACE_SECONDS`
- `VOICE_SILENCE_TIMEOUT_SECONDS`
- `VOICE_MAX_TURN_SECONDS`

## Testing With Global Hermes

The bridge currently expects a normal global Hermes install at:

- `~/.hermes`
- `~/.hermes/hermes-agent`
- `~/.hermes/hermes-agent/venv/bin/python`

To prepare this repo for that path, run:

```bash
./scripts/use-global-hermes.sh
```

That script:

- verifies the global Hermes checkout and venv exist
- verifies the gateway/runtime imports the bridge depends on
- creates `.env` from `.env.example` if needed
- rewrites the local project env to point at `~/.hermes`
- leaves Hermes source untouched; there is no required Hermes patch in this repo right now

After that, fill in the remaining project-specific values in `.env`:

- ESPHome endpoint settings
- bridge-specific overrides if you do not want to inherit provider keys from `~/.hermes/.env`

At the moment there are no required Hermes source patches in this repo. The bridge is importing and using the existing global Hermes checkout in place.

## Transport Paths

Top-tier path:

- custom realtime websocket client for Pi-class devices
- one persistent connection
- explicit interrupt semantics
- streamed assistant text and audio back to the client
- current Pi W 2 deployment uses this path and has `linux-voice-assistant` disabled

Fallback path:

- stock ESPHome voice devices
- `linux-voice-assistant`
- ESP32-class endpoints speaking the ESPHome voice protocol

The custom client protocol is documented in [docs/realtime-client-protocol.md](/mnt/samesung/ai/dev/opanhome/docs/realtime-client-protocol.md).

## ESPHome Fallback Notes

Natural follow-up and interrupt behavior on the ESPHome fallback path still depends on a patched `linux-voice-assistant` endpoint. The stock endpoint is good enough to expose the ESPHome voice transport, but it does not own interruption strongly enough for the behavior this bridge wants.

The current patch in [patches/linux-voice-assistant-followup-interrupt.patch](/mnt/samesung/ai/dev/opanhome/patches/linux-voice-assistant-followup-interrupt.patch) does three important things:

- adds speech-first barge-in detection knobs at the endpoint
- turns wake-word and stop-word interrupts into explicit local `stop output now, then reopen mic` behavior
- preserves follow-up conversation reopening after TTS instead of relying on fragile announce-state side effects

To apply it to a `linux-voice-assistant` checkout:

```bash
./scripts/apply-linux-voice-assistant-patch.sh /path/to/linux-voice-assistant
```

This is intentionally endpoint-local. Hermes itself still does not require a source patch for the current bridge path.

## Pi Realtime Client

The dedicated Pi-class client lives under [client/pi_realtime](/mnt/samesung/ai/dev/opanhome/client/pi_realtime).

It is the preferred path for devices that can afford a custom client, because it owns:

- continuous local microphone capture
- local preroll buffering
- immediate playback stop on interrupt
- direct websocket streaming back to the hub

Deployment details are in [client/pi_realtime/README.md](/mnt/samesung/ai/dev/opanhome/client/pi_realtime/README.md).

## Repository Layout

```text
hub/
  cli/
    probe.py
    run.py
  devices/
    esphome_session.py
    realtime_server.py
    voice_runtime_streaming.py
  adapters/
    interfaces.py
  media/
    http_audio.py
  runtime.py
  storage/
    session_cache.py
tests/
```

## Notes

- The current runtime path is global-Hermes-first, using gateway-backed session context rather than a project-scoped Hermes install.
- The repo now supports both a custom realtime client path and an ESPHome fallback path.
- Historical `.agent/` scaffolding exists in this repo, but it is not the main deployment target right now.
- The bridge serves streamed audio on `AUDIO_SERVER_PORT` for announcement playback back to the device.
- Turn artifacts are intentionally kept for debugging transport, latency, and failure recovery.

## Upstream Plan

The likely upstream path is:

1. keep ESPHome support as a sidecar first
2. identify the smallest Hermes streaming seam worth upstreaming
3. only move toward core gateway integration after the transport feels solid

That keeps the current experiment useful without forcing a large Hermes core change too early.

## Future Plans

- smooth streaming TTS by buffering Hermes deltas into short phrase-sized chunks before each ElevenLabs flush
- add better latency instrumentation around STT finalize, first Hermes token, first TTS audio, and playback start
- support fully local STT providers behind the same adapter interface
- support fully local TTS providers behind the same adapter interface
- replace the current Pi-specific endpoint fork with a cleaner upstreamable `linux-voice-assistant` patch set or a dedicated endpoint implementation
- make the hub usable with a fully local speech stack before worrying about a polished upstream story
- upstream the smallest Hermes-side streaming interface only after the bridge feels stable against the global deployment
