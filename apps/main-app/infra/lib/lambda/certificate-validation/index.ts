import type { CloudFormationCustomResourceEvent, Context } from "aws-lambda";
import {
  Route53Client,
  ChangeResourceRecordSetsCommand,
  Change,
  ChangeAction,
} from "@aws-sdk/client-route-53";
import {
  ACMClient,
  DescribeCertificateCommand,
  DomainValidation,
} from "@aws-sdk/client-acm";
import * as https from "https";
import type { IncomingMessage } from "http";

const route53Client = new Route53Client({});
const acmClient = new ACMClient({});

interface ResourceProperties {
  readonly CertificateArn: string;
  readonly HostedZoneId: string;
  readonly DomainName: string;
}

type CustomCloudFormationEvent = CloudFormationCustomResourceEvent & {
  ResourceProperties: ResourceProperties;
};

type CloudFormationCustomResourceStatus = "SUCCESS" | "FAILED";

interface CustomCloudFormationCustomResourceResponse {
  Status: CloudFormationCustomResourceStatus;
  Reason?: string;
  PhysicalResourceId: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  Data?: Record<string, any>;
}

// 証明書から検証レコード情報を取得する関数
const getCertificateValidationRecords = async (
  certificateArn: string
): Promise<DomainValidation[]> => {
  try {
    const command = new DescribeCertificateCommand({
      CertificateArn: certificateArn,
    });
    const response = await acmClient.send(command);
    const certificate = response.Certificate;

    if (!certificate || !certificate.DomainValidationOptions) {
      throw new Error("証明書の検証情報が見つかりません");
    }

    console.log(
      "証明書の検証情報を取得しました:",
      JSON.stringify(certificate.DomainValidationOptions, null, 2)
    );
    return certificate.DomainValidationOptions;
  } catch (error) {
    console.error("証明書の検証情報取得に失敗しました:", error);
    throw error;
  }
};

const createChangeRequest = (
  validationOption: DomainValidation,
  action: ChangeAction
): Change | null => {
  if (
    !validationOption.ResourceRecord ||
    !validationOption.ResourceRecord.Name ||
    !validationOption.ResourceRecord.Value ||
    !validationOption.ResourceRecord.Type
  ) {
    console.warn("検証レコード情報が不完全です:", validationOption);
    return null;
  }

  const { ResourceRecord } = validationOption;

  return {
    Action: action,
    ResourceRecordSet: {
      Name: ResourceRecord.Name,
      Type: ResourceRecord.Type as any,
      TTL: 300,
      ResourceRecords: [{ Value: ResourceRecord.Value }],
    },
  };
};

const postResponseToCloudformation = async (
  url: string,
  response: CustomCloudFormationCustomResourceResponse
): Promise<void> => {
  const data = JSON.stringify(response);
  console.log("Sending response to CloudFormation:", data);

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
          console.log("Response from CloudFormation:", responseData);
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

const handleCertificateValidation = async (
  event: CustomCloudFormationEvent
): Promise<CustomCloudFormationCustomResourceResponse> => {
  console.log("イベント:", JSON.stringify(event, null, 2));

  const response: CustomCloudFormationCustomResourceResponse = {
    Status: "SUCCESS",
    PhysicalResourceId: `certificate-validation-${event.RequestId}`,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
  };

  try {
    const { CertificateArn, HostedZoneId, DomainName } =
      event.ResourceProperties;
    const requestType = event.RequestType as string;

    if (!CertificateArn || !HostedZoneId || !DomainName) {
      throw new Error(
        "必須パラメータが不足しています: CertificateArn, HostedZoneId, DomainNameが必要です"
      );
    }

    // 証明書の検証情報を取得
    console.log(`証明書ARN: ${CertificateArn} の検証情報を取得します`);
    const validationOptions = await retryOperation(
      () => getCertificateValidationRecords(CertificateArn),
      3,
      1000
    );

    // ドメインに関連する検証情報をフィルタリング
    const domainValidations = validationOptions.filter(
      (option) =>
        option.DomainName === DomainName ||
        option.DomainName === `*.${DomainName}`
    );

    if (domainValidations.length === 0) {
      throw new Error(
        `ドメイン ${DomainName} に関連する検証情報が見つかりませんでした。証明書の発行が完了していることを確認してください。`
      );
    }

    console.log(
      `${domainValidations.length}個の検証情報が見つかりました:`,
      JSON.stringify(domainValidations, null, 2)
    );

    switch (requestType) {
      case "Create":
      case "Update": {
        console.log("DNS検証レコードを作成/更新します");
        const changeRequests = domainValidations
          .map((validation) => createChangeRequest(validation, "UPSERT"))
          .filter((change): change is Change => change !== null);

        if (changeRequests.length === 0) {
          console.warn("作成/更新するDNS検証レコードがありません");
          break;
        }

        await Promise.all(
          changeRequests.map((change) => {
            console.log(
              "レコードを処理します:",
              JSON.stringify(change, null, 2)
            );
            return route53Client.send(
              new ChangeResourceRecordSetsCommand({
                HostedZoneId,
                ChangeBatch: {
                  Changes: [change],
                },
              })
            );
          })
        );
        break;
      }

      case "Delete": {
        console.log("DNS検証レコードを削除します");
        try {
          const changeRequests = domainValidations
            .map((validation) => createChangeRequest(validation, "DELETE"))
            .filter((change): change is Change => change !== null);

          if (changeRequests.length === 0) {
            console.warn("削除するDNS検証レコードがありません");
            break;
          }

          await Promise.all(
            changeRequests.map((change) => {
              console.log(
                "レコードを削除します:",
                JSON.stringify(change, null, 2)
              );
              return route53Client.send(
                new ChangeResourceRecordSetsCommand({
                  HostedZoneId,
                  ChangeBatch: {
                    Changes: [change],
                  },
                })
              );
            })
          );
        } catch (error) {
          console.log(
            "レコード削除中にエラーが発生しました（無視します）:",
            error
          );
          // 削除時のエラーは無視（レコードが既に存在しない可能性があるため）
        }
        break;
      }

      default:
        throw new Error(`サポートされていないリクエストタイプ: ${requestType}`);
    }

    // データを返す
    response.Data = {
      NumRecordsProcessed: domainValidations.length,
      CertificateArn,
      DomainName,
    };
  } catch (error) {
    console.error("エラー:", error);
    response.Status = "FAILED";
    response.Reason = error instanceof Error ? error.message : String(error);
  }

  return response;
};

// リトライロジックを実装する関数
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

export const handler = async (
  event: CustomCloudFormationEvent,
  _context: Context
): Promise<void> => {
  const response = await handleCertificateValidation(event);
  await postResponseToCloudformation(event.ResponseURL, response);
};
