/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.json`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { XMLParser } from 'fast-xml-parser';

export interface Env {
	MASUDA_URL: string;
	MISSKEY_HOST: string;
	MISSKEY_TOKEN: string;
	POSTED_ITEMS: KVNamespace;
}

const LATEST_SEEN_LINK_KEY = 'state:latest_seen_link';
const RSS_FETCH_USER_AGENT = 'Mozilla/5.0 (compatible; masuda-bot/1.0; +https://github.com/jj1guj/masuda_bot)';

export interface RssItem {
	title: string;
	link: string;
	description?: string;
	'content:encoded'?: string;
	'dc:date'?: string;
}

export function normalizeItems(parsed: unknown): RssItem[] {
	const data = parsed as {
		'rdf:RDF'?: {
			item?: RssItem | RssItem[];
		};
	};
	const rawItems = data['rdf:RDF']?.item;
	if (!rawItems) {
		return [];
	}

	return (Array.isArray(rawItems) ? rawItems : [rawItems])
		.filter((item) => item.title && item.link)
		.filter((item) => !item.title.startsWith('anond:'));
}

export function buildRssRequestHeaders(): HeadersInit {
	return {
		Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1',
		'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
		'Cache-Control': 'no-cache',
		'User-Agent': RSS_FETCH_USER_AGENT,
	};
}

function toComparableDate(publishedAt: string | undefined): number {
	if (!publishedAt) {
		return 0;
	}
	const timestamp = new Date(publishedAt).getTime();
	return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function getPendingItems(items: RssItem[], latestSeenLink: string | null): RssItem[] {
	if (items.length === 0 || !latestSeenLink) {
		return [];
	}

	const pendingNewestFirst: RssItem[] = [];
	for (const item of items) {
		if (item.link === latestSeenLink) {
			break;
		}
		pendingNewestFirst.push(item);
	}

	return pendingNewestFirst.reverse();
}

async function fetchFeedItems(env: Env): Promise<RssItem[]> {
	try {
		const response = await fetch(env.MASUDA_URL, {
			headers: buildRssRequestHeaders(),
		});
		if (!response.ok) {
			const errorBody = (await response.text()).slice(0, 500);
			throw new Error(`Failed to fetch RSS: ${response.status} ${errorBody}`.trim());
		}

		const parser = new XMLParser();
		const parsed = parser.parse(await response.text());
		return normalizeItems(parsed).sort(
			(a, b) => toComparableDate(b['dc:date']) - toComparableDate(a['dc:date'])
		);
	} catch (error) {
		console.error('Error fetching RSS feed:', error);
		return [];
	}
}

function replaceUrlInDescription(description: string, content: string): string {
	// URLの正規表現パターン
	const urlPattern = /(https?:\/\/[^\s]+)/g;
	const matches = description.match(urlPattern);

	if (matches) {
		// <a>タグからURLを抽出
		const anchorPattern = /<a\s+[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
		let match;
		const urls: string[] = [];

		while ((match = anchorPattern.exec(content)) !== null) {
			urls.push(match[1]);
		}

		// description内のURLをcontent内の同じURLで置換
		matches.forEach(partialUrl => {
			const escapedPartialUrl = partialUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const fullUrlPattern = new RegExp(escapedPartialUrl.replace(/\\\.\\\.\\\./g, '[^\\s<]*'), 'g');
			const fullUrlMatch = urls.find(url => fullUrlPattern.test(url));
			if (fullUrlMatch) {
				description = description.replace(partialUrl, fullUrlMatch);
			}
		});
	}

	return description;
}

export function buildNoteText(item: RssItem): string {
	const description = item.description
		? replaceUrlInDescription(item.description, item['content:encoded'] ?? '').trim()
		: '';
	if (description.length > 0) {
		return `新しい記事が投稿されました\n\n${item.title}\n${description}\n${item.link}`;
	}
	return `新しい記事が投稿されました\n\n${item.title}\n${item.link}`;
}

async function postNewArticle(env: Env, item: RssItem): Promise<boolean> {
	const response = await fetch(`https://${env.MISSKEY_HOST}/api/notes/create`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${env.MISSKEY_TOKEN}`
		},
		body: JSON.stringify({
			visibility: 'public',
			cw: null,
			localOnly: false,
			reactionAcceptance: null,
			noExtractMentions: false,
			noExtractHashtags: false,
			noExtractEmojis: false,
			replyId: null,
			renoteId: null,
			channelId: null,
			text: buildNoteText(item),
		})
	});

	if (!response.ok) {
		const body = await response.text();
		console.error('Failed to post note:', response.status, body);
		return false;
	}

	return true;
}

async function syncFeed(env: Env): Promise<void> {
	const items = await fetchFeedItems(env);
	if (items.length === 0) {
		console.log('Sync completed. No RSS items found.');
		return;
	}

	const latestFeedLink = items[0].link;
	const latestSeenLink = await env.POSTED_ITEMS.get(LATEST_SEEN_LINK_KEY);
	if (!latestSeenLink) {
		await env.POSTED_ITEMS.put(LATEST_SEEN_LINK_KEY, latestFeedLink);
		console.log('Initialized latest seen link without posting backlog.');
		return;
	}

	const pendingItems = getPendingItems(items, latestSeenLink);
	if (pendingItems.length === 0) {
		console.log('Sync completed. No new items to post.');
		return;
	}

	let postedCount = 0;
	for (const item of pendingItems) {
		const isSuccess = await postNewArticle(env, item);
		if (!isSuccess) {
			break;
		}

		await env.POSTED_ITEMS.put(LATEST_SEEN_LINK_KEY, item.link);
		postedCount += 1;
	}

	console.log(`Sync completed. postedCount=${postedCount}`);
}

export default {
	async scheduled(controller, env, ctx): Promise<void> {
		console.log('Scheduled task started');
		await syncFeed(env);
	},
	async fetch(request, env, ctx): Promise<Response> {
		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
