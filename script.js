/* global SpeechSynthesisUtterance */

const STORAGE_KEYS = {
  vocabSource: "vocab.source",
  vocabMode: "vocab.mode",
  vocabProgress: "vocab.progress.v1",
  voiceURI: "vocab.voiceURI",
  rate: "vocab.rate",
};

function $(id) {
  return document.getElementById(id);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeWord(w) {
  return String(w || "")
    .trim()
    .replaceAll(/\s+/g, " ")
    .toLowerCase();
}

function diffMarkup(expected, actual) {
  const e = normalizeWord(expected);
  const aRaw = String(actual ?? "").trim();
  const a = normalizeWord(aRaw);
  const maxLen = Math.max(e.length, a.length);
  let out = "";
  for (let i = 0; i < maxLen; i++) {
    const ec = e[i] ?? "";
    const ac = a[i] ?? "";
    if (!ac && ec) {
      out += '<span class="bad">•</span>';
      continue;
    }
    if (!ec && ac) {
      out += `<span class="bad">${escapeHtml(ac)}</span>`;
      continue;
    }
    out += ec === ac ? escapeHtml(ac) : `<span class="bad">${escapeHtml(ac || "•")}</span>`;
  }
  return out || escapeHtml(aRaw);
}

function parseVocab(text) {
  const src = String(text ?? "").trim();
  if (!src) return [];

  if (src.startsWith("[") || src.startsWith("{")) {
    try {
      const data = JSON.parse(src);
      if (Array.isArray(data)) {
        return data
          .map((x) => {
            if (!x) return null;
            if (typeof x === "string") return { word: x, meaning: "" };
            if (typeof x === "object") {
              const word = x.word ?? x.term ?? x.en ?? x.w ?? "";
              const meaning = x.meaning ?? x.translation ?? x.zh ?? x.m ?? "";
              return { word: String(word).trim(), meaning: String(meaning).trim() };
            }
            return null;
          })
          .filter((x) => x && x.word);
      }
      if (data && typeof data === "object") {
        return Object.entries(data)
          .map(([word, meaning]) => ({ word: String(word).trim(), meaning: String(meaning).trim() }))
          .filter((x) => x.word);
      }
    } catch {
      // fallthrough
    }
  }

  const lines = src.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items = [];
  for (const line of lines) {
    const tabIdx = line.indexOf("\t");
    if (tabIdx >= 0) {
      const word = line.slice(0, tabIdx).trim();
      const meaning = line.slice(tabIdx + 1).trim();
      if (word) items.push({ word, meaning });
      continue;
    }
    const commaIdx = line.indexOf(",");
    if (commaIdx >= 0) {
      const word = line.slice(0, commaIdx).trim();
      const meaning = line.slice(commaIdx + 1).trim();
      if (word) items.push({ word, meaning });
      continue;
    }
    items.push({ word: line, meaning: "" });
  }
  return items;
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getDefaultSample() {
  return [
    { word: "apple", meaning: "苹果" },
    { word: "banana", meaning: "香蕉" },
    { word: "teacher", meaning: "老师" },
    { word: "classroom", meaning: "教室" },
    { word: "practice", meaning: "练习" },
    { word: "language", meaning: "语言" },
  ]
    .map((x) => `${x.word}\t${x.meaning}`)
    .join("\n");
}

const app = {
  items: [],
  activeIndex: 0,
  mode: "A",
  started: false,
  progress: {},
  voices: [],
  voiceURI: "",
  rate: 1,
};

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const t = String(text || "").trim();
  if (!t) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(t);
  u.rate = clamp(Number(app.rate) || 1, 0.5, 1.5);
  const v = app.voices.find((vv) => vv.voiceURI === app.voiceURI);
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
}

function stopSpeak() {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
}

function render() {
  const body = $("vocabBody");
  if (!body) return;

  body.innerHTML = app.items
    .map((it, idx) => {
      const p = app.progress[idx] || {};
      const inputVal = p.input ?? "";
      const checked = Boolean(p.checked);
      const ok = Boolean(p.ok);

      const wordHidden = app.mode === "B" && !checked;
      const meaningHidden = app.mode === "A" && !checked;

      const wordCell = `<span class="vocab-term ${wordHidden ? "is-hidden" : ""}" data-idx="${idx}">${escapeHtml(
        it.word
      )}</span>`;

      const meaningCell = `<span class="vocab-meaning ${meaningHidden ? "is-hidden" : ""}" data-idx="${idx}">${
        checked && app.mode === "A"
          ? `<span class="diff">${diffMarkup(it.word, inputVal)}</span> <span class="hint">（正确：${escapeHtml(
              it.word
            )}）</span>`
          : escapeHtml(it.meaning || "")
      }</span>`;

      const speakBtn = `<button class="speak-btn" type="button" data-speak="${idx}" aria-label="朗读第 ${
        idx + 1
      } 个单词">🔊</button>`;

      return `
        <tr class="vocab-row ${idx === app.activeIndex ? "is-active" : ""}" data-row="${idx}">
          <td class="col-no">${idx + 1}</td>
          <td class="col-word">
            <span class="vocab-word">${speakBtn}${wordCell}</span>
          </td>
          <td class="col-meaning">${meaningCell}</td>
          <td class="col-input">
            <input
              class="vocab-input"
              data-input="${idx}"
              value="${escapeHtml(inputVal)}"
              placeholder="在此输入，回车判定"
              autocomplete="off"
              spellcheck="false"
              ${app.started ? "" : "disabled"}
            />
            ${
              checked
                ? `<p class="hint" style="margin:6px 0 0; color:${ok ? "var(--accent-2)" : "var(--danger)"}">${
                    ok ? "正确" : "有错误"
                  }</p>`
                : ""
            }
          </td>
        </tr>
      `;
    })
    .join("");
}

function saveProgress() {
  saveJSON(STORAGE_KEYS.vocabProgress, {
    itemsHash: app.items.map((x) => `${x.word}\t${x.meaning}`).join("\n"),
    activeIndex: app.activeIndex,
    progress: app.progress,
  });
}

function loadProgressFor(items) {
  const saved = loadJSON(STORAGE_KEYS.vocabProgress, null);
  const hash = items.map((x) => `${x.word}\t${x.meaning}`).join("\n");
  if (!saved || saved.itemsHash !== hash) return { activeIndex: 0, progress: {} };
  return {
    activeIndex: clamp(Number(saved.activeIndex) || 0, 0, Math.max(0, items.length - 1)),
    progress: saved.progress || {},
  };
}

function focusActiveInput() {
  const el = document.querySelector(`input[data-input="${app.activeIndex}"]`);
  if (el) el.focus();
}

function setActiveIndex(next) {
  const max = app.items.length - 1;
  if (max < 0) return;
  app.activeIndex = clamp(next, 0, max);
  render();
  focusActiveInput();
  if (app.started) speak(app.items[app.activeIndex]?.word);
  saveProgress();
}

function checkRow(idx) {
  const it = app.items[idx];
  if (!it) return;
  const p = app.progress[idx] || {};
  const input = String(p.input ?? "");
  const ok = normalizeWord(input) === normalizeWord(it.word);
  app.progress[idx] = { input, checked: true, ok };
  saveProgress();
  render();
  focusActiveInput();
}

function applyFromSource(text) {
  const status = $("vocabStatus");
  const items = parseVocab(text).filter((x) => x.word);
  app.items = items;
  const { activeIndex, progress } = loadProgressFor(items);
  app.activeIndex = activeIndex;
  app.progress = progress;
  render();

  if (status) status.textContent = items.length ? `已载入 ${items.length} 个单词。` : "词库为空，请检查格式。";
}

function start() {
  if (!app.items.length) return;
  app.started = true;
  render();
  focusActiveInput();
  speak(app.items[app.activeIndex]?.word);
}

function stop() {
  app.started = false;
  stopSpeak();
  render();
}

function clearProgress() {
  app.progress = {};
  app.activeIndex = 0;
  localStorage.removeItem(STORAGE_KEYS.vocabProgress);
  render();
  focusActiveInput();
}

function setMode(mode) {
  app.mode = mode === "B" ? "B" : "A";
  localStorage.setItem(STORAGE_KEYS.vocabMode, app.mode);
  render();
  focusActiveInput();
}

function initVoices() {
  if (!("speechSynthesis" in window)) return;
  const sel = $("voiceSelect");
  function refresh() {
    app.voices = window.speechSynthesis.getVoices() || [];
    if (!sel) return;
    const current = localStorage.getItem(STORAGE_KEYS.voiceURI) || "";
    sel.innerHTML =
      `<option value="">自动</option>` +
      app.voices
        .map((v) => {
          const label = `${v.name}${v.lang ? ` (${v.lang})` : ""}`;
          const selected = v.voiceURI === current ? "selected" : "";
          return `<option value="${escapeHtml(v.voiceURI)}" ${selected}>${escapeHtml(label)}</option>`;
        })
        .join("");
    app.voiceURI = current;
  }
  refresh();
  window.speechSynthesis.onvoiceschanged = refresh;
}

function wireEvents() {
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const speakIdx = t.getAttribute("data-speak");
    if (speakIdx != null) {
      const idx = Number(speakIdx);
      setActiveIndex(idx);
      speak(app.items[idx]?.word);
    }
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    const idxStr = t.getAttribute("data-input");
    if (idxStr == null) return;
    const idx = Number(idxStr);
    app.progress[idx] = { ...(app.progress[idx] || {}), input: t.value };
    saveProgress();
  });

  document.addEventListener("keydown", (e) => {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement)) return;
    const idxStr = active.getAttribute("data-input");
    if (idxStr == null) return;
    const idx = Number(idxStr);

    if (e.key === "Enter") {
      e.preventDefault();
      checkRow(idx);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(idx - 1);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(idx + 1);
    }
  });

  $("startVocabBtn")?.addEventListener("click", start);
  $("stopVocabBtn")?.addEventListener("click", stop);
  $("clearProgressBtn")?.addEventListener("click", clearProgress);

  $("applyVocabBtn")?.addEventListener("click", () => {
    const src = $("vocabSource")?.value ?? "";
    localStorage.setItem(STORAGE_KEYS.vocabSource, src);
    applyFromSource(src);
  });

  $("loadSampleBtn")?.addEventListener("click", () => {
    const sample = getDefaultSample();
    const ta = $("vocabSource");
    if (ta) ta.value = sample;
    localStorage.setItem(STORAGE_KEYS.vocabSource, sample);
    applyFromSource(sample);
  });

  $("modeSelect")?.addEventListener("change", (e) => {
    const t = e.target;
    if (t instanceof HTMLSelectElement) setMode(t.value);
  });

  $("rate")?.addEventListener("input", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    app.rate = Number(t.value);
    localStorage.setItem(STORAGE_KEYS.rate, String(app.rate));
  });

  $("voiceSelect")?.addEventListener("change", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLSelectElement)) return;
    app.voiceURI = t.value;
    localStorage.setItem(STORAGE_KEYS.voiceURI, app.voiceURI);
  });
}

function init() {
  const mode = localStorage.getItem(STORAGE_KEYS.vocabMode) || "A";
  app.mode = mode === "B" ? "B" : "A";
  const modeSelect = $("modeSelect");
  if (modeSelect) modeSelect.value = app.mode;

  const rate = Number(localStorage.getItem(STORAGE_KEYS.rate) || "1");
  app.rate = clamp(rate || 1, 0.6, 1.3);
  const rateEl = $("rate");
  if (rateEl) rateEl.value = String(app.rate);

  const src = localStorage.getItem(STORAGE_KEYS.vocabSource) || getDefaultSample();
  const ta = $("vocabSource");
  if (ta) ta.value = src;
  applyFromSource(src);

  initVoices();
  wireEvents();
}

document.addEventListener("DOMContentLoaded", init);

