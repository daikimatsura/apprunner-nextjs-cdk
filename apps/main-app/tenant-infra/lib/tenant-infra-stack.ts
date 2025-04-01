import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { NextJsAppRunnerService } from "./constructs/apprunner-service";
import { Cpu, Memory } from "@aws-cdk/aws-apprunner-alpha";

interface TenantInfraStackProps extends cdk.StackProps {
  envName: string;
  appName: string;
}

export class TenantInfraStack extends cdk.Stack {
  /**
   * App Runnerサービス
   */
  public readonly appRunnerService: NextJsAppRunnerService;

  constructor(scope: Construct, id: string, props: TenantInfraStackProps) {
    super(scope, id, props);

    // 環境変数
    const { envName, appName } = props;

    // リソース名のプレフィックス
    const resourcePrefix = `${appName}-${envName}`;

    // App Runnerサービスをデプロイ
    this.appRunnerService = new NextJsAppRunnerService(
      this,
      "NextJsAppRunner",
      {
        serviceName: `${resourcePrefix}-service`,
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
      }
    );

    // スタックの出力
    new cdk.CfnOutput(this, "WebAppUrl", {
      value: `https://${this.appRunnerService.service.serviceUrl}`,
      description: "Web Application URL",
      exportName: `${resourcePrefix}-web-app-url`,
    });
  }
}
