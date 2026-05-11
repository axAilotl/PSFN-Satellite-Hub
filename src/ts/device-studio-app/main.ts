import {
  createBehaviorPlayback,
  createFixtureBehaviorLibrary,
  sampleBehaviorRenderState,
} from "../device-studio/behavior.js";
import type {
  BehaviorEvent,
  BehaviorLibraryEntry,
  BehaviorPlayback,
  NormalizedBehaviorRenderState,
} from "../device-studio/behavior.js";
import type { BehaviorTimeline } from "../device-studio/model.js";
import {
  concreteDeviceProfiles,
  getConcreteDeviceProfile,
} from "../device-studio/profiles.js";
import type { ConcreteDeviceProfile } from "../device-studio/profiles.js";
import {
  DisplayPreview,
  formatIgnoredChannels,
  formatProfilePreviewMeta,
} from "./display-preview.js";

type BackendMode = "live" | "mock";

interface StudioState {
  profileId: string;
  backendMode: BackendMode;
  selectedBehaviorId: string;
  elapsedMs: number;
  connected: boolean;
}

const behaviorLibrary = createFixtureBehaviorLibrary();
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
  connected: false,
};

let playback: BehaviorPlayback | undefined;
let animationFrameId: number | undefined;

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
const previewCaption = requireElement("preview-caption", HTMLParagraphElement);
const previewMeta = requireElement("preview-meta", HTMLDivElement);
const previewStage = requireElement("preview-stage", HTMLDivElement);
const behaviorList = requireElement("behavior-list", HTMLDivElement);
const timeRuler = requireElement("time-ruler", HTMLDivElement);
const frameLane = requireElement("frame-lane", HTMLDivElement);
const eventLog = requireElement("event-log", HTMLOListElement);
const commandInput = requireElement("command-input", HTMLTextAreaElement);
const hubUrl = requireElement("hub-url", HTMLInputElement);
const connectButton = requireElement("connect-button", HTMLButtonElement);
const interruptButton = requireElement("interrupt-button", HTMLButtonElement);
const sendCommandButton = requireElement("send-command-button", HTMLButtonElement);
const playButton = requireElement("play-button", HTMLButtonElement);
const stopButton = requireElement("stop-button", HTMLButtonElement);
const clearLogButton = requireElement("clear-log-button", HTMLButtonElement);
const displayPreview = new DisplayPreview(previewStage, {
  onTouch: (detail) => appendEvent(detail.type, detail),
});

function selectedProfile(): ConcreteDeviceProfile {
  return getConcreteDeviceProfile(state.profileId) ?? firstProfile;
}

function currentBehaviorEntries(profile = selectedProfile()): BehaviorLibraryEntry[] {
  return behaviorLibrary.list({ profile, includeIncompatible: true });
}

function ensureSelectedBehavior(profile = selectedProfile()): void {
  const entries = currentBehaviorEntries(profile);
  if (!entries.some((entry) => entry.id === state.selectedBehaviorId)) {
    state.selectedBehaviorId = requireFirst(entries, "No behaviors available for the selected profile").id;
    state.elapsedMs = 0;
  }
}

function selectedBehavior(): BehaviorTimeline {
  return behaviorLibrary.require(state.selectedBehaviorId);
}

function currentRenderState(): NormalizedBehaviorRenderState {
  return sampleBehaviorRenderState(selectedBehavior(), state.elapsedMs, {
    profile: selectedProfile(),
  });
}

function appendEvent(kind: string, detail: unknown): void {
  const item = document.createElement("li");
  const timestamp = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const timeElement = document.createElement("span");
  timeElement.textContent = timestamp;
  const kindElement = document.createElement("strong");
  kindElement.textContent = kind;
  const detailElement = document.createElement("code");
  const detailText = formatLogDetail(detail);
  detailElement.textContent = detailText;
  item.dataset.detail = detailText;
  item.append(timeElement, kindElement, detailElement);
  eventLog.prepend(item);
  while (eventLog.children.length > 10) {
    eventLog.lastElementChild?.remove();
  }
}

