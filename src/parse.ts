import { checkItem, plainText, type RawPostFeedItem } from "./item.js";
import {
  JSON_FEED_VERSION_PREFIX,
  POST_FEED_LIMITS,
  type ParsedPostFeed,
  type PostFeedFormat,
  type PostFeedItem,
  type PostFeedParseResult,
  type PostFeedRejection,
} from "./types.js";

/**
 * Reads a feed document: JSON Feed 1.x (its items' `_runner` blocks read when present), RSS
 * 2.0 or Atom. Dependency-free and tolerant: a malformed item is listed in `rejected` with
 * its reason and the rest are read; only a document that is no feed at all is refused.
 */

function sortNewestFirst(items: PostFeedItem[]): PostFeedItem[] {
  const time = (item: PostFeedItem) => (item.publishedAt ? Date.parse(item.publishedAt) : 0);
  return items.sort((a, b) => time(b) - time(a));
}

function collect(
  format: PostFeedFormat,
  title: string | null,
  raws: readonly (RawPostFeedItem | null)[],
): ParsedPostFeed {
  const items: PostFeedItem[] = [];
  const rejected: PostFeedRejection[] = [];
  const seen = new Set<string>();
  raws.forEach((raw, index) => {
    if (!raw) {
      rejected.push({ index, id: null, reason: "not_an_object" });
      return;
    }
    const checked = checkItem(raw);
    if (!checked.ok) {
      rejected.push({ index, id: checked.id, reason: checked.reason });
      return;
    }
    if (seen.has(checked.item.id)) {
      rejected.push({ index, id: checked.item.id, reason: "duplicate_id" });
      return;
    }
    seen.add(checked.item.id);
    items.push(checked.item);
  });
  return {
    format,
    title,
    items: sortNewestFirst(items).slice(0, POST_FEED_LIMITS.items),
    rejected,
  };
}

/* ---------------------------------- JSON Feed ---------------------------------- */

function jsonItem(value: unknown): RawPostFeedItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const html = typeof item.content_html === "string" ? item.content_html : undefined;
  return {
    id: item.id,
    title: item.title,
    text: item.content_text ?? html ?? item.summary,
    url: item.url,
    image: item.image ?? item.banner_image,
    publishedAt: item.date_published ?? item.date_modified,
    runner: item._runner,
  };
}

/** A JSON Feed document already parsed from JSON, or one item sent on its own. */
export function parseJsonFeed(document: unknown): PostFeedParseResult {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return { ok: false, reason: "not_a_feed" };
  }
  const feed = document as Record<string, unknown>;
  if (typeof feed.version !== "string" || !Array.isArray(feed.items)) {
    return { ok: false, reason: "not_a_feed" };
  }
  if (!feed.version.startsWith(JSON_FEED_VERSION_PREFIX))
    return { ok: false, reason: "bad_version" };
  const title = typeof feed.title === "string" ? plainText(feed.title) || null : null;
  return { ok: true, feed: collect("json_feed", title, feed.items.map(jsonItem)) };
}

/** Items handed over directly (an agent's call), in the JSON Feed item shape. */
export function parseJsonFeedItems(items: readonly unknown[]): ParsedPostFeed {
  return collect("json_feed", null, items.map(jsonItem));
}

/* ---------------------------------- RSS / Atom ---------------------------------- */

function tag(block: string, name: string): string | null {
  const escaped = name.replace(":", "\\:");
  const match = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, "i").exec(block);
  return match ? (match[1] ?? "").trim() : null;
}

function attribute(block: string, name: string, attr: string, where?: RegExp): string | null {
  const escaped = name.replace(":", "\\:");
  const tags = block.match(new RegExp(`<${escaped}\\b[^>]*>`, "gi")) ?? [];
  for (const found of tags) {
    if (where && !where.test(found)) continue;
    const value = new RegExp(`\\s${attr}\\s*=\\s*["']([^"']+)["']`, "i").exec(found);
    if (value?.[1]) return value[1].replace(/&amp;/g, "&");
  }
  return null;
}

function unwrap(value: string | null): string | null {
  return value === null ? null : value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function rssItem(block: string): RawPostFeedItem {
  const link = unwrap(tag(block, "link"));
  const image =
    attribute(block, "enclosure", "url", /type\s*=\s*["']image\//i) ??
    attribute(block, "media:content", "url") ??
    attribute(block, "media:thumbnail", "url");
  return {
    id: unwrap(tag(block, "guid")) ?? link,
    title: tag(block, "title"),
    text: tag(block, "content:encoded") ?? tag(block, "description"),
    url: link,
    image,
    publishedAt: unwrap(tag(block, "pubDate")) ?? unwrap(tag(block, "dc:date")),
  };
}

function atomEntry(block: string): RawPostFeedItem {
  const link =
    attribute(block, "link", "href", /rel\s*=\s*["']alternate["']/i) ??
    attribute(block, "link", "href");
  return {
    id: unwrap(tag(block, "id")) ?? link,
    title: tag(block, "title"),
    text: tag(block, "content") ?? tag(block, "summary"),
    url: link,
    image: attribute(block, "media:thumbnail", "url") ?? attribute(block, "media:content", "url"),
    publishedAt: unwrap(tag(block, "published")) ?? unwrap(tag(block, "updated")),
  };
}

function blocks(xml: string, name: string): string[] {
  return xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>[\\s\\S]*?</${name}>`, "gi")) ?? [];
}

/** An RSS 2.0 or Atom document. */
export function parseXmlFeed(xml: string): PostFeedParseResult {
  if (/<rss\b|<rdf:RDF\b/i.test(xml)) {
    const channel = tag(xml, "channel") ?? xml;
    const title = tag(channel.split(/<item\b/i)[0] ?? "", "title");
    return {
      ok: true,
      feed: collect("rss", title ? plainText(title) : null, blocks(xml, "item").map(rssItem)),
    };
  }
  if (/<feed\b[^>]*xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom/i.test(xml)) {
    const title = tag(xml.split(/<entry\b/i)[0] ?? "", "title");
    return {
      ok: true,
      feed: collect("atom", title ? plainText(title) : null, blocks(xml, "entry").map(atomEntry)),
    };
  }
  return { ok: false, reason: "not_a_feed" };
}

/** Any feed document, as fetched: JSON Feed, RSS or Atom, told apart by its first character. */
export function parsePostFeed(body: string): PostFeedParseResult {
  if (body.length > POST_FEED_LIMITS.bytes) return { ok: false, reason: "too_large" };
  const trimmed = body.replace(/^﻿/, "").trimStart();
  if (trimmed.startsWith("{")) {
    try {
      return parseJsonFeed(JSON.parse(trimmed));
    } catch {
      return { ok: false, reason: "not_a_feed" };
    }
  }
  return trimmed.startsWith("<") ? parseXmlFeed(trimmed) : { ok: false, reason: "not_a_feed" };
}
