# MEOVV 2026 Yearbook — Discord Bot

Runs the **MEOVV 2026 Yearbook** fan event (Nov 2 – Nov 22) on Discord:

| When | What the bot does |
|---|---|
| **Week 1 · Nov 2–8** | Posts the kickoff announcement. Fans nominate with `/nominate member` (superlatives) and `/nominate moment` (2026 content and moments, with an optional link). Autocomplete suggests what other fans already nominated, so duplicates group together. |
| **Week 2 · Nov 9–15** | The top nominations become **native Discord polls**, posted automatically every day. Each poll links the nominated content so fans can rewatch it before voting. |
| **Week 3 · Nov 16–22** | Posts *"What MEOVV moment made your 2026?"* with a **💌 Share your moment** button (or `/moment`), then runs the retrospective polls. |
| **Reveal · Nov 22** | Builds the yearbook (Member Superlatives, 2026 Fan Favorites, MEOVV Moments of 2026, featured fan responses) as **PNG pages** and posts them, one message per page. |

Staff stay in control with `/yb`. They can merge duplicate nominations, fix names and links, exclude spam, preview or override polls, pick featured fan responses, and publish the yearbook.

---

## Setup

Requires **Node.js 22+**.

1. **Create the bot.** In the [Discord Developer Portal](https://discord.com/developers/applications), create an application and add a Bot. Copy the bot token. No privileged intents are needed.
2. **Invite it to your server.** Under OAuth2 → URL Generator, select the scopes `bot` and `applications.commands`, and these permissions: *View Channels, Send Messages, Embed Links, Attach Files, Send Polls, Read Message History, Mention Everyone* (the last one only if you use `PING_ROLE_ID` with a role that isn't mentionable).
3. **Configure the bot.**
   ```bash
   npm install
   cp .env.example .env      # fill in the token, MongoDB URI, IDs and channel IDs
   ```
   Then edit **`config/yearbook.config.js`** to set dates, members, categories and copy. The event timezone comes from `TZ` in `.env`.
4. **Register the slash commands** (run this again whenever you change categories or members):
   ```bash
   npm run deploy
   ```
5. **Run the bot:**
   ```bash
   npm start
   ```
   Keep it running for the whole event, using a VPS, Railway, Fly.io, or a Raspberry Pi with `pm2`, for example. All state is stored in MongoDB (`MONGO_URI`), in collections prefixed `yearbook_`. If the URI doesn't name a database, the bot uses `meovv-yearbook`.

### Settings (`.env`)

| Variable | Used for |
|---|---|
| `BOT_TOKEN` | Discord bot token |
| `BOT_OWNER_ID` | Your Discord user ID. Always allowed to use `/yb`. |
| `GUILD_ID` | The server the bot runs in |
| `MONGO_URI` | MongoDB connection string |
| `TZ` | Event timezone, for example `America/Los_Angeles`. Every date and time in the config is read in this zone. |
| `LOG_LEVEL` | *(optional)* Console detail: `debug`, `info` (default), `warn` or `error`. `debug` also shows every scheduler pass and database write. |
| `ANNOUNCE_CHANNEL_ID` | Phase announcements, reminders, and the "share your moment" button |
| `POLL_CHANNEL_ID` | Daily yearbook polls |
| `YEARBOOK_CHANNEL_ID` | Final reveal |
| `LOG_CHANNEL_ID` | **Private staff channel.** Every fan entry as it happens (nominations, withdrawals, shared moments, with the fan tagged but not pinged), plus poll results, warnings and the reveal checklist. |
| `PING_ROLE_ID` | *(optional)* Role pinged on announcements and polls |
| `ADMIN_ROLE_ID` | *(optional)* Extra staff role for `/yb`. Also allow this role on `/yb` under Server Settings → Integrations, because by default `/yb` is only visible to members with Manage Server. |

## Commands

**Fans**
- `/nominate member category member [why]`: nominate a member for a superlative
- `/nominate moment category nomination [link]`: nominate a song, MV, performance or moment
- `/nominate withdraw category`: remove one of your nominations
- `/mynominations`: see your picks
- `/moment`: *What MEOVV moment made your 2026?* (Week 3)
- `/yearbook`: event timeline and current phase

Each fan gets one nomination per category. Nominating again replaces the earlier pick.

**Staff (`/yb`)**
- `status`: phase, participation numbers, what's next, and anything that failed
- `nominations view | merge | rename | link | exclude`: curate nominees before Week 2
- `user view | remove`: everything one fan nominated and shared, or wipe it (spam). The `user` option takes an @mention, or type their username or ID.
- `poll preview | post | end | results`: check or override polls. `post options:"A | B=https://… | C"` posts hand-picked answers.
- `memories list | feature | unfeature | remove`: choose fan responses for the yearbook, optionally credited anonymously
- `yearbook preview | publish`: private preview of the PNG pages with a checklist, then the public reveal
- `schedule list | run | retry`: view the automatic timeline, run an item now, or retry a failed one

## Staff runbook

1. **Before starting:** check `npm run schedule`. Do a rehearsal in a test server (see below).
2. **To start the event:** run `/yb schedule run key:announce:nominations`. This posts the announcement and opens nominations. Until then, the bot posts nothing and fans can't nominate.
3. **Until nominations close:** run `/yb nominations view` daily. **Merge duplicates** (for example, "toxic mv" into "TOXIC") so their counts combine, set official links with `/yb nominations link`, and exclude spam.
4. **Before each poll:** `/yb poll preview category:…` shows exactly which answers will post. Polls go out automatically at the scheduled times.
5. **During Week 2 and 3:** results arrive in the log channel as each poll closes. Ties are flagged.
6. **Before Nov 16:** fill in `options` for any Week 3 retrospective poll you want hand-picked in `config/yearbook.config.js`, then restart the bot. Without that, the bot pulls the top Week 1 nominations from the poll's `sources`.
7. **Nov 16–22:** use `/yb memories list` to review responses and `/yb memories feature id:…` to pick the ones for the yearbook.
8. **Nov 22:** the bot posts a checklist in the log channel. Run `/yb yearbook preview`, resolve anything flagged, then `/yb yearbook publish confirm:true`. The pages are 1080×1350 PNGs, ready for socials too.

> Discord polls show results publicly once they close, so the reveal reveals the full yearbook rather than individual winners for the first time.

## Rehearsal mode

Set `YEARBOOK_NOW=2026-11-09T11:58` in `.env` to make the bot think it's that time. The scheduler will run everything due up to that point, so you can dry-run each phase in a **test server**. Point `MONGO_URI` at a separate rehearsal database, drop its `yearbook_` collections between rehearsals, and **remove `YEARBOOK_NOW` before the real event.**

## Configuration notes

- **Songs:** *Favorite MEOVV Song* only accepts songs from the `songs` list in the config. Add new releases there and restart the bot.
- **Categories:** each category has an `enabled` flag. The brief suggests narrowing superlatives to 6–8, and *Best Off-Duty Style* is disabled by default. The scheduler spreads whatever is enabled evenly across the week.
- **Poll timing:** `polls.postTimes` sets the posting times, `polls.durationHours` sets how long polls stay open (48h by default), and every poll is cut off at least `closeBeforeRevealHours` before the reveal.
- **Finalists:** `polls.finalistsPerPoll` (default 5, Discord's maximum is 10) sets how many top nominations make each Week 2 poll. Poll answers are limited to 55 characters, and `/yb nominations rename` sets a clean display name.
- **Yearbook sections:** a category's `section` (`favorites` or `moments`) decides where its winner appears.

## Development

```bash
npm test             # unit tests (text normalisation, tallying, schedule, services, command definitions)
npm run schedule     # print the computed event timeline
npm run render       # render the yearbook pages with sample data to data/previews/
```

```
config/yearbook.config.js   event settings (edit me)
src/index.js                bot entry: interactions + scheduler
src/deploy-commands.js      registers slash commands
src/commands/               /nominate, /mynominations, /moment, /yearbook, /yb
src/services/               nominations, polls, announcements, scheduler, staff log, yearbook builder
src/services/pages.js       yearbook PNG pages (fonts in assets/fonts)
src/lib/                    pure helpers (normalising, tallying, schedule planning)
src/db.js                   MongoDB storage
```
