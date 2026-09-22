const stage = document.getElementById("stage");
const claimBtn = document.getElementById("claim-btn");
const emptyMessageEl = document.getElementById("empty-message");
const adSurface = document.getElementById("ad-surface");
const progressFill = document.getElementById("progress-fill");
const timerLabel = document.getElementById("timer-label");
const skipBtn = document.getElementById("skip-btn");
const finishBtn = document.getElementById("finish-btn");
const againBtn = document.getElementById("again-btn");

const params = new URLSearchParams(location.search);
const siteKey = params.get("site");

let config = null;
let activeTimer = null;
let currentAd = null;

function getViewerId() {
  try {
    let vid = localStorage.getItem("werbung_vid");
    if (!vid) {
      vid = crypto.randomUUID();
      localStorage.setItem("werbung_vid", vid);
    }
    return vid;
  } catch {
    return null; // storage blocked (private mode etc.) — frequency capping just won't apply
  }
}

function postToParent(type, extra = {}) {
  try {
    window.parent.postMessage({ type, ...extra }, "*");
  } catch {
    // no parent frame (page opened directly) — ignore
  }
}

function setState(state) {
  stage.dataset.state = state;
}

function withSite(url) {
  if (!siteKey) return url;
  const u = new URL(url, location.origin);
  u.searchParams.set("site", siteKey);
  return u.pathname + u.search;
}

async function loadConfig() {
  try {
    const res = await fetch(withSite("/api/config"));
    config = await res.json();
  } catch {
    config = { buttonText: "Belohnung beanspruchen", accentColor: "#6d5bff", fallbackBehavior: "grant", fallbackMessage: "Danke!" };
  }
  document.documentElement.style.setProperty("--accent", config.accentColor);
  claimBtn.textContent = config.buttonText;
  setState("idle");
  postToParent("werbung:ready");
}

window.addEventListener("message", (event) => {
  if (event.data && event.data.type === "werbung:reset") {
    cancelTimer();
    setState("idle");
  }
});

const isPreview = !!params.get("preview");

function logEvent(type, adId) {
  if (isPreview) return; // previews from the admin panel must not pollute real stats
  const body = JSON.stringify({ type, adId, site: siteKey, viewerId: getViewerId() });
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
  } else {
    fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
  }
}

// "complete" needs the server's response (the reward token) so it can't use
// sendBeacon like the other events — but it must still never block the UI.
async function logCompleteAndGetToken(adId) {
  if (isPreview) return null;
  try {
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "complete", adId, site: siteKey, viewerId: getViewerId() }),
    });
    const data = await res.json();
    return data.rewardToken ?? null;
  } catch {
    return null;
  }
}

function getLastAdId() {
  try { return sessionStorage.getItem("werbung_last_ad"); } catch { return null; }
}
function setLastAdId(adId) {
  try { if (adId) sessionStorage.setItem("werbung_last_ad", adId); } catch { /* ignore */ }
}

claimBtn.addEventListener("click", claim);
againBtn.addEventListener("click", claim);

async function claim() {
  claimBtn.disabled = true;
  setState("loading");
  try {
    const lastAdId = getLastAdId();
    const query = `vid=${encodeURIComponent(getViewerId() || "")}${lastAdId ? `&last=${encodeURIComponent(lastAdId)}` : ""}`;
    const res = await fetch(withSite(`/api/ad?${query}`));
    const data = await res.json();
    claimBtn.disabled = false;

    if (!data.ad) {
      handleEmpty();
      return;
    }
    currentAd = data.ad;
    renderAd(currentAd);
  } catch {
    claimBtn.disabled = false;
    setState("idle");
  }
}

async function handleEmpty() {
  if (config?.fallbackBehavior === "grant") {
    setState("done");
    const rewardToken = await logCompleteAndGetToken(null);
    postToParent("werbung:reward", { adId: null, rewardToken });
  } else {
    emptyMessageEl.textContent = config?.fallbackMessage || "Danke!";
    setState("empty");
    setTimeout(() => setState("idle"), 3000);
  }
}

function cancelTimer() {
  if (activeTimer) {
    activeTimer.cancel();
    activeTimer = null;
  }
}

