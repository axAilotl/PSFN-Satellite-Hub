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
import type { BehaviorTimeline, HardwareVerification } from "../device-studio/model.js";
import {
  concreteDeviceProfiles,
  getConcreteDeviceProfile,
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
  DisplayPreview,
  formatIgnoredChannels,
  formatProfilePreviewMeta,
  type DisplayTouchLogDetail,
} from "./display-preview.js";
import {
  DeviceStudioAppEventLog,
  formatDeviceStudioEventForClipboard,
  type DeviceStudioAppEventInput,
} from "./event-log.js";
import {
  StackChanPreview,
  type StackChanPreviewModel,
} from "./stackchan-preview.js";

declare global {
  interface Window {
    __deviceStudioPreviewSnapshot?: () => StackChanPreviewModel | undefined;
  }
}

interface StudioState {
  profileId: string;
  backendMode: DeviceStudioTransportMode;
  selectedBehaviorId: string;
  elapsedMs: number;
}

let behaviorLibrary: BehaviorLibrary = createFixtureBehaviorLibrary();
const firstProfile = requireFirst(concreteDeviceProfiles, "Device Studio requires at least one profile");
const firstBehavior = requireFirst(
  behaviorLibrary.list({ profile: firstProfile, includeIncompatible: true }),
  "Device Studio requires at least one behavior",
);

const state: StudioState = {
  profileId: firstProfile.id,
  backendMode: "mock",
  selectedBehaviorId: firstBehavior.id,
  elapsedMs: 0,
};

let hubClient: DeviceStudioHubClient | null = null;
let hubClientConfigKey = "";
let hubUnsubscribes: DeviceStudioTransportUnsubscribe[] = [];
let activePlayback: BehaviorPlayback | null = null;
let animationFrameId: number | undefined;
let playbackStartedAt = 0;
let lastStackChanModel: StackChanPreviewModel | undefined;
const operationalLog = new DeviceStudioAppEventLog();

function requireElement<T extends HTMLElement>(id: string, type: { new(): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`Missing #${id}`);
  }
  return element;
}

