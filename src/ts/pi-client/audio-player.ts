import type { ChildProcessByStdio } from "node:child_process";
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";

export class StreamingAudioPlayer {
  private process: ChildProcessByStdio<Writable, null, Readable> | null = null;

  constructor(private readonly command: string[]) {}

  start(): void {
    this.stop();
    const [bin, ...args] = this.command;
    this.process = spawn(bin as string, args, {
      stdio: ["pipe", "ignore", "pipe"],
    });
    this.process.stderr.on("data", (raw: Buffer) => {
      const message = raw.toString("utf8").trim();
      if (message) {
        console.error(`[player] ${message}`);
      }
    });
  }

  write(chunk: Buffer): void {
    if (!this.process || !this.process.stdin.writable) {
      return;
    }
    this.process.stdin.write(chunk);
  }

  finish(): void {
    if (!this.process || !this.process.stdin.writable) {
      return;
    }
    this.process.stdin.end();
  }

  stop(): void {
    if (!this.process) {
      return;
    }
    this.process.kill("SIGKILL");
    this.process = null;
  }
}