function renderAd(ad) {
  adSurface.innerHTML = "";
  adSurface.className = "ad-surface";
  skipBtn.hidden = true;
  finishBtn.hidden = true;
  progressFill.parentElement.style.visibility = "visible";
  timerLabel.textContent = "";

  const clickable = ad.clickAction !== "none" && ad.type !== "html";
  if (!clickable) adSurface.classList.add("no-click");

  let videoEl = null;

  if (ad.type === "image") {
    const img = document.createElement("img");
    img.src = `/media/${ad.mediaKey}`;
    img.alt = ad.title || ad.name || "Werbung";
    if (clickable) img.addEventListener("click", onAdClick);
    adSurface.appendChild(img);
  } else if (ad.type === "video") {
    videoEl = document.createElement("video");
    videoEl.src = `/media/${ad.mediaKey}`;
    videoEl.playsInline = true;
    // The viewer already clicked the claim button to get here — that counts
    // as a user gesture, so try playing with sound instead of forcing mute.
    videoEl.muted = false;
    if (clickable) videoEl.addEventListener("click", onAdClick);
    // A broken/missing media file must not leave the viewer stuck forever
    // with no way to skip and no reward ever firing.
    videoEl.addEventListener("error", () => onSkip(ad), { once: true });
    adSurface.appendChild(videoEl);

    const unmute = document.createElement("button");
    unmute.className = "unmute-btn";
    unmute.type = "button";
    unmute.textContent = "🔊";
    unmute.addEventListener("click", (e) => {
      e.stopPropagation();
      videoEl.muted = !videoEl.muted;
      unmute.textContent = videoEl.muted ? "🔇" : "🔊";
    });
    adSurface.appendChild(unmute);

    videoEl.play().catch(() => {
      // Some browsers still refuse unmuted autoplay here — fall back to
      // muted rather than leaving the video frozen on its first frame.
      videoEl.muted = true;
      unmute.textContent = "🔇";
      videoEl.play().catch(() => {});
    });
  } else if (ad.type === "html") {
    const frame = document.createElement("iframe");
    frame.className = "creative-frame";
    frame.sandbox = "allow-scripts allow-popups";
    frame.srcdoc = ad.content || "";
    adSurface.appendChild(frame);
  } else {
    // text or link
    const card = document.createElement("div");
    card.className = clickable ? "ad-card" : "ad-card no-click";
    if (clickable) card.addEventListener("click", onAdClick);

    const eyebrow = document.createElement("div");
    eyebrow.className = "ad-eyebrow";
    eyebrow.textContent = "Anzeige";
    card.appendChild(eyebrow);

    if (ad.title) {
      const title = document.createElement("p");
      title.className = "ad-title";
      title.textContent = ad.title;
      card.appendChild(title);
    }
    if (ad.content) {
      const body = document.createElement("p");
      body.className = "ad-body";
      body.textContent = ad.content;
      card.appendChild(body);
    }
    if (ad.type === "link" && clickable) {
      const cta = document.createElement("span");
      cta.className = "ad-cta";
      cta.textContent = "Mehr erfahren";
      card.appendChild(cta);
    }
    adSurface.appendChild(card);
  }

  setState("playing");

  if (ad.skipAfterSeconds != null) {
    setTimeout(() => { if (currentAd === ad) skipBtn.hidden = false; }, ad.skipAfterSeconds * 1000);
  }
  skipBtn.onclick = () => onSkip(ad);

  if (ad.durationMode === "manual") {
    progressFill.parentElement.style.visibility = "hidden";
    finishBtn.hidden = false;
    finishBtn.onclick = () => completeAd(ad);
  } else if (ad.durationMode === "until_finished" && videoEl) {
    videoEl.addEventListener("timeupdate", () => {
      if (videoEl.duration) {
        progressFill.style.width = `${(videoEl.currentTime / videoEl.duration) * 100}%`;
        timerLabel.textContent = `Noch ${Math.max(0, Math.ceil(videoEl.duration - videoEl.currentTime))}s`;
      }
    });
    videoEl.addEventListener("ended", () => completeAd(ad));
  } else {
    const seconds = ad.durationSeconds || 5;
    activeTimer = runCountdown(seconds, () => completeAd(ad));
  }
}

function runCountdown(totalSeconds, onDone) {
  const start = performance.now();
  let raf = null;
  let done = false;

  function tick(now) {
    const elapsed = (now - start) / 1000;
    const remaining = Math.max(0, totalSeconds - elapsed);
    progressFill.style.width = `${((totalSeconds - remaining) / totalSeconds) * 100}%`;
    timerLabel.textContent = `Weiter in ${Math.ceil(remaining)}s`;
    if (remaining <= 0) {
      if (!done) { done = true; onDone(); }
      return;
    }
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  return { cancel: () => { done = true; if (raf) cancelAnimationFrame(raf); } };
}

function onAdClick() {
  if (!currentAd) return;
  logEvent("click", currentAd.id);
  const ad = currentAd;

  if (ad.clickAction === "open_url" && ad.clickUrl) {
    // Opens in a new tab — the viewer stays on this page, so the ad must
    // keep playing normally and only reward once it actually finishes.
    window.open(ad.clickUrl, "_blank", "noopener,noreferrer");
  } else if (ad.clickAction === "redirect_top") {
    try { window.top.location.href = ad.clickUrl; } catch { window.open(ad.clickUrl, "_blank", "noopener,noreferrer"); }
    completeAd(ad);
  } else if (ad.clickAction === "postmessage") {
    postToParent("werbung:click", { adId: ad.id, payload: ad.postmessagePayload ?? null });
  }
}

async function completeAd(ad) {
  if (currentAd !== ad) return;
  cancelTimer();
  currentAd = null;
  setLastAdId(ad.id);
  setState("done");
  const rewardToken = await logCompleteAndGetToken(ad.id);
  postToParent("werbung:reward", { adId: ad.id, rewardToken });
}

function onSkip(ad) {
  if (currentAd !== ad) return;
  cancelTimer();
  logEvent("skip", ad.id);
  currentAd = null;
  setState("skipped");
  setTimeout(() => setState("idle"), 1800);
}

const previewId = params.get("preview");
if (previewId) {
  loadConfig().then(async () => {
    const res = await fetch(`/api/ad?preview=${encodeURIComponent(previewId)}`);
    const data = await res.json();
    if (data.ad) { currentAd = data.ad; renderAd(currentAd); }
  });
} else {
  loadConfig();
}
