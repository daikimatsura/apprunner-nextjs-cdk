# Tenant Infrastructure

このプロジェクトはAWS CDKを使用してApp Runnerサービスとカスタムドメイン設定を自動化するインフラストラクチャコードを提供します。

## 環境変数の設定

デプロイのために、以下の環境変数を設定する必要があります。`.env`ファイルをプロジェクトルートに作成してください（`.env.example`からコピーできます）。

```
# アプリケーション設定
APP_NAME=apprunner-nextjs
ENVIRONMENT=dev

# ドメイン設定
HOSTED_ZONE_NAME=yourdomain.com  # Route53で管理しているドメイン名
SUBDOMAIN_NAME=app               # サブドメイン（app.yourdomain.com）

# AWS設定
REGION=ap-northeast-1
```

## デプロイ手順

1. プロジェクトのセットアップ

```bash
pnpm install
```

2. ビルド

```bash
pnpm run build
```

3. デプロイ

```bash
pnpm run deploy -- --profile your-aws-profile
```

## カスタムドメインの設定

カスタムドメインを設定するには、以下の条件を満たす必要があります：

1. Route53でホストゾーンが設定済みであること
2. `.env`ファイルに`HOSTED_ZONE_NAME`と`SUBDOMAIN_NAME`が正しく設定されていること

デプロイ後、ACM証明書の検証が完了するまで数分かかることがあります。検証が完了すると、App Runnerサービスのカスタムドメインタブにドメインが表示されます。
