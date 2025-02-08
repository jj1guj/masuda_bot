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

import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';

export interface Env {
	MASUDA_URL: string;
	MISSKEY_HOST: string;
	MISSKEY_TOKEN: string;
}

async function fetchNewArticle(env: Env) {
	try {
		const response = await axios.get(env.MASUDA_URL);
		const parser = new XMLParser();
		const jsonString = parser.parse(response.data);

		// 1分前の記事を取得
		const now_minutes = (60 + new Date().getMinutes() - 1) % 60;
		const items = jsonString["rdf:RDF"]["item"].filter((item: any) => {
			const written_minutes = new Date(item["dc:date"]).getMinutes();
			const title = item["title"];
			return written_minutes === now_minutes && title.substring(0, 6) !== "anond:";
		});
		return items;
	} catch (error) {
		console.error('Error fetching RSS feed:', error);
	}
}

async function postNewArticle(env: Env, items: any) {
	for (let item of items) {
		const title = item["title"];
		const description = item["description"];
		const link = item["link"];
		const post_string = `新しい記事が投稿されました\n\n${title}\n${description}\n${link}`;
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
				text: post_string,
			})
		});
	}
}

export default {
	async scheduled(controller, env, ctx): Promise<void> {
		console.log('Scheduled task started');
		const items = await fetchNewArticle(env);
		await postNewArticle(env, items);
	},
	async fetch(request, env, ctx): Promise<Response> {
		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
