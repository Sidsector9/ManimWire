const { test } = require('node:test');
const assert = require('node:assert/strict');
const expire = require('./expire-artifact.cjs');

function fixture(overrides = {}) {
  let clock = Date.parse('2026-10-05T10:10:00Z');
  const deleted = [];
  const sleeps = [];
  const args = {
    github: { rest: { actions: {
      getArtifact: async () => ({ data: { name: 'ManimWire-linux-42-1', workflow_run: { id: 42 }, created_at: '2026-10-05T10:00:00Z', ...overrides } }),
      deleteArtifact: async (params) => deleted.push({ ...params, at: clock })
    } } },
    context: { repo: { owner: 'owner', repo: 'repo' }, runId: 42 },
    core: { info() {} }, artifactId: 123,
    now: () => clock,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; }
  };
  return { args, deleted, sleeps };
}

test('expires one hour from upload, not one hour from cleanup start', async () => {
  const { args, deleted, sleeps } = fixture();
  await expire(args);
  assert.equal(sleeps.reduce((a, b) => a + b, 0), 50 * 60_000);
  assert.deepEqual(deleted, [{ owner: 'owner', repo: 'repo', artifact_id: 123, at: Date.parse('2026-10-05T11:00:00Z') }]);
});

test('deletes an overdue artifact immediately', async () => {
  const { args, sleeps, deleted } = fixture({ created_at: '2026-10-05T08:00:00Z' });
  await expire(args);
  assert.equal(sleeps.length, 0);
  assert.equal(deleted.length, 1);
});

test('refuses an artifact from another workflow run', async () => {
  const { args, deleted } = fixture({ workflow_run: { id: 99 } });
  await assert.rejects(expire(args), /outside this ManimWire run/);
  assert.equal(deleted.length, 0);
});

test('handles artifacts already deleted without masking other errors', async () => {
  const { args } = fixture();
  args.github.rest.actions.getArtifact = async () => { throw Object.assign(new Error('Not found'), { status: 404 }); };
  await expire(args);
  args.github.rest.actions.getArtifact = async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); };
  await assert.rejects(expire(args), /Forbidden/);
});
