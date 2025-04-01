## 開発環境セットアップ

### Node.jsとpnpmのバージョン管理

本プロジェクトではasdfを使用したバージョン管理を推奨しています。

**理由**：  
プロジェクトルートの`.tool-versions`ファイルでNode.jsとpnpmのバージョンを管理しており、asdfを使用することで全開発者が同一のバージョンを簡単に使用できるためです。

```bash
# asdfがインストールされていない場合
brew install asdf

# プラグインの追加
asdf plugin add nodejs  # Node.jsプラグインがまだない場合
asdf plugin add pnpm    # pnpmプラグインがまだない場合

# プロジェクトに指定されたバージョンのインストールと適用
cd プロジェクトディレクトリ
asdf install  # すべてのツールをインストール
```

**現在(2025年4月時点)の使用バージョン**：

- Node.js: 22.14.0
- pnpm: 10.7.0

### パッケージマネージャ

本プロジェクトではパッケージマネージャとして**pnpm**を使用しています。npmやyarnではなく、必ずpnpmを使用してください。

**理由**：

- 高速なインストール
- ディスク容量の節約
- モノレポの優れたサポート

```bash
# pnpmがインストールされていない場合
npm install -g pnpm

# 依存関係のインストール
pnpm install

# パッケージの追加（プロジェクトルートの場合）
pnpm add <パッケージ名>

# 特定のワークスペースにパッケージを追加
pnpm add <パッケージ名> --filter <ワークスペース名>
例: pnpm add react --filter @sb/web-app
```

## プロジェクト構成

### プロジェクト構造

本プロジェクトはモノレポ構造を採用しています。主要なディレクトリは以下の通りです：

- `apps/`: アプリケーション

  - `main-app/`: メインアプリケーション
    - `web-app/`: Webアプリケーション（Next.js）
    - `tenant-infra/`: テナントインフラストラクチャ(AWS CDK)

- `scripts/`: プロジェクト全体で使用するスクリプト

## デプロイガイドライン

### 前提条件

- Node.js: v22.0.0以上23.0.0未満
- pnpm: v10.7.0
- AWS CLI (設定済み)
- AWS CDK v2

### 初期セットアップ

1. AWS CLIの設定

```bash
# AWS CLIの設定
aws configure
# AWS Access Key ID, Secret Access Key, Default region name (ap-northeast-1), Default output format (json)を入力
```

2. プロジェクトのセットアップ

```bash
# プロジェクトのルートディレクトリで実行
pnpm install

# テナントインフラディレクトリに移動
cd apps/main-app/tenant-infra


# AWSアカウントのブートストラップ（初回のみ）
pnpm run bootstrap
```

## 開発フロー

1. コードの変更

```bash
# 変更を監視してコンパイル
pnpm run watch
```

2. 変更の確認

```bash
# デプロイ前の変更確認
pnpm run diff
```

3. デプロイ

```bash
# スタックのデプロイ
pnpm run deploy
```

## 便利なコマンド

- `pnpm run build` - TypeScriptのコンパイル
- `pnpm run watch` - 変更を監視してコンパイル
- `pnpm run test` - Jestによるユニットテストの実行
- `pnpm run deploy` - スタックをデフォルトのAWSアカウント/リージョンにデプロイ
- `pnpm run diff` - デプロイ済みスタックと現在の状態を比較
- `pnpm run synth` - CloudFormationテンプレートの合成
- `pnpm run destroy` - デプロイしたスタックを削除

## トラブルシューティング

1. デプロイエラーが発生した場合

```bash
# スタックの状態を確認
pnpm run synth

# エラーメッセージを確認し、必要に応じてスタックを削除して再デプロイ
pnpm run destroy
pnpm run deploy
```

2. 依存関係の問題が発生した場合

```bash
# node_modulesを削除して再インストール
rm -rf node_modules
pnpm install
```

## 注意事項

- 本番環境へのデプロイは必ずレビュー後に実行してください
- 環境変数は`.env`ファイルで管理し、Gitにコミットしないでください
- リソースの命名規則は`${appName}-${envName}`に従ってください
