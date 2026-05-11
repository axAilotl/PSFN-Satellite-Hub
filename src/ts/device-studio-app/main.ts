import {
  createBehaviorLibrary,
  createBehaviorPlayback,
  sampleBehaviorRenderState,
} from "../device-studio/behavior.js";
import type {
  BehaviorEvent,
  NormalizedBehaviorRenderState,
} from "../device-studio/behavior.js";
import type {
  BehaviorTimeline,
  HardwareVerification,
  Provenance,
} from "../device-studio/model.js";
import {
  stackChanProfile,
  waveshareEsp32S3RoundTouchProfile,
} from "../device-studio/profiles.js";
import type { ConcreteDeviceProfile } from "../device-studio/profiles.js";
import {
  formatPreviewMotion,
  StackChanPreview,
} from "./stackchan-preview.js";
import type { StackChanPreviewModel } from "./stackchan-preview.js";

type BackendMode = "live" | "mock";

declare global {
  interface Window {
    __deviceStudioPreviewSnapshot?: () => StackChanPreviewModel | undefined;
  }
}

const SIMULATED_BEHAVIOR: HardwareVerification = {
  status: "simulated-only",
  label: "Simulated behavior; hardware safety has not been measured",
  notes: "Device Studio mock playback only. Do not treat these angles as verified servo travel limits.",
};

const STUDIO_PROVENANCE: Provenance = {
  label: "Device Studio mock behavior",
  source: "host-generated",
  notes: "Local browser preview behavior authored for Stack-chan motion visualization.",
};

const stackChanBehaviors: BehaviorTimeline[] = [
  {
    id: "behavior.stackchan.idle-presence",
    name: "Idle presence",
    compatibleProfileIds: [],
    channels: ["expression", "viseme", "joints", "display", "backlight", "leds"],
    durationMs: 1200,
    frames: [
      {
        atMs: 0,
        durationMs: 400,
        label: "center",
        expression: {
          id: "neutral",
          intensity: 1,
          eyes: "open",
          mouth: "neutral",
        },
        viseme: {
          id: "sil",
          weight: 1,
        },
        joints: {
          "head.yaw": { value: 0 },
          "head.pitch": { value: 0 },
        },
        display: {
          mode: "face",
          backgroundColor: "#101918",
        },
        backlight: {
          brightness: 0.72,
        },
        leds: {
          "status.rgb": {
            color: "#50d6c6",
            brightness: 0.45,
            effect: "solid",
          },
        },
      },
      {
        atMs: 600,
        label: "breath",
        expression: {
          id: "neutral",
          intensity: 0.85,
          eyes: "open",
          mouth: "neutral",
        },
        joints: {
          "head.yaw": { value: 0 },
          "head.pitch": { value: 3 },
        },
      },
      {
        atMs: 1200,
        label: "settle",
        expression: {
          id: "neutral",
          intensity: 1,
          eyes: "open",
          mouth: "neutral",
        },
        joints: {
          "head.yaw": { value: 0 },
          "head.pitch": { value: 0 },
        },
      },
    ],
    provenance: STUDIO_PROVENANCE,
    hardwareVerification: SIMULATED_BEHAVIOR,
  },
  {
    id: "behavior.stackchan.curious-glance",
    name: "Curious glance",
    compatibleProfileIds: [],
    channels: ["expression", "viseme", "joints", "display", "backlight", "leds"],
    durationMs: 1280,
    frames: [
      {
        atMs: 0,
        label: "notice",
        expression: {
          id: "curious",
          intensity: 0.75,
          eyes: "wide",
          mouth: "open",
        },
        viseme: {
          id: "oh",
          weight: 0.65,
        },
        joints: {
          "head.yaw": { value: 0 },
          "head.pitch": { value: 0 },
        },
        display: {
          mode: "face",
          backgroundColor: "#172033",
        },
        backlight: {
          brightness: 0.82,
        },
        leds: {
          "status.rgb": {
            color: "#52b6ff",
            brightness: 0.72,
            effect: "pulse",
          },
        },
      },
      {
        atMs: 320,
        label: "look left",
        expression: {
          id: "curious",
          intensity: 1,
          eyes: "wide",
          mouth: "open",
        },
        joints: {
          "head.yaw": { value: -18 },
          "head.pitch": { value: 8 },
        },
      },
      {
        atMs: 820,
        label: "look right",
        expression: {
          id: "curious",
          intensity: 0.9,
          eyes: "squint",
          mouth: "smile",
        },
        viseme: {
          id: "ee",
          weight: 0.5,
        },
        joints: {
          "head.yaw": { value: 14 },
          "head.pitch": { value: -4 },
        },
        leds: {
          "status.rgb": {
            color: "#ffdd4a",
            brightness: 0.75,
            effect: "blink",
          },
        },
      },
      {
        atMs: 1280,
        label: "center",
        expression: {
          id: "happy",
          intensity: 0.7,
          eyes: "open",
          mouth: "smile",
        },
        viseme: {
          id: "sil",
          weight: 1,
        },
        joints: {
          "head.yaw": { value: 0 },
          "head.pitch": { value: 0 },
        },
      },
    ],
    provenance: STUDIO_PROVENANCE,
    hardwareVerification: SIMULATED_BEHAVIOR,
  },
  {
    id: "behavior.stackchan.affirming-nod",
    name: "Affirming nod",
    compatibleProfileIds: [],
    channels: ["expression", "viseme", "joints", "display", "backlight", "leds"],
    durationMs: 1120,
    frames: [
      {
        atMs: 0,
        label: "listen",
        expression: {
          id: "happy",
          intensity: 0.72,
          eyes: "open",
          mouth: "smile",
        },
        viseme: {
          id: "sil",
          weight: 1,
        },
        joints: {
          "head.yaw": { value: 0 },
          "head.pitch": { value: 0 },
        },
        display: {
          mode: "face",
          backgroundColor: "#12372a",
        },
        backlight: {
          brightness: 0.78,
        },
        leds: {
          "status.rgb": {
            color: "#42f57b",
            brightness: 0.7,
            effect: "pulse",
          },
        },
      },
      {
        atMs: 260,
        label: "nod down",
        expression: {
          id: "happy",
          intensity: 0.85,
          eyes: "closed",
          mouth: "smile",
        },
        joints: {
          "head.yaw": { value: 0 },
          "head.pitch": { value: -13 },
        },
      },
      {
        atMs: 620,
        label: "nod up",
        expression: {
          id: "happy",
          intensity: 0.9,
          eyes: "open",
          mouth: "smile",
        },
        viseme: {
          id: "ee",
          weight: 0.6,
        },
        joints: {
          "head.yaw": { value: 0 },
          "head.pitch": { value: 7 },
        },
      },
      {
        atMs: 1120,
        label: "done",
        expression: {
          id: "happy",
          intensity: 0.75,
          eyes: "open",
          mouth: "smile",
        },
        viseme: {
          id: "sil",
          weight: 1,
        },
        joints: {
          "head.yaw": { value: 0 },
          "head.pitch": { value: 0 },
        },
      },
    ],
    provenance: STUDIO_PROVENANCE,
    hardwareVerification: SIMULATED_BEHAVIOR,
  },
];

