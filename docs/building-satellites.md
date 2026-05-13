# Building Satellites for the Hub

A satellite is any endpoint that connects to PSFN Satellite Hub and exposes a
real device, simulated device, or client surface to a PSFN-backed conversation.
Examples include a Pi voice endpoint, a browser text shell, a Device Studio
simulator, a Voxta/VaM avatar, a mobile browser, or a telemetry-only sidecar.

This guide covers the hub-facing realtime WebSocket path. Stock ESPHome voice
devices use the Python ESPHome fallback path and do not need to implement this
protocol directly.

## Integration Model

The hub sits between the satellite and PSFN:

```text
satellite endpoint
  -> realtime websocket hello/audio/text/control
  -> PSFN Satellite Hub
  -> PSFN chat runtime with satellite claim envelope
  <- assistant text/audio/control events
  <- satellite endpoint
```

The satellite proves what it can currently do to the hub through the `hello`
payload. The hub then advertises endpoint identity, current capabilities, and
configured telemetry to PSFN through a satellite claim envelope. PSFN policy is
expected to intersect those advertised capabilities with registry permissions;
the satellite must not assume that advertising a capability grants permission.

## Choose an Endpoint Shape

Use the narrowest profile that matches the endpoint:

| Profile | Use for | Typical capabilities |
| --- | --- | --- |
| `voice-only` | Pi-class microphone/speaker endpoint | mic PCM, transcript, text, streamed audio, interrupt |
| `text-only` | CLI, browser shell, chat-only sidecar | text in, text/subtitle out, interrupt |
| `voxta-avatar` | VaM/Voxta avatar facade | text, local audio file playback, avatar actions/expressions |
| `vision-capable` | Image upload or camera endpoint | text plus image upload, text/subtitle output |
| `telemetry-only` | Health/presence/device-state sidecar | presence/control only, no chat input/output |
| `mobile-location` | Phone/tablet/browser endpoint with location | text plus configured location/timezone/battery telemetry |

Only advertise capabilities that are actually available at runtime. If a camera,
speaker, microphone, avatar action path, or telemetry source is unavailable,
omit or degrade that capability before sending `hello`.

## Hub Configuration

The hub’s PSFN-facing identity is configured in `.env`. These values become the
registry claim envelope sent to PSFN:

```dotenv
AGENT_RUNTIME=psfn
DEVICE_TRANSPORT=realtime

PSFN_API_BASE_URL=https://psfn.example/v1
PSFN_MODEL=psfn
PSFN_API_KEY=

PSFN_CLAIM_NAMESPACE=satellite.endpoint
PSFN_CLAIM_TYPE=voice-only
PSFN_CHANNEL_TYPE=satellite.endpoint
PSFN_CAPABILITY_PROFILE=voice-only
PSFN_SATELLITE_ID=kitchen-pi
PSFN_ENDPOINT_ID=kitchen-pi-realtime
PSFN_ENDPOINT_NAME=Kitchen Pi
PSFN_ENDPOINT_CLASS=voice
PSFN_LOCATION_MODE=static
PSFN_TELEMETRY_MODE=disabled
PSFN_TELEMETRY_CATEGORIES=

PSFN_CLIENT_CERT_PATH=
PSFN_CLIENT_KEY_PATH=
PSFN_CA_CERT_PATH=
```

For high-trust registered endpoints, configure `PSFN_CLIENT_CERT_PATH` and
`PSFN_CLIENT_KEY_PATH` so the hub presents client certificate identity to PSFN.
The satellite itself connects to the hub over the local hub transport; the hub
is the component that authenticates to PSFN.

## WebSocket Connection

Connect to the hub:

```text
ws://<hub-host>:8787/
```

The first client message should be `hello`. Use stable IDs:

- `deviceId`: local device/client identifier
- `deviceName`: human-readable local device name
- `sessionId`: stable conversation thread id, such as `realtime:kitchen-pi`
- `satelliteId`: endpoint identity inside the hub session
- `satelliteName`: human-readable satellite name
- `channelId`: optional; if omitted, the hub derives `satellite.endpoint:<sessionId>`

Text-only example:

```json
{
  "type": "hello",
  "deviceId": "thin-shell",
  "deviceName": "Thin Shell",
  "sessionId": "thin-shell:demo",
  "satelliteId": "thin-shell",
  "satelliteName": "Thin Shell",
  "capabilities": {
    "input": ["text"],
    "output": ["text", "subtitle"],
    "control": ["interrupt", "session_attach"],
    "safety": []
  }
}
```

Voice endpoint example:

```json
{
  "type": "hello",
  "deviceId": "kitchen-pi",
  "deviceName": "Kitchen Pi",
  "sessionId": "realtime:kitchen-pi",
  "satelliteId": "kitchen-pi",
  "satelliteName": "Kitchen Pi",
  "capabilities": {
    "input": ["microphone_pcm", "final_transcript", "text", "wake_event"],
    "output": ["text", "subtitle", "streamed_audio"],
    "control": ["interrupt", "presence", "session_attach"],
    "safety": []
  }
}
```

The hub replies with `hello.ack` containing the resolved session, channel, and
normalized capabilities. Treat that as the authoritative hub-side attachment for
the current connection.

## Sending User Input

For text-only satellites, send:

