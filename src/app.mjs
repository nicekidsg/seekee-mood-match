import {
  ASSISTANT_OPTIONS,
  BROWSE_PLAYLISTS,
  COPY,
  MODULE_CONFIG,
  REFINE_LABELS,
} from "./config.mjs";
import {
  analyticsEvent,
  buildCandidateQueue,
  hashString,
  resolveAssistantIntent,
  validateModuleConfig,
} from "./core.mjs";

const query = new URLSearchParams(window.location.search);
const language = detectLanguage(query.get("lang") || navigator.language);
const copy = COPY[language];
const country = (query.get("country") || "MX").toUpperCase();
const timeRange = new Date().getHours() >= 20 || new Date().getHours() < 6 ? "night" : "day";
const userId = getStableId("seekee_demo_user_id");
const sessionId = getSessionId();
const experimentGroup = resolveExperimentGroup();
const featureEnabled = MODULE_CONFIG.enabled
  && query.get("feature") !== "off"
  && experimentGroup === "treatment";

const analyticsBase = {
  user_id: userId,
  session_id: sessionId,
  country,
  app_lang: language,
  experiment_group: experimentGroup,
  module_version: MODULE_CONFIG.moduleVersion,
};

window.__SEKEE_EVENTS__ = [];

function track(event, properties = {}) {
  const payload = analyticsEvent(event, analyticsBase, properties);
  window.__SEKEE_EVENTS__.push(payload);
  window.dispatchEvent(new CustomEvent("seekee:analytics", { detail: payload }));
  console.debug("[Seekee analytics]", payload);
}

function detectLanguage(value = "en") {
  const normalized = value.toLowerCase();
  if (normalized.startsWith("es")) return "es";
  if (normalized.startsWith("pt")) return "pt";
  return "en";
}

function getStableId(key) {
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const value = crypto.randomUUID?.() || `user-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, value);
    return value;
  } catch {
    return "demo-user";
  }
}

function getSessionId() {
  try {
    const existing = sessionStorage.getItem("seekee_demo_session_id");
    if (existing) return existing;
    const value = crypto.randomUUID?.() || `session-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem("seekee_demo_session_id", value);
    return value;
  } catch {
    return `session-${Date.now()}`;
  }
}

function resolveExperimentGroup() {
  const override = query.get("group");
  if (override === "control" || override === "treatment") return override;
  if (MODULE_CONFIG.experimentGroup !== "auto") return MODULE_CONFIG.experimentGroup;
  return hashString(userId) % 2 === 0 ? "control" : "treatment";
}

const elements = {
  intentModule: document.querySelector("#intent-module"),
  intentGrid: document.querySelector("#intent-grid"),
  assistantEntry: document.querySelector("#assistant-entry"),
  assistantDialog: document.querySelector("#assistant-dialog"),
  assistantBack: document.querySelector("#assistant-back"),
  assistantClose: document.querySelector("#assistant-close"),
  assistantStep: document.querySelector("#assistant-step"),
  assistantTitle: document.querySelector("#assistant-title"),
  assistantSubtitle: document.querySelector("#assistant-subtitle"),
  assistantOptions: document.querySelector("#assistant-options"),
  playerSection: document.querySelector("#player-section"),
  playerShell: document.querySelector("#youtube-player-shell"),
  playbackStatus: document.querySelector("#playback-status"),
  nowPlaying: document.querySelector("#now-playing"),
  nowPlayingLabel: document.querySelector("#now-playing-label"),
  playlistTitle: document.querySelector("#playlist-title"),
  refineChips: document.querySelector("#refine-chips"),
  errorActions: document.querySelector("#error-actions"),
  retryButton: document.querySelector("#retry-button"),
  playlistList: document.querySelector("#playlist-list"),
  announcement: document.querySelector("#announcement"),
};

let player = null;
let playerReady = false;
let initialCandidateId = null;
let playerApiResolve;
let playerApiReject;
let requestSerial = 0;
let active = null;
let candidateTimer = null;
let playbackTimer = null;
let playbackState = "IDLE";
let assistantMoment = null;
let assistantStep = 1;
let playerHiddenForDialog = false;
let assistantLaunchingPlayback = false;

const playerApiReady = new Promise((resolve, reject) => {
  playerApiResolve = resolve;
  playerApiReject = reject;
});

window.onYouTubeIframeAPIReady = () => playerApiResolve(window.YT);

