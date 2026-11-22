import test from 'node:test';
import assert from 'node:assert/strict';
import diagnostic, { diagnose, inspectResponse } from '../src/cloudflare-ai-diagnostic.mjs';
import { SqliteD1, fixtureEnvironment, stubDraft } from './support/sqlite-d1.mjs';

test('diagnostic distinguishes truncated, non-JSON and wrong response shapes', () => {
  assert.equal(inspectResponse({ choices: [{ finish_reason: 'length', message: { content: '{', reasoning_content: 'not logged' } }] }).reason, 'completion_truncated');
  assert.equal(inspectResponse({ response: 'not json' }).reason, 'invalid_json');
  assert.equal(inspectResponse({}).reason, 'missing_content');
  assert.equal(inspectResponse({ response: [] }).reason, 'unexpected_output_shape');
  assert.equal(inspectResponse({ choices: [{ finish_reason: 'stop', message: { tool_calls: [{}], content: '{}' } }] }).reason, 'unexpected_tool_call');
  const result = inspectResponse({ choices: [{ finish_reason: 'length', message: { content: 'RAW SECRET DATA', reasoning_content: 'NEVER LOG THIS' } }] });
  assert.equal(JSON.stringify(result).includes('RAW SECRET'), false);
  assert.equal(JSON.stringify(result).includes('NEVER LOG'), false);
  assert.equal(result.metadata.has_reasoning, true);
});
test('diagnostic keeps existing draft validation constraints', () => {
  assert.equal(inspectResponse(stubDraft()).draft.review_required, true);
  for (const body of ['Guaranteed results from Eclipso Digital?', 'Eclipso Digital: visit https://test.org?', 'Hello there?']) {
    const response = { response: JSON.stringify({ subject: 'test', body, evidence_ids: ['fixture-booking-gap'] }) };
    assert.ok(inspectResponse(response).reason);
  }
});
test('one extra diagnostic attempt total; no existing runs or budgets changed', async () => {
  const db = new SqliteD1();
  let calls = 0;
  try {
    const env = fixtureEnvironment(db, async (_model, input) => {
      calls++;
      assert.equal(input.max_completion_tokens, 300);
      assert.ok(JSON.stringify(input).includes('office@harbor-clinic.example'));
      return stubDraft();
    });
    const results = await Promise.all([diagnose(env), diagnose(env)]);
    assert.equal(calls, 1);
    assert.ok(results.some(r => r.status === 'draft_needs_review'));
    assert.equal((await diagnose(env)).status, 'already_attempted');
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM m1_budget').get().n, 0);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM m1_runs').get().n, 0);
    assert.equal(db.sqlite.prepare('SELECT sending_enabled FROM m1_diagnostic_runs').get().sending_enabled, 0);
  } finally { db.close(); }
});
test('provider failure is saved safely and not retried', async () => {
  const db = new SqliteD1();
  let calls = 0;
  try {
    const env = fixtureEnvironment(db, async () => { calls++; throw Object.assign(new Error('PRIVATE TOKEN'), { status: 429 }); });
    assert.equal((await diagnose(env)).reason, 'provider_limit');
    assert.equal((await diagnose(env)).status, 'already_attempted');
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(db.sqlite.prepare('SELECT * FROM m1_diagnostic_runs').get()).includes('PRIVATE TOKEN'), false);
  } finally { db.close(); }
});
test('flags off prevent schema writes and inference', async () => {
  let touched = false;
  const result = await diagnose({ PILOT_DB: { prepare() { touched = true; } }, AI: { run() { touched = true; } } });
  assert.equal(result.status, 'configuration_required');
  assert.equal(touched, false);
});
test('public HTTP cannot run the diagnostic or read its results', async () => {
  for (const path of ['/', '/run', '/drafts']) assert.equal((await diagnostic.fetch(new Request('https://test.org' + path))).status, 404);
  assert.equal((await diagnostic.fetch(new Request('https://test.org/run', { method: 'POST' }))).status, 404);
  assert.equal((await (await diagnostic.fetch(new Request('https://test.org/health'))).json()).sendingEnabled, false);
});
