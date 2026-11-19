# Post Feed

A feed format for handing a growth team, people or AI, what is new with your business, so
it can post about it. It is [JSON Feed 1.1](https://www.jsonfeed.org/version/1.1/) with one
optional block per item, `_runner`, for the things a plain feed cannot say: when an offer
ends, which claims may be made, whether the picture is yours to post.

Plain RSS 2.0 and Atom feeds work too. They are read with careful defaults.

## The shortest feed that works

```json
{
  "version": "https://jsonfeed.org/version/1.1",
  "title": "Juniper Street Café",
  "items": [
    {
      "id": "spring-menu-2026",
      "title": "Spring menu is in",
      "content_text": "Three new plates this spring.",
      "url": "https://juniperstreet.example/menu"
    }
  ]
}
```

## The `_runner` block

Every field is optional. The full rules are in
[`schema/runner-extension.schema.json`](schema/runner-extension.schema.json).

| Field | What it does |
|---|---|
| `kind` | `news`, `product`, `event`, `offer`, `story` or `character`. Shapes how a post is written. |
| `not_before` | Not posted before this moment. |
| `expires` | Never posted after this moment: the end of an offer, the start of an event. |
| `claims` | When given, the only claims a post about the item may make. |
| `characters` | Recurring characters to feature, by the exact name the team knows them by. |
| `rights` | `owned`, `made_with_ai`, `shows_real_person`, about the item's picture. |
| `channels` | Where to post (`instagram`, `linkedin`, …). Left out, the team chooses. |
| `priority` | `push` asks for it ahead of the team's own ideas. |

## Rules every reader keeps

- **An `id` is posted once.** Keep each item's id stable; changing it makes a new item.
- **Expired items are skipped, and early ones wait** until `not_before`.
- **A picture is used only when `rights.owned` is true**, and never when
  `rights.shows_real_person` is true: a feed cannot carry a person's consent.
- **Claims are a ceiling, not a script.** A post may say less, never more.
- **A feed hands over facts, never finished posts.** The team writes, and a person approves.

## Using the parser

```ts
import { parsePostFeed, postFeedItemState, postFeedPictureUsable } from "@runtheworldai/post-feed";

const parsed = parsePostFeed(await (await fetch(url)).text());
if (parsed.ok) {
  for (const item of parsed.feed.items) {
    if (postFeedItemState(item, new Date()) !== "due") continue;
    // item.claims, item.characters, postFeedPictureUsable(item), …
  }
}
```

No dependencies. Examples for a café, a shop and a software changelog are in
[`examples/`](examples/).

## Licence

[Common Sense License (CSL) v1.1](LICENSE), Copyright (C) 2026 Shmaplex: free for individuals, nonprofits, researchers and businesses under USD $10 million in annual revenue; larger commercial users owe reciprocity under its terms. It covers this package only, not Runner.

## Releasing

Bump `version` in `package.json` and push to `main`. The [publish workflow](.github/workflows/publish.yml) builds, tests and publishes any version npm does not have yet, through npm trusted publishing: no token is stored, and each release carries a provenance statement.
