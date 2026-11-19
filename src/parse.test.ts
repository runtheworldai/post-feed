import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  POST_FEED_KINDS,
  POST_FEED_PRIORITIES,
  parseJsonFeedItems,
  parsePostFeed,
  postFeedItemState,
  postFeedPictureUsable,
  type PostFeedItem,
} from "./index";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function feed(items: unknown[]) {
  return JSON.stringify({ version: "https://jsonfeed.org/version/1.1", title: "Shop", items });
}

function only(body: string): PostFeedItem {
  const parsed = parsePostFeed(body);
  if (!parsed.ok) throw new Error(parsed.reason);
  expect(parsed.feed.rejected).toEqual([]);
  return parsed.feed.items[0]!;
}

describe("JSON Feed with _runner", () => {
  it("reads every _runner field", () => {
    const item = only(
      feed([
        {
          id: "offer-1",
          title: "15% off",
          content_html: "<p>15% off <em>cookware</em> &amp; more</p>",
          url: "https://shop.example/sale",
          image: "https://shop.example/a.jpg",
          date_published: "2026-04-06T07:00:00-07:00",
          _runner: {
            kind: "offer",
            not_before: "2026-04-06T00:00:00Z",
            expires: "2026-04-13T07:00:00Z",
            claims: ["15% off cookware"],
            characters: ["Bo"],
            rights: { owned: true, made_with_ai: false, shows_real_person: false },
            channels: ["Instagram", "x", "x"],
            priority: "push",
          },
        },
      ]),
    );
    expect(item).toMatchObject({
      id: "offer-1",
      title: "15% off",
      text: "15% off cookware & more",
      kind: "offer",
      claims: ["15% off cookware"],
      characters: ["Bo"],
      channels: ["instagram", "x"],
      priority: "push",
      extended: true,
      publishedAt: "2026-04-06T14:00:00.000Z",
    });
    expect(postFeedPictureUsable(item)).toBe(true);
  });

  it("reads an item with no _runner with careful defaults", () => {
    const item = only(
      feed([{ id: 7, content_text: "New hours", image: "https://x.example/a.jpg" }]),
    );
    expect(item).toMatchObject({
      id: "7",
      kind: "news",
      priority: "normal",
      claims: [],
      channels: [],
      extended: false,
      rights: { owned: false, madeWithAi: false, showsRealPerson: false },
    });
    // A picture nobody said they own is not posted.
    expect(postFeedPictureUsable(item)).toBe(false);
  });

  it("never uses a picture of a real person, whoever owns it", () => {
    const item = only(
      feed([
        {
          id: "a",
          title: "Meet Dana",
          image: "https://x.example/dana.jpg",
          _runner: { rights: { owned: true, shows_real_person: true } },
        },
      ]),
    );
    expect(postFeedPictureUsable(item)).toBe(false);
  });

  it("keeps each id once and lists every bad item with its reason", () => {
    const parsed = parsePostFeed(
      feed([
        { id: "a", title: "One" },
        { id: "a", title: "Again" },
        { title: "No id" },
        { id: "b" },
        { id: "c", title: "x", url: "http://insecure.example" },
        { id: "d", title: "x", _runner: { kind: "rumour" } },
        { id: "e", title: "x", _runner: { expires: "soon" } },
        { id: "f", title: "x", _runner: { claims: "all of them" } },
        { id: "g", title: "x", _runner: { channels: ["Not a channel!"] } },
        { id: "h", title: "x", _runner: { rights: { owned: "yes" } } },
        { id: "i", title: "x", _runner: { claims: Array.from({ length: 11 }, () => "c") } },
        "not an item",
      ]),
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.feed.items.map((item) => item.id)).toEqual(["a"]);
    expect(parsed.feed.rejected.map((r) => r.reason)).toEqual([
      "duplicate_id",
      "no_id",
      "no_content",
      "bad_url",
      "bad_kind",
      "bad_date",
      "bad_list",
      "bad_channel",
      "bad_rights",
      "too_many_claims",
      "not_an_object",
    ]);
  });

  it("refuses what is not a feed", () => {
    expect(parsePostFeed("hello")).toEqual({ ok: false, reason: "not_a_feed" });
    expect(parsePostFeed("{ broken")).toEqual({ ok: false, reason: "not_a_feed" });
    expect(parsePostFeed(JSON.stringify({ version: "https://example.com/v9", items: [] }))).toEqual(
      { ok: false, reason: "bad_version" },
    );
    expect(parsePostFeed(" ".repeat(1_000_001))).toEqual({ ok: false, reason: "too_large" });
  });

  it("reads items handed over one by one, as an agent sends them", () => {
    const parsed = parseJsonFeedItems([{ id: "x", title: "Hi", _runner: { kind: "story" } }]);
    expect(parsed.items[0]).toMatchObject({ id: "x", kind: "story", extended: true });
  });
});