function formatLogDetail(detail: unknown): string {
  if (typeof detail === "string") {
    return detail;
  }
  return JSON.stringify(detail);
}

function appendBehaviorEvent(event: BehaviorEvent): void {
  appendEvent(event.type, summarizeBehaviorEvent(event));
}

function summarizeBehaviorEvent(event: BehaviorEvent): Record<string, unknown> {
  switch (event.type) {
    case "behavior.import":
    case "behavior.export":
      return {
        count: event.count,
        behaviorIds: event.behaviorIds,
      };
    case "behavior.playback.start":
      return {
        behaviorId: event.behavior.id,
        profileId: event.profileId,
        durationMs: event.durationMs,
        supportedChannels: event.supportedChannels,
        ignoredChannels: event.ignoredChannels,
      };
    case "behavior.frame.apply":
      return {
        behaviorId: event.behavior.id,
        profileId: event.profileId,
        elapsedMs: event.elapsedMs,
        frame: event.frame,
        ignoredChannels: event.renderState.ignoredChannels,
      };
    case "behavior.playback.stop":
      return {
        behaviorId: event.behavior.id,
        profileId: event.profileId,
        reason: event.reason,
        elapsedMs: event.elapsedMs,
      };
  }
}

function renderProfileOptions(): void {
  profileSelect.replaceChildren(...concreteDeviceProfiles.map((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    return option;
  }));
  profileSelect.value = state.profileId;
}

function renderProfile(profile = selectedProfile()): void {
  profileSelect.value = profile.id;
  profileSummary.textContent = `${profile.name} / ${state.backendMode} backend`;
  previewCaption.textContent = profile.description;
  previewMeta.textContent = formatProfilePreviewMeta(profile);
  displayPreview.setProfile(profile);
}

function renderMode(): void {
  const label = state.connected
    ? `${state.backendMode === "mock" ? "Mock" : "Live"} connected`
    : `${state.backendMode === "mock" ? "Mock" : "Live"} idle`;
  connectionBadge.dataset.mode = state.backendMode;
  connectionBadge.dataset.connected = String(state.connected);
  connectionLabel.textContent = label;
  controlModeLabel.textContent = `${state.backendMode === "mock" ? "Mock" : "Live"} backend`;
}

function renderBehavior(): void {
  const behavior = selectedBehavior();
  const renderState = currentRenderState();
  displayPreview.render(renderState);
  renderFrameLane(behavior, renderState);
}

function renderFrameLane(behavior: BehaviorTimeline, renderState: NormalizedBehaviorRenderState): void {
  const durationMs = Math.max(behavior.durationMs ?? 0, 1);
  timeRuler.replaceChildren(...[0, durationMs / 3, (durationMs * 2) / 3, durationMs].map((time) => {
    const marker = document.createElement("span");
    marker.textContent = `${Math.round(time)} ms`;
    return marker;
  }));
  frameLane.replaceChildren(...behavior.frames.map((frame, index) => {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "frame-marker";
    marker.style.left = `${Math.min(100, Math.max(0, (frame.atMs / durationMs) * 100))}%`;
    marker.textContent = String(index + 1);
    marker.dataset.active = String(renderState.activeFrame?.index === index);
    marker.setAttribute("aria-label", `Frame ${index + 1} at ${frame.atMs} milliseconds`);
    marker.addEventListener("click", () => {
      stopPlayback("frame-scrub", false);
      state.elapsedMs = frame.atMs;
      renderBehavior();
      appendEvent("frame.apply", {
        behaviorId: behavior.id,
        atMs: frame.atMs,
        label: frame.label,
      });
    });
    return marker;
  }));
}

