export type ClientToHubMessage =
  | HelloMessage
  | TurnStartMessage
  | AudioMessage
  | TurnEndMessage
  | InterruptMessage
  | PingMessage;

export type HubToClientMessage =
  | SessionReadyMessage
  | HelloAckMessage
  | TurnStartedMessage
  | TranscriptFinalMessage
  | AssistantStartMessage
  | AssistantTextMessage
  | AssistantAudioStartMessage
  | AssistantAudioChunkMessage
  | AssistantAudioEndMessage
  | AssistantEndMessage
  | AssistantInterruptedMessage
  | TurnNoInputMessage
  | ErrorMessage
  | PongMessage;

export interface HelloMessage {
  type: "hello";
  deviceId: string;
  deviceName: string;
  sessionId?: string;
}

export interface TurnStartMessage {
  type: "turn.start";
  interrupt?: boolean;
}

export interface AudioMessage {
  type: "audio";
  audio: string;
}

export interface TurnEndMessage {
  type: "turn.end";
  reason: string;
}

export interface InterruptMessage {
  type: "interrupt";
}

export interface PingMessage {
  type: "ping";
  sentAt: number;
}

export interface SessionReadyMessage {
  type: "session.ready";
  sessionId: string;
  deviceId: string;
  deviceName: string;
  audioFormat: string;
}

export interface HelloAckMessage {
  type: "hello.ack";
  sessionId: string;
  deviceId: string;
  deviceName: string;
}

export interface TurnStartedMessage {
  type: "turn.started";
  sessionId: string;
  turnId: string;
}

export interface TranscriptFinalMessage {
  type: "transcript.final";
  sessionId: string;
  turnId: string;
  text: string;
  latencyMs: number;
  provider: string;
}

export interface AssistantStartMessage {
  type: "assistant.start";
  sessionId: string;
  turnId: string;
}

export interface AssistantTextMessage {
  type: "assistant.text";
  sessionId: string;
  turnId: string;
  delta: string;
}

export interface AssistantAudioStartMessage {
  type: "assistant.audio.start";
  sessionId: string;
  turnId: string;
  mimeType: string;
}

export interface AssistantAudioChunkMessage {
  type: "assistant.audio.chunk";
  sessionId: string;
  turnId: string;
  audio: string;
}

export interface AssistantAudioEndMessage {
  type: "assistant.audio.end";
  sessionId: string;
  turnId: string;
}

export interface AssistantEndMessage {
  type: "assistant.end";
  sessionId: string;
  turnId: string;
  text: string;
}

export interface AssistantInterruptedMessage {
  type: "assistant.interrupted";
  sessionId: string;
}

export interface TurnNoInputMessage {
  type: "turn.no_input";
  sessionId: string;
  turnId: string;
  reason: string;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export interface PongMessage {
  type: "pong";
  sentAt: number;
}

export function encodeAudioChunk(chunk: Buffer): string {
  return chunk.toString("base64");
}

export function decodeAudioChunk(encoded: string): Buffer {
  return Buffer.from(encoded, "base64");
}
