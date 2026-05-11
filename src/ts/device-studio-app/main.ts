import {
  createBehaviorPlayback,
  createFixtureBehaviorLibrary,
  exportBehaviorTimeline,
  importBehaviorLibraryJson,
  sampleBehaviorRenderState,
  type BehaviorEvent,
  type BehaviorLibrary,
  type BehaviorLibraryEntry,
  type BehaviorPlayback,
  type NormalizedBehaviorRenderState,
} from "../device-studio/behavior.js";
import type { BehaviorTimeline, DeviceProfile, HardwareVerification } from "../device-studio/model.js";
import {
  stackChanProfile,
  waveshareEsp32S3RoundTouchProfile,
  type ConcreteDeviceProfile,
} from "../device-studio/profiles.js";
import {
  DeviceStudioHubClient,
  type DeviceStudioConnectionState,
  type DeviceStudioTransportMode,
  type DeviceStudioTransportSnapshot,
  type DeviceStudioTransportUnsubscribe,
} from "../device-studio/transport.js";
import {
  DeviceStudioAppEventLog,
  formatDeviceStudioEventForClipboard,
  type DeviceStudioAppEventInput,
} from "./event-log.js";

type ProfileId = "stack-chan" | "waveshare-round";

interface DeviceProfileOption {
  id: ProfileId;
  label: string;
  summary: string;
  previewMeta: string;
  caption: string;
  previewKey: string;
  profile: ConcreteDeviceProfile;
}

const profiles: Record<ProfileId, DeviceProfileOption> = {
  "stack-chan": {
    id: "stack-chan",
    label: "Stack-chan bench",
    summary: "M5Stack Stack-chan reference profile",
    previewMeta: "320 x 240 / pan + tilt",
    caption: "Screen, face, motion, and status preview surface",
    previewKey: "stack-chan",
    profile: stackChanProfile,
  },
  "waveshare-round": {
    id: "waveshare-round",
    label: "Waveshare round LCD",
    summary: "Waveshare ESP32-S3 round LCD profile",
    previewMeta: "360 x 360 / touch",
    caption: "Round LCD expression and touch preview surface",
    previewKey: "waveshare-round",
    profile: waveshareEsp32S3RoundTouchProfile,
  },
};

const state = {
  profileId: "stack-chan" as ProfileId,
  backendMode: "mock" as DeviceStudioTransportMode,
  selectedBehaviorId: "behavior.neutral",
};

let behaviorLibrary: BehaviorLibrary = createFixtureBehaviorLibrary();
let hubClient: DeviceStudioHubClient | null = null;
let hubClientConfigKey = "";
let hubUnsubscribes: DeviceStudioTransportUnsubscribe[] = [];
let activePlayback: BehaviorPlayback | null = null;

const operationalLog = new DeviceStudioAppEventLog();

function requireElement<T extends HTMLElement>(id: string, type: { new(): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`Missing #${id}`);
  }
  return element;
}

const profileSelect = requireElement("profile-select", HTMLSelectElement);
const profileSummary = requireElement("profile-summary", HTMLParagraphElement);
const connectionBadge = requireElement("connection-badge", HTMLDivElement);
const connectionLabel = requireElement("connection-label", HTMLSpanElement);
const controlModeLabel = requireElement("control-mode-label", HTMLSpanElement);
const connectionStateValue = requireElement("connection-state-value", HTMLElement);
const sessionValue = requireElement("session-value", HTMLElement);
const activeProfileValue = requireElement("active-profile-value", HTMLElement);
const logCountValue = requireElement("log-count-value", HTMLElement);
const previewCaption = requireElement("preview-caption", HTMLParagraphElement);
const previewMeta = requireElement("preview-meta", HTMLDivElement);
const previewStage = requireElement("preview-stage", HTMLDivElement);
const expressionValue = requireElement("expression-value", HTMLElement);
const visemeValue = requireElement("viseme-value", HTMLElement);
const motionValue = requireElement("motion-value", HTMLElement);
const behaviorList = requireElement("behavior-list", HTMLDivElement);
const frameLane = requireElement("frame-lane", HTMLDivElement);
const eventLog = requireElement("event-log", HTMLOListElement);
const commandInput = requireElement("command-input", HTMLTextAreaElement);
const hubUrl = requireElement("hub-url", HTMLInputElement);
const connectButton = requireElement("connect-button", HTMLButtonElement);
const pingButton = requireElement("ping-button", HTMLButtonElement);
const interruptButton = requireElement("interrupt-button", HTMLButtonElement);
const sendCommandButton = requireElement("send-command-button", HTMLButtonElement);
const draftCommandButton = requireElement("draft-command-button", HTMLButtonElement);
const importBehaviorButton = requireElement("import-behavior-button", HTMLButtonElement);
const importBehaviorFile = requireElement("import-behavior-file", HTMLInputElement);
const exportBehaviorButton = requireElement("export-behavior-button", HTMLButtonElement);
const playButton = requireElement("play-button", HTMLButtonElement);
const stopButton = requireElement("stop-button", HTMLButtonElement);
const copyLogButton = requireElement("copy-log-button", HTMLButtonElement);
const exportLogButton = requireElement("export-log-button", HTMLButtonElement);

