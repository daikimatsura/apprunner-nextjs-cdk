import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as TenantInfra from "../lib/stacks/tenant-infra-stack";

describe("TenantInfraStack", () => {
  const app = new cdk.App();
  const stack = new TenantInfra.TenantInfraStack(app, "MyTestStack", {
    env: { account: "123456789012", region: "ap-northeast-1" },
    envName: "test",
    appName: "test-app",
  });
  const template = Template.fromStack(stack);

  test("App Runner Service is created", () => {
    template.hasResourceProperties("AWS::AppRunner::Service", {
      SourceConfiguration: {
        ImageRepository: {
          ImageIdentifier: {
            "Fn::Join": [
              "",
              [
                {
                  "Fn::Select": [
                    4,
                    {
                      "Fn::Split": [
                        ":",
                        {
                          "Fn::GetAtt": [
                            "NextJsAppRunnerDockerAssetECRRepository4A8EF344",
                            "Arn",
                          ],
                        },
                      ],
                    },
                  ],
                },
                ".dkr.ecr.",
                {
                  "Fn::Select": [
                    3,
                    {
                      "Fn::Split": [
                        ":",
                        {
                          "Fn::GetAtt": [
                            "NextJsAppRunnerDockerAssetECRRepository4A8EF344",
                            "Arn",
                          ],
                        },
                      ],
                    },
                  ],
                },
                ".",
                { Ref: "AWS::URLSuffix" },
                "/",
                { Ref: "NextJsAppRunnerDockerAssetECRRepository4A8EF344" },
                ":latest",
              ],
            ],
          },
        },
      },
    });
  });
});
