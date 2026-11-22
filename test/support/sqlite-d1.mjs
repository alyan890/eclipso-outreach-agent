// Test adapter only: executes the actual migration and SQL with Node's SQLite.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export class SqliteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
  }
  prepare(sql) {
    const database = this.sqlite;
    const statement = {
      sql,
      values: [],
      bind(...values) { this.values = values; return this; },
      async first() { return database.prepare(sql).get(...this.values) ?? null; },
      async run() {
        const result = database.prepare(sql).run(...this.values);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
    return statement;
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) {
        const result = this.sqlite.prepare(statement.sql).run(...statement.values);
        results.push({ success: true, meta: { changes: Number(result.changes) } });
      }
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  close() { this.sqlite.close(); }
}

export function fixtureEnvironment(database, generate) {
  return {
    MODULE1_ENABLED: 'true', FREE_PLAN_CONFIRMED: 'true', AGENT_MODE: 'draft_only',
    DAILY_MODEL_CALL_LIMIT: '1', PILOT_DB: database,
    AI: { run: generate },
  };
}

// Deliberately a stub, never represented as a live AI response.
export function stubDraft() {
  return { response: JSON.stringify({
    subject: 'appointment requests',
    body: 'Hi Harbor Example Clinic team, your example contact page asks patients to call for appointments. We’re Eclipso Digital, and we help businesses add straightforward appointment-request forms. Would it be useful if we shared an idea for your booking process?',
    evidence_ids: ['fixture-booking-gap'],
  }) };
}