```json
{
  "type": "user.text",
  "text": "hello from my satellite",
  "interrupt": true
}
```

For voice satellites, use this turn flow:

```json
{ "type": "interrupt" }
{ "type": "turn.start", "interrupt": true }
{ "type": "audio", "audio": "<base64 pcm16 mono 16k chunk>" }
{ "type": "audio", "audio": "<base64 pcm16 mono 16k chunk>" }
{ "type": "turn.end", "reason": "vad_end" }
```

Audio chunks are raw PCM signed 16-bit little-endian mono at 16 kHz, base64
encoded. Keep chunks small enough for responsive interrupt behavior; the Pi
client uses continuous local capture and pushes frames as speech is detected.

## Receiving Assistant Output

Handle these hub messages:

| Message | Meaning |
| --- | --- |
| `session.ready` | Initial server-side default session before `hello` |
| `hello.ack` | Satellite attachment accepted and normalized |
| `message` with `role: "user"` | Final or live user transcript echoed by the hub |
| `message` with `role: "assistant"` and `live: true` | Assistant text delta |
| `message` with `role: "assistant"` and `final: true` | Final assistant text |
| `text` with `audio-init` | Hub is about to stream assistant audio |
| `audio` | Base64 assistant audio chunk |
| `text` with `audio-end` | Assistant audio stream finished |
| `assistant.interrupted` | Current assistant reply was interrupted |
| `error-event` | Hub-side protocol or runtime error |

If the satellite does not advertise `streamed_audio`, it should ignore audio
lifecycle events and render text/subtitles only.

## Capability Vocabulary

Allowed capability values are defined in `src/ts/shared/protocol.ts`.

Input:

```text
text, microphone_pcm, final_transcript, vision_upload, wake_event
```

Output:

```text
text, subtitle, streamed_audio, local_file_audio, animation, action, expression, gaze, servo
```

Control:

```text
interrupt, mute, sleep_wake, presence, session_attach
```

Safety:

```text
action_allowlist, confirmation_required, local_only
```

Prefer smaller capability sets. For example, a Device Studio simulator should
not advertise `vision_upload`, `action`, `servo`, or `streamed_audio` unless the
corresponding path is implemented and working.

## Telemetry

Telemetry is currently advertised through hub configuration and the PSFN claim
envelope, not through a separate satellite WebSocket message. Do not invent
custom telemetry frames until the shared protocol defines them.

Supported telemetry categories for the claim envelope are:

```text
location, timezone, room, presence, battery, health, device_status, avatar_state
```

Use `PSFN_TELEMETRY_MODE=disabled` by default. Enable telemetry only for
endpoints that are configured to provide it and whose registry entry permits it.

## Minimal JavaScript Satellite

This is the smallest text-only satellite shape:

```js
import WebSocket from "ws";

const socket = new WebSocket(process.env.HUB_WS_URL || "ws://127.0.0.1:8787/");

socket.on("open", () => {
  socket.send(JSON.stringify({
    type: "hello",
    deviceId: "my-shell",
    deviceName: "My Shell",
    sessionId: "text:my-shell",
    satelliteId: "my-shell",
    satelliteName: "My Shell",
    capabilities: {
      input: ["text"],
      output: ["text", "subtitle"],
      control: ["interrupt", "session_attach"],
      safety: []
    }
  }));
});

socket.on("message", (raw) => {
  const message = JSON.parse(String(raw));
  if (message.type === "hello.ack") {
    socket.send(JSON.stringify({
      type: "user.text",
      text: "hello from my shell",
      interrupt: true
    }));
    return;
  }
  if (message.type === "message" && message.data?.role === "assistant") {
    process.stdout.write(message.data.content);
    if (message.data.final) {
      process.stdout.write("\n");
      socket.close();
    }
  }
  if (message.type === "error-event") {
    console.error(message.data.message);
    socket.close();
  }
});
```

The checked-in version of this pattern is `scripts/psfn-thin-shell.mjs`.

## Validation

Start the TypeScript hub:

```bash
DEVICE_TRANSPORT=realtime npm run hub:ts
```

Run the built-in thin shell:

```bash
npm run shell:psfn -- "hello from a satellite"
```

Run protocol tests after changing the protocol, hub, or satellite examples:

```bash
npm run test:ts
uv run python -m pytest
```

If your shell resolves `pytest` outside this repo, use the project interpreter
form above. It avoids user-level `pytest` binaries shadowing the virtualenv.

## Readiness Criteria

Before treating a satellite as production-ready, verify:

- it sends `hello` before user/audio frames
- IDs are stable across reconnects when conversation continuity is desired
- capability claims are accurate for the current runtime state
- local playback stops immediately after `interrupt`
- text-only satellites do not advertise audio capabilities
- audio satellites send PCM16 mono 16 kHz chunks
- reconnect logic backs off and resends `hello`
- `error-event` is surfaced in local logs
- secrets, certs, and PSFN API keys stay in hub config, not satellite logs

## Extending the Protocol

Add a new message only when existing messages cannot represent the behavior.
When adding one:

- update `src/ts/shared/protocol.ts`
- document it in `docs/realtime-client-protocol.md`
- capability-gate it in the `hello` payload
- add focused tests for parsing and hub behavior
- keep unknown messages non-fatal where possible so older satellites can coexist