function requireFirst<T>(values: readonly T[], message: string): T {
  const first = values[0];
  if (!first) {
    throw new Error(message);
  }
  return first;
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
const displayPreviewRoot = requireElement("display-preview-root", HTMLDivElement);
const stackChanPreviewRoot = requireElement("stackchan-preview-root", HTMLDivElement);
const behaviorList = requireElement("behavior-list", HTMLDivElement);
const timeRuler = requireElement("time-ruler", HTMLDivElement);
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

const displayPreview = new DisplayPreview(displayPreviewRoot, {
  onTouch: (detail) => recordDisplayTouch(detail),
});
const stackChanPreview = new StackChanPreview(stackChanPreviewRoot);
window.__deviceStudioPreviewSnapshot = () => lastStackChanModel;

function selectedProfile(): ConcreteDeviceProfile {
  const profile = getConcreteDeviceProfile(state.profileId);
  if (!profile) {
    throw new Error(`Unknown profile ${state.profileId}`);
  }
  return profile;
}

function behaviorEntries(profile = selectedProfile()): BehaviorLibraryEntry[] {
  return behaviorLibrary.list({ profile, includeIncompatible: true });
}

function ensureSelectedBehavior(profile = selectedProfile()): void {
  const entries = behaviorEntries(profile);
  if (entries.some((entry) => entry.id === state.selectedBehaviorId)) {
    return;
  }
  state.selectedBehaviorId = requireFirst(entries, "No behaviors available for selected profile").id;
  state.elapsedMs = 0;
}

function selectedBehaviorEntry(): BehaviorLibraryEntry {
  ensureSelectedBehavior();
  const entry = behaviorEntries().find((candidate) => candidate.id === state.selectedBehaviorId);
  if (!entry) {
    throw new Error(`Unknown behavior ${state.selectedBehaviorId}`);
  }
  return entry;
}

function selectedBehaviorTimeline(): BehaviorTimeline {
  return behaviorLibrary.require(selectedBehaviorEntry().id);
}

function sampleSelectedBehavior(elapsedMs = state.elapsedMs): NormalizedBehaviorRenderState {
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

function recordDisplayTouch(detail: DisplayTouchLogDetail): void {
  recordEvent({
    ...activeSessionContext(),
    source: "user",
    kind: detail.type,
    summary: `${detail.gesture} ${detail.pixel.x},${detail.pixel.y}`,
    payload: detail,
  });
}

function recordHardwareVerification(subject: "profile" | "behavior"): void {
  const profile = selectedProfile();
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

function renderProfileOptions(): void {
  profileSelect.replaceChildren(...concreteDeviceProfiles.map((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    return option;
  }));
}

function renderProfile(): void {
  const profile = selectedProfile();
  profileSelect.value = profile.id;
  profileSummary.textContent = `${profile.name} / ${state.backendMode} backend`;
  previewCaption.textContent = profile.description;
  previewMeta.textContent = formatProfilePreviewMeta(profile);
  activeProfileValue.textContent = profile.id;
  previewStage.dataset.profile = profile.family;
  previewStage.dataset.hardware = profile.hardwareVerification.status;
  displayPreview.setProfile(profile);
}

function renderMode(): void {
  const snapshot = activeSnapshot();
  const connectionState: DeviceStudioConnectionState = snapshot?.state ?? "idle";
  const ready = snapshot?.ready ?? false;
  const connected = isActiveConnectionState(connectionState);
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
  applyRenderStateToPreview(sampleSelectedBehavior());
  renderFrameLane();
}

function applyRenderStateToPreview(renderState: NormalizedBehaviorRenderState): void {
  state.elapsedMs = renderState.elapsedMs;
  previewStage.dataset.hardwareVerified = String(renderState.hardwareVerified);
  displayPreview.render(renderState);
  lastStackChanModel = stackChanPreview.update(selectedProfile(), renderState);
}

function renderFrameLane(): void {
  const timeline = selectedBehaviorTimeline();
  const renderState = sampleSelectedBehavior();
  const durationMs = Math.max(renderState.durationMs, timeline.durationMs ?? 0, 1);
  timeRuler.replaceChildren(...[0, durationMs / 3, (durationMs * 2) / 3, durationMs].map((time) => {
    const marker = document.createElement("span");
    marker.textContent = `${Math.round(time)} ms`;
    return marker;
  }));
  frameLane.replaceChildren(...timeline.frames.map((frame, index) => {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "frame-marker";
    marker.style.left = `${Math.min(96, Math.max(4, (frame.atMs / durationMs) * 100))}%`;
    marker.textContent = String(index + 1);
    marker.dataset.active = String(renderState.activeFrame?.index === index);
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
  ensureSelectedBehavior();
  behaviorList.replaceChildren(...entries.map((entry) => {
    const renderState = sampleBehaviorRenderState(behaviorLibrary.require(entry.id), 0, { profile: selectedProfile() });
    const button = document.createElement("button");
    button.type = "button";
    button.className = "behavior-card";
    button.dataset.selected = String(entry.id === state.selectedBehaviorId);
    button.dataset.compatible = String(entry.compatible);
    const label = document.createElement("strong");
    label.textContent = entry.name;
    const stateLine = document.createElement("span");
    stateLine.textContent = [
      renderState.expression?.id ?? "none",
      renderState.viseme?.id ?? "rest",
      entry.supportedChannels.join(", ") || "no preview channels",
    ].join(" / ");
    const provenance = document.createElement("small");
    provenance.textContent = `${entry.provenanceSource} / ${entry.hardwareVerificationStatus}`;
    button.append(label, stateLine, provenance);
    if (entry.ignoredChannels.length > 0) {
      const ignored = document.createElement("small");
      ignored.className = "ignored-channel-note";
      ignored.textContent = `Drops ${formatIgnoredChannels(entry.ignoredChannels)}`;
      button.append(ignored);
    }
    button.addEventListener("click", () => {
      stopActivePlayback("behavior changed");
      state.selectedBehaviorId = entry.id;
      state.elapsedMs = 0;
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
  ensureSelectedBehavior();
  renderProfile();
  renderMode();
  renderBehaviorList();
  renderBehavior();
  renderEventLog();
}

function ensureHubClient(): DeviceStudioHubClient {
  if (hubClient && hubClient.snapshot().mode === state.backendMode && hubClientConfigKey === desiredHubClientConfigKey()) {
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
      assistantText: `Mock ${profile.name} response from Device Studio.`,
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
    hubClient.on("message", (event) => {
      if (event.final && event.role === "assistant") {
        stopActivePlayback("assistant final", false);
      }
    }),
    hubClient.on("lifecycle", (event) => {
      if (event.name === "assistant.interrupted" || event.name === "action.interrupt") {
        stopActivePlayback("transport interrupt");
      }
      renderMode();
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

function stopActivePlayback(reason: string, emit = true): void {
  if (animationFrameId !== undefined) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = undefined;
  }
  const playback = activePlayback;
  activePlayback = null;
  if (playback && emit) {
    applyRenderStateToPreview(playback.stop(reason, state.elapsedMs));
  }
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
  const started = activePlayback.start(0);
  playbackStartedAt = performance.now() - started.elapsedMs;
  applyRenderStateToPreview(started);
  schedulePlaybackTick();
}

function schedulePlaybackTick(): void {
  animationFrameId = requestAnimationFrame((timestamp) => {
    const playback = activePlayback;
    if (!playback) {
      animationFrameId = undefined;
      return;
    }
    const renderState = playback.sample(timestamp - playbackStartedAt);
    applyRenderStateToPreview(renderState);
    renderFrameLane();
    if (renderState.complete) {
      stopActivePlayback("complete");
      return;
    }
    schedulePlaybackTick();
  });
}

function applyBehaviorFrame(elapsedMs: number): void {
  if (!activePlayback) {
    activePlayback = createSelectedPlayback();
    applyRenderStateToPreview(activePlayback.start(0));
  }
  applyRenderStateToPreview(activePlayback.sample(elapsedMs));
  renderFrameLane();
}

function createDraftCommand(): void {
  const entry = selectedBehaviorEntry();
  const profile = selectedProfile();
  const channels = entry.supportedChannels.join(", ");
  commandInput.value = `Draft a ${entry.name} turn for ${profile.name}. Use supported channels: ${channels}. Keep motion hardware-safe and report any unverified output before applying it.`;
  recordEvent({
    ...activeSessionContext(),
    source: "user",
    kind: "draft.generate",
    summary: entry.name,
    payload: {
      behaviorId: entry.id,
      profileId: profile.id,
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
    state.elapsedMs = 0;
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
  downloadText("device-studio-event-log.json", operationalLog.toJson(), "application/json");
  recordEvent({
    ...activeSessionContext(),
    source: "import/export",
    kind: "event-log.export",
    summary: `${operationalLog.entries.length} entries`,
  });
}

function downloadText(filename: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

renderProfileOptions();

profileSelect.addEventListener("change", () => {
  stopActivePlayback("profile changed");
  state.profileId = profileSelect.value;
  state.elapsedMs = 0;
  replaceHubClient();
  ensureSelectedBehavior();
  render();
  recordEvent({
    ...activeSessionContext(),
    source: "user",
    kind: "profile.select",
    summary: selectedProfile().name,
    payload: {
      profileId: state.profileId,
      touch: selectedProfile().touch,
    },
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
    render();
    recordEvent({
      ...activeSessionContext(),
      source: "user",
      kind: "backend.mode",
      summary: state.backendMode,
    });
  });
});

hubUrl.addEventListener("change", () => replaceHubClient());

connectButton.addEventListener("click", () => {
  void toggleConnection();
});

pingButton.addEventListener("click", () => {
  ensureHubClient().ping();
});

interruptButton.addEventListener("click", () => {
  stopActivePlayback("interrupt");
  ensureHubClient().interrupt();
});

sendCommandButton.addEventListener("click", () => {
  void sendTypedTurn();
});

draftCommandButton.addEventListener("click", () => createDraftCommand());

importBehaviorButton.addEventListener("click", () => importBehaviorFile.click());

importBehaviorFile.addEventListener("change", () => {
  void importBehaviorFileSelection();
});

exportBehaviorButton.addEventListener("click", () => exportSelectedBehavior());

playButton.addEventListener("click", () => playSelectedBehavior());

stopButton.addEventListener("click", () => stopActivePlayback("user stop"));

copyLogButton.addEventListener("click", () => {
  void copyEventLog();
});

exportLogButton.addEventListener("click", () => exportEventLog());

replaceHubClient();
render();
recordEvent({
  ...activeSessionContext(),
  source: "transport",
  kind: "studio.ready",
  summary: "Device Studio initialized",
  payload: {
    profileId: state.profileId,
    behaviorId: state.selectedBehaviorId,
  },
});