function loadYouTubeApi() {
  if (window.YT?.Player) {
    playerApiResolve(window.YT);
    return;
  }
  const script = document.createElement("script");
  script.src = "https://www.youtube.com/iframe_api";
  script.async = true;
  script.onerror = () => playerApiReject(new Error("YouTube IFrame API failed to load"));
  document.head.append(script);
}

function applyCopy() {
  document.documentElement.lang = language === "pt" ? "pt-BR" : language;
  document.querySelector("#intent-eyebrow").textContent = copy.eyebrow;
  document.querySelector("#intent-title").textContent = copy.title;
  document.querySelector("#intent-subtitle").textContent = copy.subtitle;
  document.querySelector("#assistant-entry-label").textContent = copy.assistantEntry;
  document.querySelector("#player-eyebrow").textContent = copy.playerEyebrow;
  document.querySelector("#player-heading").textContent = copy.playerHeading;
  document.querySelector("#browse-eyebrow").textContent = copy.browseEyebrow;
  document.querySelector("#browse-title").textContent = copy.browseTitle;
  document.querySelector("#youtube-disclosure").textContent = copy.youtubeDisclosure;
  elements.nowPlayingLabel.textContent = copy.nowPlaying;
  elements.retryButton.textContent = copy.retry;
  ["home", "music", "video", "me"].forEach((key, index) => {
    document.querySelector(`#tab-${key}`).textContent = copy.tabs[index];
  });
}

function renderIntents() {
  elements.intentGrid.replaceChildren(...MODULE_CONFIG.intents.map((intent, position) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "intent-button";
    button.dataset.intentId = intent.id;
    button.style.setProperty("--intent-tint", intent.tint);
    button.setAttribute("aria-label", `${intent.labels[language]}. ${intent.hints[language]}`);
    button.innerHTML = `
      <span class="intent-icon" aria-hidden="true">${intent.icon}</span>
      <span class="intent-copy">
        <strong>${intent.labels[language]}</strong>
        <small>${intent.hints[language]}</small>
      </span>`;
    button.addEventListener("click", () => {
      track("intent_click", { intent_id: intent.id, position: position + 1, entry: "quick" });
      requestIntent(intent.id, "quick");
    });
    return button;
  }));
}

function renderBrowse() {
  elements.playlistList.replaceChildren(...BROWSE_PLAYLISTS.map((playlist, index) => {
    const card = document.createElement("article");
    card.className = "playlist-card";
    card.innerHTML = `
      <div class="playlist-cover" style="background:${playlist.gradient}" aria-hidden="true">${playlist.icon}</div>
      <div class="playlist-copy">
        <strong>${playlist.title}</strong>
        <small>YouTube · Seekee Music</small>
      </div>
      <button class="playlist-play" type="button" aria-label="Play ${playlist.title}">▶</button>`;
    card.querySelector("button").addEventListener("click", () => {
      track("playlist_click", { youtube_music_playlist_id: playlist.id, position: index + 1, entry: "existing_content" });
      requestDirectPlaylist(playlist);
    });
    return card;
  }));
}

function setPlaybackState(nextState, message = "") {
  playbackState = nextState;
  const busy = nextState === "REQUESTING" || nextState === "FALLBACK";
  elements.playerSection.setAttribute("aria-busy", String(busy));
  elements.playbackStatus.textContent = message;
  elements.playbackStatus.classList.toggle("error", nextState === "ERROR");
  elements.errorActions.hidden = nextState !== "ERROR";
  document.querySelectorAll(".intent-button, .playlist-play").forEach(button => {
    button.disabled = busy;
  });
}

function revealPlayer() {
  elements.playerSection.hidden = false;
  elements.playerSection.scrollIntoView({ behavior: "auto", block: "center" });
}

function visibleRatio(element) {
  const rect = element.getBoundingClientRect();
  const visibleWidth = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
  const visibleHeight = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
  return (visibleWidth * visibleHeight) / Math.max(1, rect.width * rect.height);
}

async function ensurePlayerVisible() {
  revealPlayer();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (visibleRatio(elements.playerShell) > 0.5) return true;
    elements.playerShell.scrollIntoView({ behavior: "auto", block: "center" });
  }
  return visibleRatio(elements.playerShell) > 0.5;
}

function playbackContext() {
  return { country, language, timeRange };
}

function requestIntent(intentId, entry) {
  const intent = MODULE_CONFIG.intents.find(item => item.id === intentId);
  if (!intent) return;
  const queue = buildCandidateQueue(intent, playbackContext(), sessionId);
  beginRequest({
    intentId,
    intentLabel: intent.labels[language],
    queue,
    entry,
    refineOptions: intent.refineOptions,
  });
}

