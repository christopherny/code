// 実行: node --test card-buyback-checker/
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeNumber, similarity, findCandidates, evaluate, parsePrice, parseBuybackCsv, compareCard } from "./matching.js";

const buyback = [
  { id: "a", name: "リザードンex", card_number: "SV3 134/108", rarity: "SAR", price: 12000, shop: "A店" },
  { id: "b", name: "リザードンex", card_number: "SV3 134/108", rarity: "SAR", price: 13500, shop: "B店" },
  { id: "c", name: "リザードンex", card_number: "SV2a 185/165", rarity: "SR", price: 3000, shop: "A店" },
  { id: "d", name: "モンキー・D・ルフィ", card_number: "OP05-119", rarity: "SEC", price: 8000, shop: "A店" },
  { id: "e", name: "ピカチュウ", card_number: "", rarity: "AR", price: 500, shop: "A店" },
];

test("型番の正規化", () => {
  assert.equal(normalizeNumber("ｓｖ３ １３４／１０８"), "SV3134/108");
  assert.equal(normalizeNumber("op05－119"), "OP05-119");
});

test("名前の類似度（表記ゆれ）", () => {
  assert.equal(similarity("モンキー・D・ルフィ", "モンキーＤルフィ"), 1);
  assert.equal(similarity("りざーどんex", "リザードンEX"), 1);
  assert.ok(similarity("リザードンex", "ピカチュウ") < 0.2);
});

test("型番一致を最優先し、別型番の同名カードは除外", () => {
  const c = findCandidates({ name: "リザードンex", card_number: "134/108", rarity: "SAR" }, buyback);
  assert.deepEqual(c.map((x) => x.entry.id).sort(), ["a", "b"]);
});

test("型番なしでも名前とレアで照合", () => {
  const c = findCandidates({ name: "ピカチュウ", card_number: "", rarity: "AR" }, buyback);
  assert.equal(c[0].entry.id, "e");
});

test("複数店舗のうち最高買取を採用してお得度を出す", () => {
  const r = compareCard({ name: "リザードンex", card_number: "SV3 134/108", rarity: "SAR", price: 12800 }, buyback);
  assert.equal(r.best.entry.id, "b");
  assert.equal(r.diff, 700);
  assert.equal(r.level, "profit");
});

test("お得度の段階", () => {
  assert.equal(evaluate(10000, 9000).level, "great");
  assert.equal(evaluate(10000, 7500).level, "good");
  assert.equal(evaluate(10000, 5000).level, "normal");
  assert.equal(evaluate(10000, 0).level, "unknown");
  assert.equal(evaluate(10000, 8000, 0.8).level, "great");
});

test("価格の読み取り", () => {
  assert.equal(parsePrice("¥12,800"), 12800);
  assert.equal(parsePrice("１２８００円"), 12800);
  assert.equal(parsePrice("1.2万"), 12000);
  assert.equal(parsePrice(""), 0);
});

test("CSV 取り込み（ヘッダーあり・タブ区切り・クォート）", () => {
  const rows = parseBuybackCsv('買取価格\tカード名\t型番\n"¥1,200"\tピカチュウ\t001/100\n', "C店");
  assert.deepEqual(rows, [{ name: "ピカチュウ", card_number: "001/100", rarity: "", price: 1200, shop: "C店" }]);
  const noHead = parseBuybackCsv("リザードンex,SV3 134/108,SAR,12000,D店");
  assert.equal(noHead[0].shop, "D店");
  assert.equal(noHead[0].price, 12000);
});
