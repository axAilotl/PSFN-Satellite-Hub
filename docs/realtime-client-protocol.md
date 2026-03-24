# Realtime Client Protocol

The custom Pi-class client talks to the hub over one persistent websocket.

This path exists for devices that can do smooth local playback interruption and continuous conversational control. Stock ESPHome and `linux-voice-assistant` remain supported through the fallback ESPHome transport.

## Why It Exists

The realtime client path is meant for devices that can:

- keep microphone capture local and continuous
- interrupt playback immediately on first user speech
- flush local playback buffers without waiting on ESPHome-style turn transitions
- keep a natural back-and-forth conversation over one persistent connection

## Connection

Default websocket endpoint:

```text
ws://<hub-host>:8787/
```

Set `DEVICE_TRANSPORT=realtime` to run only this path, or `DEVICE_TRANSPORT=hybrid` to run it beside the ESPHome fallback.

## Client To Hub

All client messages are JSON text frames.

`hello`

```json
{
  "type": "hello",
  "device_id": "pi-zero-2w-kitchen",
  "device_name": "Kitchen Pi",
  "conversation_id": "optional-stable-thread-id"
}
```

`turn.start`

```json
{
  "type": "turn.start",
  "wake_word_phrase": "Hey Hermes"
}
```

`audio`

```json
{
  "type": "audio",
  "audio": "<base64 pcm16 mono 16k>"
}
```

`turn.end`

```json
{
  "type": "turn.end",
  "reason": "vad_end"
}
```

`interrupt`

```json
{
  "type": "interrupt"
}
```

`session.reset`

```json
{
  "type": "session.reset"
}
```

## Hub To Client

All hub messages are JSON text frames.

Setup and turn lifecycle:

- `session.ready`
- `hello.ack`
- `turn.started`
- `transcript.final`
- `turn.no_input`

Assistant lifecycle:

- `assistant.start`
- `assistant.text`
- `assistant.audio.start`
- `assistant.audio.chunk`
- `assistant.audio.end`
- `assistant.end`
- `assistant.cancelled`
- `assistant.interrupted`

Errors:

- `error`

## Streaming Model

The intended client behavior is:

1. keep local mic capture active
2. detect user speech locally
3. cut local playback immediately
4. send `interrupt`
5. send `turn.start`
6. keep streaming `audio` frames without waiting for a wake beep or transport reopen
7. send `turn.end` when local VAD decides the utterance is complete

That is the top-tier conversational path. The ESPHome path remains available for stock devices that cannot do this.
