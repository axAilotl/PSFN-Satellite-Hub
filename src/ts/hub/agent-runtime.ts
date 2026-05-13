import type { PsfnChannelContext } from "./embodied-session.js";
import type { ConversationMessage } from "./session-store.js";
import type { RuntimeIdentity } from "../shared/protocol.js";

export interface AgentRuntimeAdapter {
  streamReply(input: {
    userText: string;
    conversationId?: string;
    history?: ConversationMessage[];
    channel?: PsfnChannelContext;
  }): AsyncGenerator<string, string, void>;

  getIdentity?(): Promise<RuntimeIdentity | null>;

  close(): Promise<void>;
}