function selectedProfileOption(): DeviceProfileOption {
  return profiles[state.profileId];
}

function selectedProfile(): DeviceProfile {
  return selectedProfileOption().profile;
}

function behaviorEntries(): BehaviorLibraryEntry[] {
  return behaviorLibrary.list({ profile: selectedProfile(), includeIncompatible: true });
}

function selectedBehaviorEntry(): BehaviorLibraryEntry {
  const entries = behaviorEntries();
  const selected = entries.find((entry) => entry.id === state.selectedBehaviorId) ?? entries[0];
  if (!selected) {
    throw new Error("Behavior library is empty");
  }
  if (selected.id !== state.selectedBehaviorId) {
    state.selectedBehaviorId = selected.id;
  }
  return selected;
}

function selectedBehaviorTimeline(): BehaviorTimeline {
  return behaviorLibrary.require(selectedBehaviorEntry().id);
}

function selectedRenderState(elapsedMs = 0): NormalizedBehaviorRenderState {
  return sampleBehaviorRenderState(selectedBehaviorTimeline(), elapsedMs, { profile: selectedProfile() });
}

function activeSnapshot(): DeviceStudioTransportSnapshot | null {
  return hubClient?.snapshot() ?? null;
}

function activeSessionContext(): Pick<DeviceStudioAppEventInput, "mode" | "state" | "profileId" | "sessionId" | "channelId"> {
  const snapshot = activeSnapshot();
  return {
    mode: state.backendMode,
    state: snapshot?.state,
    profileId: selectedProfile().id,
    sessionId: snapshot?.session.sessionId,
    channelId: snapshot?.session.channelId,
  };
}

function recordEvent(input: DeviceStudioAppEventInput): void {
  operationalLog.append(input);
  renderEventLog();
}

function recordBehaviorEvent(event: BehaviorEvent): void {
  const context = activeSessionContext();
  operationalLog.appendBehaviorEvent(event, {
    mode: context.mode,
    profileId: context.profileId,
    sessionId: context.sessionId,
    channelId: context.channelId,
  });
  renderEventLog();
}

function recordHardwareVerification(subject: "profile" | "behavior"): void {
  const profile = selectedProfileOption().profile;
  const entry = selectedBehaviorEntry();
  const payload = subject === "profile"
    ? {
        profile: verificationPayload(profile.id, profile.name, profile.hardwareVerification),
      }
    : {
        profile: verificationPayload(profile.id, profile.name, profile.hardwareVerification),
        behavior: verificationPayload(entry.id, entry.name, entry.timeline.hardwareVerification),
        compatible: entry.compatible,
        ignoredChannels: entry.ignoredChannels,
      };
  recordEvent({
    ...activeSessionContext(),
    source: "hardware verification",
    kind: `hardware.${subject}`,
    summary: subject === "profile" ? profile.hardwareVerification.status : entry.timeline.hardwareVerification.status,
    payload,
  });
}

