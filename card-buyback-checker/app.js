import { compareCard, evaluate, parseBuybackCsv, parsePrice, LEVEL_LABEL } from "./matching.js";
import { DEFAULT_MODEL, readShowcase, readBuybackList, lookupBuybackOnWeb, describeError } from "./claude.js";

// ---------- 保存 ----------
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* プライベートモード等では保存しない */
    }
  },
};

const state = {
  settings: { apiKey: "", model: DEFAULT_MODEL, threshold: 85, ...store.get("settings", {}) },
  buyback: store.get("buyback", []),
  cards: store.get("cards", []),
};
const saveBuyback = () => store.set("buyback", state.buyback);
const saveCards = () => store.set("cards", state.cards);
const uid = () => Math.random().toString(36).slice(2, 10);
const yen = (n) => (n || n === 0 ? `¥${Math.round(n).toLocaleString("ja-JP")}` : "—");
const $ = (sel) => document.querySelector(sel);

// ---------- タブ ----------
document.querySelectorAll(".tabs button").forEach((btn) =>
  btn.addEventListener("click", () => showTab(btn.dataset.tab)),
);
function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.id !== `tab-${name}`));
}

function setStatus(el, msg, kind = "info") {
  el.hidden = !msg;
  el.className = `status ${kind}`;
  el.textContent = msg || "";
}

function requireKey() {
  if (state.settings.apiKey) return true;
  showTab("settings");
  $("#api-key").focus();
  alert("先に API キーを設定してください。");
  return false;
}

// ---------- 画像の縮小（通信量・コスト削減。値札の文字が読める解像度は保つ） ----------
async function loadImage(file, maxEdge = 2400) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { mediaType: "image/jpeg", data: dataUrl.split(",")[1] };
}

// ---------- 照合 ----------
$("#showcase-input").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length || !requireKey()) return;
  const status = $("#scan-status");
  try {
    setStatus(status, `写真を準備中…（${files.length}枚）`);
    const images = await Promise.all(files.map((f) => loadImage(f)));
    setStatus(status, "AI がショーケースを読み取り中…（30秒〜1分ほどかかります）");
    const result = await readShowcase(state.settings.apiKey, state.settings.model, images);
    const base = state.cards.length;
    const added = result.cards.map((c, i) => ({ ...c, id: uid(), order: base + i, match: "auto", web: null }));
    state.cards = [...state.cards, ...added];
    saveCards();
    renderResults();
    const note = result.notes ? `\nメモ: ${result.notes}` : "";
    setStatus(status, `${added.length}枚のカードを読み取りました。値札の読み違いはタップして修正できます。${note}`, "ok");
  } catch (err) {
    setStatus(status, describeError(err), "error");
  }
});

function computed(card) {
  const greatRatio = state.settings.threshold / 100;
  const cmp = compareCard(card, state.buyback, greatRatio);
  if (card.match === "none") return { ...cmp, best: null, diff: null, ratio: null, level: "unknown" };
  if (card.match !== "auto") {
    const picked = state.buyback.find((b) => b.id === card.match);
    if (picked) {
      const best = { entry: picked, score: 1, reason: "手動選択" };
      return { ...cmp, best, ...evaluate(card.price, picked.price, greatRatio) };
    }
  }
  return cmp;
}

function renderResults() {
  const list = $("#results");
  list.innerHTML = "";
  const rows = state.cards.map((c) => ({ card: c, r: computed(c) }));
  const onlyMatched = $("#only-matched").checked;
  const sort = $("#sort-select").value;
  const sorted = rows
    .filter(({ r }) => !onlyMatched || r.best)
    .sort((a, b) => {
      if (sort === "position") return a.card.order - b.card.order;
      if (sort === "price") return (b.card.price || 0) - (a.card.price || 0);
      const key = sort === "diff" ? "diff" : "ratio";
      return (b.r[key] ?? -Infinity) - (a.r[key] ?? -Infinity);
    });

  for (const { card, r } of sorted) list.appendChild(renderCard(card, r));

  $("#result-toolbar").hidden = !state.cards.length;
  renderSummary(rows);
}

