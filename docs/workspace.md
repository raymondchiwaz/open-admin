# Team workspace

OpenAdmin brings app activity, team updates, feedback, and tasks together without ranking people or encouraging endless scrolling. The existing plugin system and zero-build Node.js setup are retained.

## Everyday use

- Start with Home feed. Overview remains available for plugin widgets.
- Review unresolved update posts and warning/error posts under Needs attention. Resolve or reopen them from the feed.
- Write an update, deployment note, or status. Ctrl/Cmd+Enter posts it. Changing type keeps the draft. The composer draft is stored in this browser under the current workspace path.
- Bookmark a post to find it under Saved. Bookmarks are local to this browser, not shared across devices or users.
- Reply in a collapsed thread. Reactions acknowledge messages without changing feed order.
- Add or complete a task under On your radar. The list prioritizes high, then medium, then low priority tasks for the whole workspace.
- Move community feedback through open, planned, and shipped states.
- Use More tools for less frequent pages, Apps & integrations for plugin management, and Ctrl/Cmd+K for navigation.

New posts wait behind a refresh button. There is no automatic infinite scroll. Feed pages contain 15 posts; loading more is explicit. Other updates can refresh counters and task statuses, while composer and quick-task drafts are preserved. Reaction/comment updates preserve an open reply draft.

## Data and integration

The metrics use the Users, Tasks, Feedback, and plugin APIs. Disabled tools yield unavailable values rather than invented counts. The stories API reports Not connected for absent uptime/error/visitor measurements and preserves real zero values.

Existing plugins can publish through `social.post`, emit an `activity` event, or send events through the existing HTTP event endpoint. Base-path embedding such as `/admin` remains supported. See [HTTP API](http-api.md), [plugin API](plugin-api.md), and [pipeline integration](pipeline-integration.md).

### Feed query

`GET /api/social/feed` supports:

| Query | Behavior |
| --- | --- |
| `tab` | `all`, `attention`, `announcements`, `updates`, or `saved` |
| `q` | Case-insensitive text, author, and hashtag search |
| `source` | Exact source match |
| `tag` | Exact tag match |
| `ids` | Comma-separated saved post IDs; used only for `tab=saved` |
| `limit` | 1–100, default 60; invalid numbers use the default |
| `offset` | Nonnegative starting offset, default 0 |

The response includes `posts`, `total`, `sources`, `hasMore`, and `nextOffset`. Existing clients reading only `posts` remain compatible. Feedback and conversation tags are no longer sorted by vote/popularity counts.

## Boundaries

First-run records are sample content. The bundled app-update catalog demonstrates version bookkeeping; it does not download new software. Real external integrations still need configuration. The current API uses a shared Admin author and the host application's auth hook; this redesign does not add per-person authentication or authorization. Bookmarks, composer drafts, and reaction tracking are browser-local.

## Verification

Run `node --test tests/*.test.js`. Workspace coverage includes combined feed filtering, saved IDs, bounded pagination, missing telemetry versus zero, embedded asset paths, package frontend inclusion, and flushing pending writes when the kernel closes.

The implementation uses locally bundled Lucide 0.468.0 icons with their license in `public/icons/LICENSE`; no runtime CDN or build dependency is required.
