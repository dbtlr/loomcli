const sha = /^[a-f0-9]{40}$/;
const releaseTitle = /^chore\(release\): Release v0\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*) - \S[^\r\n]*$/;

// Normalize the event once so every downstream job uses the same release identity.
module.exports = async function publicationSelection({ github, context, core, env }) {
  let selection = {};
  if (context.eventName === 'pull_request') {
    const pr = context.payload.pull_request;
    const repository = `${context.repo.owner}/${context.repo.repo}`;
    if (
      context.payload.action !== 'closed' ||
      pr?.merged !== true ||
      pr.base?.ref !== 'main' ||
      pr.base.repo?.full_name !== repository ||
      pr.head?.repo?.full_name !== repository ||
      !releaseTitle.test(pr.title)
    ) {
      return;
    }
    if (!sha.test(pr.merge_commit_sha) || pr.merge_commit_sha !== context.sha) {
      throw new Error('Release source must equal the workflow run SHA.');
    }
    if (!sha.test(pr.head.sha)) {
      throw new Error('A full reviewed cut SHA is required.');
    }
    const { data: cut } = await github.rest.git.getCommit({
      ...context.repo,
      commit_sha: pr.head.sha,
    });
    const { data: merge } = await github.rest.git.getCommit({
      ...context.repo,
      commit_sha: context.sha,
    });
    const base = cut.parents?.[0]?.sha;
    if (cut.parents?.length !== 1 || !sha.test(base) || merge.parents?.[0]?.sha !== base) {
      throw new Error(
        'Release merge must preserve the original single-commit cut base. Prepare a fresh cut after main advances.',
      );
    }
    if (
      ![1, 2].includes(merge.parents.length) ||
      (merge.parents.length === 2 && merge.parents[1].sha !== pr.head.sha) ||
      !cut.tree?.sha ||
      merge.tree?.sha !== cut.tree.sha
    ) {
      throw new Error('Release merge differs from the reviewed cut.');
    }
    if (merge.message?.split('\n')[0] !== pr.title) {
      throw new Error('Merge commit must preserve the release title.');
    }
    selection = {
      auth: 'trusted',
      base,
      mode: 'automatic',
      publish: 'true',
      source: context.sha,
      title: pr.title,
      tooling: context.sha,
    };
  } else if (context.eventName === 'workflow_dispatch') {
    const { MODE: mode, SOURCE: source, TOOLING: tooling } = env;
    if (!['prepare', 'verify', 'publish'].includes(mode) || !sha.test(source)) {
      throw new Error('A publication operation and full source SHA are required.');
    }
    if (tooling && !sha.test(tooling)) {
      throw new Error('Tooling must be a full commit SHA.');
    }
    if (mode === 'publish' && source !== context.sha) {
      throw new Error('Dispatch publication from a ref at the retained release source SHA.');
    }
    if (!['trusted', 'bootstrap'].includes(env.AUTH)) {
      throw new Error('Select trusted or bootstrap authentication.');
    }
    selection = {
      auth: env.AUTH,
      base: env.BASE,
      mode: mode === 'publish' ? 'verify' : mode,
      publish: String(mode === 'publish'),
      source,
      title: env.TITLE,
      tooling: tooling || context.sha,
    };
  } else {
    throw new Error('Unsupported publication event.');
  }
  for (const [key, value] of Object.entries(selection)) {
    core.setOutput(key, value || '');
  }
};