function renderCard(card, r) {
  const li = $("#card-template").content.firstElementChild.cloneNode(true);
  li.dataset.level = r.level;
  li.querySelector(".name").value = card.name;
  li.querySelector(".number").value = card.card_number;
  li.querySelector(".rarity").value = card.rarity;
  li.querySelector(".sale").value = card.price ? card.price.toLocaleString("ja-JP") : "";
  li.querySelector(".pos").textContent = [
    card.position,
    card.condition,
    card.confidence === "low" ? "⚠ 読み取り不確か" : card.confidence === "medium" ? "読み取りやや不確か" : "",
  ].filter(Boolean).join(" ・ ");

  li.querySelector(".badge").textContent =
    r.level === "unknown" ? LEVEL_LABEL.unknown : `${LEVEL_LABEL[r.level]}`;
  li.querySelector(".buy").textContent = r.best ? yen(r.best.entry.price) : "—";
  li.querySelector(".shop").textContent = r.best ? ` ${r.best.entry.shop || ""}` : "";
  const diffEl = li.querySelector(".diff");
  diffEl.textContent = r.diff === null ? "—" : `${r.diff >= 0 ? "+" : "−"}${yen(Math.abs(r.diff))}`;
  diffEl.classList.toggle("plus", r.diff > 0);
  li.querySelector(".ratio").textContent = r.ratio === null ? "—" : `${Math.round(r.ratio * 100)}%`;
  li.querySelector(".bar span").style.width = r.ratio === null ? "0" : `${Math.min(100, r.ratio * 100)}%`;

  // 照合候補
  const sel = li.querySelector(".candidate");
  const opt = (value, label) => Object.assign(document.createElement("option"), { value, textContent: label });
  sel.appendChild(opt("auto", r.candidates.length ? "自動照合（最高買取）" : "候補なし"));
  for (const c of r.candidates) {
    const e = c.entry;
    sel.appendChild(opt(e.id, `${e.name} ${e.card_number || ""} ${e.rarity || ""} ${yen(e.price)} ${e.shop || ""}（${c.reason}）`));
  }
  if (card.match !== "auto" && card.match !== "none" && !r.candidates.some((c) => c.entry.id === card.match)) {
    const e = state.buyback.find((b) => b.id === card.match);
    if (e) sel.appendChild(opt(e.id, `${e.name} ${yen(e.price)} ${e.shop || ""}（手動）`));
  }
  sel.appendChild(opt("none", "照合しない（別カード）"));
  sel.value = card.match;

  const update = (patch) => {
    Object.assign(card, patch);
    saveCards();
    renderResults();
  };
  li.querySelector(".name").addEventListener("change", (e) => update({ name: e.target.value, match: "auto" }));
  li.querySelector(".number").addEventListener("change", (e) => update({ card_number: e.target.value, match: "auto" }));
  li.querySelector(".rarity").addEventListener("change", (e) => update({ rarity: e.target.value, match: "auto" }));
  li.querySelector(".sale").addEventListener("change", (e) => update({ price: parsePrice(e.target.value) }));
  sel.addEventListener("change", (e) => update({ match: e.target.value }));
  li.querySelector(".remove").addEventListener("click", () => {
    state.cards = state.cards.filter((c) => c.id !== card.id);
    saveCards();
    renderResults();
  });

  // Web で買取相場
  const webBox = li.querySelector(".web-result");
  if (card.web) renderWeb(webBox, card);
  li.querySelector(".web").addEventListener("click", async (e) => {
    if (!requireKey()) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "検索中…";
    webBox.hidden = false;
    webBox.textContent = "各ショップの買取価格を検索しています（〜1分）";
    try {
      card.web = await lookupBuybackOnWeb(state.settings.apiKey, state.settings.model, card);
      saveCards();
      renderWeb(webBox, card);
    } catch (err) {
      webBox.textContent = describeError(err);
    } finally {
      btn.disabled = false;
      btn.textContent = "🔎 Webで買取相場";
    }
  });
  return li;
}

