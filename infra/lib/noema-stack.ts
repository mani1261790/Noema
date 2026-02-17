import path from "path";
import * as cdk from "aws-cdk-lib";
import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

interface NoemaStackProps extends StackProps {
  projectName: string;
  stage: string;
}

export class NoemaStack extends Stack {
  constructor(scope: Construct, id: string, props: NoemaStackProps) {
    super(scope, id, props);

    const prefix = `${props.projectName}-${props.stage}`;
    const frontendUrl = String(this.node.tryGetContext("frontendUrl") ?? "https://example.com").replace(/\/$/, "");

    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `${prefix}-user-pool`,
      selfSignUpEnabled: true,
      signInAliases: { email: true, username: false },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false
      },
      standardAttributes: {
        email: { required: true, mutable: false }
      },
      removalPolicy: RemovalPolicy.RETAIN
    });

    const userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool,
      userPoolClientName: `${prefix}-web-client`,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true
        },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
        callbackUrls: [
          "http://localhost:3000/api/auth/callback/cognito",
          `${frontendUrl}/api/auth/callback/cognito`
        ],
        logoutUrls: ["http://localhost:3000", `${frontendUrl}`]
      }
    });

    const cognitoDomainPrefix = (
      this.node.tryGetContext("cognitoDomainPrefix") ?? `${prefix}-auth`
    )
      .toLowerCase()
      .slice(0, 63);

    const userPoolDomain = new cognito.UserPoolDomain(this, "UserPoolDomain", {
      userPool,
      cognitoDomain: {
        domainPrefix: cognitoDomainPrefix
      }
    });

    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false
    });

    const notebookBucket = new s3.Bucket(this, "NotebookBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED
      },
      additionalBehaviors: {
        "/notebooks/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(notebookBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED
        }
      },
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultRootObject: "index.html"
    });

    const questionsTable = new dynamodb.Table(this, "QuestionsTable", {
      tableName: `${prefix}-questions`,
      partitionKey: { name: "questionId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN
    });

    questionsTable.addGlobalSecondaryIndex({
      indexName: "user-createdAt-index",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING }
    });

    const answersTable = new dynamodb.Table(this, "AnswersTable", {
      tableName: `${prefix}-answers`,
      partitionKey: { name: "questionId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN
    });

    const cacheTable = new dynamodb.Table(this, "CacheTable", {
      tableName: `${prefix}-question-cache`,
      partitionKey: { name: "cacheKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN
    });

    const notebooksTable = new dynamodb.Table(this, "NotebooksTable", {
      tableName: `${prefix}-notebooks`,
      partitionKey: { name: "notebookId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN
    });

    const accessLogsTable = new dynamodb.Table(this, "AccessLogsTable", {
      tableName: `${prefix}-access-logs`,
      partitionKey: { name: "logId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN
    });

    const deadLetterQueue = new sqs.Queue(this, "QaDeadLetterQueue", {
      queueName: `${prefix}-qa-dlq`,
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED
    });

    const qaQueue = new sqs.Queue(this, "QaQueue", {
      queueName: `${prefix}-qa-jobs`,
      visibilityTimeout: Duration.seconds(120),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 5
      },
      encryption: sqs.QueueEncryption.SQS_MANAGED
    });

    const apiFunction = new lambdaNodejs.NodejsFunction(this, "ApiFunction", {
      functionName: `${prefix}-api`,
      entry: path.join(__dirname, "../lambda/api.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(20),
      environment: {
        QUESTIONS_TABLE: questionsTable.tableName,
        ANSWERS_TABLE: answersTable.tableName,
        CACHE_TABLE: cacheTable.tableName,
        NOTEBOOKS_TABLE: notebooksTable.tableName,
        ACCESS_LOGS_TABLE: accessLogsTable.tableName,
        QA_QUEUE_URL: qaQueue.queueUrl,
        NOTEBOOK_BUCKET: notebookBucket.bucketName
      }
    });

    const workerFunction = new lambdaNodejs.NodejsFunction(this, "WorkerFunction", {
      functionName: `${prefix}-qa-worker`,
      entry: path.join(__dirname, "../lambda/worker.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.seconds(120),
      environment: {
        QUESTIONS_TABLE: questionsTable.tableName,
        ANSWERS_TABLE: answersTable.tableName,
        CACHE_TABLE: cacheTable.tableName,
        NOTEBOOKS_TABLE: notebooksTable.tableName,
        ACCESS_LOGS_TABLE: accessLogsTable.tableName,
        NOTEBOOK_BUCKET: notebookBucket.bucketName
      }
    });

    workerFunction.addEventSource(
      new lambdaEventSources.SqsEventSource(qaQueue, {
        batchSize: 5,
        maxBatchingWindow: Duration.seconds(5)
      })
    );

    questionsTable.grantReadWriteData(apiFunction);
    answersTable.grantReadWriteData(apiFunction);
    cacheTable.grantReadWriteData(apiFunction);
    notebooksTable.grantReadWriteData(apiFunction);
    accessLogsTable.grantReadWriteData(apiFunction);
    qaQueue.grantSendMessages(apiFunction);
    notebookBucket.grantReadWrite(apiFunction);

    questionsTable.grantReadWriteData(workerFunction);
    answersTable.grantReadWriteData(workerFunction);
    cacheTable.grantReadWriteData(workerFunction);
    notebooksTable.grantReadWriteData(workerFunction);
    accessLogsTable.grantReadWriteData(workerFunction);
    notebookBucket.grantReadWrite(workerFunction);
    qaQueue.grantConsumeMessages(workerFunction);

    const bedrockPolicy = new iam.PolicyStatement({
      sid: "AllowBedrockInvoke",
      actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      resources: ["*"]
    });
    apiFunction.addToRolePolicy(bedrockPolicy);
    workerFunction.addToRolePolicy(bedrockPolicy);

    const api = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: `${prefix}-http-api`,
      corsPreflight: {
        allowHeaders: ["authorization", "content-type"],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.OPTIONS
        ],
        allowOrigins: ["*"]
      }
    });

    const jwtAuthorizer = new HttpJwtAuthorizer("JwtAuthorizer", userPool.userPoolProviderUrl, {
      jwtAudience: [userPoolClient.userPoolClientId]
    });

    const apiIntegration = new HttpLambdaIntegration("ApiIntegration", apiFunction);

    api.addRoutes({
      path: "/health",
      methods: [apigwv2.HttpMethod.GET],
      integration: apiIntegration
    });

    api.addRoutes({
      path: "/api/questions",
      methods: [apigwv2.HttpMethod.POST],
      integration: apiIntegration,
      authorizer: jwtAuthorizer
    });

    api.addRoutes({
      path: "/api/questions/{questionId}/answer",
      methods: [apigwv2.HttpMethod.GET],
      integration: apiIntegration,
      authorizer: jwtAuthorizer
    });

    api.addRoutes({
      path: "/api/admin/notebooks",
      methods: [apigwv2.HttpMethod.POST],
      integration: apiIntegration,
      authorizer: jwtAuthorizer
    });

    api.addRoutes({
      path: "/api/admin/questions",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PATCH],
      integration: apiIntegration,
      authorizer: jwtAuthorizer
    });

    new cdk.CfnOutput(this, "CloudFrontDomainName", {
      value: distribution.distributionDomainName
    });

    new cdk.CfnOutput(this, "SiteBucketName", {
      value: siteBucket.bucketName
    });

    new cdk.CfnOutput(this, "NotebookBucketName", {
      value: notebookBucket.bucketName
    });

    new cdk.CfnOutput(this, "HttpApiUrl", {
      value: api.url ?? ""
    });

    new cdk.CfnOutput(this, "CognitoUserPoolId", {
      value: userPool.userPoolId
    });

    new cdk.CfnOutput(this, "CognitoUserPoolClientId", {
      value: userPoolClient.userPoolClientId
    });

    new cdk.CfnOutput(this, "CognitoDomain", {
      value: userPoolDomain.domainName
    });

    new cdk.CfnOutput(this, "QaQueueUrl", {
      value: qaQueue.queueUrl
    });
  }
}
