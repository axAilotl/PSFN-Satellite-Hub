import fs from "node:fs";
import https from "node:https";
import type { IncomingMessage } from "node:http";

import type { ConversationMessage } from "./session-store.js";
import type { PsfnChannelContext } from "./embodied-session.js";
import type { AgentRuntimeAdapter } from "./agent-runtime.js";
import type { PsfnRuntimeConfig } from "../shared/env.js";
import {
  buildSatelliteClaimEnvelope,
  buildSatelliteRegistryHeaders,
  defaultCapabilitiesForProfile,
  type SatelliteClaimEnvelope,
} from "./satellite-claim.js";

interface CompletionResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  chunks(): AsyncIterable<Uint8Array>;
}

const DEFAULT_SYSTEM_PROMPT =
  "Reply as plain spoken dialogue only, in one short sentence unless the user explicitly asks for more. "
  + "Do not use roleplay actions, stage directions, emotes, asterisks, markdown, narration, or scene-setting. "
  + "Do not call tools. Do not add preambles, summaries, or extra reassurance.";

export class PsfnModelAdapter implements AgentRuntimeAdapter {
  private readonly apiBaseUrl: string;

  constructor(private readonly runtime: PsfnRuntimeConfig) {
    const baseUrl = runtime.baseUrl.replace(/\/$/, "");
    this.apiBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  }

  async *streamReply(input: {
    userText: string;
    conversationId?: string;
    history?: ConversationMessage[];
    channel?: PsfnChannelContext;
  }): AsyncGenerator<string, string, void> {
    const conversationId = input.conversationId?.trim();
    if (!conversationId) {
      throw new Error("PSFN conversation ID is required for the satellite claim registry bridge");
    }
    const channel = input.channel ?? buildDefaultChannelContext(this.runtime.satelliteClaim, conversationId);
    const satelliteClaim = buildSatelliteClaimEnvelope({
      config: this.runtime.satelliteClaim,
      conversationId,
      channel,
      apiKey: this.runtime.apiKey,
    });
    const response = await this.postChatCompletion(
      this.buildHeaders(channel, satelliteClaim),
      JSON.stringify({
        model: this.runtime.model,
        stream: true,
        max_tokens: 80,
        system_prompt_mode: "custom",
        system_prompt: DEFAULT_SYSTEM_PROMPT,
        response_style: "concise",
        user: conversationId,
        satellite_claim: satelliteClaim,
        messages: this.buildMessages(input.history ?? [], input.userText),
      }),
    );

    if (!response.ok) {
      throw new Error(await formatError(response));
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    for await (const value of response.chunks()) {
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary < 0) break;
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const lines = rawEvent
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          const delta = extractDelta(payload);
          if (!delta) continue;
          fullText += delta;
          yield delta;
        }
      }
    }

    return fullText.trim();
  }

  async close(): Promise<void> {}

  private async postChatCompletion(headers: Record<string, string>, body: string): Promise<CompletionResponse> {
    const url = `${this.apiBaseUrl}/chat/completions`;
    const tls = this.runtime.satelliteClaim.tls;
    if (tls?.certPath && tls.keyPath) {
      return this.postChatCompletionWithClientCertificate(url, headers, body, tls);
    }
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
    });
    return {
      ok: response.ok,
      status: response.status,
      text: () => response.text(),
      chunks: async function* chunks() {
        if (!response.body) {
          throw new Error("PSFN chat completion response did not include a body");
        }
        const reader = response.body.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          yield value;
        }
      },
    };
  }

  private async postChatCompletionWithClientCertificate(
    rawUrl: string,
    headers: Record<string, string>,
    body: string,
    tls: NonNullable<PsfnRuntimeConfig["satelliteClaim"]["tls"]>,
  ): Promise<CompletionResponse> {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") {
      throw new Error("PSFN_CLIENT_CERT_PATH requires an https PSFN_API_BASE_URL");
    }
    return await new Promise<CompletionResponse>((resolve, reject) => {
      const request = https.request(
        url,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Length": Buffer.byteLength(body).toString(),
          },
          cert: fs.readFileSync(requiredPath(tls.certPath, "PSFN_CLIENT_CERT_PATH")),
          key: fs.readFileSync(requiredPath(tls.keyPath, "PSFN_CLIENT_KEY_PATH")),
          ...(tls.caPath ? { ca: fs.readFileSync(tls.caPath) } : {}),
        },
        (message) => {
          resolve(responseFromIncomingMessage(message));
        },
      );
      request.on("error", reject);
      request.write(body);
      request.end();
    });
  }

  private buildHeaders(channel: PsfnChannelContext, satelliteClaim: SatelliteClaimEnvelope): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.runtime.apiKey) {
      headers.Authorization = `Bearer ${this.runtime.apiKey}`;
    }
    headers["X-PSFN-Channel-Type"] = channel.channelType;
    headers["X-PSFN-Channel-ID"] = channel.channelId;
    headers["X-PSFN-Satellite-ID"] = channel.sourceSatelliteId;
    headers["X-PSFN-Satellite-Name"] = channel.sourceSatelliteName;
    Object.assign(headers, buildSatelliteRegistryHeaders({
      config: this.runtime.satelliteClaim,
      satelliteClaim,
    }));
    headers["X-PSFN-Satellite-Claim"] = JSON.stringify(satelliteClaim);
    headers["X-PSFN-Channel-Metadata"] = JSON.stringify({
      sessionId: channel.sessionId,
      sourceSatelliteId: channel.sourceSatelliteId,
      sourceSatelliteName: channel.sourceSatelliteName,
      activeSatellites: channel.activeSatellites,
      satelliteClaim,
    });
    return headers;
  }

  private buildMessages(history: ConversationMessage[], userText: string): Array<{ role: "user" | "assistant"; content: string }> {
    const messages = history
      .filter((message) => message.content.trim().length > 0)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));
    if (!messages.length || messages[messages.length - 1]?.content !== userText) {
      messages.push({ role: "user", content: userText });
    }
    return messages;
  }
}

