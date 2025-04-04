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

  /**
   * App Runner サービスのヘルスチェック設定
   */
  healthCheckConfig?: {
    path?: string;
    interval?: cdk.Duration;
    timeout?: cdk.Duration;
    healthyThreshold?: number;
    unhealthyThreshold?: number;
  };

  /**
   * コンテナのスタートコマンド
   * @default "node apps/main-app/web-app/server.js"
   */
  startCommand?: string;
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

  /**
   * App Runner のサービスURL
   */
  public readonly appRunnerUrl: string;

  constructor(scope: Construct, id: string, props: NextJsAppRunnerProps) {
    super(scope, id);

    // デフォルト値を設定
    const {
      serviceName,
      nextJsAppPath = "../../web-app",
      cpu = Cpu.ONE_VCPU,
      memory = Memory.TWO_GB,
      environmentVariables = {},
      autoDeploymentsEnabled = false,
      healthCheckConfig,
      startCommand = "node apps/main-app/web-app/server.js",
    } = props;

    // プロジェクトルートとウェブアプリディレクトリの設定
    const paths = this.setupPaths(nextJsAppPath);

    // Dockerイメージの作成
    this.dockerImageAsset = this.createDockerImageAsset(
      paths.projectRoot,
      paths.dockerfilePath
    );
    this.repository = this.dockerImageAsset.repository;

    // IAMロールの設定
    const roles = this.setupIamRoles();

    // App Runnerサービスを作成
    this.service = this.createAppRunnerService(
      serviceName,
      cpu,
      memory,
      roles.instanceRole,
      roles.accessRole,
      environmentVariables,
      autoDeploymentsEnabled,
      healthCheckConfig,
      startCommand
    );

    this.appRunnerUrl = `https://${this.service.serviceUrl}`;

    // 出力の設定
    this.createOutputs();
  }

  /**
   * パスの設定と検証を行う
   */
  private setupPaths(nextJsAppPath: string): {
    projectRoot: string;
    webAppDir: string;
    dockerfilePath: string;
  } {
    // プロジェクトルートのパスを取得
    const projectRoot = path.resolve(__dirname, "../../../../../");
    console.log(`Project Root: ${projectRoot}`);

    // web-appのディレクトリパスを構築（nextJsAppPathは使用しない）
    const webAppDir = path.resolve(projectRoot, "apps/main-app/web-app");
    console.log(`Web App Directory: ${webAppDir}`);

    // Dockerfileのパスを構築
    const dockerfilePath = path.resolve(webAppDir, ".docker", "Dockerfile");
    console.log(`Dockerfile Path: ${dockerfilePath}`);

    // Dockerfileの存在確認
    if (!fs.existsSync(dockerfilePath)) {
      throw new Error(
        `Dockerfile not found at: ${dockerfilePath}. Please check the path.`
      );
    }

    return { projectRoot, webAppDir, dockerfilePath };
  }

  /**
   * Dockerイメージアセットを作成する
   */
  private createDockerImageAsset(
    projectRoot: string,
    dockerfilePath: string
  ): ecrAssets.DockerImageAsset {
    return new ecrAssets.DockerImageAsset(this, "DockerImage", {
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
    });
  }

  /**
   * IAMロールを設定する
   */
  private setupIamRoles(): { instanceRole: iam.Role; accessRole: iam.Role } {
    // インスタンスロールを作成
    const instanceRole = new iam.Role(this, "InstanceRole", {
      assumedBy: new iam.ServicePrincipal("tasks.apprunner.amazonaws.com"),
      description: "Instance role for App Runner service",
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSAppRunnerServicePolicyForECRAccess"
        ),
      ],
    });

    // アクセスロールを作成
    const accessRole = new iam.Role(this, "AccessRole", {
      assumedBy: new iam.ServicePrincipal("build.apprunner.amazonaws.com"),
      description: "Access role for App Runner service",
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSAppRunnerServicePolicyForECRAccess"
        ),
      ],
    });

    return { instanceRole, accessRole };
  }

  /**
   * App Runnerサービスを作成する
   */
  private createAppRunnerService(
    serviceName: string,
    cpu: Cpu,
    memory: Memory,
    instanceRole: iam.Role,
    accessRole: iam.Role,
    environmentVariables: Record<string, string>,
    autoDeploymentsEnabled: boolean,
    healthCheckConfig?: NextJsAppRunnerProps["healthCheckConfig"],
    startCommand?: string
  ): Service {
    // デフォルトのヘルスチェック設定
    const defaultHealthCheck = HealthCheck.http({
      path: healthCheckConfig?.path || "/",
      interval: healthCheckConfig?.interval || cdk.Duration.seconds(10),
      timeout: healthCheckConfig?.timeout || cdk.Duration.seconds(5),
      healthyThreshold: healthCheckConfig?.healthyThreshold || 2,
      unhealthyThreshold: healthCheckConfig?.unhealthyThreshold || 3,
    });

    // 環境変数からポートを取得
    const port = parseInt(environmentVariables.PORT || "3000");

    return new Service(this, "Service", {
      serviceName: serviceName,
      cpu: cpu,
      memory: memory,
      instanceRole: instanceRole,
      accessRole: accessRole,
      source: Source.fromAsset({
        imageConfiguration: {
          port: port,
          startCommand: startCommand,
          environmentVariables: environmentVariables,
        },
        asset: this.dockerImageAsset,
      }),
      autoDeploymentsEnabled: autoDeploymentsEnabled,
      healthCheck: defaultHealthCheck,
    });
  }

  /**
   * CloudFormation出力を設定する
   */
  private createOutputs(): void {
    new cdk.CfnOutput(this, "AppRunnerServiceArn", {
      value: this.service.serviceArn,
      description: "App Runner Service ARN",
    });

    new cdk.CfnOutput(this, "AppRunnerServiceUrl", {
      value: this.service.serviceUrl,
      description: "App Runner Service URL",
    });

    new cdk.CfnOutput(this, "WebAppUrl", {
      value: this.appRunnerUrl,
      description: "Web Application URL",
    });

    new cdk.CfnOutput(this, "DockerImageUri", {
      value: this.dockerImageAsset.imageUri,
      description: "Docker Image URI",
    });
  }
}
