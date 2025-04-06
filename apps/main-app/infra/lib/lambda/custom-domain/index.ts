import {
  AppRunner,
  AssociateCustomDomainCommand,
  DescribeCustomDomainsCommand,
  DisassociateCustomDomainCommand,
  DescribeCustomDomainsCommandOutput,
} from "@aws-sdk/client-apprunner";
import type {
  CloudFormationCustomResourceCreateEvent,
  CloudFormationCustomResourceUpdateEvent,
  CloudFormationCustomResourceDeleteEvent,
  CloudFormationCustomResourceResponse,
  Context,
} from "aws-lambda";
import * as https from "https";
import type { IncomingMessage } from "http";

/**
 * 検証レコード情報
 */
interface ValidationRecord {
  readonly Name: string;
  readonly Type: string;
  readonly Value: string;
}

/**
 * カスタムドメインの情報
 */
interface CustomDomain {
  readonly DomainName: string;
  readonly Status: string;
  readonly CertificateValidationRecords: readonly ValidationRecord[];
}

/**
 * App Runnerカスタムドメインの情報
 */
interface CustomDomains {
  readonly DNSTarget: string;
  readonly ServiceArn: string;
  readonly CustomDomain: CustomDomain;
  readonly CustomDomains: readonly CustomDomain[];
}

/**
 * CloudFormationリソースのプロパティ
 */
interface ResourceProperties {
  readonly ServiceArn: string;
  readonly DomainName: string;
}

/**
 * リソースレコード情報
 */
interface ResourceRecord {
  readonly Name: string;
  readonly Type: string;
  readonly ResourceRecords: readonly string[];
  readonly SetIdentifier: string;
  readonly Weight: string;
  readonly TTL: string;
}

/**
 * 抽出した属性情報
 */
interface ExtractedAttributes {
  readonly DNSTarget: string;
  readonly ValidationResourceRecords: readonly ResourceRecord[];
}

type CloudFormationCustomResourceEvent =
  | CloudFormationCustomResourceCreateEvent<ResourceProperties>
  | CloudFormationCustomResourceUpdateEvent<
      ResourceProperties,
      ResourceProperties
    >
  | CloudFormationCustomResourceDeleteEvent<ResourceProperties>;

type CloudFormationCustomResourceStatus = "SUCCESS" | "FAILED";

/**
 * CloudFormationカスタムリソースレスポンス
 */
interface CustomCloudFormationCustomResourceResponse
  extends Omit<CloudFormationCustomResourceResponse, "Status"> {
  Status: CloudFormationCustomResourceStatus;
}

/**
 * 物理リソースIDを生成する
 */
const createPhysicalId = (serviceArn: string, domainName: string): string =>
  `${serviceArn},${domainName}`;

/**
 * カスタムドメインの状態をチェックする
 */
const checkCustomDomain = async (
  apprunner: AppRunner,
  props: ResourceProperties
): Promise<DescribeCustomDomainsCommandOutput> => {
  const command = new DescribeCustomDomainsCommand({
    ServiceArn: props.ServiceArn,
  });
  return apprunner.send(command);
};

/**
 * カスタムドメインを作成する
 */
const createCustomDomain = async (
  apprunner: AppRunner,
  request: CloudFormationCustomResourceCreateEvent<ResourceProperties>,
  response: CustomCloudFormationCustomResourceResponse
): Promise<void> => {
  const props = request.ResourceProperties;

  // 入力検証
  if (!props.ServiceArn || !props.DomainName) {
    throw new Error("ServiceArnとDomainNameは必須パラメータです");
  }

  // カスタムドメインの追加リクエスト
  const command = new AssociateCustomDomainCommand({
    ServiceArn: props.ServiceArn,
    DomainName: props.DomainName,
    EnableWWWSubdomain: false,
  });

  try {
    // リトライロジックを使ってカスタムドメインを関連付ける
    await retryOperation(() => apprunner.send(command), 3, 2000);

    response.PhysicalResourceId = createPhysicalId(
      props.ServiceArn,
      props.DomainName
    );
    response.Status = "SUCCESS";

    // 現在のカスタムドメイン情報を取得して返す
    const domainInfo = await checkCustomDomain(apprunner, props);
    response.Data = {
      DomainName: props.DomainName,
      Status: "CREATING", // 初期ステータス
      DetailedInfo: JSON.stringify(domainInfo, null, 2),
    };
  } catch (error) {
    console.error("カスタムドメイン関連付けに失敗しました:", error);
    throw new Error(`カスタムドメイン関連付けに失敗しました: ${error}`);
  }
};

/**
 * カスタムドメインを更新する
 */