function renderWeb(box, card) {
  const w = card.web;
  box.hidden = false;
  box.innerHTML = "";
  const head = document.createElement("div");
  head.innerHTML = `<b>Web 買取相場:</b> ${w.best_price ? yen(w.best_price) : "見つかりませんでした"}`;
  box.appendChild(head);
  const ul = document.createElement("ul");
  for (const s of w.sources || []) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = s.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = s.shop || s.url;
    li.append(a, ` ${yen(s.price)}`);
    ul.appendChild(li);
  }
  box.appendChild(ul);
  if (w.note) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = w.note;
    box.appendChild(p);
  }
  if (w.best_price) {
    const add = document.createElement("button");
    add.textContent = "この価格を買取表に追加して照合";
    add.addEventListener("click", () => {
      const top = (w.sources || []).reduce((a, b) => ((b.price || 0) > (a?.price || 0) ? b : a), null);
      const entry = {
        id: uid(),
        name: card.name,
        card_number: card.card_number,
        rarity: card.rarity,
        price: w.best_price,
        shop: `Web: ${top?.shop || "相場"}`,
        addedAt: Date.now(),
      };
      state.buyback.push(entry);
      saveBuyback();
      card.match = entry.id;
      saveCards();
      renderBuyback();
      renderResults();
    });
    box.appendChild(add);
  }
}

function renderSummary(rows) {
  const el = $("#summary");
  if (!rows.length) {
    el.hidden = true;
    return;
  }
  const matched = rows.filter(({ card, r }) => r.best && card.price);
  const sale = matched.reduce((s, { card }) => s + card.price, 0);
  const buy = matched.reduce((s, { r }) => s + r.best.entry.price, 0);
  const profitable = matched.filter(({ r }) => r.diff > 0);
  const profit = profitable.reduce((s, { r }) => s + r.diff, 0);
  const great = matched.filter(({ r }) => r.level === "great").length;
  el.hidden = false;
  el.innerHTML = `
    <div class="stat"><span class="label">読み取り</span><b>${rows.length}枚</b><small>照合 ${matched.length}枚</small></div>
    <div class="stat"><span class="label">平均買取率</span><b>${sale ? Math.round((buy / sale) * 100) + "%" : "—"}</b><small>照合分の合計比</small></div>
    <div class="stat good"><span class="label">利益が出るカード</span><b>${profitable.length}枚</b><small>${profit ? "合計 +" + yen(profit) : "—"}</small></div>
    <div class="stat"><span class="label">かなり割安</span><b>${great}枚</b><small>買取率 ${state.settings.threshold}%以上</small></div>
    <button id="clear-cards" class="link">結果をクリア</button>`;
  el.querySelector("#clear-cards").addEventListener("click", () => {
    if (!confirm("読み取り結果をすべて消しますか？")) return;
    state.cards = [];
    saveCards();
    renderResults();
  });
}

$("#sort-select").addEventListener("change", renderResults);
$("#only-matched").addEventListener("change", renderResults);

// ---------- 買取表 ----------
function addBuybackEntries(entries, shop) {
  const now = Date.now();
  const cleaned = entries
    .map((e) => ({
      id: uid(),
      name: String(e.name || "").trim(),
      card_number: String(e.card_number || "").trim(),
      rarity: String(e.rarity || "").trim(),
      price: parsePrice(e.price),
      shop: (e.shop || shop || "").trim(),
      addedAt: now,
    }))
    .filter((e) => e.name && e.price > 0);
  state.buyback.push(...cleaned);
  saveBuyback();
  renderBuyback();
  renderResults();
  return cleaned.length;
}

$("#buyback-image-input").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length || !requireKey()) return;
  const status = $("#buyback-status");
  try {
    setStatus(status, "AI が買取表を読み取り中…（量が多いと1〜2分）");
    const images = await Promise.all(files.map((f) => loadImage(f, 2800)));
    const result = await readBuybackList(state.settings.apiKey, state.settings.model, images);
    const shop = $("#shop-name").value.trim() || result.shop || "店舗未設定";
    const n = addBuybackEntries(result.entries, shop);
    setStatus(status, `${shop} の買取価格を ${n} 件登録しました。`, "ok");
  } catch (err) {
    setStatus(status, describeError(err), "error");
  }
});

