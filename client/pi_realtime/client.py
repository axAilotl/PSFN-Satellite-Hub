from __future__ import annotations

import asyncio
import base64
from collections import deque
from dataclasses import dataclass
import json
import logging
import os
from pathlib import Path
from queue import Empty, Full, Queue
import socket
import sys
import threading
import time
from typing import Any

import numpy as np

# soundcard currently assumes argv[1] exists when inferring a Pulse client name.
if len(sys.argv) < 2:
    sys.argv.append("opanhome-realtime-client")

import soundcard as sc
import websockets
from websockets.exceptions import ConnectionClosed

LOG = logging.getLogger("opanhome_realtime_client")


@dataclass(slots=True)
class AudioChunk:
    audio: bytes
    rms: float
    captured_at: float


@dataclass(slots=True)
class ClientConfig:
    hub_url: str
    device_id: str
    device_name: str
    conversation_id: str | None
    sample_rate: int
    block_size: int
    start_threshold: float
    continue_threshold: float
    interrupt_ratio: float
    start_chunks: int
    min_speech_chunks: int
    initial_silence_timeout: float
    end_silence_timeout: float
    max_turn_seconds: float
    preroll_chunks: int
    reconnect_delay: float
    ffplay_bin: str
    ffplay_log_level: str
    ffplay_volume: float


class StreamingAudioPlayer:
    def __init__(self, *, ffplay_bin: str, log_level: str, volume: float) -> None:
        self._ffplay_bin = ffplay_bin
        self._log_level = log_level
        self._volume = volume
        self._process: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()
        self._wait_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        async with self._lock:
            await self._stop_locked()
            self._process = await asyncio.create_subprocess_exec(
                self._ffplay_bin,
                "-autoexit",
                "-nodisp",
                "-hide_banner",
                "-loglevel",
                self._log_level,
                "-fflags",
                "nobuffer",
                "-flags",
                "low_delay",
                "-volume",
                str(int(self._volume * 100)),
                "-i",
                "pipe:0",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )

    async def write(self, data: bytes) -> None:
        if not data:
            return
        async with self._lock:
            process = self._process
            if process is None or process.returncode is not None or process.stdin is None:
                return
            process.stdin.write(data)
            await process.stdin.drain()

    async def finish(self) -> None:
        async with self._lock:
            process = self._process
            if process is None or process.returncode is not None:
                self._process = None
                return
            if process.stdin is not None and not process.stdin.is_closing():
                process.stdin.close()
            if self._wait_task is None or self._wait_task.done():
                self._wait_task = asyncio.create_task(self._wait_for_exit(process))

    async def stop(self) -> None:
        async with self._lock:
            await self._stop_locked()

    async def _stop_locked(self) -> None:
        if self._wait_task is not None:
            self._wait_task.cancel()
            self._wait_task = None
        process = self._process
        self._process = None
        if process is None:
            return
        if process.returncode is None:
            process.kill()
            try:
                await asyncio.wait_for(process.wait(), timeout=2)
            except TimeoutError:
                return

    async def _wait_for_exit(self, process: asyncio.subprocess.Process) -> None:
        try:
            await process.wait()
        except asyncio.CancelledError:
            return
        finally:
            if self._process is process:
                self._process = None


