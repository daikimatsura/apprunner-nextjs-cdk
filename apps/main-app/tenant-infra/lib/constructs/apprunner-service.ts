import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import {
  Cpu,
  Memory,
  Service,
  Source,
  HealthCheck,
} from "@aws-cdk/aws-apprunner-alpha";
import { Construct } from "constructs";
import * as path from "path";
import * as fs from "fs";

/**
 * NextJSアプリケーションのApp Runner設定プロパティ
 */
export interface NextJsAppRunnerProps {
  /**
   * App Runnerサービス名
   */
  serviceName: string;

  /**
   * Next.jsアプリケーションのパス
   * @default "../../web-app"
   */
  nextJsAppPath?: string;

  /**
   * CPU設定
   * @default Cpu.ONE_VCPU
   */
  cpu?: Cpu;

  /**
   * メモリ設定
   * @default Memory.TWO_GB
   */
  memory?: Memory;

  /**
   * 環境変数
   */
  environmentVariables?: Record<string, string>;

  /**
   * 自動デプロイの有効化
   * @default false
   */
  autoDeploymentsEnabled?: boolean;
}

/**
 * NextJSアプリケーションをApp Runnerにデプロイするためのコンストラクト
 */
export class NextJsAppRunnerService extends Construct {
  /**
   * App Runnerサービス
   */
  public readonly service: Service;

  /**
   * Docker Image Asset
   */
  public readonly dockerImageAsset: ecrAssets.DockerImageAsset;

  /**
   * ECRリポジトリ (コンテナイメージの保存先)
   */
  public readonly repository: ecr.IRepository;

  constructor(scope: Construct, id: string, props: NextJsAppRunnerProps) {
    super(scope, id);

    // デフォルト値を設定
    const {
      serviceName,
      cpu = Cpu.ONE_VCPU,
      memory = Memory.FOUR_GB,
      environmentVariables = {},
      autoDeploymentsEnabled = false,
    } = props;

    // パスを取得してDockerfileの存在を確認
    const projectRoot = path.resolve(__dirname, "../../../../../");
    const webAppDir = path.join(projectRoot, "apps/main-app/web-app");
    console.log(`Project Root: ${projectRoot}`);
    console.log(`Web App Directory: ${webAppDir}`);

    const dockerfilePath = path.join(webAppDir, ".docker", "Dockerfile");
    console.log(`Dockerfile Path: ${dockerfilePath}`);

    if (!fs.existsSync(dockerfilePath)) {
      throw new Error(`Dockerfile not found at: ${dockerfilePath}`);
    }

    // Dockerイメージの作成
    this.dockerImageAsset = new ecrAssets.DockerImageAsset(
      this,
      "DockerImage",
      {
        directory: projectRoot,
        file: path.relative(projectRoot, dockerfilePath),
        exclude: [
          "apps/main-app/tenant-infra/cdk.out",
          "apps/main-app/tenant-infra/node_modules",
        ],
        platform: ecrAssets.Platform.LINUX_AMD64,
        buildArgs: {
          BUILDPLATFORM: "linux/amd64",
          TARGETPLATFORM: "linux/amd64",
        },
      }
    );

    this.repository = this.dockerImageAsset.repository;

    // App Runnerサービスを作成
    this.service = new Service(this, "Service", {
      serviceName: serviceName,
      cpu: cpu,
      memory: memory,
      // インスタンスロールを作成
      instanceRole: new iam.Role(this, "InstanceRole", {
        assumedBy: new iam.ServicePrincipal("tasks.apprunner.amazonaws.com"),
        description: "Instance role for App Runner service",
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AWSAppRunnerServicePolicyForECRAccess"
          ),
        ],
      }),
      // アクセスロールを作成
      accessRole: new iam.Role(this, "AccessRole", {
        assumedBy: new iam.ServicePrincipal("build.apprunner.amazonaws.com"),
        description: "Access role for App Runner service",
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AWSAppRunnerServicePolicyForECRAccess"
          ),
        ],
      }),
      source: Source.fromAsset({
        imageConfiguration: {
          port: parseInt(environmentVariables.PORT),
          startCommand: "node apps/main-app/web-app/server.js",
          environmentVariables: environmentVariables,
        },
        asset: this.dockerImageAsset,
      }),
      autoDeploymentsEnabled: autoDeploymentsEnabled,
      healthCheck: HealthCheck.http({
        path: "/",
        interval: cdk.Duration.seconds(10),
        timeout: cdk.Duration.seconds(5),
        healthyThreshold: 2,
        unhealthyThreshold: 3,
      }),
    });

    // 出力
    new cdk.CfnOutput(this, "AppRunnerServiceArn", {
      value: this.service.serviceArn,
      description: "App Runner Service ARN",
    });

    new cdk.CfnOutput(this, "AppRunnerServiceUrl", {
      value: this.service.serviceUrl,
      description: "App Runner Service URL",
    });

    new cdk.CfnOutput(this, "WebAppUrl", {
      value: `https://${this.service.serviceUrl}`,
      description: "Web Application URL",
    });

    new cdk.CfnOutput(this, "DockerImageUri", {
      value: this.dockerImageAsset.imageUri,
      description: "Docker Image URI",
    });
  }
}