function renderBehaviorList(profile = selectedProfile()): void {
  const entries = currentBehaviorEntries(profile);
  behaviorList.replaceChildren(...entries.map((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "behavior-card";
    button.dataset.selected = String(entry.id === state.selectedBehaviorId);
    button.dataset.compatible = String(entry.compatible);
    const label = document.createElement("strong");
    label.textContent = entry.name;
    const stateLine = document.createElement("span");
    stateLine.textContent = entry.supportedChannels.length > 0
      ? entry.supportedChannels.join(", ")
      : "No preview channels";
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
      stopPlayback("behavior-select", false);
      state.selectedBehaviorId = entry.id;
      state.elapsedMs = 0;
      renderBehaviorList(profile);
      renderBehavior();
      appendEvent("behavior.select", {
        behaviorId: entry.id,
        profileId: profile.id,
        ignoredChannels: entry.ignoredChannels,
      });
    });
    return button;
  }));
}

function render(): void {
  const profile = selectedProfile();
  ensureSelectedBehavior(profile);
  renderProfile(profile);
  renderMode();
  renderBehaviorList(profile);
  renderBehavior();
}

function startPlayback(): void {
  stopPlayback("restart", false);
  state.elapsedMs = 0;
  const timeline = selectedBehavior();
  const profile = selectedProfile();
  const activePlayback = createBehaviorPlayback({
    timeline,
    profile,
    emit: appendBehaviorEvent,
  });
  playback = activePlayback;
  const startState = activePlayback.start(0);
  state.elapsedMs = startState.elapsedMs;
  renderBehavior();
  const startedAt = performance.now();
  const tick = (timestamp: number): void => {
    if (playback !== activePlayback) {
      return;
    }
    const renderState = activePlayback.sample(timestamp - startedAt);
    state.elapsedMs = renderState.elapsedMs;
    renderBehavior();
    if (renderState.complete) {
      stopPlayback("complete");
      return;
    }
    animationFrameId = requestAnimationFrame(tick);
  };
  animationFrameId = requestAnimationFrame(tick);
}

function stopPlayback(reason = "stopped", emit = true): void {
  if (animationFrameId !== undefined) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = undefined;
  }
  const activePlayback = playback;
  playback = undefined;
  if (activePlayback && emit) {
    const stopState = activePlayback.stop(reason, state.elapsedMs);
    state.elapsedMs = stopState.elapsedMs;
    renderBehavior();
  }
}

renderProfileOptions();

profileSelect.addEventListener("change", () => {
  stopPlayback("profile-change");
  state.profileId = profileSelect.value;
  state.elapsedMs = 0;
  ensureSelectedBehavior();
  render();
  appendEvent("profile.select", {
    profileId: state.profileId,
    touch: selectedProfile().touch,
  });
});

document.querySelectorAll<HTMLInputElement>('input[name="backend-mode"]').forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked) {
      return;
    }
    state.backendMode = input.value as BackendMode;
    state.connected = false;
    renderMode();
    renderProfile();
    appendEvent("backend.mode", state.backendMode);
  });
});

connectButton.addEventListener("click", () => {
  state.connected = !state.connected;
  renderMode();
  appendEvent(state.connected ? "transport.connect" : "transport.disconnect", {
    mode: state.backendMode,
    endpoint: state.backendMode === "live" ? hubUrl.value : "mock",
  });
});

interruptButton.addEventListener("click", () => {
  stopPlayback("interrupt");
  appendEvent("command.interrupt", {
    state: state.connected ? "sent" : "queued",
    behaviorId: state.selectedBehaviorId,
  });
});

sendCommandButton.addEventListener("click", () => {
  appendEvent("command.send", {
    command: commandInput.value.trim() || "(empty)",
    profileId: state.profileId,
  });
});

playButton.addEventListener("click", () => {
  startPlayback();
});

stopButton.addEventListener("click", () => {
  if (!playback) {
    appendEvent("timeline.stop", {
      behaviorId: state.selectedBehaviorId,
      reason: "already stopped",
    });
    return;
  }
  stopPlayback("user-stop");
});

clearLogButton.addEventListener("click", () => {
  eventLog.replaceChildren();
});

render();
appendEvent("studio.ready", {
  profileId: state.profileId,
  behaviorId: state.selectedBehaviorId,
});
