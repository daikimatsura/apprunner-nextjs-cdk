import * as cdk from "aws-cdk-lib";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { Construct } from "constructs";
import { Service } from "@aws-cdk/aws-apprunner-alpha";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import * as cr from "aws-cdk-lib/custom-resources";

// リージョンごとのApp Runnerホストゾーンマッピング
const APP_RUNNER_HOSTED_ZONE_MAP = new Map<string, string>([
  ["us-east-2", "Z0224347AD7KVHMLOX31"],
  ["us-east-1", "Z01915732ZBZKC8D32TPT"],
  ["us-west-2", "Z02243383FTQ64HJ5772Q"],
  ["ap-southeast-1", "Z09819469CZ3KQ8PWMCL"],
  ["ap-southeast-2", "Z03657752RA8799S0TI5I"],
  ["ap-northeast-1", "Z08491812XW6IPYLR6CCA"],
  ["eu-central-1", "Z0334911C2FDI2Q9M4FZ"],
  ["eu-west-1", "Z087551914Z2PCAU0QHMW"],
]);

// App RunnerのホストゾーンIDを取得する関数
function getAppRunnerHostedZone(region: string): string {
  return (
    APP_RUNNER_HOSTED_ZONE_MAP.get(region) ||
    APP_RUNNER_HOSTED_ZONE_MAP.get("ap-northeast-1")!
  );
}

/**
 * Route53設定のプロパティ
 */
export interface Route53ConfigProps {
  /**
   * ホストゾーン名
   */
  hostedZoneName: string;

  /**
   * サブドメイン名（オプショナル）
   * 指定しない場合はApexドメインを使用
   */
  subdomainName?: string;

  /**
   * App Runnerサービス
   */
  appRunnerService: Service;

  /**
   * DNSレコードタイプ
   * デフォルトはALIAS
   */
  recordType?: "ALIAS" | "CNAME";
}

/**
 * Route53の設定を行うコンストラクト
 */
export class Route53Config extends Construct {
  /**
   * SSL/TLS証明書
   */
  public readonly certificate: acm.Certificate;

  /**
   * ホストゾーン
   */
  public readonly hostedZone: route53.IHostedZone;

  /**
   * カスタムドメインURL
   */
  public readonly customDomainUrl: string;

