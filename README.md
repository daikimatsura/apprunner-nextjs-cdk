# App Runner Next.js CDK

AWS App Runnerを使用してNext.jsアプリケーションをデプロイするためのCDKプロジェクトです。

## 前提条件

- Node.js: v22.0.0以上23.0.0未満
- pnpm: v10.7.0
- AWS CLI: 設定済み
- AWS CDK: インストール済み

## セットアップ

1. リポジトリのクローン

```bash
git clone <repository-url>
cd apprunner-nextjs-cdk
```

2. 依存関係のインストール

```bash
pnpm install
```

3. 環境変数の設定

```bash
cp .env.example .env
```

`.env`ファイルを編集して、必要な環境変数を設定します。

## デプロイ

```bash
cd apps/main-app/infra
npx cdk deploy --all --profile {profile_name}
```

## アーキテクチャ

このプロジェクトは以下のAWSリソースを使用します：

- AWS App Runner: Next.jsアプリケーションのホスティング
- Amazon ECR: Dockerイメージの保存
- Route53: ドメイン名の管理
- IAM: アクセス権限の管理

## ベストプラクティス

- App Runnerの設定

  - 適切なCPUとメモリ設定
  - ヘルスチェックの設定
  - 環境変数の設定
  - IAMロールの適切な設定
  - Dockerイメージの最適化

- Route53の設定
  - 既存のホストゾーンを参照
  - サブドメインのレコードを作成
  - App Runnerサービスへのエイリアス設定

## トラブルシューティング

### デプロイエラー

- `.env`ファイルが正しく設定されているか確認してください。
- AWS認証情報が正しく設定されているか確認してください。
- Route53のホストゾーンが存在するか確認してください。

### App Runnerエラー

- Dockerイメージが正しくビルドされているか確認してください。
- 環境変数が正しく設定されているか確認してください。
- IAMロールが正しく設定されているか確認してください。

## ライセンス

MIT
