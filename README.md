# masuda-bot

はてな匿名ダイアリーの RSS を監視し、新着記事だけを Misskey に投稿する Cloudflare Workers ボットです。

前回取得時点の最新記事リンクを Cloudflare KV に保存し、次回取得時に差分だけを投稿します。初回実行時は過去記事をまとめて投稿せず、その時点の最新記事を基準として記録します。

## 必要なもの

- Node.js
- npm
- Cloudflare アカウント
- Misskey のアクセストークン

## セットアップ

### 1. 依存関係をインストール

```bash
npm install
```

### 2. Cloudflare にログイン

```bash
npx wrangler login
```

### 3. KV Namespace を作成

本番用:

```bash
npx wrangler kv namespace create POSTED_ITEMS
```

プレビュー用:

```bash
npx wrangler kv namespace create POSTED_ITEMS --preview
```

出力された `id` と `preview_id` を [wrangler.toml](wrangler.toml) の以下へ設定してください。

- `REPLACE_WITH_KV_NAMESPACE_ID`
- `REPLACE_WITH_PREVIEW_KV_NAMESPACE_ID`

### 4. 設定を確認

[wrangler.toml](wrangler.toml) の `[vars]` を環境に合わせて設定します。

- `MASUDA_URL`: 監視する RSS URL
- `MISSKEY_HOST`: 投稿先 Misskey ホスト名

`MISSKEY_TOKEN` は Secret として設定する運用を推奨します。

```bash
npx wrangler secret put MISSKEY_TOKEN
```

補足:

- すでに [wrangler.toml](wrangler.toml) に `MISSKEY_TOKEN` を書いている場合でも、Secret を設定すればそちらを使う運用に寄せられます。
- Secret を使う場合は [wrangler.toml](wrangler.toml) から平文の `MISSKEY_TOKEN` を削除しておく方が安全です。

### 5. 型定義を更新

```bash
npm run cf-typegen
```

## デプロイ手順

### 1. テストを実行

```bash
npm test -- --run
```

### 2. Worker をデプロイ

```bash
npm run deploy
```

### 3. Cron と KV の反映を確認

デプロイ後に以下を確認してください。

- Worker が正常にデプロイされていること
- Cron が 1 分間隔で設定されていること
- `POSTED_ITEMS` がバインドされていること

## ローカル開発

```bash
npm run dev
```

## 運用メモ

- 現在の Cron は [wrangler.toml](wrangler.toml) で `*/1 * * * *` に設定されています。
- 初回実行時は投稿を行わず、最新 link のみ記録します。
- RSS に含まれる `anond:` タイトルの記事は投稿対象から除外しています。