const updateCustomDomain = async (
  apprunner: AppRunner,
  request: CloudFormationCustomResourceUpdateEvent<
    ResourceProperties,
    ResourceProperties
  >,
  response: CustomCloudFormationCustomResourceResponse
): Promise<void> => {
  const props = request.ResourceProperties;
  const oldProps = request.OldResourceProperties;

  // 変更がない場合は何もしない
  if (
    oldProps.ServiceArn === props.ServiceArn &&
    oldProps.DomainName === props.DomainName
  ) {
    response.Reason = "変更はありません";
    response.PhysicalResourceId = request.PhysicalResourceId;
    response.Status = "SUCCESS";
    return;
  }

  // 新しいドメインの設定
  console.log(
    `カスタムドメイン設定を更新: ${oldProps.DomainName} -> ${props.DomainName}`
  );

  // 古いドメインを削除
  try {
    const deleteCommand = new DisassociateCustomDomainCommand({
      ServiceArn: oldProps.ServiceArn,
      DomainName: oldProps.DomainName,
    });
    await apprunner.send(deleteCommand);
    console.log(
      `古いカスタムドメイン ${oldProps.DomainName} の関連付けを解除しました`
    );
  } catch (error) {
    console.warn(
      `古いカスタムドメインの関連付け解除中にエラーが発生しました（続行します）:`,
      error
    );
  }

  // 新しいドメインを設定
  const createRequest: CloudFormationCustomResourceCreateEvent<ResourceProperties> =
    {
      ...request,
      RequestType: "Create",
    };
  await createCustomDomain(apprunner, createRequest, response);
};

/**
 * カスタムドメインを削除する
 */
const deleteCustomDomain = async (
  apprunner: AppRunner,
  request: CloudFormationCustomResourceDeleteEvent<ResourceProperties>,
  response: CustomCloudFormationCustomResourceResponse
): Promise<void> => {
  // 作成時に失敗した場合は無視する
  if (!request.PhysicalResourceId?.startsWith("arn:aws:apprunner")) {
    response.Reason =
      "作成済みリソースが見つからないため、削除をスキップします";
    response.Status = "SUCCESS";
    return;
  }

  const props = request.ResourceProperties;
  const command = new DisassociateCustomDomainCommand({
    ServiceArn: props.ServiceArn,
    DomainName: props.DomainName,
  });

  try {
    await retryOperation(() => apprunner.send(command), 3, 2000);
    console.log(
      `カスタムドメイン ${props.DomainName} の関連付けを解除しました`
    );
    response.Status = "SUCCESS";
  } catch (error) {
    console.error("カスタムドメイン関連付け解除に失敗しました", error);
    // 削除エラーは無視して成功として扱う（すでに存在しない可能性がある）
    response.Reason = "カスタムドメイン関連付け解除中のエラーを無視します";
    response.Status = "SUCCESS";
  }
};

/**
 * カスタムドメインイベントを処理する
 */
const handleCustomDomain = async (
  request: CloudFormationCustomResourceEvent
): Promise<CustomCloudFormationCustomResourceResponse> => {
  const apprunner = new AppRunner({});
  const response: CustomCloudFormationCustomResourceResponse = {
    StackId: request.StackId,
    RequestId: request.RequestId,
    LogicalResourceId: request.LogicalResourceId,
    Status: "SUCCESS",
    PhysicalResourceId: "NONE",
  };

  try {
    switch (request.RequestType) {
      case "Create":
        await createCustomDomain(apprunner, request, response);
        break;
      case "Update":
        await updateCustomDomain(apprunner, request, response);
        break;
      case "Delete":
        await deleteCustomDomain(apprunner, request, response);
        break;
      default:
        response.Status = "FAILED";
        response.Reason = "サポートされていないリクエストタイプです";
    }
  } catch (error) {
    response.Status = "FAILED";
    response.Reason = `${error}`;
    console.error(response.Reason);
  }

  return response;
};

/**
 * CloudFormationにレスポンスを送信する
 */
const postResponseToCloudformation = async (
  url: string,
  response: CustomCloudFormationCustomResourceResponse
): Promise<void> => {
  const data = JSON.stringify(response);
  console.log("CloudFormationにレスポンスを送信:", data);

  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "PUT",
        headers: {
          "Content-Type": "",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res: IncomingMessage) => {
        let responseData = "";
        res.on("data", (chunk: Buffer) => (responseData += chunk));
        res.on("end", () => {
          console.log("CloudFormationからのレスポンス:", responseData);
          resolve();
        });
        res.on("error", reject);
      }
    );

    request.on("error", reject);
    request.write(data);
    request.end();
  });
};

/**
 * 操作をリトライする
 */
async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  delay: number
): Promise<T> {
  let lastError: Error | undefined;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      console.warn(
        `操作に失敗しました (リトライ ${i + 1}/${maxRetries}):`,
        error
      );
      lastError = error instanceof Error ? error : new Error(String(error));

      if (i < maxRetries - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, delay * Math.pow(2, i))
        );
      }
    }
  }

  throw lastError || new Error("不明なエラーでリトライが失敗しました");
}

/**
 * Lambda関数ハンドラー
 */
export const handler = async (
  event: CloudFormationCustomResourceEvent,
  _context: Context
): Promise<void> => {
  console.log("イベントを受信:", JSON.stringify(event, null, 2));
  try {
    const response = await handleCustomDomain(event);
    await postResponseToCloudformation(event.ResponseURL, response);
  } catch (error) {
    console.error("ハンドラーでエラーが発生しました:", error);
    // 最後の手段としてエラーレスポンスを送信
    const errorResponse: CustomCloudFormationCustomResourceResponse = {
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Status: "FAILED",
      PhysicalResourceId: "ERROR_HANDLER",
      Reason: `処理中に致命的なエラーが発生しました: ${error}`,
    };
    await postResponseToCloudformation(event.ResponseURL, errorResponse);
  }
};