$("#toggle-csv").addEventListener("click", () => ($("#csv-area").hidden = !$("#csv-area").hidden));
$("#csv-import").addEventListener("click", () => {
  const shop = $("#shop-name").value.trim();
  const entries = parseBuybackCsv($("#csv-text").value, shop);
  const n = addBuybackEntries(entries, shop);
  setStatus($("#buyback-status"), n ? `${n} 件取り込みました。` : "取り込める行がありませんでした（カード名と買取価格が必要です）。", n ? "ok" : "error");
  if (n) $("#csv-text").value = "";
});

$("#manual-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const n = addBuybackEntries([Object.fromEntries(f)], $("#shop-name").value.trim());
  if (n) e.target.reset();
});

$("#buyback-filter").addEventListener("input", renderBuyback);
$("#clear-buyback").addEventListener("click", () => {
  if (!state.buyback.length || !confirm(`買取表 ${state.buyback.length} 件をすべて削除しますか？`)) return;
  state.buyback = [];
  saveBuyback();
  renderBuyback();
  renderResults();
});
$("#export-csv").addEventListener("click", () => {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = ["カード名,型番,レアリティ,買取価格,店舗", ...state.buyback.map((b) => [b.name, b.card_number, b.rarity, b.price, b.shop].map(esc).join(","))];
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "buyback.csv" });
  a.click();
  URL.revokeObjectURL(a.href);
});

function renderBuyback() {
  $("#buyback-count").textContent = state.buyback.length;
  const q = $("#buyback-filter").value.trim().toLowerCase();
  const body = $("#buyback-body");
  body.innerHTML = "";
  const rows = state.buyback.filter((b) => !q || `${b.name} ${b.card_number} ${b.shop}`.toLowerCase().includes(q));
  for (const b of rows.slice(0, 500)) {
    const tr = document.createElement("tr");
    for (const [v, cls] of [[b.name], [b.card_number], [b.rarity], [yen(b.price), "num"], [b.shop]]) {
      const td = document.createElement("td");
      td.textContent = v || "";
      if (cls) td.className = cls;
      tr.appendChild(td);
    }
    const td = document.createElement("td");
    const del = Object.assign(document.createElement("button"), { textContent: "✕", className: "link" });
    del.setAttribute("aria-label", "削除");
    del.addEventListener("click", () => {
      state.buyback = state.buyback.filter((x) => x.id !== b.id);
      saveBuyback();
      renderBuyback();
      renderResults();
    });
    td.appendChild(del);
    tr.appendChild(td);
    body.appendChild(tr);
  }
  if (rows.length > 500) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" class="hint">ほか ${rows.length - 500} 件（絞り込みで表示）</td>`;
    body.appendChild(tr);
  }
  updateSetupHint();
}

// ---------- 設定 ----------
function loadSettingsForm() {
  $("#api-key").value = state.settings.apiKey;
  $("#model").value = state.settings.model;
  $("#threshold").value = state.settings.threshold;
}
$("#save-settings").addEventListener("click", () => {
  state.settings = {
    apiKey: $("#api-key").value.trim(),
    model: $("#model").value.trim() || DEFAULT_MODEL,
    threshold: Math.max(1, Number($("#threshold").value) || 85),
  };
  store.set("settings", state.settings);
  $("#settings-saved").hidden = false;
  setTimeout(() => ($("#settings-saved").hidden = true), 1500);
  updateSetupHint();
  renderResults();
});

function updateSetupHint() {
  $("#setup-hint").hidden = Boolean(state.settings.apiKey && state.buyback.length);
}

// 古いデータに id がない場合の補完
state.buyback.forEach((b) => (b.id ||= uid()));
loadSettingsForm();
renderBuyback();
renderResults();