describe("RSS and Atom", () => {
  it("reads RSS 2.0 items, their picture and date, newest first", () => {
    const parsed = parsePostFeed(`<?xml version="1.0"?>
      <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
        <title>Café news</title>
        <item><title>Old</title><guid>1</guid><link>https://c.example/1</link>
          <pubDate>Mon, 02 Mar 2026 08:00:00 GMT</pubDate></item>
        <item><title><![CDATA[New & good]]></title><guid isPermaLink="false">2</guid>
          <link>https://c.example/2</link><description>&lt;p&gt;Fresh buns&lt;/p&gt;</description>
          <enclosure url="https://c.example/bun.jpg" type="image/jpeg" length="1"/>
          <pubDate>Tue, 03 Mar 2026 08:00:00 GMT</pubDate></item>
      </channel></rss>`);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.feed.format).toBe("rss");
    expect(parsed.feed.title).toBe("Café news");
    expect(parsed.feed.items.map((item) => item.id)).toEqual(["2", "1"]);
    expect(parsed.feed.items[0]).toMatchObject({
      title: "New & good",
      text: "Fresh buns",
      image: "https://c.example/bun.jpg",
      extended: false,
    });
  });

  it("reads Atom entries", () => {
    const parsed = parsePostFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Changelog</title>
      <entry><id>tag:x,2026:1</id><title>v1.2</title>
        <link rel="alternate" href="https://x.example/1.2"/>
        <summary>Faster sync</summary><updated>2026-05-01T00:00:00Z</updated></entry></feed>`);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.feed.format).toBe("atom");
    expect(parsed.feed.items[0]).toMatchObject({
      id: "tag:x,2026:1",
      url: "https://x.example/1.2",
      text: "Faster sync",
    });
  });
});

describe("postFeedItemState", () => {
  const item = (runner: Record<string, string>) =>
    parseJsonFeedItems([{ id: "a", title: "x", _runner: runner }]).items[0]!;
  const now = new Date("2026-04-10T00:00:00Z");

  it("waits before not_before, is due inside the window, and is gone after expires", () => {
    expect(postFeedItemState(item({ not_before: "2026-04-11T00:00:00Z" }), now)).toBe("waiting");
    expect(postFeedItemState(item({ expires: "2026-04-11T00:00:00Z" }), now)).toBe("due");
    expect(postFeedItemState(item({ expires: "2026-04-10T00:00:00Z" }), now)).toBe("expired");
    expect(postFeedItemState(item({}), now)).toBe("due");
  });
});

describe("the published files", () => {
  it("every example parses with no item refused", () => {
    for (const name of ["cafe", "shop", "saas-changelog"]) {
      const parsed = parsePostFeed(read(`examples/${name}.json`));
      if (!parsed.ok) throw new Error(`${name}: ${parsed.reason}`);
      expect(parsed.feed.rejected, name).toEqual([]);
      expect(parsed.feed.items.length, name).toBeGreaterThan(1);
      expect(
        parsed.feed.items.every((i) => i.extended),
        name,
      ).toBe(true);
    }
  });

  it("the JSON Schema says what the parser reads", () => {
    const schema = JSON.parse(read("schema/runner-extension.schema.json")) as {
      properties: Record<string, { enum?: string[]; properties?: Record<string, unknown> }>;
    };
    expect(schema.properties.kind?.enum).toEqual([...POST_FEED_KINDS]);
    expect(schema.properties.priority?.enum).toEqual([...POST_FEED_PRIORITIES]);
    expect(Object.keys(schema.properties).sort()).toEqual(
      [
        "channels",
        "characters",
        "claims",
        "expires",
        "kind",
        "not_before",
        "priority",
        "rights",
      ].sort(),
    );
    expect(Object.keys(schema.properties.rights?.properties ?? {}).sort()).toEqual(
      ["made_with_ai", "owned", "shows_real_person"].sort(),
    );
  });
});