const profiles = [
  stackChanProfile,
  waveshareEsp32S3RoundTouchProfile,
] as const;
const profileById = new Map<string, ConcreteDeviceProfile>(profiles.map((profile) => [profile.id, profile]));
const behaviorLibrary = createBehaviorLibrary(stackChanBehaviors);
const initialBehavior = stackChanBehaviors[0];

if (!initialBehavior) {
  throw new Error("Device Studio requires at least one behavior");
}

const state = {
  profileId: stackChanProfile.id,
  backendMode: "mock" as BackendMode,
  selectedBehaviorId: initialBehavior.id,
  connected: false,
  elapsedMs: 0,
  playing: false,
};

let playback: ReturnType<typeof createBehaviorPlayback> | undefined;
let animationFrameId: number | undefined;
let playbackOriginMs = 0;
let playbackOriginElapsedMs = 0;
let lastPreviewModel: StackChanPreviewModel | undefined;

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
const previewCaption = requireElement("preview-caption", HTMLParagraphElement);
const previewMeta = requireElement("preview-meta", HTMLDivElement);
const previewStage = requireElement("preview-stage", HTMLDivElement);
const previewRoot = requireElement("stackchan-preview-root", HTMLDivElement);
const expressionValue = requireElement("expression-value", HTMLElement);
const visemeValue = requireElement("viseme-value", HTMLElement);
const motionValue = requireElement("motion-value", HTMLElement);
const hardwareValue = requireElement("hardware-value", HTMLElement);
const frameValue = requireElement("frame-value", HTMLElement);
const behaviorList = requireElement("behavior-list", HTMLDivElement);
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
const stackChanPreview = new StackChanPreview(previewRoot);

window.__deviceStudioPreviewSnapshot = () => lastPreviewModel;

function selectedProfile(): ConcreteDeviceProfile {
  const profile = profileById.get(state.profileId);
  if (!profile) {
    throw new Error(`Unknown profile ${state.profileId}`);
  }
  return profile;
}

