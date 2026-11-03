// 買取表とショーケースのカードを照合する純粋ロジック（DOM・API に依存しない）

/** 全角/半角・ひらがな/カタカナ・記号の揺れを吸収した比較用文字列 */
export function normalizeName(str) {
  if (!str) return "";
  let s = String(str).normalize("NFKC").toLowerCase();
  // ひらがな → カタカナ
  s = s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  // 括弧書き（【プロモ】など）は残しつつ、記号・空白は除去
  s = s.replace(/[\s・･,，.。、'"’“”!！?？:：;；\-－ー―_~〜/／\\|()（）\[\]［］【】「」『』<>＜＞]/g, "");
  return s;
}

/** 型番を比較用に正規化（例: "sv2a 201 / 165" → "SV2A201/165", "op05－119" → "OP05-119"） */
export function normalizeNumber(str) {
  if (!str) return "";
  let s = String(str).normalize("NFKC").toUpperCase();
  s = s.replace(/[‐‑‒–—―ー－]/g, "-");
  s = s.replace(/\s+/g, "");
  s = s.replace(/^NO\.?/, "");
  return s;
}

/** 型番の「番号部分」だけ（例: "SV2A201/165" → "201/165", "OP05-119" → "OP05-119"） */
function numberCore(n) {
  const m = n.match(/(\d{1,4}\/\d{1,4})$/);
  return m ? m[1] : n;
}

/** 文字バイグラムの Dice 係数（0〜1） */
export function similarity(a, b) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;
  const grams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const gx = grams(x);
  const gy = grams(y);
  let inter = 0;
  for (const [g, c] of gx) inter += Math.min(c, gy.get(g) || 0);
  let score = (2 * inter) / (x.length - 1 + (y.length - 1));
  // 片方がもう片方を完全に含む場合（"リザードンex" と "リザードンex SAR" など）は底上げ
  if (x.includes(y) || y.includes(x)) score = Math.max(score, 0.85);
  return score;
}

function rarityEqual(a, b) {
  if (!a || !b) return null;
  return normalizeName(a) === normalizeName(b);
}

/**
 * 1枚のカードに対して買取表の候補をスコア順に返す。
 * @returns {{entry: object, score: number, reason: string}[]}
 */
export function findCandidates(card, buyback, { minScore = 0.55, limit = 5 } = {}) {
  const cardNum = normalizeNumber(card.card_number);
  const out = [];
  for (const entry of buyback) {
    const entryNum = normalizeNumber(entry.card_number);
    const nameScore = similarity(card.name, entry.name);
    let score;
    let reason;
    if (cardNum && entryNum) {
      if (cardNum === entryNum) {
        score = 0.8 + 0.2 * nameScore;
        reason = "型番一致";
      } else if (numberCore(cardNum) === numberCore(entryNum)) {
        // 片方にだけ弾コードが付いているケース
        score = 0.6 + 0.35 * nameScore;
        reason = "番号一致";
      } else {
        // 型番が違うなら別カード（同名の再録など）。名前が似ていても低く抑える
        score = nameScore * 0.5;
        reason = "型番不一致";
      }
    } else {
      score = nameScore * 0.9;
      reason = "名前の類似";
    }
    const r = rarityEqual(card.rarity, entry.rarity);
    if (r === true) score = Math.min(1, score + 0.08);
    if (r === false) score -= 0.25;
    if (score >= minScore) out.push({ entry, score, reason });
  }
  out.sort((a, b) => b.score - a.score || (b.entry.price || 0) - (a.entry.price || 0));
  return out.slice(0, limit);
}

/**
 * 販売価格と買取価格からお得度を計算。
 * 買取率 = 買取 ÷ 販売。100% 以上なら「買ってすぐ売っても利益が出る」。
 */
export function evaluate(salePrice, buyPrice, greatRatio = 0.85) {
  if (!salePrice || !buyPrice) return { diff: null, ratio: null, level: "unknown" };
  const diff = buyPrice - salePrice;
  const ratio = buyPrice / salePrice;
  let level;
  if (ratio >= 1) level = "profit"; // 買取 ≥ 販売：転売で利益
  else if (ratio >= greatRatio) level = "great"; // かなり割安
  else if (ratio >= greatRatio - 0.15) level = "good"; // やや割安
  else level = "normal"; // 一般的な価格差
  return { diff, ratio, level };
}

export const LEVEL_LABEL = {
  profit: "利益が出る",
  great: "かなり割安",
  good: "やや割安",
  normal: "通常",
  unknown: "買取データなし",
};

/** "¥12,000" / "12000円" / "1.2万" → 12000 */
export function parsePrice(v) {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : 0;
  if (!v) return 0;
  const s = String(v).normalize("NFKC").replace(/[,\s¥￥円]/g, "");
  const man = s.match(/^(\d+(?:\.\d+)?)万(\d*)$/);
  if (man) return Math.round(parseFloat(man[1]) * 10000 + (man[2] ? parseInt(man[2], 10) : 0));
  const n = parseFloat(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function splitCsvLine(line) {
  const cells = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === "\t") { cells.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const HEADER_ALIASES = {
  name: ["name", "カード名", "名前", "商品名", "card"],
  card_number: ["card_number", "number", "型番", "番号", "カード番号", "no"],
  rarity: ["rarity", "レアリティ", "レア"],
  price: ["price", "買取価格", "買取", "価格", "金額"],
  shop: ["shop", "店舗", "ショップ", "店名"],
};

/**
 * CSV/TSV を買取表エントリに変換。ヘッダー行があれば列名で、なければ
 * 「カード名, 型番, レアリティ, 買取価格[, 店舗]」の順とみなす。
 */
export function parseBuybackCsv(text, defaultShop = "") {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  let cols = { name: 0, card_number: 1, rarity: 2, price: 3, shop: 4 };
  const head = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const mapped = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = head.findIndex((h) => aliases.includes(h));
    if (idx >= 0) mapped[key] = idx;
  }
  let start = 0;
  if (mapped.name !== undefined && mapped.price !== undefined) {
    cols = { name: -1, card_number: -1, rarity: -1, shop: -1, ...mapped };
    start = 1;
  }
  const out = [];
  for (const line of lines.slice(start)) {
    const c = splitCsvLine(line);
    const get = (k) => (cols[k] >= 0 ? c[cols[k]] || "" : "");
    const entry = {
      name: get("name"),
      card_number: get("card_number"),
      rarity: get("rarity"),
      price: parsePrice(get("price")),
      shop: get("shop") || defaultShop,
    };
    if (entry.name && entry.price > 0) out.push(entry);
  }
  return out;
}

/** ショーケースの1枚を照合して、最高買取の候補と評価をまとめる */
export function compareCard(card, buyback, greatRatio = 0.85) {
  const candidates = findCandidates(card, buyback);
  // 同じカードとみなせる候補（ベストのスコアに近いもの）の中で一番高い買取を採用
  let best = null;
  if (candidates.length) {
    const top = candidates[0].score;
    const same = candidates.filter((c) => c.score >= top - 0.05);
    best = same.reduce((a, b) => ((b.entry.price || 0) > (a.entry.price || 0) ? b : a));
  }
  const buyPrice = best ? best.entry.price : 0;
  return { candidates, best, ...evaluate(card.price, buyPrice, greatRatio) };
}
