type BackendMode = "live" | "mock";
type ProfileId = "stack-chan" | "waveshare-round";

interface DeviceProfile {
  id: ProfileId;
  label: string;
  summary: string;
  previewMeta: string;
  caption: string;
}

interface BehaviorPreset {
  id: string;
  label: string;
  expression: string;
  viseme: string;
  motion: string;
  source: "official" | "host-generated";
  verified: boolean;
  frames: number[];
}

const profiles: Record<ProfileId, DeviceProfile> = {
  "stack-chan": {
    id: "stack-chan",
    label: "Stack-chan bench",
    summary: "Stack-chan bench profile",
    previewMeta: "320 x 240 / pan + tilt",
    caption: "Screen, face, motion, and status preview surface",
  },
  "waveshare-round": {
    id: "waveshare-round",
    label: "Waveshare round LCD",
    summary: "Waveshare round LCD profile",
    previewMeta: "360 x 360 / touch",
    caption: "Round LCD expression and touch preview surface",
  },
};

const behaviors: BehaviorPreset[] = [
  {
    id: "idle",
    label: "Idle presence",
    expression: "Neutral",
    viseme: "Rest",
    motion: "Pan 0 / Tilt 0",
    source: "official",
    verified: true,
    frames: [0, 450, 900, 1350],
  },
  {
    id: "curious",
    label: "Curious glance",
    expression: "Curious",
    viseme: "Oh",
    motion: "Pan -12 / Tilt 8",
    source: "host-generated",
    verified: false,
    frames: [0, 320, 820, 1280],
  },
  {
    id: "affirm",
    label: "Affirming nod",
    expression: "Smile",
    viseme: "Ee",
    motion: "Pan 0 / Tilt -10",
    source: "host-generated",
    verified: false,
    frames: [0, 260, 620, 1120],
  },
];

const state = {
  profileId: "stack-chan" as ProfileId,
  backendMode: "mock" as BackendMode,
  selectedBehaviorId: "idle",
  connected: false,
};

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
const expressionValue = requireElement("expression-value", HTMLElement);
const visemeValue = requireElement("viseme-value", HTMLElement);
const motionValue = requireElement("motion-value", HTMLElement);
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

function selectedBehavior(): BehaviorPreset {
  const behavior = behaviors.find((candidate) => candidate.id === state.selectedBehaviorId);
  if (!behavior) {
    throw new Error(`Unknown behavior ${state.selectedBehaviorId}`);
  }
  return behavior;
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
  while (eventLog.children.length > 8) {
    eventLog.lastElementChild?.remove();
  }
}

function renderProfile(): void {
  const profile = profiles[state.profileId];
  profileSummary.textContent = `${profile.summary} / ${state.backendMode} backend`;
  previewCaption.textContent = profile.caption;
  previewMeta.textContent = profile.previewMeta;
  previewStage.dataset.profile = profile.id;
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
  expressionValue.textContent = behavior.expression;
  visemeValue.textContent = behavior.viseme;
  motionValue.textContent = behavior.motion;
  frameLane.replaceChildren(...behavior.frames.map((frame, index) => {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "frame-marker";
    marker.style.left = `${Math.min(92, frame / 16)}%`;
    marker.textContent = String(index + 1);
    marker.setAttribute("aria-label", `Frame ${index + 1} at ${frame} milliseconds`);
    marker.addEventListener("click", () => appendEvent("frame.apply", `${behavior.id}@${frame}ms`));
    return marker;
  }));
}

function renderBehaviorList(): void {
  behaviorList.replaceChildren(...behaviors.map((behavior) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "behavior-card";
    button.dataset.selected = String(behavior.id === state.selectedBehaviorId);
    const label = document.createElement("strong");
    label.textContent = behavior.label;
    const stateLine = document.createElement("span");
    stateLine.textContent = `${behavior.expression} / ${behavior.viseme}`;
    const provenance = document.createElement("small");
    provenance.textContent = `${behavior.source}${behavior.verified ? " / verified" : " / unverified"}`;
    button.append(label, stateLine, provenance);
    button.addEventListener("click", () => {
      state.selectedBehaviorId = behavior.id;
      renderBehaviorList();
      renderBehavior();
      appendEvent("behavior.select", behavior.id);
    });
    return button;
  }));
}

function render(): void {
  renderProfile();
  renderMode();
  renderBehaviorList();
  renderBehavior();
}

profileSelect.addEventListener("change", () => {
  state.profileId = profileSelect.value as ProfileId;
  renderProfile();
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
  appendEvent("command.interrupt", state.connected ? "sent" : "queued");
});

sendCommandButton.addEventListener("click", () => {
  appendEvent("command.send", commandInput.value.trim() || "(empty)");
});

playButton.addEventListener("click", () => {
  appendEvent("timeline.play", selectedBehavior().id);
});

stopButton.addEventListener("click", () => {
  appendEvent("timeline.stop", selectedBehavior().id);
});

clearLogButton.addEventListener("click", () => {
  eventLog.replaceChildren();
});

render();
appendEvent("studio.ready", "mock surface initialized");