function requestDirectPlaylist(playlist) {
  beginRequest({
    intentId: "browse",
    intentLabel: playlist.title,
    queue: [{ ...playlist, candidateSource: "existing_content", candidateRank: 1 }],
    entry: "existing_content",
    refineOptions: [],
  });
}

function beginRequest({ intentId, intentLabel, queue, entry, refineOptions }) {
  maybeTrackQuickSkip();
  clearTimeout(candidateTimer);
  requestSerial += 1;
  active = {
    serial: requestSerial,
    intentId,
    intentLabel,
    queue,
    index: 0,
    entry,
    refineOptions,
    playbackSeconds: 0,
    startTracked: false,
    play30Tracked: false,
    play3mTracked: false,
    quickSkipTracked: false,
    failedCandidateId: null,
    nextTrackIndex: 1,
    trackRecoveryAttempts: 0,
    requestStartedAt: performance.now(),
  };
  elements.nowPlaying.hidden = true;
  elements.refineChips.replaceChildren();
  revealPlayer();

  if (!navigator.onLine) {
    showFinalError("offline", copy.offline);
    return;
  }
  if (!queue.length) {
    showFinalError("no_config", copy.unavailable);
    return;
  }
  loadCandidate(0);
}

async function loadCandidate(index) {
  const request = active;
  if (!request || index >= request.queue.length) {
    showFinalError("all_candidates_failed", copy.unavailable);
    return;
  }

  request.index = index;
  request.failedCandidateId = null;
  request.nextTrackIndex = 1;
  request.trackRecoveryAttempts = 0;
  request.playbackSeconds = 0;
  request.startTracked = false;
  request.play30Tracked = false;
  request.play3mTracked = false;
  request.requestStartedAt = performance.now();
  const selected = request.queue[index];
  elements.playlistTitle.textContent = selected.title;
  setPlaybackState(
    selected.candidateSource === "fallback" || index > 0 ? "FALLBACK" : "REQUESTING",
    selected.candidateSource === "fallback" || index > 0 ? copy.fallback : copy.preparing,
  );
  track("play_request", playbackProperties(selected));

  const serial = request.serial;
  const visible = await ensurePlayerVisible();
  if (!active || active.serial !== serial) return;
  if (!visible) {
    handleCandidateFailure("player_not_visible");
    return;
  }

  try {
    await Promise.race([
      playerApiReady,
      new Promise((_, reject) => window.setTimeout(() => reject(new Error("YouTube API timeout")), 10000)),
    ]);
  } catch {
    showFinalError("iframe_api_unavailable", copy.unavailable);
    return;
  }
  if (!active || active.serial !== serial) return;

  if (!player) {
    createPlayer(selected);
  } else if (playerReady) {
    player.loadPlaylist({ list: selected.id, listType: "playlist", index: 0, startSeconds: 0 });
  }

  armCandidateTimeout(serial);
}

function armCandidateTimeout(serial) {
  clearTimeout(candidateTimer);
  candidateTimer = window.setTimeout(() => {
    if (active?.serial === serial && !active.startTracked && playbackState !== "AWAITING_GESTURE") {
      handleCandidateFailure("start_timeout");
    }
  }, 12000);
}

function createPlayer(selected) {
  initialCandidateId = selected.id;
  const playerVars = {
    autoplay: 1,
    controls: 1,
    fs: 1,
    playsinline: 1,
    rel: 0,
    hl: language,
    listType: "playlist",
    list: selected.id,
  };
  if (["http:", "https:"].includes(location.protocol)) playerVars.origin = location.origin;

  player = new window.YT.Player("youtube-player", {
    width: 480,
    height: 270,
    playerVars,
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError,
      onAutoplayBlocked: onAutoplayBlocked,
    },
  });
}

function onPlayerReady(event) {
  playerReady = true;
  const iframe = event.target.getIframe();
  iframe.setAttribute("title", "YouTube playlist player");
  iframe.setAttribute("allow", "autoplay; encrypted-media; fullscreen; picture-in-picture");
  iframe.setAttribute("allowfullscreen", "");
  iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  const current = active?.queue[active.index];
  if (current && current.id !== initialCandidateId) {
    event.target.loadPlaylist({ list: current.id, listType: "playlist", index: 0, startSeconds: 0 });
  }
}

