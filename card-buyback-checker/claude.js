// Claude API 呼び出し（ブラウザから直接）
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.99.0";

export const DEFAULT_MODEL = "claude-opus-5-5";

function client(apiKey) {
  // 個人利用前提：API キーはこの端末の localStorage にのみ保存し、Anthropic へ直接送る
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

/** 拒否時は自動で別モデルにフォールバックさせる共通オプション */
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

function textOf(response) {
  if (response.stop_reason === "refusal") {
    throw new Error("AI がこのリクエストを処理できませんでした（refusal）。写真を変えて再試行してください。");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("出力が長すぎて途中で切れました。写真を分割して撮影してください。");
  }
  return response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

function imageBlock(img) {
  return { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } };
}

const CARD_ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["name", "card_number", "rarity", "game", "price", "condition", "position", "confidence"],
  properties: {
    name: { type: "string", description: "カード名（写真の表記どおり、日本語）" },
    card_number: { type: "string", description: "型番・コレクション番号（例: SV2a 201/165, OP05-119）。読めなければ空文字" },
    rarity: { type: "string", description: "レアリティ（SAR, SR, UR, AR, SEC, P など）。不明なら空文字" },
    game: { type: "string", description: "ゲーム名（ポケモンカード、ワンピースカード、遊戯王 など）" },
    price: { type: "integer", description: "値札の価格（円、税込表記を優先）。読めなければ 0" },
    condition: { type: "string", description: "状態表記（美品、キズあり、PSA10 など）。なければ空文字" },
    position: { type: "string", description: "写真内の位置（例: 上段左から2枚目）" },
    confidence: { type: "string", enum: ["high", "medium", "low"], description: "読み取りの確かさ" },
  },
};

const SHOWCASE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["cards", "notes"],
  properties: {
    cards: { type: "array", items: CARD_ITEM },
    notes: { type: "string", description: "読み取りにくかった点など（なければ空文字）" },
  },
};

const BUYBACK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["shop", "entries"],
  properties: {
    shop: { type: "string", description: "店名（写っていれば）。不明なら空文字" },
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "card_number", "rarity", "price"],
        properties: {
          name: { type: "string" },
          card_number: { type: "string" },
          rarity: { type: "string" },
          price: { type: "integer", description: "買取価格（円）。状態別に複数ある場合は最も高い（美品）価格" },
        },
      },
    },
  },
};

/** ショーケース写真 → カード一覧 */
export async function readShowcase(apiKey, model, images) {
  const response = await client(apiKey).beta.messages.create({
    model,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "high", format: { type: "json_schema", schema: SHOWCASE_SCHEMA } },
    system:
      "あなたはトレーディングカードショップの店頭ショーケースを読み取るアシスタントです。" +
      "写真に写っているカードを1枚ずつ、カード名・型番・レアリティ・値札の価格を読み取ってください。" +
      "値札とカードの対応はショーケース内の配置から判断します。カードのイラストや枠からカードを特定できる場合は正式なカード名を使い、" +
      "型番が値札やカード下部に見えるときは必ず記録してください。推測で埋めた項目は confidence を下げてください。" +
      "価格が見えないカード、サプライ品や箱は除外します。",
    messages: [
      {
        role: "user",
        content: [
          ...images.map(imageBlock),
          { type: "text", text: "このショーケースのカードと販売価格をすべて読み取ってください。" },
        ],
      },
    ],
  });
  return JSON.parse(textOf(response));
}

/** 買取表（店頭ポップ・チラシ・Web のスクショ）写真 → 買取表エントリ */
export async function readBuybackList(apiKey, model, images) {
  const response = await client(apiKey).beta.messages.create({
    model,
    max_tokens: 32000,
    ...FALLBACK,
    output_config: { effort: "high", format: { type: "json_schema", schema: BUYBACK_SCHEMA } },
    system:
      "あなたはトレーディングカードショップの買取表を読み取るアシスタントです。" +
      "画像内のすべての行について、カード名・型番・レアリティ・買取価格を読み取ってください。" +
      "販売価格ではなく買取価格を読みます。状態別の価格が並ぶ場合は最も高い価格を使ってください。",
    messages: [
      {
        role: "user",
        content: [...images.map(imageBlock), { type: "text", text: "この買取表をすべて書き出してください。" }],
      },
    ],
  });
  return JSON.parse(textOf(response));
}

/** 手元に買取データがないカードを Web 検索で相場確認 */
export async function lookupBuybackOnWeb(apiKey, model, card) {
  const desc = [card.name, card.card_number, card.rarity, card.game].filter(Boolean).join(" / ");
  const stream = client(apiKey).beta.messages.stream({
    model,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "medium" },
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5, user_location: { type: "approximate", country: "JP" } }],
    messages: [
      {
        role: "user",
        content:
          `次のトレーディングカードについて、日本の主要カードショップ（カードラッシュ、晴れる屋、駿河屋、トレカキャンプ など）の` +
          `現在の「買取価格」を Web で調べてください（販売価格ではありません）。\n\nカード: ${desc}\n\n` +
          "最後に、次の形式の JSON だけを ```json コードブロックで出力してください:\n" +
          '{"best_price": 最も高い買取価格(円・整数、見つからなければ0), "sources": [{"shop": "店名", "price": 整数, "url": "ページURL"}], "note": "注意点（状態条件・日付など）"}',
      },
    ],
  });
  const response = await stream.finalMessage();
  const text = textOf(response);
  const m = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})\s*$/);
  if (!m) throw new Error("検索結果を読み取れませんでした");
  return JSON.parse(m[1]);
}

/** エラーをユーザー向けの日本語に */
export function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "API キーが正しくありません。設定タブで確認してください。";
  if (err instanceof Anthropic.PermissionDeniedError) return "この API キーではこの機能を使えません。";
  if (err instanceof Anthropic.RateLimitError) return "リクエストが多すぎます。少し待ってから再試行してください。";
  if (err instanceof Anthropic.BadRequestError) return `リクエストエラー: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "通信エラー。電波状況を確認してください。";
  if (err instanceof Anthropic.APIError) return `API エラー (${err.status}): ${err.message}`;
  return err?.message || String(err);
}