function verificationPayload(id: string, name: string, verification: HardwareVerification): unknown {
  return {
    id,
    name,
    status: verification.status,
    label: verification.label,
    verifiedAt: verification.verifiedAt,
    verifiedBy: verification.verifiedBy,
    notes: verification.notes,
  };
}

function renderProfile(): void {
  const option = selectedProfileOption();
  profileSummary.textContent = `${option.summary} / ${state.backendMode} backend`;
  previewCaption.textContent = option.caption;
  previewMeta.textContent = option.previewMeta;
  previewStage.dataset.profile = option.previewKey;
  activeProfileValue.textContent = option.profile.id;
}

function renderMode(): void {
  const snapshot = activeSnapshot();
  const connectionState: DeviceStudioConnectionState = snapshot?.state ?? "idle";
  const ready = snapshot?.ready ?? false;
  const connected = connectionState === "connected" || connectionState === "ready";
  const modeLabel = state.backendMode === "mock" ? "Mock" : "Live";

  connectionBadge.dataset.mode = state.backendMode;
  connectionBadge.dataset.connected = String(connected);
  connectionLabel.textContent = `${modeLabel} ${ready ? "ready" : connectionState}`;
  controlModeLabel.textContent = `${modeLabel} backend`;
  connectionStateValue.textContent = connectionState;
  sessionValue.textContent = snapshot?.session.sessionId ?? "not attached";
  connectButton.textContent = connected ? "Disconnect" : "Connect";
  pingButton.disabled = !connected;
  interruptButton.disabled = !connected;
}

function renderBehavior(): void {
  const renderState = selectedRenderState();
  applyRenderStateToPreview(renderState);
  renderFrameLane();
}

function applyRenderStateToPreview(renderState: NormalizedBehaviorRenderState): void {
  expressionValue.textContent = renderState.expression?.id ?? "None";
  visemeValue.textContent = renderState.viseme?.id ?? "Rest";
  motionValue.textContent = formatMotion(renderState);
  previewStage.dataset.expression = renderState.expression?.id ?? "neutral";
  previewStage.dataset.hardwareVerified = String(renderState.hardwareVerified);
}

function renderFrameLane(): void {
  const timeline = selectedBehaviorTimeline();
  const durationMs = Math.max(timeline.durationMs ?? 0, ...timeline.frames.map((frame) => frame.atMs), 1);
  frameLane.replaceChildren(...timeline.frames.map((frame, index) => {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "frame-marker";
    marker.style.left = `${Math.min(96, Math.max(4, (frame.atMs / durationMs) * 100))}%`;
    marker.textContent = String(index + 1);
    marker.setAttribute("aria-label", `Frame ${index + 1} at ${frame.atMs} milliseconds`);
    marker.addEventListener("click", () => applyBehaviorFrame(frame.atMs));
    return marker;
  }));
}

function renderBehaviorList(): void {
  const entries = behaviorEntries();
  if (entries.length === 0) {
    behaviorList.replaceChildren();
    return;
  }
  selectedBehaviorEntry();
  behaviorList.replaceChildren(...entries.map((entry) => {
    const renderState = sampleBehaviorRenderState(behaviorLibrary.require(entry.id), 0, { profile: selectedProfile() });
    const button = document.createElement("button");
    button.type = "button";
    button.className = "behavior-card";
    button.dataset.selected = String(entry.id === state.selectedBehaviorId);
    const label = document.createElement("strong");
    label.textContent = entry.name;
    const stateLine = document.createElement("span");
    stateLine.textContent = `${renderState.expression?.id ?? "none"} / ${renderState.viseme?.id ?? "rest"}`;
    const provenance = document.createElement("small");
    provenance.textContent = `${entry.provenanceSource}${entry.hardwareVerified ? " / hardware verified" : " / unverified"}`;
    button.append(label, stateLine, provenance);
    button.addEventListener("click", () => {
      stopActivePlayback("behavior changed");
      state.selectedBehaviorId = entry.id;
      renderBehaviorList();
      renderBehavior();
      recordEvent({
        ...activeSessionContext(),
        source: "behavior",
        kind: "behavior.select",
        summary: entry.name,
        payload: {
          id: entry.id,
          name: entry.name,
          provenanceSource: entry.provenanceSource,
          hardwareVerificationStatus: entry.hardwareVerificationStatus,
          compatible: entry.compatible,
          ignoredChannels: entry.ignoredChannels,
        },
      });
      recordHardwareVerification("behavior");
    });
    return button;
  }));
}

