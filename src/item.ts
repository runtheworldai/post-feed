import {
  POST_FEED_KINDS,
  POST_FEED_LIMITS,
  POST_FEED_PRIORITIES,
  type PostFeedItem,
  type PostFeedItemState,
  type PostFeedKind,
  type PostFeedPriority,
  type PostFeedRejectionReason,
  type PostFeedRights,
} from "./types.js";

/**
 * One item, checked and normalized: the fields every reader shares, from JSON Feed, RSS
 * or Atom. A bad field refuses the item with a reason rather than guessing what was meant.
 */

/** The fields a reader found, before checking. `runner` is the raw `_runner` block. */
export interface RawPostFeedItem {
  readonly id: unknown;
  readonly title?: unknown;
  readonly text?: unknown;
  readonly url?: unknown;
  readonly image?: unknown;
  readonly publishedAt?: unknown;
  readonly runner?: unknown;
}

export type ItemCheck =
  | { readonly ok: true; readonly item: PostFeedItem }
  | { readonly ok: false; readonly id: string | null; readonly reason: PostFeedRejectionReason };

const CHANNEL = /^[a-z][a-z0-9_]{0,29}$/;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** HTML to plain text: tags out, entities decoded, whitespace collapsed. */
export function plainText(value: string): string {
  const decoded = value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(br|\/p|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      const lower = name.toLowerCase();
      if (lower.startsWith("#x")) return safeCodePoint(Number.parseInt(lower.slice(2), 16), whole);
      if (lower.startsWith("#")) return safeCodePoint(Number.parseInt(lower.slice(1), 10), whole);
      return ENTITIES[lower] ?? whole;
    })
    .replace(/<[^>]*>/g, " ");
  return decoded
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

function safeCodePoint(code: number, fallback: string): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : fallback;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const plain = plainText(value);
  if (plain === "") return null;
  return plain.length <= max ? plain : `${plain.slice(0, max - 1).trimEnd()}…`;
}

/** An https link, or `undefined` when the value is there but is not one. */
function httpsUrl(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** An ISO 8601 moment, or `undefined` when the value is there but is not a date. */
function moment(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

function strings(value: unknown): readonly string[] | undefined {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return undefined;
  return (value as string[]).map((entry) => entry.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const DEFAULT_RIGHTS: PostFeedRights = { owned: false, madeWithAi: false, showsRealPerson: false };

function rightsOf(value: unknown): PostFeedRights | undefined {
  if (value === undefined || value === null) return DEFAULT_RIGHTS;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const flag = (key: string) => (raw[key] === undefined ? false : raw[key]);
  const owned = flag("owned");
  const madeWithAi = flag("made_with_ai");
  const showsRealPerson = flag("shows_real_person");
  if ([owned, madeWithAi, showsRealPerson].some((entry) => typeof entry !== "boolean")) {
    return undefined;
  }
  return {
    owned: owned as boolean,
    madeWithAi: madeWithAi as boolean,
    showsRealPerson: showsRealPerson as boolean,
  };
}

function idOf(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id === "" ? null : id;
}

/** Checks one item the way every format shares. */
export function checkItem(raw: RawPostFeedItem): ItemCheck {
  const id = idOf(raw.id);
  const refuse = (reason: PostFeedRejectionReason): ItemCheck => ({ ok: false, id, reason });
  if (!id) return refuse("no_id");
  if (id.length > POST_FEED_LIMITS.id) return refuse("id_too_long");

  const runner =
    raw.runner && typeof raw.runner === "object" && !Array.isArray(raw.runner)
      ? (raw.runner as Record<string, unknown>)
      : null;
  if (raw.runner !== undefined && raw.runner !== null && !runner) return refuse("not_an_object");
  const r = runner ?? {};

  const title = text(raw.title, POST_FEED_LIMITS.title);
  const body = text(raw.text, POST_FEED_LIMITS.text);
  if (!title && !body) return refuse("no_content");

  const url = httpsUrl(raw.url);
  const image = httpsUrl(raw.image);
  if (url === undefined || image === undefined) return refuse("bad_url");
  const publishedAt = moment(raw.publishedAt);
  const notBefore = moment(r.not_before);
  const expires = moment(r.expires);
  if (publishedAt === undefined || notBefore === undefined || expires === undefined) {
    return refuse("bad_date");
  }

  const kind = r.kind ?? "news";
  if (!POST_FEED_KINDS.includes(kind as PostFeedKind)) return refuse("bad_kind");
  const priority = r.priority ?? "normal";
  if (!POST_FEED_PRIORITIES.includes(priority as PostFeedPriority)) return refuse("bad_priority");

  const claims = strings(r.claims);
  if (!claims) return refuse("bad_list");
  if (claims.length > POST_FEED_LIMITS.claims) return refuse("too_many_claims");
  if (claims.some((claim) => claim.length > POST_FEED_LIMITS.claim))
    return refuse("claim_too_long");

  const characters = strings(r.characters);
  if (!characters) return refuse("bad_list");
  if (characters.length > POST_FEED_LIMITS.characters) return refuse("too_many_characters");
  if (characters.some((name) => name.length > POST_FEED_LIMITS.character)) {
    return refuse("character_too_long");
  }

  const channels = strings(r.channels);
  if (!channels) return refuse("bad_list");
  if (channels.length > POST_FEED_LIMITS.channels) return refuse("too_many_channels");
  const lowered = channels.map((channel) => channel.toLowerCase());
  if (lowered.some((channel) => !CHANNEL.test(channel))) return refuse("bad_channel");

  const rights = rightsOf(r.rights);
  if (!rights) return refuse("bad_rights");

  return {
    ok: true,
    item: {
      id,
      title,
      text: body,
      url,
      image,
      publishedAt,
      kind: kind as PostFeedKind,
      notBefore,
      expires,
      claims,
      characters,
      rights,
      channels: [...new Set(lowered)],
      priority: priority as PostFeedPriority,
      extended: runner !== null,
    },
  };
}

/** Whether an item may be posted at `now`: not yet, now, or never again. */
export function postFeedItemState(item: PostFeedItem, now: Date): PostFeedItemState {
  if (item.expires && Date.parse(item.expires) <= now.getTime()) return "expired";
  if (item.notBefore && Date.parse(item.notBefore) > now.getTime()) return "waiting";
  return "due";
}

/**
 * Whether the item's picture may go into a post. Only one the publisher owns, and never one
 * of a real person: a feed can say a person agreed, but it cannot carry their consent, so a
 * real person's picture is added where consent is recorded instead.
 */
export function postFeedPictureUsable(item: PostFeedItem): boolean {
  return item.image !== null && item.rights.owned && !item.rights.showsRealPerson;
}