function selectedBehavior(): BehaviorTimeline {
  return behaviorLibrary.require(state.selectedBehaviorId);
}

function appendEvent(kind: string, detail: string): void {
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
  detailElement.textContent = detail;
  item.append(timeElement, kindElement, detailElement);
  eventLog.prepend(item);
  while (eventLog.children.length > 10) {
    eventLog.lastElementChild?.remove();
  }
}

function renderProfileOptions(): void {
  profileSelect.replaceChildren(...profiles.map((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.family === "stackchan" ? "Stack-chan bench" : "Waveshare round LCD";
    return option;
  }));
}

function renderProfile(): void {
  const profile = selectedProfile();
  profileSelect.value = profile.id;
  profileSummary.textContent = `${profile.name} / ${state.backendMode} backend`;
  previewCaption.textContent = profile.description;
  previewMeta.textContent = `${profile.display.width} x ${profile.display.height} / ${profile.rendererHints.movementPreview}`;
  previewStage.dataset.profile = profile.family;
  previewStage.dataset.hardware = profile.hardwareVerification.status;
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

function renderBehaviorList(): void {
  const profile = selectedProfile();
  const entries = behaviorLibrary.list({ profile, includeIncompatible: true });
  behaviorList.replaceChildren(...entries.map((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "behavior-card";
    button.dataset.selected = String(entry.id === state.selectedBehaviorId);
    button.dataset.verified = String(entry.hardwareVerified);
    button.dataset.compatible = String(entry.compatible);
    const label = document.createElement("strong");
    label.textContent = entry.name;
    const stateLine = document.createElement("span");
    stateLine.textContent = `${entry.durationMs} ms / ${entry.channels.join(", ")}`;
    const provenance = document.createElement("small");
    provenance.textContent = `${entry.provenanceSource} / ${statusLabel(entry.hardwareVerificationStatus)}`;
    button.append(label, stateLine, provenance);
    button.addEventListener("click", () => {
      stopPlayback("behavior-change");
      state.selectedBehaviorId = entry.id;
      state.elapsedMs = 0;
      renderBehaviorList();
      applyRenderState(sampleCurrentRenderState(0));
      appendEvent("behavior.select", entry.id);
    });
    return button;
  }));
}

function sampleCurrentRenderState(elapsedMs = state.elapsedMs): NormalizedBehaviorRenderState {
  return sampleBehaviorRenderState(selectedBehavior(), elapsedMs, {
    profile: selectedProfile(),
  });
}

function applyRenderState(renderState: NormalizedBehaviorRenderState): void {
  state.elapsedMs = renderState.elapsedMs;
  const profile = selectedProfile();
  expressionValue.textContent = formatExpression(renderState);
  visemeValue.textContent = formatViseme(renderState);
  motionValue.textContent = formatPreviewMotion(profile, renderState);
  hardwareValue.textContent = formatHardware(renderState, profile);
  frameValue.textContent = renderState.activeFrame
    ? `${renderState.activeFrame.label ?? `Frame ${renderState.activeFrame.index + 1}`} @ ${renderState.activeFrame.atMs} ms`
    : `${Math.round(renderState.elapsedMs)} ms`;
  lastPreviewModel = stackChanPreview.update(profile, renderState);
  renderTimeline(renderState);
}

function renderTimeline(renderState: NormalizedBehaviorRenderState): void {
  const behavior = selectedBehavior();
  const durationMs = Math.max(renderState.durationMs, behavior.durationMs ?? 0, 1);
  frameLane.replaceChildren(...behavior.frames.map((frame, index) => {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "frame-marker";
    marker.dataset.active = String(renderState.activeFrame?.index === index);
    marker.style.left = `${Math.min(98, Math.max(2, (frame.atMs / durationMs) * 100))}%`;
    marker.textContent = String(index + 1);
    marker.setAttribute("aria-label", `Frame ${index + 1} at ${frame.atMs} milliseconds`);
    marker.addEventListener("click", () => {
      stopPlayback("frame-apply");
      applyRenderState(sampleCurrentRenderState(frame.atMs));
      appendEvent("behavior.frame.apply", `${behavior.id}@${frame.atMs}ms`);
    });
    return marker;
  }));
}

function render(): void {
  renderProfileOptions();
  renderProfile();
  renderMode();
  renderBehaviorList();
  applyRenderState(sampleCurrentRenderState(0));
}

function startPlayback(): void {
  stopPlayback("restart", { emitWhenIdle: false });
  const profile = selectedProfile();
  playback = createBehaviorPlayback({
    timeline: selectedBehavior(),
    profile,
    emit: emitBehaviorEvent,
  });
  state.playing = true;
  playbackOriginElapsedMs = 0;
  playbackOriginMs = performance.now();
  applyRenderState(playback.start(0));
  schedulePlaybackTick();
}

function schedulePlaybackTick(): void {
  animationFrameId = window.requestAnimationFrame((now) => {
    const currentPlayback = playback;
    if (!state.playing || !currentPlayback) {
      animationFrameId = undefined;
      return;
    }
    const elapsedMs = playbackOriginElapsedMs + (now - playbackOriginMs);
    const renderState = currentPlayback.sample(elapsedMs);
    applyRenderState(renderState);
    if (renderState.complete) {
      const stoppedState = currentPlayback.stop("complete", renderState.durationMs);
      state.playing = false;
      playback = undefined;
      animationFrameId = undefined;
      applyRenderState(stoppedState);
      return;
    }
    schedulePlaybackTick();
  });
}

function stopPlayback(
  reason = "stopped",
  options: { emitWhenIdle?: boolean } = {},
): void {
  if (animationFrameId !== undefined) {
    window.cancelAnimationFrame(animationFrameId);
    animationFrameId = undefined;
  }
  const currentPlayback = playback;
  playback = undefined;
  const wasPlaying = state.playing;
  state.playing = false;
  if (currentPlayback) {
    applyRenderState(currentPlayback.stop(reason, state.elapsedMs));
    return;
  }
  if (options.emitWhenIdle ?? wasPlaying) {
    appendEvent("timeline.stop", reason);
  }
}

function emitBehaviorEvent(event: BehaviorEvent): void {
  switch (event.type) {
    case "behavior.playback.start":
      appendEvent(event.type, `${event.behavior.id} / ${event.durationMs}ms`);
      break;
    case "behavior.frame.apply":
      appendEvent(event.type, `${event.behavior.id}@${event.frame.atMs}ms`);
      break;
    case "behavior.playback.stop":
      appendEvent(event.type, `${event.behavior.id} / ${event.reason}`);
      break;
    case "behavior.import":
    case "behavior.export":
      appendEvent(event.type, event.behaviorIds.join(", "));
      break;
  }
}

function formatExpression(renderState: NormalizedBehaviorRenderState): string {
  const expression = renderState.expression;
  if (!expression) {
    return "None";
  }
  const intensity = expression.intensity === undefined ? "" : ` ${Math.round(expression.intensity * 100)}%`;
  return `${expression.id}${intensity}`;
}

function formatViseme(renderState: NormalizedBehaviorRenderState): string {
  const viseme = renderState.viseme;
  if (!viseme) {
    return "Rest";
  }
  const weight = viseme.weight === undefined ? "" : ` ${Math.round(viseme.weight * 100)}%`;
  return `${viseme.id}${weight}`;
}

function formatHardware(
  renderState: NormalizedBehaviorRenderState,
  profile: ConcreteDeviceProfile,
): string {
  if (renderState.hardwareVerified && isHardwareVerified(profile.hardwareVerification.status)) {
    return "Verified";
  }
  return `${statusLabel(profile.hardwareVerification.status)} / ${statusLabel(renderState.hardwareVerificationStatus)}`;
}

function isHardwareVerified(status: HardwareVerification["status"]): boolean {
  return status === "verified-on-hardware" || status === "partially-verified";
}

function statusLabel(status: HardwareVerification["status"]): string {
  switch (status) {
    case "verified-on-hardware":
      return "verified";
    case "partially-verified":
      return "partially verified";
    case "simulated-only":
      return "simulated";
    case "unsafe":
      return "unsafe";
    case "unverified":
      return "unverified";
  }
}

profileSelect.addEventListener("change", () => {
  stopPlayback("profile-change");
  state.profileId = profileSelect.value;
  state.elapsedMs = 0;
  renderProfile();
  renderBehaviorList();
  applyRenderState(sampleCurrentRenderState(0));
  appendEvent("profile.select", state.profileId);
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
  appendEvent(state.connected ? "transport.connect" : "transport.disconnect", state.backendMode === "live" ? hubUrl.value : "mock");
});

interruptButton.addEventListener("click", () => {
  stopPlayback("interrupt");
  appendEvent("command.interrupt", state.connected ? "sent" : "queued");
});

sendCommandButton.addEventListener("click", () => {
  appendEvent("command.send", commandInput.value.trim() || "(empty)");
});

playButton.addEventListener("click", () => {
  startPlayback();
});

stopButton.addEventListener("click", () => {
  stopPlayback("manual", { emitWhenIdle: true });
});

clearLogButton.addEventListener("click", () => {
  eventLog.replaceChildren();
});

render();
appendEvent("studio.ready", "mock surface initialized");