  constructor(scope: Construct, id: string, props: Route53ConfigProps) {
    super(scope, id);

    const {
      hostedZoneName,
      subdomainName,
      appRunnerService,
      recordType = "ALIAS",
    } = props;

    // 既存のホストゾーンを参照
    this.hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName: hostedZoneName,
    });

    // 完全修飾ドメイン名を構築
    const fqdn = subdomainName
      ? `${subdomainName}.${hostedZoneName}`
      : hostedZoneName;
    this.customDomainUrl = `https://${fqdn}`;

    // SSL/TLS証明書の作成
    this.certificate = new acm.Certificate(this, "Certificate", {
      domainName: fqdn,
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
    });

    // 証明書検証ハンドラーの作成
    const validationHandler = this.createValidationHandler(this.hostedZone);

    // 証明書検証プロバイダーの作成
    const certificateValidationProvider = new cr.Provider(
      this,
      "CertificateValidationProvider",
      {
        onEventHandler: validationHandler,
      }
    );

    // 証明書検証用のDNSレコードを自動的に作成・管理するカスタムリソース
    const dnsValidationResource = new cdk.CustomResource(
      this,
      "DNSValidationResource",
      {
        serviceToken: certificateValidationProvider.serviceToken,
        properties: {
          HostedZoneId: this.hostedZone.hostedZoneId,
          CertificateArn: this.certificate.certificateArn,
          DomainName: fqdn,
        },
        resourceType: "Custom::DNSValidation",
      }
    );

    // カスタムドメイン管理のためのLambda関数とリソースを作成
    const customDomainFunction = this.createCustomDomainFunction();
    const customDomain = this.createCustomDomainResource(
      customDomainFunction,
      appRunnerService,
      fqdn
    );

    // DNSレコードの作成
    const dnsRecord = this.createDnsRecord(
      recordType,
      this.hostedZone,
      appRunnerService,
      subdomainName
    );

    // 依存関係を設定
    customDomain.node.addDependency(dnsValidationResource);
    customDomain.node.addDependency(dnsRecord);
    customDomain.node.addDependency(
      appRunnerService.node.defaultChild as cdk.CfnResource
    );

    // 出力の設定
    this.createOutputs(fqdn);
  }

  /**
   * 証明書検証ハンドラーを作成する
   */
  private createValidationHandler(
    hostedZone: route53.IHostedZone
  ): NodejsFunction {
    return new NodejsFunction(this, "ValidationHandler", {
      entry: path.join(__dirname, "../lambda/certificate-validation/index.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 128,
      timeout: cdk.Duration.seconds(900),
      initialPolicy: [
        new iam.PolicyStatement({
          actions: ["route53:ChangeResourceRecordSets"],
          resources: [hostedZone.hostedZoneArn],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: ["acm:DescribeCertificate"],
          resources: ["*"],
          effect: iam.Effect.ALLOW,
        }),
      ],
      environment: {
        NODE_OPTIONS: "--enable-source-maps",
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ["@aws-sdk/*"],
        esbuildArgs: {
          "--packages=bundle": true,
        },
      },
    });
  }

  /**
   * カスタムドメイン管理用のLambda関数を作成する
   */
  private createCustomDomainFunction(): NodejsFunction {
    // Lambda関数のロールを作成
    const lambdaRole = new iam.Role(this, "LambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    // App Runnerのカスタムドメイン関連の権限を追加
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "apprunner:AssociateCustomDomain",
          "apprunner:DisassociateCustomDomain",
          "apprunner:DescribeCustomDomains",
        ],
        resources: ["*"],
      })
    );

    // CloudWatchログの権限を追加
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:CreateLogGroup",
        ],
        resources: ["*"],
      })
    );

    // カスタムドメインのLambda関数を作成
    return new NodejsFunction(this, "CustomDomainFunction", {
      entry: path.join(__dirname, "../lambda/custom-domain/index.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 128,
      timeout: cdk.Duration.seconds(900),
      role: lambdaRole,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ["@aws-sdk/*"],
        esbuildArgs: {
          "--packages=bundle": true,
        },
      },
    });
  }

  /**
   * カスタムドメインリソースを作成する
   */
  private createCustomDomainResource(
    customDomainFunction: NodejsFunction,
    appRunnerService: Service,
    fqdn: string
  ): cdk.CustomResource {
    return new cdk.CustomResource(this, "CustomDomain", {
      serviceToken: customDomainFunction.functionArn,
      properties: {
        ServiceArn: appRunnerService.serviceArn,
        DomainName: fqdn,
      },
    });
  }

  /**
   * DNSレコードを作成する
   */
  private createDnsRecord(
    recordType: string,
    hostedZone: route53.IHostedZone,
    appRunnerService: Service,
    subdomainName?: string
  ): route53.RecordSet {
    if (recordType === "ALIAS") {
      // ALIASレコード
      return new route53.RecordSet(this, "DomainAliasRecord", {
        recordType: route53.RecordType.A,
        target: route53.RecordTarget.fromAlias({
          bind: () => ({
            dnsName: appRunnerService.serviceUrl,
            hostedZoneId: getAppRunnerHostedZone(cdk.Stack.of(this).region),
            evaluateTargetHealth: true,
          }),
        }),
        zone: hostedZone,
        recordName: subdomainName,
        deleteExisting: true,
      });
    } else {
      // CNAMEレコード
      return new route53.RecordSet(this, "DomainCnameRecord", {
        recordType: route53.RecordType.CNAME,
        target: route53.RecordTarget.fromValues(appRunnerService.serviceUrl),
        zone: hostedZone,
        recordName: subdomainName,
        deleteExisting: true,
      });
    }
  }

  /**
   * CloudFormation出力を設定する
   */
  private createOutputs(fqdn: string): void {
    new cdk.CfnOutput(this, "CustomDomainUrl", {
      value: this.customDomainUrl,
      description: "Custom Domain URL",
    });

    new cdk.CfnOutput(this, "CertificateArn", {
      value: this.certificate.certificateArn,
      description: "ACM Certificate ARN",
    });

    new cdk.CfnOutput(this, "AppRunnerDomainUrl", {
      value: `https://${this.certificate.node.scope}`,
      description: "App Runner Original Domain URL",
    });

    new cdk.CfnOutput(this, "SecurityNotes", {
      value: `セキュリティに関する注意事項:
1. セキュアなCookieの設定を確認してください。SameSite=Strict, Secure, HttpOnlyの設定を推奨します。
2. DNSプロパゲーションには時間がかかる場合があります。アプリケーションがすぐに利用できない場合があります。
3. SSL/TLSの設定はus-east-1リージョンで行われているため、リージョン間の遅延が発生する可能性があります。`,
      description: "Security Notes",
    });
  }
}
