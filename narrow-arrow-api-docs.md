# Narrow Arrow API Documentation (Unofficial)

Reverse-engineered API reference for [Narrow Arrow](https://narrowarrow.xyz), compiled from manual testing and network inspection. This is **not official documentation** — endpoints, fields, and behavior may change without notice.

- **Base API URL:** `https://api.narrowarrow.xyz`
- **Game client URL:** `https://play.narrowarrow.xyz`
- **Auth:** Most write/personal endpoints require a `Bearer` token in the `Authorization` header (`Authorization: Bearer ey...`). Read-only/public endpoints generally work without auth.

> Status: living document. All example values below (usernames, IDs, level names, timestamps, stats) are **placeholders for illustration only** — none reflect real accounts or real live data. Fields marked "unconfirmed" come from a limited sample and may not be exhaustive.

---

## Table of Contents

1. [Levels](#1-levels)
2. [Packs](#2-packs)
3. [Leaderboards & Runs](#3-leaderboards--runs)
4. [Custom Levels (Editor)](#4-custom-levels-editor)
5. [Ranked / Cups](#5-ranked--cups)
6. [User & Profile](#6-user--profile)
7. [Economy (Coins, Spins, Chests)](#7-economy-coins-spins-chests)
8. [Trophies & Ranked Ladder](#8-trophies--ranked-ladder)
9. [Daily Content](#9-daily-content)
10. [Notifications](#10-notifications)
11. [Settings & Startup](#11-settings--startup)
12. [Shop & Skin Unlocks](#12-shop--skin-unlocks)
13. [Authentication](#13-authentication)
14. [Misc / Version](#14-misc--version)
15. [Game Assets (Static Files)](#15-game-assets-static-files)
16. [Data Structures Reference](#16-data-structures-reference)
17. [Notes / Open Questions](#17-notes--open-questions)

---

## 1. Levels

### Get level details
```
GET /level-details/{levelId}?isCustomLevel=true
```
Returns full level data, including obstacles, metadata, world record, and (if authenticated) your personal best and like status. See [Level Data Object](#level-data-object) for the full shape.

**Error response** (invalid/unknown level ID):
```json
{ "error": "Level not found" }
```

### Get level embed image
```
GET /level-image/{levelId}.png
```
Returns a PNG preview/embed image for the level.

### Like / unlike a level
```
POST   /levels/{levelId}/like
DELETE /levels/{levelId}/like
```
Requires auth.

### Published levels (browse/search)
```
GET /published-levels?filter={filter}&page={page}
GET /published-levels?filter={filter}&page={page}&search=by%3A{username}
```
**`filter` values:**
| Value | Description |
|---|---|
| `discover` | Discovery feed of levels |
| `new` | Newest levels |
| `popular` | Most popular levels |
| `liked` | Levels you've liked (auth required) |

**Query params:**
| Param | Description |
|---|---|
| `page` | Zero-indexed page number |
| `search` | Use `by:{username}` to filter by creator |
| `completed` | `true` / `false` — filter by your completion status |

Example — a user's levels sorted by popularity:
```
GET /published-levels?filter=popular&page=0&search=by%3A{username}
```

---

## 2. Packs

Packs are curated groups of official levels.

### List all packs
```
GET /packs
```
**Response** — array of pack summary objects:
```json
[
  {
    "id": 1,
    "slug": "official-pack",
    "name": "Official Pack",
    "theme": "#FFC107",
    "icon": "star",
    "position": 0,
    "size": 8,
    "creators": ["CreatorA", "CreatorB", "CreatorC"],
    "completed_count": 0
  }
]
```
Confirmed live packs (as of testing): `official-pack`, `ice-pack`, `spinner-pack`, `highspeed-pack`, `precision-pack`, `deadzone-pack`, `symmetry-pack`, `bounce-pack`.

### Get single pack (with levels)
```
GET /packs/{slug}
```
Returns the pack summary plus a `levels` array. Each entry includes the full level object (id, level_id, name, position, creator info, like_count, format versions, and the nested `data` object with obstacles etc.) — see [Level Data Object](#level-data-object).

---

## 3. Leaderboards & Runs

### Level leaderboard
```
GET /leaderboard?levelId={levelId}
GET /leaderboard?levelId={levelId}&arrowFilter={arrow}
```
**`arrowFilter`** accepts one or more arrow names, comma-separated (URL-encoded as `%2C`). Default (omitted) = all arrows.

Valid arrow names: `Narrow Arrow`, `Speedy Arrow`, `Energy Arrow`.

Examples:
```
GET /leaderboard?levelId=ABCD1234&arrowFilter=Speedy+Arrow
GET /leaderboard?levelId=ABCD1234&arrowFilter=Speedy+Arrow%2CEnergy+Arrow
GET /leaderboard?levelId=ABCD1234&arrowFilter=Energy+Arrow%2CNarrow+Arrow
```

**Response** — array of run entries:
```json
[
  {
    "run_id": 100001,
    "completion_time": 11.187,
    "username": "ExamplePlayer",
    "arrow_name": "Speedy Arrow",
    "created_at": "2026-01-01T12:00:00.000Z",
    "replay_available": 1,
    "is_verifier": false
  }
]
```

### Get a specific run (replay)
```
GET /runs/{runId}
```

### Your personal runs for a level
```
GET /runs?levelId={levelId}
GET /runs?levelId={levelId}&arrowFilter={arrow}
```
Requires auth. Same `arrowFilter` rules as the leaderboard endpoint.

### Submit a run (non-ranked / normal play)
```
POST /runs/batch
```
**Payload:**
```json
{
  "runs": [
    {
      "mapName": "ABCD1234",
      "inputs": "........",
      "input_count": 5213,
      "arrowName": "Narrow Arrow",
      "skinConfig": {
        "themeColor": { "code": 14483524, "name": "Example Red", "rarity": "rare" },
        "skinIndices": { "theme": 7, "shader": 4, "thrust": 14 },
        "thrustColor": { "code": 16711680, "name": "Red", "rarity": "common" },
        "thrustShader": { "code": "Glitch", "name": "Glitch" }
      },
      "isCustomLevel": true,
      "levelId": "ABCD1234",
      "clientSubmissionId": "1700000000000-aaaaaaaa-bbbbbbbb-cccccccc-dddddddd",
      "isDaily": false
    }
  ]
}
```
`clientSubmissionId` appears to be a client-generated idempotency key (timestamp + UUID-like segments).

**Response:**
```json
{
  "results": [
    { "clientSubmissionId": "1700000000000-...", "status": "accepted" }
  ],
  "accepted": 1,
  "duplicates": 0,
  "rejected": 0
}
```

---

## 4. Custom Levels (Editor)

All require auth.

### List / get your custom levels
```
GET /custom-levels
```

### Create / save a custom level
```
POST /custom-levels
```
**Payload:**
```json
{
  "level_id": "ABCD1234",
  "name": "My Level",
  "published": false,
  "data": {
    "format_version": 3,
    "required_format_version": 0,
    "map_name": "My Level",
    "game_mode": "speedrun",
    "obstacles": [
      {
        "obstacle_type": "wall",
        "wall_type": "normal",
        "wall_thickness": 8,
        "points": [{ "x": 0, "y": -30 }]
      }
    ]
  }
}
```
**Response:**
```json
{ "message": "Custom level saved successfully", "level_id": "ABCD1234" }
```

### Delete a custom level
```
DELETE /custom-levels/{levelId}
```
**Response:**
```json
{ "message": "Custom level deleted successfully" }
```

### Publish a custom level
```
POST /custom-levels/{levelId}/publish
```

---

## 5. Ranked / Cups

### Start a ranked cup
```
POST /start-cup
```
**Response** includes a cup ID and the map rotation for that cup, plus (in at least one observed response) a parallel `mapData` array:
```json
{
  "cupId": 10001,
  "maps": [
    { "id": 2, "name": "Example Map", "format_version": 0, "required_format_version": 0 },
    { "id": 1, "name": "Another Map", "format_version": 0, "required_format_version": 0 }
  ],
  "mapData": [
    { "...": "full level object per map, same shape as the Level Data Object" }
  ]
}
```
`maps[]` appears to be the official ranked map pool (IDs are stable references to built-in ranked maps, distinct from custom `level_id` strings used elsewhere). `mapData[]` mirrors `maps[]` with full obstacle data per map — **not fully confirmed field-by-field**, treat as an extension of the [Level Data Object](#level-data-object).

### Submit a ranked run
```
POST /runs
```
Unlike `/runs/batch` (normal play), this is used specifically inside an active ranked cup session and returns live standings.

**Response:**
```json
{
  "runId": 100002,
  "verified": true,
  "completionTime": 14.303,
  "verificationPending": false,
  "currentCupRun": 1,
  "currentRunRanking": 1,
  "overallResults": [
    { "username": "PlayerOne", "score": 0 },
    { "username": "PlayerTwo", "score": 1 },
    { "username": "PlayerThree", "score": 2 },
    { "username": "PlayerFour", "score": 3 }
  ]
}
```

---

## 6. User & Profile

### Get a user's public profile
```
GET /user/{username}
```

### Get your own account info
```
GET /user-info
```
Requires auth.
```json
{
  "id": 1,
  "username": "ExampleUser",
  "email_verified": 1,
  "is_guest": 0,
  "bio": "..."
}
```

---

## 7. Economy (Coins, Spins, Chests)

### Get your coin balance
```
GET /coins
```

### Open a crate (spin)
```
POST /buy-spin
```
**Payload:**
```json
{ "spinType": "ultra" }
```
**`spinType` values:** `basic`, `premium`, `ultra`

### Chest slots
```
GET /chests
```
```json
{ "chestSlots": [null, null, null] }
```

---

## 8. Trophies & Ranked Ladder

### Your trophies
```
GET /trophies
```
```json
{
  "trophies": 500,
  "league": "Champion",
  "range": { "min": 400, "max": null }
}
```
`range` is the trophy band for the current league; `max: null` indicates the top league (no upper bound).

### Your winstreak
```
GET /winstreak
```
```json
{ "win_streak": 0 }
```
Current ranked win streak (consecutive ranked cup wins).

### Global trophy leaderboard
```
GET /leaderboard/trophies
```
```json
[
  { "username": "ExamplePlayer", "trophies": 500, "league": "Champion", "win_streak": 0 }
]
```

**League tiers observed:** Champion, Diamond (1–3), Gold (1–3), Silver (1–3), Bronze (1–3) — see [assets](#15-game-assets-static-files) for corresponding icons.

---

## 9. Daily Content

### Daily skins (shop rotation)
```
GET /daily-skins
```
```json
{ "dailySkins": [], "nextRefresh": "2026-01-01T00:00:00.000Z" }
```

### Daily level & streak (via startup data)
Included inside [`/startup-data`](#11-settings--startup) under the `daily` key — see [Data Structures](#daily-object) for the full shape (streak, reward ladder, today's level, etc).

---

## 10. Notifications

### Get notifications
```
GET /notifications
```
Returns an array of notification objects, newest first.

**Example entries (one per known `type`):**
```json
[
  {
    "id": 1,
    "text": "SomeUser took your WR on Example Level",
    "created_at": "2026-01-01T12:00:00.000Z",
    "read": 0,
    "type": "wr_taken",
    "data": {
      "levelId": "ABCD1234",
      "levelName": "Example Level",
      "isCustomLevel": true,
      "openLeaderboard": true
    }
  },
  {
    "id": 2,
    "text": "SomeUser liked your level Example Level",
    "created_at": "2026-01-01T12:00:00.000Z",
    "read": 1,
    "type": "level_like",
    "data": {
      "levelId": "ABCD1234",
      "levelName": "Example Level",
      "isCustomLevel": true,
      "openLeaderboard": true
    }
  },
  {
    "id": 3,
    "text": "SomeUser set a new WR on your level Example Level",
    "created_at": "2026-01-01T12:00:00.000Z",
    "read": 1,
    "type": "level_new_wr",
    "data": {
      "levelId": "ABCD1234",
      "levelName": "Example Level",
      "isCustomLevel": true,
      "openLeaderboard": true
    }
  }
]
```

**Known `type` values:**
| Type | Meaning |
|---|---|
| `wr_taken` | Someone beat your world record on a level |
| `level_like` | Someone liked a level you created |
| `level_new_wr` | Someone set a new world record on a level you created |

There may be additional types not yet observed (e.g. social/friend events, cup results).

**Common `data` fields:** `levelId`, `levelName`, `isCustomLevel`, `openLeaderboard`. Some entries have been observed with a `readCount`-style aggregation (e.g. "5 players liked your level ...") — exact aggregation trigger/shape not confirmed.

### Mark notifications as read
```
POST /notifications/mark-read
```

---

## 11. Settings & Startup

### Get settings
```
GET /settings
```
**Response:**
```json
{
  "background": "grid",
  "cameraZoom": 5,
  "musicVolume": 0,
  "pauseKeybind": "70028",
  "cameraMoveAhead": 0.1,
  "enableDepthView": false,
  "showSpeedometer": true,
  "turnLeftKeybind": "70050",
  "arrowSkinConfigs": {
    "energy": { "...": "Skin Config Object, see Data Structures" },
    "narrow": { "...": "Skin Config Object, see Data Structures" },
    "speedy": { "...": "Skin Config Object, see Data Structures" }
  },
  "turnRightKeybind": "7004f",
  "cameraDynamicZoom": 0,
  "ghostTransparency": 0.7,
  "showFinishDeltaPB": true,
  "showFinishDeltaWR": true,
  "showInputIndicator": true,
  "turnLeftAltKeybind": "",
  "restartLevelKeybind": "7002c",
  "turnRightAltKeybind": "",
  "cameraZoomSmoothness": 4,
  "enableWallContactShader": true,
  "cameraMovementSmoothness": 2,
  "showEditorTestTrajectory": true
}
```

### Update settings
```
POST /settings
```
Takes the same shape as the GET response (full settings object, not a partial patch — send all fields back). Keybinds are stored as hex-string scancodes (e.g. `"70028"`).

**Settings field reference:**
| Field | Type | Notes |
|---|---|---|
| `background` | string | e.g. `"grid"` |
| `cameraZoom` | number | |
| `cameraDynamicZoom` | number | |
| `cameraZoomSmoothness` | number | |
| `cameraMoveAhead` | number | |
| `cameraMovementSmoothness` | number | |
| `musicVolume` | number | |
| `enableDepthView` | boolean | |
| `showSpeedometer` | boolean | |
| `showFinishDeltaPB` / `showFinishDeltaWR` | boolean | Show time delta vs personal best / world record |
| `showInputIndicator` | boolean | |
| `showEditorTestTrajectory` | boolean | |
| `enableWallContactShader` | boolean | |
| `ghostTransparency` | number | 0–1 |
| `pauseKeybind` / `restartLevelKeybind` / `turnLeftKeybind` / `turnRightKeybind` / `turnLeftAltKeybind` / `turnRightAltKeybind` | string | Hex scancode strings; alt binds can be empty string |
| `arrowSkinConfigs` | object | Keyed by `energy` / `narrow` / `speedy`, each a [Skin Config Object](#skin-config-object) |

### Startup data
```
GET /startup-data
```
Bulk payload fetched on client startup, bundling several other resources in one call. Reported to be large (~2MB observed), likely because it inlines significant level/pack data. Known top-level keys:

| Key | Description |
|---|---|
| `freeSpins` | `{ remaining, total, used }` |
| `daily` | Daily level/streak info — see below |
| `settings` | Same shape as [`GET /settings`](#get-settings) |
| `publishedLevels` | Array of level objects (recently published / featured — exact selection criteria not confirmed) |

`freeSpins` example:
```json
{ "freeSpins": { "remaining": 5, "total": 5, "used": 0 } }
```

<a id="daily-object"></a>
**`daily` object shape:**
```json
{
  "bestStreak": 13,
  "completedToday": true,
  "streak": 13,
  "nextClaimStreak": 14,
  "nextRefresh": "2026-01-01T00:00:00.000Z",
  "todayReward": { "kind": "coins", "amount": 150 },
  "ladder": [
    { "cycleDay": 1, "kind": "coins", "amount": 50 },
    { "cycleDay": 2, "kind": "coins", "amount": 75 },
    { "cycleDay": 3, "kind": "chest", "chestType": "basic" },
    { "cycleDay": 4, "kind": "coins", "amount": 100 },
    { "cycleDay": 5, "kind": "chest", "chestType": "premium" },
    { "cycleDay": 6, "kind": "coins", "amount": 150 },
    { "cycleDay": 7, "kind": "chest", "chestType": "ultra" }
  ],
  "level": {
    "date": "2026-01-01",
    "type": "custom",
    "levelKey": "1234567890123",
    "name": "Example Level",
    "creatorName": "ExampleCreator",
    "creatorId": 1,
    "requiredFormatVersion": 0,
    "isFallback": false,
    "data": { "map_name": "Example Level", "game_mode": "speedrun", "obstacles": [ "..." ] }
  }
}
```
`ladder[].kind` is either `"coins"` (with `amount`) or `"chest"` (with `chestType`: `basic` / `premium` / `ultra`). The ladder repeats/cycles on a 7-day pattern based on `streak`.

---

## 12. Shop & Skin Unlocks

### Exclusive skin deal
```
GET /exclusive-skin-deal?clientSupportsMultipleDeals=true
```

### Daily skins
See [Daily Content](#9-daily-content).

### Unlocked skin config
```
GET /unlocked-skin-config
```
Returns everything the account has unlocked, broken out per arrow type (`narrow arrow` / `speedy arrow` / `energy arrow`) and per cosmetic slot. Top-level keys:

| Key | Description |
|---|---|
| `unlockedThrustColors` | Colors available for the thruster, per arrow |
| `unlockedThemeColors` | Colors available for the arrow body/theme, per arrow |
| `unlockedThrustShaders` | Shader/pattern options for the thruster, per arrow |

**`unlockedThrustColors` / normal entry shape:**
```json
{ "code": 16744448, "name": "Orange", "rarity": "common" }
```
`code` is a decimal RGB integer.

**`unlockedThemeColors` — two entry shapes observed:**

Most entries are normal tiered colors:
```json
{ "code": 16755455, "name": "Example Color", "rarity": "rare" }
```

Some entries are special/event skins with a different shape — `code` as a hex *string*, `rarity: null`, and extra visual fields:
```json
{
  "code": "#2222AB",
  "name": "Example Special Skin",
  "image": "example.svg",
  "scale": 1.2,
  "collisionCircle": "0x003366",
  "rarity": null
}
```
One observed entry had a non-standard string in the `rarity` slot instead of `null` (e.g. a short event-tag abbreviation) — this looks like a one-off/limited-event marker rather than a real rarity tier. Treat any non-`null`, non-tier string in `rarity` as a special-event flag, not a 4th rarity level.

**`unlockedThrustShaders` entry shape:**
```json
{ "name": "Glitch", "rarity": "rare" }
```
No `code` field — shaders are referenced by name only (matches the `thrustShader.code` field in the Skin Config Object, which is actually a shader *name* string despite the field name).

**Confirmed rarity tiers:** `common`, `rare`, `legendary`.

**Confirmed shader names (consistent across all 3 arrows):** `Default`, `Angles`, `Reverse Angles`, `Lines`, `Outlines`, `Glitch`.

---

## 13. Authentication

### Log in
```
POST /login
```
**Payload:**
```json
{
  "usernameOrEmail": "ExampleUser",
  "password": "..."
}
```
**Response:**
```json
{
  "access_token": "ey...",
  "refresh_token": "ey...",
  "username": "ExampleUser",
  "id": 1
}
```
Both tokens are JWTs (`ey...` prefix). `access_token` is used as the `Authorization: Bearer` value for authenticated requests.

**Not yet confirmed:**
- Whether a separate refresh endpoint exists that exchanges `refresh_token` for a new `access_token` (vs. re-running `/login`), and if so its path/payload shape.
- Access token expiry duration.
- Registration/signup endpoint.
- Password reset flow.

---

## 14. Misc / Version

### Client version check
```
GET https://play.narrowarrow.xyz/version.json?cachebuster={timestamp}
```
`cachebuster` is just a timestamp/random number to bust caching.

**Response:**
```json
{
  "latestVersions": {
    "ios": { "version": "2.2.0", "build": 215 },
    "android": { "version": "2.2.0", "build": 215 }
  }
}
```

---

## 15. Game Assets (Static Files)

Base: `https://play.narrowarrow.xyz/assets/assets/`

### UI Icons
| Asset | Path |
|---|---|
| Logo | `images/logo.png` |
| Shop icon | `images/shop.svg` |
| Editor icon | `images/editor.svg` |
| Menu icon | `images/menu.svg` |
| Community icon | `images/community.svg` |
| Account icon | `images/account.svg` |
| Coin icon | `images/coin_v2.svg` |
| Trophy icon | `images/trophy.svg` |
| Like (empty) | `images/like_empty.svg` |
| Like (full) | `images/like_full.svg` |
| Link icon | `images/link.svg` |

### Mystery Object (crate) icons
| Asset | Path |
|---|---|
| Basic crate | `images/BasicMysteryObject.svg` |
| Premium crate | `images/PremiumMysteryObject.svg` |
| Ultra crate | `images/UltraMysteryObject.svg` |

### Arrows (playable skins — base types)
| Asset | Path |
|---|---|
| Energy Arrow | `skins/energy.svg` |
| Narrow Arrow | `skins/narrow.svg` |
| Speedy Arrow | `skins/speedy.svg` |

### League rank icons
Path pattern: `images/leagues/{league}.svg`

| League | File(s) |
|---|---|
| Champion | `champion.svg` |
| Diamond | `diamond1.svg`, `diamond2.svg`, `diamond3.svg` |
| Gold | `gold1.svg`, `gold2.svg`, `gold3.svg` |
| Silver | `silver1.svg`, `silver2.svg`, `silver3.svg` |
| Bronze | `bronze1.svg`, `bronze2.svg`, `bronze3.svg` |

---

## 16. Data Structures Reference

<a id="level-data-object"></a>
### Level Data Object
Used in pack level lists, `/level-details`, custom level payloads, and (likely) ranked `mapData`.

```json
{
  "id": 100,
  "level_id": "ABCD1234",
  "name": "Example Level",
  "position": 0,
  "creator_name": "ExampleCreator",
  "creator_id": 1,
  "like_count": 2,
  "format_version": 1,
  "required_format_version": 3,
  "created_at": "2026-01-01T00:00:00.000Z",
  "updated_at": "2026-01-01T00:00:00.000Z",
  "author": "ExampleAuthor",
  "worldRecord": { "runId": 100000, "completion_time": 1.233 },
  "arrow_name": "Speedy Arrow",
  "username": "ExampleUser",
  "replay_available": 1,
  "runCount": 31,
  "personalBest": null,
  "userLiked": false,
  "data": {
    "map_name": "Example Level",
    "game_mode": "speedrun",
    "obstacles": []
  }
}
```
`worldRecord`, `runCount`, `personalBest`, and `userLiked` appear on the outer level object (alongside `data`) when fetched via `/level-details`, not inside `data` itself. `personalBest` is `null` if the requesting user hasn't completed the level (or is unauthenticated).

#### Obstacles

All obstacle entries share a `points` array of `{x, y}` coordinates and an `obstacle_type`. Optionally, any obstacle can rotate by including `rotation_pivot: {x, y}` and `rotation_speed` (signed number; sign controls direction).

**`obstacle_type: "wall"`** — a solid line/segment obstacle. Sub-typed by `wall_type`:
| `wall_type` | Behavior |
|---|---|
| `normal` | Standard solid wall |
| `boost` | Speeds up the arrow on contact |
| `bouncy` | Bounces the arrow off on contact |
| `death` | Kills/resets the arrow on contact |
| `finish` | Level finish line |

Walls also have a `wall_thickness` (number, pixels).

```json
{
  "obstacle_type": "wall",
  "wall_type": "boost",
  "wall_thickness": 10,
  "points": [{ "x": -180, "y": -390 }, { "x": -180, "y": -330 }],
  "rotation_pivot": { "x": -180, "y": -480 },
  "rotation_speed": 0.001
}
```

**`obstacle_type: "zone"`** — an area-effect region (can be more than 2 points, forming a polygon). Sub-typed by `zone_type`:
| `zone_type` | Behavior |
|---|---|
| `ice` | Low-friction surface |
| `boost` | Speeds up the arrow while inside |
| `nosteer` | Disables steering input while inside |

```json
{
  "obstacle_type": "zone",
  "zone_type": "ice",
  "points": [{ "x": 0, "y": -210 }, { "x": 30, "y": -510 }, { "x": 30, "y": -450 }, { "x": 60, "y": -450 }, { "x": 60, "y": -510 }]
}
```
Note: at least one observed `nosteer` zone also carried `side` and `portal_id` fields (see below), suggesting zones and portals can be paired/linked — exact interaction not confirmed.

**`obstacle_type: "portal"`** — teleports the arrow between two linked points. Portals come in linked pairs sharing a `portal_id`, distinguished by `side` (`"a"` and `"b"`):
```json
{
  "obstacle_type": "portal",
  "side": "a",
  "portal_id": "178041561586600",
  "points": [{ "x": 450, "y": -420 }, { "x": 420, "y": -360 }]
}
```
```json
{
  "obstacle_type": "portal",
  "side": "b",
  "portal_id": "178041561586600",
  "points": [{ "x": 150, "y": -150 }, { "x": 150, "y": -210 }]
}
```

**`obstacles[]` field reference:**
| Field | Type | Applies to | Notes |
|---|---|---|---|
| `obstacle_type` | string | all | `"wall"` \| `"zone"` \| `"portal"` |
| `wall_type` | string | walls | `normal` / `boost` / `bouncy` / `death` / `finish` |
| `zone_type` | string | zones | `ice` / `boost` / `nosteer` |
| `wall_thickness` | number | walls | pixel thickness |
| `points` | array of `{x, y}` | all | vertex path; 2 points = line segment, 3+ = polygon (zones) |
| `rotation_pivot` | `{x, y}` | any | center point of rotation, if rotating |
| `rotation_speed` | number | any | signed; present only if the obstacle rotates |
| `side` | string | portals (also seen on one zone) | `"a"` or `"b"` — pairs with `portal_id` |
| `portal_id` | string | portals (also seen on one zone) | shared ID linking two portal sides |

**`game_mode` values observed:** `"speedrun"`

<a id="skin-config-object"></a>
### Skin Config Object
Describes a player's equipped cosmetics for one arrow. Appears in `arrowSkinConfigs` (settings), and in the `skinConfig` field when submitting a run.

```json
{
  "themeColor": { "code": 14483524, "name": "Example Red", "rarity": "rare" },
  "skinIndices": { "theme": 7, "shader": 4, "thrust": 14 },
  "thrustColor": { "code": 16711680, "name": "Red", "rarity": "common" },
  "thrustShader": { "code": "Glitch", "name": "Glitch" }
}
```
- `code` under `themeColor`/`thrustColor` = decimal RGB integer (special/event skins may instead use a hex string — see [Unlocked Skin Config](#12-shop--skin-unlocks)).
- `themeColor` may also carry a `collisionCircle` field (color code for the collision-circle visual) instead of/alongside `rarity`, depending on skin type.
- `rarity` tiers: `common`, `rare`, `legendary`.
- `skinIndices` map to which visual variant is equipped per slot (theme/shader/thrust) — likely indices into the unlocked-options arrays.
- `thrustShader.code` is actually a shader **name** string (e.g. `"Glitch"`), not a numeric/hex code, despite the field name — matches entries from `unlockedThrustShaders`.

### Arrow Names
Valid values for `arrowName` / `arrow_name` / `arrowFilter`:
- `Narrow Arrow`
- `Speedy Arrow`
- `Energy Arrow`

Note: `/unlocked-skin-config` and `/settings` key arrows in **lowercase** (`narrow arrow`, `speedy arrow`, `energy arrow` / `narrow`, `speedy`, `energy`), while run submission and leaderboards use **title case** (`Narrow Arrow`, `Speedy Arrow`, `Energy Arrow`). Be careful to match casing per-endpoint.

---

## 17. Notes / Open Questions

- Full `/settings` POST validation behavior (e.g. what happens on partial payloads) not confirmed — assume full object required.
- `publishedLevels` inside `/startup-data` — exact selection criteria (recency? featured? personalized?) not confirmed.
- `mapData` inside `/start-cup` response — field shape assumed to match the Level Data Object but not fully verified.
- Additional `obstacle_type` or `wall_type`/`zone_type` values beyond those listed may exist and haven't been observed yet.
- Full list of notification `type` values beyond `wr_taken`, `level_like`, `level_new_wr` not confirmed.
- Refresh-token flow (endpoint, if any) not confirmed — only the initial `/login` exchange is documented.
- Access token expiry duration not confirmed.
- Registration and password-reset endpoints not documented.
- Error response shapes beyond "Level not found" (e.g. expired/invalid token, rate limiting) not confirmed.

---

*Compiled from manual API inspection. Intended for personal tooling use (uploaders, bots, dashboards, etc.) against narrowarrow.xyz. All example data in this document is illustrative/placeholder only.*
