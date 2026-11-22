import { runCycle } from '../src/worker.mjs';
import { SqliteD1, fixtureEnvironment, stubDraft } from '../test/support/sqlite-d1.mjs';

const database = new SqliteD1();
let calls = 0;
const env = fixtureEnvironment(database, async () => { calls++; return stubDraft(); });
const firstAt = '2026-10-23T16:17:00.000Z';
const secondAt = '2026-10-23T17:17:00.000Z';
try {
  const first = await runCycle(env, { now: firstAt, scheduledTime: firstAt });
  const second = await runCycle(env, { now: secondAt, scheduledTime: secondAt });
  console.log(JSON.stringify({
    proofType: 'LOCAL_SQLITE_WITH_STUB_AI_NOT_CLOUD_DEPLOYMENT',
    first, second, modelStubCalls: calls,
    storedRuns: database.sqlite.prepare('SELECT COUNT(*) AS count FROM m1_runs').get().count,
    storedTicks: database.sqlite.prepare('SELECT COUNT(*) AS count FROM m1_ticks').get().count,
    sendingEnabled: false,
  }, null, 2));
} finally { database.close(); }