class PiRealtimeVoiceClient:
    def __init__(self, config: ClientConfig) -> None:
        self._config = config
        self._send_lock = asyncio.Lock()
        self._capture_queue: Queue[AudioChunk] = Queue(maxsize=256)
        self._preroll: deque[AudioChunk] = deque(maxlen=config.preroll_chunks)
        self._capture_stop = threading.Event()
        self._capture_thread: threading.Thread | None = None
        self._player = StreamingAudioPlayer(
            ffplay_bin=config.ffplay_bin,
            log_level=config.ffplay_log_level,
            volume=config.ffplay_volume,
        )
        self._ws: websockets.ClientConnection | None = None
        self._assistant_active = False
        self._assistant_audio_active = False
        self._turn_active = False
        self._turn_started_at = 0.0
        self._last_speech_at = 0.0
        self._speech_chunks = 0
        self._activation_chunks = 0
        self._playback_floor = 0.0
        self._playback_floor_samples = 0

    async def run(self) -> None:
        self._ensure_capture_thread()
        while True:
            try:
                async with websockets.connect(
                    self._config.hub_url,
                    ping_interval=20,
                    ping_timeout=20,
                    max_size=None,
                ) as websocket:
                    LOG.info("Connected to hub: %s", self._config.hub_url)
                    self._ws = websocket
                    self._reset_turn_state()
                    await self._send_json(
                        {
                            "type": "hello",
                            "device_id": self._config.device_id,
                            "device_name": self._config.device_name,
                            "conversation_id": self._config.conversation_id,
                        }
                    )
                    async with asyncio.TaskGroup() as task_group:
                        task_group.create_task(self._reader_loop(websocket))
                        task_group.create_task(self._microphone_loop(websocket))
            except Exception as exc:
                LOG.warning("Realtime client disconnected: %s", exc)
                await self._player.stop()
                self._ws = None
                self._reset_turn_state()
                await asyncio.sleep(self._config.reconnect_delay)

    async def aclose(self) -> None:
        self._capture_stop.set()
        if self._capture_thread is not None:
            self._capture_thread.join(timeout=2)
        await self._player.stop()

    async def _reader_loop(self, websocket: websockets.ClientConnection) -> None:
        async for raw_message in websocket:
            if isinstance(raw_message, bytes):
                continue
            payload = json.loads(raw_message)
            await self._handle_server_message(payload)

    async def _microphone_loop(self, websocket: websockets.ClientConnection) -> None:
        while websocket.state.name == "OPEN":
            chunk = await asyncio.to_thread(self._next_chunk)
            if chunk is None:
                continue
            await self._handle_microphone_chunk(chunk)

    async def _handle_server_message(self, payload: dict[str, Any]) -> None:
        message_type = str(payload.get("type") or "")
        if message_type in {"session.ready", "hello.ack"}:
            LOG.info("%s: %s", message_type, payload)
            return
        if message_type == "assistant.start":
            self._assistant_active = True
            return
        if message_type == "assistant.text":
            delta = str(payload.get("delta") or "")
            if delta:
                LOG.info("assistant> %s", delta)
            return
        if message_type == "assistant.audio.start":
            self._assistant_active = True
            self._assistant_audio_active = True
            self._reset_playback_floor()
            await self._player.start()
            return
        if message_type == "assistant.audio.chunk":
            self._assistant_audio_active = True
            await self._player.write(_decode_audio(str(payload.get("audio") or "")))
            return
        if message_type == "assistant.audio.end":
            self._assistant_audio_active = False
            await self._player.finish()
            return
        if message_type in {"assistant.end", "assistant.cancelled", "assistant.interrupted"}:
            self._assistant_active = False
            self._assistant_audio_active = False
            self._reset_playback_floor()
            if message_type != "assistant.end":
                await self._player.stop()
            return
        if message_type == "turn.no_input":
            LOG.info("turn.no_input")
            return
        if message_type == "error":
            LOG.error("Hub error: %s", payload.get("message"))
            return

    async def _handle_microphone_chunk(self, chunk: AudioChunk) -> None:
        if self._ws is None:
            return

        self._preroll.append(chunk)
        self._update_playback_floor(chunk.rms)

        if not self._turn_active:
            threshold = self._config.start_threshold
            required_chunks = self._config.start_chunks
            interrupting = self._assistant_active or self._assistant_audio_active
            if interrupting:
                threshold = max(threshold, self._playback_floor * self._config.interrupt_ratio)
                required_chunks = 1
            if chunk.rms >= threshold:
                self._activation_chunks += 1
            else:
                self._activation_chunks = 0
            if self._activation_chunks >= required_chunks:
                await self._begin_turn(interrupt=interrupting)
                self._activation_chunks = 0
            return

        await self._send_audio(chunk.audio)
        now = time.monotonic()
        if chunk.rms >= self._config.continue_threshold:
            self._speech_chunks += 1
            self._last_speech_at = now

        if self._speech_chunks == 0:
            if now - self._turn_started_at >= self._config.initial_silence_timeout:
                await self._end_turn("initial_silence_timeout")
            return

        if self._speech_chunks >= self._config.min_speech_chunks:
            if now - self._last_speech_at >= self._config.end_silence_timeout:
                await self._end_turn("vad_end")
                return

        if now - self._turn_started_at >= self._config.max_turn_seconds:
            await self._end_turn("max_turn_timeout")

    async def _begin_turn(self, *, interrupt: bool) -> None:
        if self._ws is None or self._turn_active:
            return
        if interrupt:
            LOG.info("Interrupting local playback on user speech")
            await self._player.stop()
            self._assistant_active = False
            self._assistant_audio_active = False
            self._reset_playback_floor()
            await self._send_json({"type": "interrupt"})

        await self._send_json({"type": "turn.start"})
        self._turn_active = True
        self._turn_started_at = time.monotonic()
        self._last_speech_at = self._turn_started_at
        self._speech_chunks = 0

        buffered = list(self._preroll)
        self._preroll.clear()
        for item in buffered:
            await self._send_audio(item.audio)
            if item.rms >= self._config.continue_threshold:
                self._speech_chunks += 1
                self._last_speech_at = time.monotonic()
        LOG.info("Started turn with %s preroll chunks", len(buffered))

    async def _end_turn(self, reason: str) -> None:
        if self._ws is None or not self._turn_active:
            return
        await self._send_json({"type": "turn.end", "reason": reason})
        LOG.info("Ended turn: %s", reason)
        self._turn_active = False
        self._speech_chunks = 0
        self._turn_started_at = 0.0
        self._last_speech_at = 0.0

    async def _send_audio(self, audio: bytes) -> None:
        await self._send_json({"type": "audio", "audio": _encode_audio(audio)})

    async def _send_json(self, payload: dict[str, Any]) -> None:
        async with self._send_lock:
            if self._ws is None:
                return
            await self._ws.send(json.dumps(payload))

    def _ensure_capture_thread(self) -> None:
        if self._capture_thread is not None:
            return
        self._capture_thread = threading.Thread(target=self._capture_microphone, daemon=True)
        self._capture_thread.start()

    def _capture_microphone(self) -> None:
        microphone = sc.default_microphone()
        LOG.info("Using microphone: %s", microphone.name)
        with microphone.recorder(samplerate=self._config.sample_rate, channels=1, blocksize=self._config.block_size) as mic:
            while not self._capture_stop.is_set():
                frames = mic.record(self._config.block_size).reshape(-1)
                rms = float(np.sqrt(np.mean(np.square(frames, dtype=np.float32))))
                audio = (np.clip(frames, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
                item = AudioChunk(audio=audio, rms=rms, captured_at=time.monotonic())
                try:
                    self._capture_queue.put_nowait(item)
                except Full:
                    try:
                        self._capture_queue.get_nowait()
                    except Empty:
                        pass
                    try:
                        self._capture_queue.put_nowait(item)
                    except Full:
                        continue

    def _next_chunk(self) -> AudioChunk | None:
        try:
            return self._capture_queue.get(timeout=1.0)
        except Empty:
            return None

    def _update_playback_floor(self, rms: float) -> None:
        if not self._assistant_audio_active or self._turn_active:
            self._reset_playback_floor()
            return
        if rms <= 0.0:
            return
        if self._playback_floor_samples == 0:
            self._playback_floor = rms
            self._playback_floor_samples = 1
            return
        if self._playback_floor_samples < 12:
            self._playback_floor = max(self._playback_floor, rms)
            self._playback_floor_samples += 1
            return
        if rms < self._playback_floor * 0.85:
            self._playback_floor = (self._playback_floor * 0.98) + (rms * 0.02)

    def _reset_playback_floor(self) -> None:
        self._playback_floor = 0.0
        self._playback_floor_samples = 0

    def _reset_turn_state(self) -> None:
        self._turn_active = False
        self._assistant_active = False
        self._assistant_audio_active = False
        self._speech_chunks = 0
        self._activation_chunks = 0
        self._preroll.clear()
        self._reset_playback_floor()


def load_config() -> ClientConfig:
    hostname = socket.gethostname()
    return ClientConfig(
        hub_url=os.getenv("HUB_WS_URL", "ws://192.168.1.220:8787/"),
        device_id=os.getenv("DEVICE_ID", hostname),
        device_name=os.getenv("DEVICE_NAME", f"Opanhome Realtime Client ({hostname})"),
        conversation_id=os.getenv("CONVERSATION_ID") or None,
        sample_rate=int(os.getenv("MIC_SAMPLE_RATE", "16000")),
        block_size=int(os.getenv("MIC_BLOCK_SIZE", "512")),
        start_threshold=float(os.getenv("VOICE_START_THRESHOLD", "0.010")),
        continue_threshold=float(os.getenv("VOICE_CONTINUE_THRESHOLD", "0.008")),
        interrupt_ratio=float(os.getenv("VOICE_INTERRUPT_RATIO", "1.05")),
        start_chunks=int(os.getenv("VOICE_START_CHUNKS", "2")),
        min_speech_chunks=int(os.getenv("VOICE_MIN_SPEECH_CHUNKS", "3")),
        initial_silence_timeout=float(os.getenv("VOICE_INITIAL_SILENCE_TIMEOUT_SECONDS", "1.5")),
        end_silence_timeout=float(os.getenv("VOICE_END_SILENCE_TIMEOUT_SECONDS", "0.7")),
        max_turn_seconds=float(os.getenv("VOICE_MAX_TURN_SECONDS", "20")),
        preroll_chunks=int(os.getenv("VOICE_PREROLL_CHUNKS", "20")),
        reconnect_delay=float(os.getenv("RECONNECT_DELAY_SECONDS", "2.0")),
        ffplay_bin=os.getenv("FFPLAY_BIN", "/usr/bin/ffplay"),
        ffplay_log_level=os.getenv("FFPLAY_LOG_LEVEL", "error"),
        ffplay_volume=float(os.getenv("PLAYBACK_VOLUME", "1.0")),
    )


def configure_logging() -> None:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


async def _main() -> None:
    configure_logging()
    client = PiRealtimeVoiceClient(load_config())
    try:
        await client.run()
    finally:
        await client.aclose()


def main() -> None:
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        return


def _encode_audio(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _decode_audio(value: str) -> bytes:
    return base64.b64decode(value) if value else b""


if __name__ == "__main__":
    main()
