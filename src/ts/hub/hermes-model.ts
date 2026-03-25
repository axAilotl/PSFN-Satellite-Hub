import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";

import type { HermesRuntimeConfig } from "../shared/env.js";
import { AsyncQueue } from "../shared/async-queue.js";
import type { ConversationMessage } from "./session-store.js";

interface WorkerMessage {
  request_id: string;
  type: "delta" | "done" | "error";
  text?: string;
  error?: string;
}

export class HermesModelAdapter {
  private process: ChildProcessWithoutNullStreams | null = null;
  private readonly queues = new Map<string, AsyncQueue<WorkerMessage>>();

  constructor(private readonly runtime: HermesRuntimeConfig) {}

  async *streamReply(input: {
    history: ConversationMessage[];
    userText: string;
    conversationId?: string;
  }): AsyncGenerator<string, string, void> {
    await this.ensureStarted();
    const requestId = randomUUID();
    const queue = new AsyncQueue<WorkerMessage>();
    this.queues.set(requestId, queue);

    this.writeJson({
      command: "reply",
      request_id: requestId,
      hermes_home: this.runtime.hermesHome,
      model_name: this.runtime.model,
      conversation_id: input.conversationId || `voice-${requestId}`,
      text: input.userText,
      history: input.history,
    });

    let fullText = "";
    let sawDelta = false;

    try {
      for await (const message of queue) {
        if (message.type === "delta") {
          const delta = String(message.text || "");
          if (!delta) {
            continue;
          }
          sawDelta = true;
          fullText += delta;
          yield delta;
          continue;
        }
        if (message.type === "done") {
          const doneText = String(message.text || "");
          if (!sawDelta && doneText) {
            fullText = doneText;
            yield doneText;
          }
          return fullText.trim();
        }
        if (message.type === "error") {
          throw new Error(String(message.error || "Hermes worker failed"));
        }
      }
    } finally {
      this.queues.delete(requestId);
    }

    return fullText.trim();
  }

  async close(): Promise<void> {
    for (const queue of this.queues.values()) {
      queue.push({
        request_id: "",
        type: "error",
        error: "Hermes worker closed",
      });
      queue.close();
    }
    this.queues.clear();

    const process = this.process;
    this.process = null;
    if (!process) {
      return;
    }
    process.stdin.end();
    process.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      process.once("close", () => resolve());
    });
  }

  private async ensureStarted(): Promise<void> {
    if (this.process && this.process.exitCode === null) {
      return;
    }

    const hermesRepo = path.join(this.runtime.hermesHome, "hermes-agent");
    const python = path.join(hermesRepo, "venv", "bin", "python");
    const process = spawn(python, ["-u", "-c", HERMES_STREAM_WORKER], {
      cwd: hermesRepo,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = process;

    const stdout = readline.createInterface({ input: process.stdout });
    stdout.on("line", (line) => {
      if (!line.startsWith("__HERMES_JSON__")) {
        return;
      }
      const raw = line.slice("__HERMES_JSON__".length);
      let message: WorkerMessage;
      try {
        message = JSON.parse(raw) as WorkerMessage;
      } catch {
        return;
      }
      const queue = this.queues.get(message.request_id);
      if (queue) {
        queue.push(message);
        if (message.type !== "delta") {
          queue.close();
        }
      }
    });

    const stderr = readline.createInterface({ input: process.stderr });
    stderr.on("line", (line) => {
      if (line.trim()) {
        console.error(`[hermes-worker] ${line}`);
      }
    });

    process.once("close", () => {
      for (const queue of this.queues.values()) {
        queue.push({
          request_id: "",
          type: "error",
          error: "Hermes worker exited",
        });
        queue.close();
      }
      this.queues.clear();
      this.process = null;
    });
  }

  private writeJson(payload: Record<string, unknown>): void {
    if (!this.process || this.process.exitCode !== null) {
      throw new Error("Hermes worker is not running");
    }
    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }
}

const HERMES_STREAM_WORKER = String.raw`
import json
import os
import sys
from pathlib import Path

_loaded_home = None


def _emit(message):
    sys.stdout.write("__HERMES_JSON__" + json.dumps(message) + "\n")
    sys.stdout.flush()


def _ensure_home(hermes_home_value: str):
    global _loaded_home
    hermes_home = Path(hermes_home_value).expanduser()
    if _loaded_home == hermes_home:
        return
    os.environ["HERMES_HOME"] = str(hermes_home)

    from dotenv import load_dotenv

    load_dotenv(hermes_home / ".env", override=True, encoding="utf-8")
    repo = hermes_home / "hermes-agent"
    if str(repo) not in sys.path:
        sys.path.insert(0, str(repo))
    _loaded_home = hermes_home


for raw_line in sys.stdin:
    if not raw_line.strip():
        continue
    payload = json.loads(raw_line)
    request_id = payload["request_id"]
    try:
        _ensure_home(payload["hermes_home"])
        import run_agent

        def _stream(delta):
            if not delta:
                return
            _emit({
                "request_id": request_id,
                "type": "delta",
                "text": delta,
            })

        agent = run_agent.AIAgent(
            model=payload["model_name"],
            quiet_mode=True,
            skip_context_files=True,
            skip_memory=True,
            max_iterations=10,
            enabled_toolsets=["__none__"],
        )
        result = agent.run_conversation(
            user_message=payload["text"],
            conversation_history=payload.get("history") or [],
            task_id=payload.get("conversation_id"),
            stream_callback=_stream,
        )
        _emit({
            "request_id": request_id,
            "type": "done",
            "text": result.get("final_response", ""),
        })
    except Exception as exc:
        _emit({
            "request_id": request_id,
            "type": "error",
            "error": str(exc),
        })
`;
