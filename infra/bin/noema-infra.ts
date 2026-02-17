#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { NoemaStack } from "../lib/noema-stack";

const app = new cdk.App();

const projectName = app.node.tryGetContext("projectName") ?? "noema";
const stage = app.node.tryGetContext("stage") ?? "prod";

new NoemaStack(app, `${projectName}-${stage}`, {
  stackName: `${projectName}-${stage}`,
  projectName,
  stage,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});