function onPlayerStateChange(event) {
  if (!active) return;
  if (event.data === window.YT.PlayerState.PLAYING) {
    clearTimeout(candidateTimer);
    setPlaybackState("PLAYING", copy.playing);
    elements.nowPlaying.hidden = false;
    renderRefineChips(active.refineOptions);
    if (!active.startTracked) {
      active.startTracked = true;
      const selected = active.queue[active.index];
      track("play_start", {
        ...playbackProperties(selected),
        latency_ms: Math.round(performance.now() - active.requestStartedAt),
      });
    }
    ensurePlaybackTimer();
  } else if (event.data === window.YT.PlayerState.BUFFERING && !active.startTracked) {
    setPlaybackState("REQUESTING", copy.preparing);
  } else if (event.data === window.YT.PlayerState.PAUSED) {
    playbackState = "PAUSED";
  }
}

function onAutoplayBlocked() {
  clearTimeout(candidateTimer);
  setPlaybackState("AWAITING_GESTURE", copy.autoplayBlocked);
  elements.announcement.textContent = copy.autoplayBlocked;
}

function onPlayerError(event) {
  if ((event.data === 101 || event.data === 150) && tryNextEmbeddableTrack(event.data)) return;
  handleCandidateFailure(`youtube_${event.data}`, event.data);
}

function tryNextEmbeddableTrack(youtubeErrorCode) {
  if (!active || !playerReady || active.trackRecoveryAttempts >= 3) return false;
  const playlist = player.getPlaylist?.() || [];
  const nextIndex = active.nextTrackIndex;
  if (!playlist.length || nextIndex >= playlist.length) return false;

  const failed = active.queue[active.index];
  track("play_fail", {
    ...playbackProperties(failed),
    error_code: `youtube_${youtubeErrorCode}`,
    youtube_error_code: youtubeErrorCode,
    failed_track_index: Math.max(0, player.getPlaylistIndex?.() ?? nextIndex - 1),
    recovery: "next_track",
  });
  active.trackRecoveryAttempts += 1;
  active.nextTrackIndex += 1;
  active.requestStartedAt = performance.now();
  setPlaybackState("REQUESTING", copy.preparing);
  player.playVideoAt(nextIndex);
  armCandidateTimeout(active.serial);
  return true;
}

function handleCandidateFailure(errorCode, youtubeErrorCode = null) {
  if (!active) return;
  const failed = active.queue[active.index];
  if (!failed || active.failedCandidateId === failed.id) return;
  active.failedCandidateId = failed.id;
  clearTimeout(candidateTimer);
  track("play_fail", {
    ...playbackProperties(failed),
    error_code: errorCode,
    youtube_error_code: youtubeErrorCode,
    availability_status: navigator.onLine ? "unknown" : "offline",
  });

  const nextIndex = active.index + 1;
  if (nextIndex < active.queue.length) {
    setPlaybackState("FALLBACK", copy.fallback);
    const serial = active.serial;
    window.setTimeout(() => {
      if (active?.serial === serial) loadCandidate(nextIndex);
    }, 250);
    return;
  }
  showFinalError("all_candidates_failed", copy.unavailable, false);
}

function showFinalError(code, message, shouldTrack = true) {
  clearTimeout(candidateTimer);
  setPlaybackState("ERROR", message);
  elements.announcement.textContent = message;
  if (active && shouldTrack) {
    track("play_fail", {
      intent_id: active.intentId,
      error_code: code,
      youtube_music_playlist_id: active.queue[active.index]?.id || null,
      playlist_source: MODULE_CONFIG.playlistSource,
    });
  }
}

function playbackProperties(candidate) {
  return {
    intent_id: active.intentId,
    entry: active.entry,
    youtube_music_playlist_id: candidate.id,
    playlist_source: MODULE_CONFIG.playlistSource,
    candidate_rank: candidate.candidateRank,
    candidate_source: candidate.candidateSource,
  };
}

function ensurePlaybackTimer() {
  if (playbackTimer) return;
  playbackTimer = window.setInterval(() => {
    if (!active || !playerReady || player.getPlayerState() !== window.YT.PlayerState.PLAYING) return;
    active.playbackSeconds += 1;
    const selected = active.queue[active.index];
    if (active.playbackSeconds >= 30 && !active.play30Tracked) {
      active.play30Tracked = true;
      track("play_30s", playbackProperties(selected));
    }
    if (active.playbackSeconds >= 180 && !active.play3mTracked) {
      active.play3mTracked = true;
      track("play_3m", playbackProperties(selected));
    }
  }, 1000);
}

function maybeTrackQuickSkip() {
  if (!active?.startTracked || active.quickSkipTracked || active.playbackSeconds >= 10) return;
  active.quickSkipTracked = true;
  const selected = active.queue[active.index];
  track("first_track_skip", {
    ...playbackProperties(selected),
    elapsed_ms: active.playbackSeconds * 1000,
  });
}

