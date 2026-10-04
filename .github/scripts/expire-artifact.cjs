const HOUR_MS = 60 * 60 * 1000;

/** Delete only the uploaded artifact from this run, once its one-hour TTL elapses. */
module.exports = async function expireArtifact({ github, context, core, artifactId,
  now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  if (!Number.isSafeInteger(artifactId) || artifactId <= 0) throw new Error('Invalid artifact ID');
  const params = { ...context.repo, artifact_id: artifactId };
  let artifact;
  try {
    ({ data: artifact } = await github.rest.actions.getArtifact(params));
  } catch (error) {
    if (error.status === 404) { core.info('Artifact already removed.'); return; }
    throw error;
  }
  if (artifact.workflow_run?.id !== context.runId || !artifact.name.startsWith('ManimWire-')) {
    throw new Error('Refusing to delete an artifact outside this ManimWire run');
  }
  const expiry = Date.parse(artifact.created_at) + HOUR_MS;
  if (!Number.isFinite(expiry)) throw new Error('Invalid artifact creation timestamp');
  core.info(`Artifact deletion scheduled for ${new Date(expiry).toISOString()}`);
  while (now() < expiry) await sleep(Math.min(60_000, expiry - now()));
  try {
    await github.rest.actions.deleteArtifact(params);
    core.info(`Deleted artifact ${artifactId}.`);
  } catch (error) {
    if (error.status !== 404) throw error;
    core.info('Artifact already removed.');
  }
};
