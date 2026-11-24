import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { isMain } from '../shared/entry.ts';

const repository = 'nexu-io/openmotion';
const query = `query($number:Int!){repository(owner:"nexu-io",name:"openmotion"){
  pullRequest(number:$number){state isDraft headRefOid baseRefName mergeable reviewDecision
    labels(first:100){nodes{name} pageInfo{hasNextPage}}
    latestReviews(first:100){nodes{state} pageInfo{hasNextPage}}
    reviewThreads(first:100){nodes{isResolved} pageInfo{hasNextPage}}
    commits(last:1){nodes{commit{oid statusCheckRollup{contexts(first:100){pageInfo{hasNextPage} nodes{
      ... on CheckRun{name status conclusion}
      ... on StatusContext{context state}
    }}}}}}
  }
}}`;

export function preparedMergeStatus(pr: any, expectedSHA: string): 'ready' | 'waiting' | 'merged' {
  assert.equal(pr.headRefOid, expectedSHA, 'PR changed after preparation; start a new preparation');
  if (pr.state === 'MERGED') return 'merged';
  assert.equal(pr.state, 'OPEN', 'PR is no longer open');
  assert(!pr.isDraft && pr.baseRefName === 'main', 'Require a ready PR targeting main');
  for (const page of [pr.labels, pr.latestReviews, pr.reviewThreads]) {
    assert(page && !page.pageInfo.hasNextPage, 'Too many PR records for automatic merge; inspect manually');
  }
  assert(!pr.labels.nodes.some((label: any) => /^(?:hold|do[ -]not[ -]merge|blocked)$/i.test(label.name)), 'PR is on hold');
  assert(pr.mergeable !== 'CONFLICTING', 'Resolve merge conflicts before preparing again');
  assert(!pr.latestReviews.nodes.some((review: any) => review.state === 'CHANGES_REQUESTED'), 'A reviewer requested changes');
  const commit = pr.commits.nodes[0]?.commit;
  assert.equal(commit?.oid, expectedSHA, 'Checks must belong to the prepared commit');
  const contexts = commit.statusCheckRollup?.contexts;
  if (!contexts) return 'waiting';
  assert(!contexts.pageInfo.hasNextPage, 'Too many checks for automatic merge; inspect manually');
  const checks = contexts.nodes;
  const failed = checks.find((check: any) => check.state === 'FAILURE' || check.state === 'ERROR'
    || ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'].includes(check.conclusion));
  assert(!failed, 'CI failed: ' + (failed?.name || failed?.context));
  // Both trusted CI summaries must register on the new head before it can merge.
  for (const name of ['standalone', 'controls']) {
    const check = checks.find((check: any) => (check.name || check.context) === name);
    if (!check || (check.context ? check.state !== 'SUCCESS' : check.status !== 'COMPLETED' || check.conclusion !== 'SUCCESS')) return 'waiting';
  }
  if (checks.some((check: any) => check.context ? check.state !== 'SUCCESS'
    : check.status !== 'COMPLETED' || !['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(check.conclusion))) return 'waiting';
  if (pr.reviewDecision === 'CHANGES_REQUESTED') throw new Error('A reviewer requested changes');
  if (pr.reviewDecision === 'REVIEW_REQUIRED' || pr.reviewThreads.nodes.some((thread: any) => !thread.isResolved)) return 'waiting';
  return pr.mergeable === 'MERGEABLE' ? 'ready' : 'waiting';
}

export async function mergePreparedPullRequest(number: number, expectedSHA: string, {
  request = fetch, token = process.env.OPENMOTION_MEDIA_MAINTAINER_TOKEN,
  wait = (milliseconds: number) => setTimeout(milliseconds), now = Date.now, timeout = 30 * 60_000,
} = {}): Promise<void> {
  assert(Number.isSafeInteger(number) && number > 0 && /^[a-f0-9]{40}$/.test(expectedSHA), 'Require a PR number and prepared commit');
  assert(token, 'Missing maintainer token');
  const api = async (route: string, method: string, body: object): Promise<any> => {
    const response = await request('https://api.github.com/' + route, {
      method, headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
      body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    assert(response.ok, `GitHub ${method} ${route} failed (HTTP ${response.status})`);
    const result = await response.json();
    assert(!result.errors, 'GitHub query failed');
    return result;
  };
  const deadline = now() + timeout;
  while (now() < deadline) {
    const state = await api('graphql', 'POST', { query, variables: { number } });
    const pr = state.data?.repository?.pullRequest;
    assert(pr, 'PR not found');
    const status = preparedMergeStatus(pr, expectedSHA);
    if (status === 'merged') return;
    if (status === 'ready') {
      // GitHub enforces branch rules and rejects a contributor push racing this request.
      const result = await api(`repos/${repository}/pulls/${number}/merge`, 'PUT', { merge_method: 'squash', sha: expectedSHA });
      assert(result.merged, 'GitHub did not merge the prepared commit');
      console.log(`Merged PR #${number} at prepared head ${expectedSHA}`);
      return;
    }
    await wait(15_000);
  }
  throw new Error('Timed out waiting for CI/review; PR remains open. Rerun after resolving the blocker.');
}

if (isMain(import.meta.url)) {
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch', 'Merge requires a maintainer-started workflow');
  assert.equal(process.env.GITHUB_REPOSITORY, repository);
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  assert.equal(process.env.GITHUB_WORKFLOW_REF, repository + '/.github/workflows/prepare-pr-media.yml@refs/heads/main');
  const [number, sha, extra] = process.argv.slice(2);
  assert(!extra, 'Usage: merge-prepared-pr.ts <PR-number> <prepared-SHA>');
  await mergePreparedPullRequest(Number(number), sha);
}