function renderRefineChips(options) {
  elements.refineChips.replaceChildren(...options.slice(0, 3).map(option => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "refine-chip";
    button.textContent = REFINE_LABELS[option][language];
    button.addEventListener("click", () => handleRefine(option));
    return button;
  }));
}

function handleRefine(option) {
  if (!active) return;
  const selected = active.queue[active.index];
  if (option === "shuffle") {
    track("shuffle_click", {
      intent_id: active.intentId,
      previous_youtube_music_playlist_id: selected.id,
    });
  } else {
    track("refine_click", { intent_id: active.intentId, refine_value: option });
  }
  if (option === "liftMe") {
    requestIntent("energy", "refine");
    return;
  }
  maybeTrackQuickSkip();
  active.index = (active.index + 1) % active.queue.length;
  active.serial = ++requestSerial;
  loadCandidate(active.index);
}

function openAssistant() {
  track("assistant_start", { entry: "assistant" });
  assistantStep = 1;
  assistantMoment = null;
  assistantLaunchingPlayback = false;
  if (!elements.playerSection.hidden) {
    if (playerReady) player.pauseVideo();
    elements.playerSection.hidden = true;
    playerHiddenForDialog = true;
  }
  renderAssistant();
  elements.assistantDialog.showModal();
}

function renderAssistant() {
  const firstStep = assistantStep === 1;
  const options = firstStep ? ASSISTANT_OPTIONS.moments : ASSISTANT_OPTIONS.energies;
  elements.assistantBack.hidden = firstStep;
  elements.assistantStep.textContent = copy.assistantStep(assistantStep);
  elements.assistantTitle.textContent = firstStep ? copy.assistantMomentTitle : copy.assistantEnergyTitle;
  elements.assistantSubtitle.textContent = firstStep ? copy.assistantMomentSub : copy.assistantEnergySub;
  elements.assistantOptions.replaceChildren(...options.map(option => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "assistant-option";
    button.innerHTML = `<span aria-hidden="true">${option.icon}</span> ${option.labels[language]}`;
    if (firstStep && option.id === assistantMoment) button.classList.add("selected");
    button.addEventListener("click", () => {
      track("assistant_select", { step: assistantStep, value: option.id });
      if (firstStep) {
        assistantMoment = option.id;
        assistantStep = 2;
        renderAssistant();
        return;
      }
      const intentId = resolveAssistantIntent(assistantMoment, option.id);
      assistantLaunchingPlayback = true;
      elements.assistantDialog.close();
      requestIntent(intentId, "assistant");
    });
    return button;
  }));
}

function closeAssistant() {
  elements.assistantDialog.close();
}

elements.assistantEntry.addEventListener("click", openAssistant);
elements.assistantBack.addEventListener("click", () => {
  assistantStep = 1;
  renderAssistant();
});
elements.assistantClose.addEventListener("click", closeAssistant);
elements.assistantDialog.addEventListener("cancel", event => {
  event.preventDefault();
  closeAssistant();
});
elements.assistantDialog.addEventListener("click", event => {
  if (event.target === elements.assistantDialog) closeAssistant();
});
elements.assistantDialog.addEventListener("close", () => {
  if (playerHiddenForDialog && !assistantLaunchingPlayback) elements.playerSection.hidden = false;
  playerHiddenForDialog = false;
});
elements.retryButton.addEventListener("click", () => {
  if (!active) return;
  active.serial = ++requestSerial;
  loadCandidate(0);
});

function observeModuleView() {
  if (!featureEnabled) return;
  let tracked = false;
  const send = () => {
    if (tracked) return;
    tracked = true;
    track("intent_module_view", {
      positions: MODULE_CONFIG.intents.map((_, index) => index + 1),
      intent_ids: MODULE_CONFIG.intents.map(intent => intent.id),
    });
  };
  if (!("IntersectionObserver" in window)) {
    send();
    return;
  }
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.5)) {
      send();
      observer.disconnect();
    }
  }, { threshold: 0.5 });
  observer.observe(elements.intentModule);
}

const configErrors = validateModuleConfig(MODULE_CONFIG);
if (configErrors.length) {
  console.error("Invalid module config", configErrors);
  elements.intentModule.hidden = true;
} else if (!featureEnabled) {
  elements.intentModule.hidden = true;
}

applyCopy();
renderIntents();
renderBrowse();
loadYouTubeApi();
track("music_tab_impression");
observeModuleView();
