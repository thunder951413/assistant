import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectConfluenceComments, normalizeConfluenceComment, resolveNext } from '../src/sources/confluence-comments.js';
import { collectPullRequestDiscussion, renderGithubDiscussionEntry } from '../src/sources/github-pull.js';

const origin = 'https://confluence.example.com';

describe('Confluence comments', () => {
  it('follows _links.next across pages, includes replies and keeps the context path', async () => {
    const requested = [];
    const pages = {
      0: { results: [{ id: '1' }, { id: '2' }], _links: { base: `${origin}/wiki`, next: '/rest/api/content/9/child/comment?start=2&depth=all' } },
      1: { results: [{ id: '2' }, { id: '3', ancestors: [{ id: '9', type: 'page' }, { id: '1', type: 'comment' }] }], _links: { base: `${origin}/wiki` } }
    };
    const result = await collectConfluenceComments(origin, '9', async (url) => { requested.push(url); return { data: pages[requested.length - 1] }; });
    assert.equal(result.pageCount, 2);
    assert.equal(result.truncated, false);
    assert.equal(result.repliesIncluded, true);
    assert.deepEqual(result.results.map((c) => c.id), ['1', '2', '3']);
    assert.match(requested[0], /depth=all/);
    assert.equal(requested[1], `${origin}/wiki/rest/api/content/9/child/comment?start=2&depth=all`);
    const reply = normalizeConfluenceComment(result.results[2], 'https://c/page', (html) => html);
    assert.equal(reply.parentId, '1');
  });

  it('retries without depth=all when the server rejects it, and reports truncation', async () => {
    const requested = [];
    const result = await collectConfluenceComments(origin, '9', async (url) => {
      requested.push(url);
      if (url.includes('depth=all')) { const error = new Error('bad'); error.status = 400; throw error; }
      return { data: { results: [{ id: String(requested.length) }], _links: { next: `/rest/api/content/9/child/comment?start=${requested.length}` } } };
    }, { maxPages: 3 });
    assert.equal(result.repliesIncluded, false);
    assert.equal(result.pageCount, 3);
    assert.equal(result.truncated, true);
    assert.doesNotMatch(requested[1], /depth=all/);
  });

  it('never follows next links to another host and rebuilds the context path instead', async () => {
    const next = '/rest/api/content/9/child/comment?start=100';
    assert.equal(resolveNext(origin, { _links: { next, base: 'http://confluence-internal:8090/confluence', context: '/confluence' } }), `${origin}/confluence${next}`);
    assert.equal(resolveNext(origin, { _links: { next: 'http://confluence-internal:8090/x' } }), null);
    const requested = [];
    const result = await collectConfluenceComments(origin, '9', async (url) => { requested.push(url); return { data: { results: [{ id: '1' }], _links: { next: 'http://evil.example/rest/x' } } }; });
    assert.equal(requested.length, 1);
    assert.equal(result.truncated, true);
    assert.equal(result.offOriginNext, true);
  });

  it('propagates non-400 failures so callers can mark the capture partial', async () => {
    await assert.rejects(collectConfluenceComments(origin, '9', async () => { const error = new Error('down'); error.status = 503; throw error; }), /down/);
  });
});

describe('GitHub pull request discussion', () => {
  const api = 'https://ghe.example.com/api/v3/repos/o/r';
  it('merges issue comments, reviews and inline review comments in time order', async () => {
    const data = {
      [`${api}/issues/5/comments?per_page=100`]: [{ id: 11, user: { login: 'amy' }, created_at: '2026-10-01T03:00:00Z', body: 'LGTM overall' }],
      [`${api}/pulls/5/reviews?per_page=100`]: [
        { id: 21, user: { login: 'bob' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-10-01T02:00:00Z', body: 'Please fix the leak' },
        { id: 22, user: { login: 'bob' }, state: 'COMMENTED', submitted_at: '2026-10-01T01:00:00Z', body: '' }
      ],
      [`${api}/pulls/5/comments?per_page=100`]: [{ id: 31, user: { login: 'bob' }, created_at: '2026-10-01T01:00:00Z', path: 'src/a.c', line: 42, body: 'free() missing', pull_request_review_id: 22 }]
    };
    const result = await collectPullRequestDiscussion(api, 5, async (url) => ({ data: data[url], truncated: false }));
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.comments.map((c) => c.id), ['review-comment-31', 'review-21', '11']);
    assert.equal(result.comments[1].state, 'requested changes');
    assert.match(result.comments[0].body, /`src\/a\.c:L42`/);
    assert.equal(result.comments[0].reviewId, 'review-22');
    assert.match(renderGithubDiscussionEntry(result.comments[1]), /review: requested changes/);
  });

  it('does not present a diff position as a file line', async () => {
    const result = await collectPullRequestDiscussion(api, 5, async (url) => ({ data: url.includes('/pulls/5/comments') ? [{ id: 1, path: 'a.c', position: 7, line: null, original_line: null, body: 'x', created_at: 't' }] : [], truncated: false }));
    assert.equal(result.comments[0].line, undefined);
    assert.match(result.comments[0].body, /^`a\.c`/);
  });

  it('marks unavailable parts as missing instead of failing the capture', async () => {
    const result = await collectPullRequestDiscussion(api, 5, async (url) => {
      if (url.includes('/reviews')) throw Object.assign(new Error('404'), { status: 404 });
      return { data: [], truncated: url.includes('/pulls/5/comments') };
    });
    assert.deepEqual(result.missing, ['pull reviews']);
    assert.equal(result.truncated, true);
  });
});
