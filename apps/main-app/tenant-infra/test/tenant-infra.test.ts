import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as TenantInfra from "../lib/tenant-infra-stack";

describe("TenantInfraStack", () => {
  const app = new cdk.App();
  const stack = new TenantInfra.TenantInfraStack(app, "MyTestStack", {
    envName: "test",
    appName: "tenant-app",
  });
  const template = Template.fromStack(stack);

  test("App Runner Service is created", () => {
    template.hasResourceProperties("AWS::AppRunner::Service", {
      ServiceName: "tenant-app-test-service",
    });
  });
});
