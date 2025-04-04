import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { NextJsAppRunnerService } from "../constructs/apprunner-service";
import { Route53Config } from "../constructs/route53-config";
import { Cpu, Memory } from "@aws-cdk/aws-apprunner-alpha";

/**
 * テナントインフラストラクチャスタックのプロパティ
 */
export interface TenantInfraStackProps extends cdk.StackProps {
  /**
   * 環境名 (dev/stg/prod)
   */
  envName: string;

  /**
   * アプリケーション名
   */
  appName: string;

  /**
   * ホストゾーン名 (Route53)
   */
  hostedZoneName?: string;

  /**
   * サブドメイン名
   */
  subdomainName?: string;
}

/**
 * テナントインフラストラクチャスタック
 * このスタックはApp Runnerサービスとカスタムドメイン設定を管理します。
 */
export class TenantInfraStack extends cdk.Stack {
  /**
   * App Runnerサービス
   */
  public readonly appRunnerService: NextJsAppRunnerService;

  /**
   * Route53設定
   */
  public readonly route53Config?: Route53Config;

  /**
   * Webアプリケーション URL
   */
  public readonly webAppUrl: string;

  constructor(scope: Construct, id: string, props: TenantInfraStackProps) {
    super(scope, id, {
      ...props,
      description: `${props.appName} tenant infrastructure for ${props.envName} environment`,
      crossRegionReferences: true,
      tags: {
        Application: props.appName,
        Environment: props.envName,
        ManagedBy: "CDK",
      },
    });

    // 環境変数
    const { envName, appName, hostedZoneName, subdomainName } = props;

    // リソース名のプレフィックス
    const resourcePrefix = `${appName}-${envName}`;

    // App Runnerサービスをデプロイ
    this.appRunnerService = this.deployAppRunnerService(
      resourcePrefix,
      envName
    );
    this.webAppUrl = `https://${this.appRunnerService.service.serviceUrl}`;

    // カスタムドメイン設定
    const route53ConfigResult = this.configureCustomDomain(
      hostedZoneName,
      subdomainName
    );
    if (route53ConfigResult) {
      Object.defineProperty(this, "route53Config", {
        value: route53ConfigResult,
        writable: false,
        configurable: false,
      });
    }

    // スタックの出力
    this.createStackOutputs(resourcePrefix);
  }

  /**
   * App Runnerサービスをデプロイする
   */
  private deployAppRunnerService(
    resourcePrefix: string,
    envName: string
  ): NextJsAppRunnerService {
    return new NextJsAppRunnerService(this, "NextJsAppRunner", {
      serviceName: resourcePrefix,
      cpu: Cpu.ONE_VCPU,
      memory: Memory.TWO_GB,
      environmentVariables: {
        PORT: "3000",
        NODE_ENV: "production",
        APP_ENV: envName,
        NEXT_TELEMETRY_DISABLED: "1",
        HOSTNAME: "0.0.0.0",
      },
      autoDeploymentsEnabled: false,
      healthCheckConfig: {
        path: "/",
        interval: cdk.Duration.seconds(10),
        timeout: cdk.Duration.seconds(5),
      },
    });
  }

  /**
   * カスタムドメインを設定する（ホストゾーン名とサブドメイン名が指定されている場合）
   */
  private configureCustomDomain(
    hostedZoneName?: string,
    subdomainName?: string
  ): Route53Config | undefined {
    if (hostedZoneName && subdomainName) {
      return new Route53Config(this, "Route53Config", {
        hostedZoneName,
        subdomainName,
        appRunnerService: this.appRunnerService.service,
        recordType: "ALIAS",
      });
    }
    return undefined;
  }

  /**
   * スタックの出力を作成する
   */
  private createStackOutputs(resourcePrefix: string): void {
    new cdk.CfnOutput(this, "WebAppUrl", {
      value: this.webAppUrl,
      description: "Web Application URL",
      exportName: `${resourcePrefix}-web-app-url`,
    });
  }
}
