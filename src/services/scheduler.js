const config = require('../config');
const { buildPlan } = require('../lib/plan');
const { phaseAnnouncement, reminderMessage } = require('./announcements');
const { postPoll, closeDuePolls } = require('./polls');
const yearbook = require('./yearbook');
const { START_JOB } = require('./event');
const console_ = require('../lib/log')('scheduler');

const TICK_MS = 60_000;
let waitingLogged = false;

/** Send a message to the staff log channel (never throws). Also echoed to the console. */
function makeLogger(client) {
  return async (content) => {
    console_.info(`staff log: ${content.replace(/\n/g, ' | ')}`);
    if (!config.env.logChannelId) return;
    try {
      const ch = await client.channels.fetch(config.env.logChannelId);
      for (let i = 0; i < content.length; i += 1900) await ch.send({ content: content.slice(i, i + 1900), allowedMentions: { parse: [] } });
    } catch (err) {
      console_.error('failed to post to the staff log channel', { channel: config.env.logChannelId, err });
    }
  };
}

async function runJob(ctx, job, log) {
  const { client } = ctx;
  console_.info(`running ${job.key}`, { type: job.type, due: job.at.toFormat('ff') });
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
      const issues = yearbook.problems(await yearbook.compile(ctx.db));
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
  const done = await ctx.db.allJobs();
  // Nothing runs until staff start the event by hand.
  if (done.get(START_JOB)?.status !== 'done') {
    if (!waitingLogged) {
      waitingLogged = true;
      await log(`⏸️ Bot online, waiting to start. Run \`/yb schedule run key:${START_JOB}\` to post the announcement and open nominations.`);
    }
    console_.debug('tick: waiting for the start command');
    return;
  }
  const plan = buildPlan(config.event);
  const next = plan.find((j) => !done.has(j.key) && j.at > now);
  console_.debug('tick', { done: done.size, of: plan.length, next: next ? `${next.key} @ ${next.at.toFormat('ff')}` : 'none' });
  for (const job of plan) {
    if (done.has(job.key) || job.at > now) continue;
    if (job.expiresAt && now > job.expiresAt) {
      console_.warn(`skipped ${job.key}: window passed`, { due: job.at.toFormat('ff'), expired: job.expiresAt.toFormat('ff') });
      await ctx.db.markJob(job.key, 'skipped', 'missed its window (bot offline?)');
      await log(`⚠️ Skipped \`${job.key}\` — it was due ${job.at.toFormat('ff')} but the window has passed. Run it manually if you still want it.`);
      continue;
    }
    try {
      const { status, detail } = await runJob(ctx, job, log);
      console_.info(`${job.key} → ${status}`, { detail });
      await ctx.db.markJob(job.key, status, detail);
    } catch (err) {
      console_.error(`${job.key} failed`, err);
      await ctx.db.markJob(job.key, 'failed', err.message);
      await log(`❌ Scheduled job \`${job.key}\` failed: ${err.message}\nFix the problem, then \`/yb schedule retry key:${job.key}\`.`);
    }
  }
  await closeDuePolls(ctx, log);
}

function start(ctx) {
  const log = makeLogger(ctx.client);
  console_.info('scheduler started', { everySeconds: TICK_MS / 1000, jobs: buildPlan(config.event).length });
  let running = false;
  const loop = async () => {
    if (running) return;
    running = true;
    try {
      await tick(ctx, log);
    } catch (err) {
      console_.error('tick failed', err);
    } finally {
      running = false;
    }
  };
  loop();
  return setInterval(loop, TICK_MS);
}

module.exports = { start, tick, runJob, makeLogger };
