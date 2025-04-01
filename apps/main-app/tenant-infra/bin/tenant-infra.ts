#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { TenantInfraStack } from "../lib/tenant-infra-stack";

const app = new cdk.App();

// 環境設定
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || "ap-northeast-1",
};

// 環境変数
const environmentName = app.node.tryGetContext("environment") || "dev";
const appName = "apprunner-nextjs";

new TenantInfraStack(app, "TenantInfraStack", {
  env,
  envName: environmentName,
  appName: appName,
  description: `${appName} tenant infra (${environmentName})`,
});

// タグ付け
cdk.Tags.of(app).add("Environment", environmentName);
cdk.Tags.of(app).add("Application", appName);
cdk.Tags.of(app).add("ManagedBy", "CDK");
