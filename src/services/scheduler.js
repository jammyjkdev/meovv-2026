const config = require('../config');
const { buildPlan } = require('../lib/plan');
const { phaseAnnouncement, reminderMessage } = require('./announcements');
const { postPoll, closeDuePolls } = require('./polls');
const yearbook = require('./yearbook');

const TICK_MS = 60_000;

/** Send a message to the staff log channel (never throws). */
function makeLogger(client) {
  return async (content) => {
    console.log(`[log] ${content.replace(/\n/g, ' | ')}`);
    if (!config.env.logChannelId) return;
    try {
      const ch = await client.channels.fetch(config.env.logChannelId);
      for (let i = 0; i < content.length; i += 1900) await ch.send({ content: content.slice(i, i + 1900), allowedMentions: { parse: [] } });
    } catch (err) {
      console.error('[log] failed to post to log channel', err.message);
    }
  };
}

async function runJob(ctx, job, log) {
  const { client } = ctx;
  switch (job.type) {
    case 'announce': {
      const ch = await client.channels.fetch(config.env.announceChannelId);
      const msg = await ch.send({ ...phaseAnnouncement(job.payload.phase), allowedMentions: { roles: config.env.pingRoleId ? [config.env.pingRoleId] : [] } });
      return { status: 'done', detail: msg.url };
    }
    case 'reminder': {
      const ch = await client.channels.fetch(config.env.announceChannelId);
      const msg = await ch.send({ ...reminderMessage(job.payload.index), allowedMentions: { roles: config.env.pingRoleId ? [config.env.pingRoleId] : [] } });
      return { status: 'done', detail: msg.url };
    }
    case 'poll': {
      const res = await postPoll(ctx, job.payload.pollKey);
      if (!res.posted) {
        await log(`⚠️ Scheduled poll \`${job.payload.pollKey}\` was not posted: ${res.reason}`);
        return { status: 'skipped', detail: res.reason };
      }
      await log(`🗳️ Posted poll **${job.payload.pollKey}** → ${res.url}${res.note ? `\nℹ️ ${res.note}` : ''}`);
      return { status: 'done', detail: res.url };
    }
    case 'reveal': {
      if (config.event.autoPublish) {
        const { url } = await yearbook.publish(ctx);
        await log(`📖 Yearbook auto-published → ${url}`);
        return { status: 'done', detail: url };
      }
      const issues = yearbook.problems(yearbook.compile(ctx.db));
      await log(
        `📖 **It's reveal time!** Run \`/yb yearbook preview\` to check it, then \`/yb yearbook publish\`.` +
          (issues.length ? `\nStill to sort out:\n• ${issues.join('\n• ')}` : '\nEverything looks complete ✅'),
      );
      return { status: 'done', detail: 'reminded staff' };
    }
    default:
      throw new Error(`Unknown job type ${job.type}`);
  }
}

/** One scheduler pass: run due jobs, collect finished polls. */
async function tick(ctx, log) {
  const now = config.now();
  const done = ctx.db.allJobs();
  for (const job of buildPlan(config.event)) {
    if (done.has(job.key) || job.at > now) continue;
    if (job.expiresAt && now > job.expiresAt) {
      ctx.db.markJob(job.key, 'skipped', 'missed its window (bot offline?)');
      await log(`⚠️ Skipped \`${job.key}\` — it was due ${job.at.toFormat('ff')} but the window has passed. Run it manually if you still want it.`);
      continue;
    }
    try {
      const { status, detail } = await runJob(ctx, job, log);
      ctx.db.markJob(job.key, status, detail);
    } catch (err) {
      console.error(`[scheduler] ${job.key} failed`, err);
      ctx.db.markJob(job.key, 'failed', err.message);
      await log(`❌ Scheduled job \`${job.key}\` failed: ${err.message}\nFix the problem, then \`/yb schedule retry key:${job.key}\`.`);
    }
  }
  await closeDuePolls(ctx, log);
}

function start(ctx) {
  const log = makeLogger(ctx.client);
  let running = false;
  const loop = async () => {
    if (running) return;
    running = true;
    try {
      await tick(ctx, log);
    } catch (err) {
      console.error('[scheduler] tick failed', err);
    } finally {
      running = false;
    }
  };
  loop();
  return setInterval(loop, TICK_MS);
}

module.exports = { start, tick, runJob, makeLogger };