function renderEventLog(): void {
  const entries = [...operationalLog.entries].slice(-80);
  logCountValue.textContent = String(operationalLog.entries.length);
  eventLog.replaceChildren(...entries.map((entry) => {
    const item = document.createElement("li");
    item.dataset.source = entry.source;

    const meta = document.createElement("div");
    meta.className = "event-meta";

    const timeElement = document.createElement("time");
    timeElement.dateTime = entry.at;
    timeElement.textContent = new Date(entry.at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const sourceElement = document.createElement("span");
    sourceElement.className = "source-pill";
    sourceElement.textContent = entry.source;

    const directionElement = document.createElement("span");
    directionElement.className = "event-direction";
    directionElement.textContent = entry.direction ?? "internal";

    meta.append(timeElement, sourceElement, directionElement);

    const body = document.createElement("div");
    body.className = "event-body";

    const title = document.createElement("strong");
    title.textContent = entry.kind;

    const detailLine = document.createElement("span");
    detailLine.textContent = [
      entry.summary,
      entry.messageType,
      entry.profileId,
      entry.sessionId,
    ].filter(Boolean).join(" / ");

    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "JSON";
    const payload = document.createElement("pre");
    payload.textContent = JSON.stringify(entry, null, 2);
    details.append(summary, payload);

    body.append(title, detailLine, details);
    item.append(meta, body);
    return item;
  }));
  eventLog.scrollTop = eventLog.scrollHeight;
}

function render(): void {
  renderProfile();
  renderMode();
  renderBehaviorList();
  renderBehavior();
  renderEventLog();
}

function ensureHubClient(): DeviceStudioHubClient {
  const snapshot = hubClient?.snapshot();
  if (hubClient && snapshot?.mode === state.backendMode && hubClientConfigKey === desiredHubClientConfigKey()) {
    return hubClient;
  }

  replaceHubClient();
  if (!hubClient) {
    throw new Error("Device Studio hub client was not initialized");
  }
  return hubClient;
}

function replaceHubClient(): void {
  const previous = hubClient;
  if (previous && isActiveConnectionState(previous.snapshot().state)) {
    previous.disconnect();
  }
  for (const unsubscribe of hubUnsubscribes) {
    unsubscribe();
  }
  hubUnsubscribes = [];

  const profile = selectedProfile();
  hubClientConfigKey = desiredHubClientConfigKey();
  hubClient = new DeviceStudioHubClient({
    mode: state.backendMode,
    url: hubUrl.value,
    profile,
    mock: {
      assistantText: `Mock ${selectedProfileOption().label} response from Device Studio.`,
      assistantLiveDeltas: ["Mock transport ", "accepted the typed turn."],
    },
  });
  hubUnsubscribes = [
    hubClient.on("log", (entry) => {
      const snapshot = activeSnapshot();
      operationalLog.appendTransportLog(entry, {
        mode: snapshot?.mode ?? state.backendMode,
        profileId: entry.profileId ?? profile.id,
        sessionId: entry.sessionId ?? snapshot?.session.sessionId,
        channelId: entry.channelId ?? snapshot?.session.channelId,
      });
      renderMode();
      renderEventLog();
    }),
    hubClient.on("state", () => renderMode()),
    hubClient.on("error", () => renderMode()),
  ];

  recordEvent({
    ...activeSessionContext(),
    source: "transport",
    kind: "transport.client.ready",
    summary: `${state.backendMode} adapter`,
    payload: hubClient.snapshot().hello,
  });
}

function desiredHubClientConfigKey(): string {
  const liveUrl = state.backendMode === "live" ? hubUrl.value.trim() : "mock";
  return `${state.backendMode}:${selectedProfile().id}:${liveUrl}`;
}

function isActiveConnectionState(connectionState: DeviceStudioConnectionState): boolean {
  return connectionState === "connecting" || connectionState === "connected" || connectionState === "ready";
}

async function toggleConnection(): Promise<void> {
  const client = ensureHubClient();
  const snapshot = client.snapshot();
  if (isActiveConnectionState(snapshot.state)) {
    client.disconnect();
    renderMode();
    return;
  }

  try {
    await client.connect();
    renderMode();
  } catch (error) {
    recordEvent({
      ...activeSessionContext(),
      source: "transport",
      kind: "transport.connect.failed",
      summary: error instanceof Error ? error.message : "Connection failed",
      error: error instanceof Error ? error.message : String(error),
    });
    renderMode();
  }
}

async function sendTypedTurn(): Promise<void> {
  const text = commandInput.value.trim();
  if (!text) {
    recordEvent({
      ...activeSessionContext(),
      source: "user",
      kind: "command.rejected",
      summary: "empty typed turn",
      payload: { text },
    });
    return;
  }

  const client = ensureHubClient();
  try {
    if (!isActiveConnectionState(client.snapshot().state)) {
      await client.connect();
    }
    client.sendUserText(text, { interrupt: true });
  } catch (error) {
    recordEvent({
      ...activeSessionContext(),
      source: "user",
      kind: "command.failed",
      summary: error instanceof Error ? error.message : "Command failed",
      error: error instanceof Error ? error.message : String(error),
      payload: { text },
    });
  }
}

function stopActivePlayback(reason: string): void {
  if (!activePlayback) {
    return;
  }
  activePlayback.stop(reason);
  activePlayback = null;
}

function createSelectedPlayback(): BehaviorPlayback {
  return createBehaviorPlayback({
    timeline: selectedBehaviorTimeline(),
    profile: selectedProfile(),
    emit: recordBehaviorEvent,
  });
}

function playSelectedBehavior(): void {
  stopActivePlayback("restarted");
  activePlayback = createSelectedPlayback();
  applyRenderStateToPreview(activePlayback.start(0));
}

function applyBehaviorFrame(elapsedMs: number): void {
  if (!activePlayback) {
    activePlayback = createSelectedPlayback();
    activePlayback.start(0);
  }
  applyRenderStateToPreview(activePlayback.sample(elapsedMs));
}

function formatMotion(renderState: NormalizedBehaviorRenderState): string {
  const joints = Object.entries(renderState.joints);
  if (joints.length > 0) {
    return joints.map(([id, state]) => `${id} ${state.value}`).join(" / ");
  }
  const ignoredJoint = renderState.ignoredChannels.find((channel) => channel.channel === "joints");
  if (ignoredJoint) {
    return ignoredJoint.targetId ? `Ignored ${ignoredJoint.targetId}` : "Motion ignored";
  }
  return "No active motion";
}

function createDraftCommand(): void {
  const entry = selectedBehaviorEntry();
  const option = selectedProfileOption();
  const channels = entry.supportedChannels.join(", ");
  commandInput.value = `Draft a ${entry.name} turn for ${option.label}. Use supported channels: ${channels}. Keep motion hardware-safe and report any unverified output before applying it.`;
  recordEvent({
    ...activeSessionContext(),
    source: "user",
    kind: "draft.generate",
    summary: entry.name,
    payload: {
      behaviorId: entry.id,
      profileId: option.profile.id,
      supportedChannels: entry.supportedChannels,
      ignoredChannels: entry.ignoredChannels,
    },
  });
}

function exportSelectedBehavior(): void {
  const timeline = selectedBehaviorTimeline();
  const json = exportBehaviorTimeline(timeline, { emit: recordBehaviorEvent, space: 2 });
  downloadText(`device-studio-${timeline.id}.json`, json, "application/json");
}

async function importBehaviorFileSelection(): Promise<void> {
  const file = importBehaviorFile.files?.[0];
  if (!file) {
    return;
  }
  try {
    const text = await file.text();
    behaviorLibrary = importBehaviorLibraryJson(text, { emit: recordBehaviorEvent });
    const first = behaviorEntries()[0];
    if (first) {
      state.selectedBehaviorId = first.id;
    }
    stopActivePlayback("imported library");
    renderBehaviorList();
    renderBehavior();
  } catch (error) {
    recordEvent({
      ...activeSessionContext(),
      source: "import/export",
      kind: "behavior.import.failed",
      summary: error instanceof Error ? error.message : "Import failed",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    importBehaviorFile.value = "";
  }
}

async function copyEventLog(): Promise<void> {
  const text = formatDeviceStudioEventForClipboard(operationalLog.entries);
  try {
    await navigator.clipboard.writeText(text);
    recordEvent({
      ...activeSessionContext(),
      source: "import/export",
      kind: "event-log.copy",
      summary: `${operationalLog.entries.length} entries`,
    });
  } catch (error) {
    recordEvent({
      ...activeSessionContext(),
      source: "import/export",
      kind: "event-log.copy.failed",
      summary: error instanceof Error ? error.message : "Copy failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function exportEventLog(): void {
  recordEvent({
    ...activeSessionContext(),
    source: "import/export",
    kind: "event-log.export",
    summary: `${operationalLog.entries.length} entries`,
  });
  downloadText("device-studio-event-log.json", operationalLog.toJson({ space: 2 }), "application/json");
}

function downloadText(filename: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

profileSelect.addEventListener("change", () => {
  stopActivePlayback("profile changed");
  state.profileId = profileSelect.value as ProfileId;
  replaceHubClient();
  renderProfile();
  renderBehaviorList();
  renderBehavior();
  renderMode();
  recordEvent({
    ...activeSessionContext(),
    source: "user",
    kind: "profile.select",
    summary: selectedProfileOption().label,
    payload: selectedProfile(),
  });
  recordHardwareVerification("profile");
});

document.querySelectorAll<HTMLInputElement>('input[name="backend-mode"]').forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked) {
      return;
    }
    state.backendMode = input.value as DeviceStudioTransportMode;
    replaceHubClient();
    renderProfile();
    renderMode();
    recordEvent({
      ...activeSessionContext(),
      source: "user",
      kind: "backend.mode",
      summary: state.backendMode,
      payload: { mode: state.backendMode },
    });
  });
});

hubUrl.addEventListener("change", () => {
  if (state.backendMode === "live") {
    replaceHubClient();
    renderMode();
  }
});

connectButton.addEventListener("click", () => {
  void toggleConnection();
});

pingButton.addEventListener("click", () => {
  try {
    ensureHubClient().ping();
  } catch (error) {
    recordEvent({
      ...activeSessionContext(),
      source: "user",
      kind: "ping.failed",
      summary: error instanceof Error ? error.message : "Ping failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

interruptButton.addEventListener("click", () => {
  try {
    ensureHubClient().interrupt();
  } catch (error) {
    recordEvent({
      ...activeSessionContext(),
      source: "user",
      kind: "interrupt.failed",
      summary: error instanceof Error ? error.message : "Interrupt failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

sendCommandButton.addEventListener("click", () => {
  void sendTypedTurn();
});

draftCommandButton.addEventListener("click", createDraftCommand);
importBehaviorButton.addEventListener("click", () => importBehaviorFile.click());
importBehaviorFile.addEventListener("change", () => {
  void importBehaviorFileSelection();
});
exportBehaviorButton.addEventListener("click", exportSelectedBehavior);

playButton.addEventListener("click", playSelectedBehavior);
stopButton.addEventListener("click", () => {
  stopActivePlayback("manual");
});

copyLogButton.addEventListener("click", () => {
  void copyEventLog();
});
exportLogButton.addEventListener("click", exportEventLog);

replaceHubClient();
render();
recordEvent({
  ...activeSessionContext(),
  source: "transport",
  kind: "studio.ready",
  summary: "operational panel initialized",
  payload: {
    mode: state.backendMode,
    profileId: selectedProfile().id,
    behaviorId: state.selectedBehaviorId,
  },
});
recordHardwareVerification("profile");
recordHardwareVerification("behavior");
