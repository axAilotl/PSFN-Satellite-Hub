import OpenAI from "openai";

import type { HermesRuntimeConfig } from "../shared/env.js";
import type { ConversationMessage } from "./session-store.js";

export class HermesModelAdapter {
  private readonly client: OpenAI;

  constructor(private readonly runtime: HermesRuntimeConfig) {
    this.client = new OpenAI({
      apiKey: runtime.apiKey,
      baseURL: runtime.baseUrl,
    });
  }

  async *streamReply(input: {
    history: ConversationMessage[];
    userText: string;
  }): AsyncGenerator<string, string, void> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content:
          "You are the conversational text core for a remote voice satellite. " +
          "Respond in one short spoken-friendly sentence unless the user explicitly asks for more. " +
          "Do not call tools. Do not use markdown. Do not add preambles or reassurance.",
      },
      ...input.history.map<OpenAI.Chat.Completions.ChatCompletionMessageParam>((message) => ({
        role: message.role,
        content: message.content,
      })),
      {
        role: "user",
        content: input.userText,
      },
    ];

    const stream = (await this.client.chat.completions.create({
      model: this.runtime.model,
      messages,
      stream: true,
      max_tokens: 96,
      reasoning: {
        enabled: false,
      },
    } as any)) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

    let fullText = "";
    for await (const chunk of stream) {
      for (const choice of chunk.choices) {
        const delta = choice.delta?.content;
        if (!delta) {
          continue;
        }
        const text = Array.isArray(delta)
          ? delta.map((part) => ("text" in part ? part.text : "")).join("")
          : String(delta);
        if (!text) {
          continue;
        }
        fullText += text;
        yield text;
      }
    }
    return fullText.trim();
  }
}
