# テナントインフラCDKプロジェクト

このプロジェクトはCDK TypeScriptを使用したテナントインフラ管理のためのプロジェクトです。

## 前提条件

- Node.js (v14以上)
- AWS CLI (設定済み)
- AWS CDK v2

## セットアップ

```bash
# 依存関係のインストール
npm install

# AWSアカウントのブートストラップ（初回のみ）
npm run bootstrap
```

## 便利なコマンド

- `npm run build` TypeScriptのコンパイル
- `npm run watch` 変更を監視してコンパイル
- `npm run test` Jestによるユニットテストの実行
- `npm run deploy` スタックをデフォルトのAWSアカウント/リージョンにデプロイ
- `npm run diff` デプロイ済みスタックと現在の状態を比較
- `npm run synth` CloudFormationテンプレートの合成
- `npm run destroy` デプロイしたスタックを削除
