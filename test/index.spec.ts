// test/index.spec.ts
import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import { XMLParser } from 'fast-xml-parser';
import { buildNoteText, buildRssRequestHeaders, getPendingItems, normalizeItems } from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Masuda worker', () => {
	it('responds with 404 (unit style)', async () => {
		const request = new IncomingRequest('http://example.com');
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const unitEnv = env as unknown as Parameters<typeof worker.fetch>[1];
		const response = await worker.fetch(request, unitEnv, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
		expect(await response.text()).toBe('Not Found');
	});

	it('responds with 404 (integration style)', async () => {
		const response = await SELF.fetch('https://example.com');
		expect(response.status).toBe(404);
		expect(await response.text()).toBe('Not Found');
	});

	it('parses rdf items and builds note text', () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<item>
<title>増田テスト</title>
<link>https://anond.hatelabo.jp/20260412000100</link>
<description>本文 https://example.com/abc...</description>
<content:encoded><![CDATA[<p><a href="https://example.com/abcdef">https://example.com/abc...</a></p>]]></content:encoded>
<dc:date>2026-04-12T00:01:00+09:00</dc:date>
</item>
</rdf:RDF>`;
		const parser = new XMLParser();
		const parsed = parser.parse(xml);
		const items = normalizeItems(parsed);
		expect(items).toHaveLength(1);
		expect(items[0].title).toBe('増田テスト');
		expect(items[0].link).toBe('https://anond.hatelabo.jp/20260412000100');

		const text = buildNoteText(items[0]);
		expect(text).toContain('新しい記事が投稿されました');
		expect(text).toContain('増田テスト');
		expect(text).toContain('https://example.com/abcdef');
	});

	it('collects pending items after the latest seen link', () => {
		const pendingItems = getPendingItems(
			[
				{ title: 'D', link: 'https://example.com/d' },
				{ title: 'C', link: 'https://example.com/c' },
				{ title: 'B', link: 'https://example.com/b' },
				{ title: 'A', link: 'https://example.com/a' },
			],
			'https://example.com/a'
		);
		expect(pendingItems.map((item) => item.title)).toEqual(['B', 'C', 'D']);
	});

	it('returns no backlog when latest seen link is not initialized', () => {
		const pendingItems = getPendingItems(
			[{ title: 'A', link: 'https://example.com/a' }],
			null
		);
		expect(pendingItems).toEqual([]);
	});

	it('filters out anond titles and builds rss fetch headers', () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<item>
<title>anond: hidden</title>
<link>https://example.com/hidden</link>
</item>
<item>
<title>visible</title>
<link>https://example.com/visible</link>
</item>
</rdf:RDF>`;
		const parser = new XMLParser();
		const items = normalizeItems(parser.parse(xml));
		expect(items.map((item) => item.title)).toEqual(['visible']);

		const headers = buildRssRequestHeaders() as Record<string, string>;
		expect(headers.Accept).toContain('application/rss+xml');
		expect(headers['Accept-Language']).toContain('ja');
		expect(headers['Cache-Control']).toBe('no-cache');
		expect(headers['User-Agent']).toContain('masuda-bot');
	});
});
