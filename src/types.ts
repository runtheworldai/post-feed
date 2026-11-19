/**
 * Post Feed: the format a business publishes so an AI growth team can post about what is
 * new with it. A JSON Feed 1.1 document whose items may carry a `_runner` extension, or a
 * plain RSS 2.0 / Atom feed read with defaults. No dependencies; shared by Runner's app and
 * the `@runtheworldai/post-feed` package so the two cannot drift.
 */

/** What an item is about. It shapes how a post is written, never whether facts may be invented. */
export const POST_FEED_KINDS = ["news", "product", "event", "offer", "story", "character"] as const;
export type PostFeedKind = (typeof POST_FEED_KINDS)[number];

export const POST_FEED_PRIORITIES = ["normal", "push"] as const;
export type PostFeedPriority = (typeof POST_FEED_PRIORITIES)[number];

/** Where a feed came from: JSON Feed (with or without `_runner`), RSS 2.0 or Atom. */
export type PostFeedFormat = "json_feed" | "rss" | "atom";

/** What the publisher says about the item's picture. Unknown is the most careful answer. */
export interface PostFeedRights {
  /** The publisher owns the picture or may let it be posted. Absent: false, and it is not used. */
  readonly owned: boolean;
  /** The picture was made or edited with AI. */
  readonly madeWithAi: boolean;
  /** The picture shows a real, identifiable person. A feed cannot carry their consent. */
  readonly showsRealPerson: boolean;
}

export interface PostFeedItem {
  /** Stable for the life of the item: the same id is never posted twice. */
  readonly id: string;
  readonly title: string | null;
  /** The facts, in the publisher's own words, as plain text. */
  readonly text: string | null;
  /** Where a reader goes (https). */
  readonly url: string | null;
  /** One picture for the post (https). */
  readonly image: string | null;
  /** ISO 8601. */
  readonly publishedAt: string | null;
  readonly kind: PostFeedKind;
  /** ISO 8601: not posted before this moment. */
  readonly notBefore: string | null;
  /** ISO 8601: never posted after this moment (an offer, an event). */
  readonly expires: string | null;
  /** When given, the only claims a post about this item may make. */
  readonly claims: readonly string[];
  /** Recurring characters to feature, by the exact name the team knows them by. */
  readonly characters: readonly string[];
  readonly rights: PostFeedRights;
  /** Channels to post on (`instagram`, `linkedin`, …); empty lets the team choose. */
  readonly channels: readonly string[];
  readonly priority: PostFeedPriority;
  /** The item carried a `_runner` block; false for plain RSS, Atom or JSON Feed items. */
  readonly extended: boolean;
}

export interface PostFeedRejection {
  /** The item's place in the feed, from 0. */
  readonly index: number;
  readonly id: string | null;
  readonly reason: PostFeedRejectionReason;
}

export type PostFeedRejectionReason =
  | "not_an_object"
  | "no_id"
  | "id_too_long"
  | "no_content"
  | "bad_kind"
  | "bad_priority"
  | "bad_date"
  | "bad_url"
  | "too_many_claims"
  | "claim_too_long"
  | "too_many_characters"
  | "character_too_long"
  | "too_many_channels"
  | "bad_channel"
  | "bad_rights"
  | "bad_list"
  | "duplicate_id";

export interface ParsedPostFeed {
  readonly format: PostFeedFormat;
  readonly title: string | null;
  /** Newest first, at most {@link POST_FEED_LIMITS}.items, each id once. */
  readonly items: readonly PostFeedItem[];
  readonly rejected: readonly PostFeedRejection[];
}

export type PostFeedParseResult =
  | { readonly ok: true; readonly feed: ParsedPostFeed }
  | { readonly ok: false; readonly reason: "too_large" | "not_a_feed" | "bad_version" };

/** When an item may be posted, at a given moment. */
export type PostFeedItemState = "due" | "waiting" | "expired";

export const POST_FEED_LIMITS = {
  /** Bytes of a whole feed document. */
  bytes: 1_000_000,
  /** Items kept from one feed, newest first. */
  items: 100,
  id: 180,
  title: 300,
  text: 5_000,
  claims: 10,
  claim: 300,
  characters: 4,
  character: 60,
  channels: 10,
} as const;

/** The JSON Feed versions read. */
export const JSON_FEED_VERSION_PREFIX = "https://jsonfeed.org/version/1";
