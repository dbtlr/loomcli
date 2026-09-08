const branch = 'publication-ledger';
const file = 'ledger.json';
const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
const id = /^[1-9][0-9]*$/;
const titlePattern =
  /^chore\(release\): Release v(?<version>0\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)) - (?:\S[^\r\n]*)$/;

function validateLedger(value) {
  if (value?.schema !== 1 || !Array.isArray(value.records)) {
    throw new Error('Invalid publication ledger. Stop for reconciliation.');
  }
  const sources = new Set();
  const versions = new Set();
  for (const record of value.records) {
    if (
      !record ||
      !sha.test(record.source) ||
      !sha.test(record.base) ||
      !id.test(record.run) ||
      typeof record.title !== 'string' ||
      typeof record.version !== 'string' ||
      record.title.match(titlePattern)?.groups?.version !== record.version ||
      !['reserved', 'retained'].includes(record.state) ||
      (record.state === 'retained' && (!id.test(record.artifact) || !digest.test(record.digest))) ||
      sources.has(record.source) ||
      versions.has(record.version)
    ) {
      throw new Error('Invalid publication ledger record. Stop for reconciliation.');
    }
    sources.add(record.source);
    versions.add(record.version);
  }
  return value;
}

// The non-forced ref update is a compare-and-swap: every write has the observed head as its parent.
async function writeLedger(github, repo, head, tree, ledger, message) {
  const { data: nextTree } = await github.rest.git.createTree({
    ...repo,
    base_tree: tree,
    tree: [
      { content: `${JSON.stringify(ledger, null, 2)}\n`, mode: '100644', path: file, type: 'blob' },
    ],
  });
  const { data: commit } = await github.rest.git.createCommit({
    ...repo,
    message,
    parents: [head],
    tree: nextTree.sha,
  });
  await github.rest.git.updateRef({
    ...repo,
    force: false,
    ref: `heads/${branch}`,
    sha: commit.sha,
  });
}

module.exports = async function publicationLedger({ github, context, core, env }) {
  const { SOURCE, BASE, TITLE } = env;
  let { MODE, RETAINED_RUN, RETAINED_ARTIFACT, RETAINED_DIGEST } = env;
  if (!sha.test(SOURCE)) {
    throw new Error('A full source SHA is required.');
  }
  if (!['prepare', 'retain', 'verify', 'automatic'].includes(MODE)) {
    throw new Error('Unknown artifact operation.');
  }
  // Missing branches and unreadable records fail closed. Initialization is a separate operator step.
  const { data: ref } = await github.rest.git.getRef({ ...context.repo, ref: `heads/${branch}` });
  const head = ref.object.sha;
  const { data: commit } = await github.rest.git.getCommit({ ...context.repo, commit_sha: head });
  const { data } = await github.rest.repos.getContent({ ...context.repo, path: file, ref: head });
  if (data.type !== 'file' || data.encoding !== 'base64') {
    throw new Error('Unreadable publication ledger.');
  }
  const ledger = validateLedger(JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')));
  const record = ledger.records.find((entry) => entry.source === SOURCE);
  const name = `release-${SOURCE}`;
  if (MODE === 'automatic') {
    if (record) {
      if (record.base !== BASE || record.title !== TITLE) {
        throw new Error(
          'Automatic retry differs from the original release. Stop for reconciliation.',
        );
      }
      if (record.state !== 'retained') {
        throw new Error(
          'Publication reservation is incomplete. Stop for reconciliation; do not rebuild.',
        );
      }
      MODE = 'verify';
      RETAINED_RUN = record.run;
      RETAINED_ARTIFACT = record.artifact;
      RETAINED_DIGEST = record.digest;
      core.setOutput('prepare', 'false');
    } else {
      MODE = 'prepare';
      core.setOutput('prepare', 'true');
    }
  }
  if (MODE === 'prepare') {
    if (Number(env.GITHUB_RUN_ATTEMPT) !== 1) {
      throw new Error(
        'Use verify with the retained artifact ID and digest. Do not rebuild on retry.',
      );
    }
    const version =
      typeof TITLE === 'string' ? titlePattern.exec(TITLE)?.groups?.version : undefined;
    if (!sha.test(BASE) || !version) {
      throw new Error('A release base SHA and title are required.');
    }
    if (record || ledger.records.some((entry) => entry.version === version)) {
      throw new Error(
        'This source or version is already reserved. Reuse retained artifacts or stop for reconciliation.',
      );
    }
    const artifacts = await github.paginate(github.rest.actions.listArtifactsForRepo, {
      ...context.repo,
      name,
      per_page: 100,
    });
    if (artifacts.some((artifact) => artifact.name === name)) {
      throw new Error('This source already has an artifact record. Reconcile the ledger.');
    }
    ledger.records.push({
      base: BASE,
      run: String(context.runId),
      source: SOURCE,
      state: 'reserved',
      title: TITLE,
      version,
    });
    await writeLedger(
      github,
      context.repo,
      head,
      commit.tree.sha,
      ledger,
      `Reserve release ${version}`,
    );
    core.setOutput('run', context.runId);
    return;
  }
  if (!id.test(RETAINED_RUN) || !id.test(RETAINED_ARTIFACT) || !digest.test(RETAINED_DIGEST)) {
    throw new Error('The original run, artifact ID, and manifest digest are required.');
  }
  if (!record || record.run !== RETAINED_RUN) {
    throw new Error('Publication reservation differs or is missing. Stop for reconciliation.');
  }
  const { data: artifact } = await github.rest.actions.getArtifact({
    ...context.repo,
    artifact_id: Number(RETAINED_ARTIFACT),
  });
  if (
    artifact.expired ||
    artifact.name !== name ||
    String(artifact.workflow_run?.id) !== RETAINED_RUN
  ) {
    throw new Error('Retained artifact identity differs or has expired. Stop for reconciliation.');
  }
  if (MODE === 'retain') {
    if (String(context.runId) !== record.run) {
      throw new Error('Only the preparing run can retain its artifact identity.');
    }
    if (record.state === 'reserved') {
      record.state = 'retained';
      record.artifact = RETAINED_ARTIFACT;
      record.digest = RETAINED_DIGEST;
      await writeLedger(
        github,
        context.repo,
        head,
        commit.tree.sha,
        ledger,
        `Retain release ${record.version}`,
      );
    }
  }
  if (
    record.state !== 'retained' ||
    record.artifact !== RETAINED_ARTIFACT ||
    record.digest !== RETAINED_DIGEST
  ) {
    throw new Error(
      'Retained identity differs from the ledger or is incomplete. Stop for reconciliation.',
    );
  }
  core.setOutput('run', record.run);
  core.setOutput('artifact', record.artifact);
  core.setOutput('digest', record.digest);
};