function buildDefaultChannelContext(config: PsfnRuntimeConfig["satelliteClaim"], conversationId: string): PsfnChannelContext {
  const channelId = deriveChannelId(config.channelType, conversationId);
  const capabilities = defaultCapabilitiesForProfile(config.capabilityProfile);
  return {
    sessionId: conversationId,
    channelType: config.channelType,
    channelId,
    sourceSatelliteId: config.satelliteId,
    sourceSatelliteName: config.displayName,
    activeSatellites: [
      {
        id: config.satelliteId,
        name: config.displayName,
        transport: "websocket",
        capabilities,
      },
    ],
  };
}

function deriveChannelId(channelType: string, conversationId: string): string {
  const normalized = conversationId.trim();
  if (!normalized) {
    throw new Error("PSFN conversation ID is required for channel derivation");
  }
  if (normalized.startsWith(`${channelType}:`)) {
    return normalized;
  }
  return `${channelType}:${normalized}`;
}

function extractDelta(payload: string): string {
  const parsed = JSON.parse(payload) as {
    choices?: Array<{
      delta?: { content?: string; role?: string };
      message?: { content?: string };
      text?: string;
    }>;
  };
  const firstChoice = parsed.choices?.[0];
  if (!firstChoice) return "";
  if (typeof firstChoice.delta?.content === "string") return firstChoice.delta.content;
  if (typeof firstChoice.message?.content === "string") return firstChoice.message.content;
  if (typeof firstChoice.text === "string") return firstChoice.text;
  return "";
}

async function formatError(response: CompletionResponse): Promise<string> {
  const body = (await response.text()).trim();
  if (body) {
    return `PSFN chat completion failed (${response.status}): ${body}`;
  }
  return `PSFN chat completion failed (${response.status})`;
}

function responseFromIncomingMessage(message: IncomingMessage): CompletionResponse {
  return {
    ok: Boolean(message.statusCode && message.statusCode >= 200 && message.statusCode < 300),
    status: message.statusCode ?? 0,
    text: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of message) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString("utf8");
    },
    chunks: async function* chunks() {
      for await (const chunk of message) {
        yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      }
    },
  };
}

function requiredPath(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required when PSFN client certificate auth is configured`);
  }
  return value;
}
