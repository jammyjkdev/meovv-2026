/**
 * MEOVV 2026 YEARBOOK — event configuration.
 *
 * Everything the team is likely to tweak lives here: dates, members, categories,
 * which categories are enabled, poll timing, and announcement copy.
 *
 * All dates/times are interpreted in `timezone`.
 * Restart the bot after editing. Re-run `npm run deploy` if you change categories
 * or members (they're baked into slash-command choices).
 */
module.exports = {
  eventName: 'MEOVV 2026 Yearbook',
  timezone: 'America/New_York',

  // Accent colour for embeds (hex number).
  color: 0xff4f9a,

  members: [
    { id: 'sooin', name: 'SOOIN', emoji: '🐱' },
    { id: 'gawon', name: 'GAWON', emoji: '🐱' },
    { id: 'anna', name: 'ANNA', emoji: '🐱' },
    { id: 'narin', name: 'NARIN', emoji: '🐱' },
    { id: 'ella', name: 'ELLA', emoji: '🐱' },
  ],

  phases: {
    // WEEK 1 — nominations are accepted between start and end.
    nominations: { start: '2026-11-02T10:00', end: '2026-11-08T23:59' },
    // WEEK 2 — superlative + 2026 nomination polls are spread across these days.
    voting: { start: '2026-11-09T10:00', end: '2026-11-15T23:59' },
    // WEEK 3 — "What MEOVV moment made your 2026?" + retrospective polls.
    review: { start: '2026-11-16T10:00', end: '2026-11-22T12:00' },
    // FINAL REVEAL
    reveal: '2026-11-22T18:00',
  },

  polls: {
    // Local times polls are posted each day. The scheduler uses as many slots per
    // day as needed (e.g. 17 polls over 7 days → 2–3 per day).
    postTimes: ['12:00', '20:00', '16:00'],
    // How long each poll stays open (Discord allows 1–768 hours).
    durationHours: 48,
    // Polls are always closed at least this many hours before the reveal so results are in.
    closeBeforeRevealHours: 2,
    // Max answers on a 2026 nominations poll (Discord max is 10).
    finalistsPerPoll: 5,
    // Ignore nominations with fewer than this many votes when picking finalists.
    minNominationsToQualify: 1,
    // Superlative polls: how many members to include (top nominated). Use 99 for "all members".
    superlativeFinalists: 99,
    // Year-in-review polls are posted on days from review.start up to and including this day.
    reviewPollsUntil: '2026-11-20',
  },

  // WEEK 1 → WEEK 2: fans nominate a member for each superlative.
  // The brief suggests narrowing to 6–8 — flip `enabled` to false to drop one.
  superlatives: [
    { id: 'best-dressed', title: 'Best Dressed', enabled: true },
    { id: 'go-viral', title: 'Most Likely to Go Viral', enabled: true },
    { id: 'make-you-laugh', title: 'Most Likely to Make You Laugh', enabled: true },
    { id: 'start-a-trend', title: 'Most Likely to Start a Trend', enabled: true },
    { id: 'break-the-rules', title: 'Most Likely to Break the Rules', enabled: true },
    { id: 'best-playlist', title: 'Most Likely to Have the Best Playlist', enabled: true },
    { id: 'off-duty-style', title: 'Best Off-Duty Style', enabled: false },
    { id: 'most-chaotic', title: 'Most Chaotic Member', enabled: true },
    { id: 'concert-bestie', title: "Member You'd Want as Your Concert Bestie", enabled: true },
  ],

  // WEEK 1 → WEEK 2: fans nominate content/moments (free text + optional link).
  // `section` decides where the winner lands in the yearbook: 'favorites' or 'moments'.
  nominationCategories: [
    { id: 'song', title: 'Favorite MEOVV Song', section: 'favorites', hint: 'Song title' },
    { id: 'mv', title: 'Favorite Music Video', section: 'favorites', hint: 'MV title' },
    { id: 'performance', title: 'Favorite Performance', section: 'favorites', hint: 'e.g. song + show/stage' },
    { id: 'choreography', title: 'Favorite Choreography', section: 'favorites', hint: 'Song / dance' },
    { id: 'member-look', title: 'Favorite Member Look', section: 'favorites', hint: 'Member + where/when' },
    { id: 'fashion-moment', title: 'Favorite Fashion Moment', section: 'favorites', hint: 'Describe the moment' },
    { id: 'variety-moment', title: 'Favorite Variety/Interview Moment', section: 'moments', hint: 'Show + moment' },
    { id: 'funny-moment', title: 'Favorite Funny/Chaotic Moment', section: 'moments', hint: 'Describe the moment' },
    { id: 'go-hard-moment', title: 'Favorite “GO HARD” Moment', section: 'moments', hint: 'Describe the moment' },
  ],

  // WEEK 3: retrospective polls.
  // Answers come from `options` if given, otherwise from the top Week 1 nominations in `sources`.
  // Fill in `options` (max 10, ≤55 chars each) before Nov 16 for anything you want hand-picked.
  // Option format: 'Text' or { text: 'Text', link: 'https://…' }
  reviewPolls: [
    { id: 'moment-of-2026', title: 'Favorite MEOVV Moment of 2026', section: 'moments', sources: ['variety-moment', 'funny-moment', 'go-hard-moment'], enabled: true },
    { id: 'review-performance', title: 'Favorite Performance (Year in Review)', section: 'favorites', sources: ['performance'], enabled: true },
    { id: 'review-mv', title: 'Favorite Music Video (Year in Review)', section: 'favorites', sources: ['mv'], enabled: true },
    { id: 'review-choreography', title: 'Favorite Choreography (Year in Review)', section: 'favorites', sources: ['choreography'], enabled: true },
    { id: 'styling-moment', title: 'Favorite Styling Moment', section: 'favorites', sources: ['member-look', 'fashion-moment'], enabled: true },
    { id: 'most-unexpected', title: 'Most Unexpected MEOVV Moment', section: 'moments', sources: ['variety-moment', 'funny-moment'], enabled: true },
    { id: 'most-played', title: 'Song You Played the Most', section: 'favorites', sources: ['song'], enabled: true },
    { id: 'into-2027', title: 'Song You’re Bringing Into 2027', section: 'favorites', sources: ['song'], enabled: true },
  ],

  memories: {
    prompt: 'What MEOVV moment made your 2026?',
    maxLength: 1000,
    // Fans can submit until this time (defaults to review phase end if omitted).
    closesAt: '2026-11-22T12:00',
  },

  // Reminder announcements. Times in `timezone`.
  reminders: [
    { at: '2026-11-07T12:00', text: '⏰ **Nominations close tomorrow night!** Get your picks in with `/nominate member` and `/nominate moment`.' },
    { at: '2026-11-19T12:00', text: '💌 There’s still time to tell us **what MEOVV moment made your 2026** — the best answers will be featured in the Yearbook! Use `/moment` or the button below.' , memoryButton: true },
  ],

  // If true, the yearbook is published automatically at the reveal time.
  // Default false: staff get a reminder in the log channel and publish with `/yb yearbook publish`
  // after picking featured fan responses.
  autoPublish: false,
};
