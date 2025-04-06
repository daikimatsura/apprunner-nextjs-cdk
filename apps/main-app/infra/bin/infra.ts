#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { InfraStack } from "../lib/stacks/infra-stack";
import * as dotenv from "dotenv";
import * as path from "path";

// .envファイルを読み込む
dotenv.config({ path: path.join(__dirname, "../.env") });

const app = new cdk.App();

// 環境変数
const environmentName = process.env.ENVIRONMENT || "dev";
const appName = process.env.APP_NAME || "apprunner-nextjs";

// Route53設定
const hostedZoneName = process.env.HOSTED_ZONE_NAME;
const subdomainName = process.env.SUBDOMAIN_NAME;

// スタックを作成
new InfraStack(app, `${appName}-${environmentName}-Stack`, {
  // 環境設定
  envName: environmentName,
  appName,
  hostedZoneName,
  subdomainName,
  // アカウントとリージョンを明示的に指定
  env: {
    account: process.env.AWS_ACCOUNT_ID,
    region: process.env.REGION,
  },
});

// タグ付け
cdk.Tags.of(app).add("Environment", environmentName);
cdk.Tags.of(app).add("Application", appName);
cdk.Tags.of(app).add("ManagedBy", "CDK");
