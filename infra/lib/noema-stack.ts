import path from "path";
import * as cdk from "aws-cdk-lib";
import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
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
    const frontendUrlRaw = String(this.node.tryGetContext("frontendUrl") ?? "https://example.com").trim();
    let frontendUrlParsed: URL;
    try {
      frontendUrlParsed = new URL(frontendUrlRaw);
    } catch {
      throw new Error(`Invalid frontendUrl context: ${frontendUrlRaw}`);
    }
    const isHttpsOrigin = frontendUrlParsed.protocol === "https:";
    const isLocalhostHttp = frontendUrlParsed.protocol === "http:" && frontendUrlParsed.hostname === "localhost";
    const hasPath = frontendUrlParsed.pathname && frontendUrlParsed.pathname !== "/";
    if (!isHttpsOrigin && !isLocalhostHttp) {
      throw new Error(`Invalid frontendUrl context: ${frontendUrlRaw}`);
    }
    if (frontendUrlParsed.username || frontendUrlParsed.password || hasPath || frontendUrlParsed.search || frontendUrlParsed.hash) {
      throw new Error(`frontendUrl must be origin only (scheme://host[:port]): ${frontendUrlRaw}`);
    }
    const frontendUrl = `${frontendUrlParsed.protocol}//${frontendUrlParsed.host}`;
    const alarmEmail = String(this.node.tryGetContext("alarmEmail") ?? "");
    const githubRepo = String(this.node.tryGetContext("githubRepo") ?? "");
    const githubRefPattern = String(this.node.tryGetContext("githubRefPattern") ?? "refs/heads/main");
    const githubEnvironmentName = String(this.node.tryGetContext("githubEnvironmentName") ?? "production");
    const createGithubDeployRole = String(this.node.tryGetContext("createGithubDeployRole") ?? "false") === "true";
    const cdkBootstrapQualifier = String(this.node.tryGetContext("cdkBootstrapQualifier") ?? "hnb659fds");
    const qaModelProvider = String(this.node.tryGetContext("qaModelProvider") ?? "auto");
    const noemaInlineQa = String(this.node.tryGetContext("noemaInlineQa") ?? "false");
    const adminEmails = String(this.node.tryGetContext("adminEmails") ?? "");
    const openAiApiKey = String(this.node.tryGetContext("openAiApiKey") ?? "");
    const openAiApiKeySsmParameter = String(this.node.tryGetContext("openAiApiKeySsmParameter") ?? "");
    const openAiBaseUrl = String(this.node.tryGetContext("openAiBaseUrl") ?? "https://api.openai.com/v1");
    const openAiModelSmall = String(this.node.tryGetContext("openAiModelSmall") ?? "gpt-5-nano");
    const openAiModelMid = String(this.node.tryGetContext("openAiModelMid") ?? "");
    const openAiModelLarge = String(this.node.tryGetContext("openAiModelLarge") ?? "");
    const openAiMaxOutputTokens = String(this.node.tryGetContext("openAiMaxOutputTokens") ?? "800");
    const openAiTemperature = String(this.node.tryGetContext("openAiTemperature") ?? "0.2");
    const qaRateLimitMax = String(this.node.tryGetContext("qaRateLimitMax") ?? "6");
    const qaRateLimitWindowMinutes = String(this.node.tryGetContext("qaRateLimitWindowMinutes") ?? "1");
    const bedrockRegion = String(this.node.tryGetContext("bedrockRegion") ?? "us-east-1");
    const allowedBedrockRegions = new Set(["us-east-1", "us-west-2", "ap-northeast-1", "ap-northeast-3"]);
    if (!allowedBedrockRegions.has(bedrockRegion)) {
      throw new Error(
        `Unsupported bedrockRegion context: ${bedrockRegion}. Allowed regions: us-east-1, us-west-2, ap-northeast-1, ap-northeast-3`
      );
    }
    const bedrockModelSmall = String(this.node.tryGetContext("bedrockModelSmall") ?? "");
    const bedrockModelMid = String(this.node.tryGetContext("bedrockModelMid") ?? "");
    const bedrockModelLarge = String(this.node.tryGetContext("bedrockModelLarge") ?? "");
    const bedrockMaxTokens = String(this.node.tryGetContext("bedrockMaxTokens") ?? "800");
    const bedrockModelArns = [bedrockModelSmall, bedrockModelMid, bedrockModelLarge]
      .map((value) => value.trim())
      .filter(Boolean)
      .map((modelId) =>
        modelId.startsWith("arn:")
          ? modelId
          : `arn:${cdk.Aws.PARTITION}:bedrock:${bedrockRegion}::foundation-model/${modelId}`
      );

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
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
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
    const rateLimitTable = new dynamodb.Table(this, "RateLimitTable", {
      tableName: `${prefix}-rate-limits`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "requestAt", type: dynamodb.AttributeType.STRING },
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

    const alarmTopic = new sns.Topic(this, "AlarmTopic", {
      topicName: `${prefix}-alarms`
    });
    if (alarmEmail) {
      alarmTopic.addSubscription(new snsSubscriptions.EmailSubscription(alarmEmail));
    }

    const apiLogGroup = new logs.LogGroup(this, "ApiLogGroup", {
      logGroupName: `/aws/lambda/${prefix}-api`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.RETAIN
    });

    const apiFunction = new lambdaNodejs.NodejsFunction(this, "ApiFunction", {
      functionName: `${prefix}-api`,
      entry: path.join(__dirname, "../lambda/api.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(20),
      logGroup: apiLogGroup,
      environment: {
        QUESTIONS_TABLE: questionsTable.tableName,
        ANSWERS_TABLE: answersTable.tableName,
        CACHE_TABLE: cacheTable.tableName,
        RATE_LIMIT_TABLE: rateLimitTable.tableName,
        NOTEBOOKS_TABLE: notebooksTable.tableName,
        ACCESS_LOGS_TABLE: accessLogsTable.tableName,
        QA_QUEUE_URL: qaQueue.queueUrl,
        NOTEBOOK_BUCKET: notebookBucket.bucketName,
        QA_MODEL_PROVIDER: qaModelProvider,
        NOEMA_INLINE_QA: noemaInlineQa,
        ADMIN_EMAILS: adminEmails,
        OPENAI_API_KEY: openAiApiKey,
        OPENAI_API_KEY_SSM_PARAMETER: openAiApiKeySsmParameter,
        OPENAI_BASE_URL: openAiBaseUrl,
        OPENAI_MODEL_SMALL: openAiModelSmall,
        OPENAI_MODEL_MID: openAiModelMid,
        OPENAI_MODEL_LARGE: openAiModelLarge,
        OPENAI_MAX_OUTPUT_TOKENS: openAiMaxOutputTokens,
        OPENAI_TEMPERATURE: openAiTemperature,
        QA_RATE_LIMIT_MAX: qaRateLimitMax,
        QA_RATE_LIMIT_WINDOW_MINUTES: qaRateLimitWindowMinutes,
        BEDROCK_REGION: bedrockRegion,
        BEDROCK_MODEL_SMALL: bedrockModelSmall,
        BEDROCK_MODEL_MID: bedrockModelMid,
        BEDROCK_MODEL_LARGE: bedrockModelLarge,
        BEDROCK_MAX_TOKENS: bedrockMaxTokens
      }
    });

    const pythonRunnerFunction = new lambda.Function(this, "PythonRunnerFunction", {
      functionName: `${prefix}-python-runner`,
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.X86_64,
      handler: "handler.lambda_handler",
      memorySize: 1024,
      timeout: Duration.seconds(30),
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/python-runner"), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            "bash",
            "-lc",
            "set -euo pipefail && pip install --disable-pip-version-check -r requirements.txt -t /asset-output && cp -au . /asset-output"
          ]
        }
      })
    });

    apiFunction.addEnvironment("PYTHON_RUNNER_FUNCTION_NAME", pythonRunnerFunction.functionName);

    const workerLogGroup = new logs.LogGroup(this, "WorkerLogGroup", {
      logGroupName: `/aws/lambda/${prefix}-qa-worker`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.RETAIN
    });

    const workerFunction = new lambdaNodejs.NodejsFunction(this, "WorkerFunction", {
      functionName: `${prefix}-qa-worker`,
      entry: path.join(__dirname, "../lambda/worker.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.seconds(120),
      logGroup: workerLogGroup,
      environment: {
        QUESTIONS_TABLE: questionsTable.tableName,
        ANSWERS_TABLE: answersTable.tableName,
        CACHE_TABLE: cacheTable.tableName,
        RATE_LIMIT_TABLE: rateLimitTable.tableName,
        NOTEBOOKS_TABLE: notebooksTable.tableName,
        ACCESS_LOGS_TABLE: accessLogsTable.tableName,
        NOTEBOOK_BUCKET: notebookBucket.bucketName,
        QA_MODEL_PROVIDER: qaModelProvider,
        NOEMA_INLINE_QA: noemaInlineQa,
        ADMIN_EMAILS: adminEmails,
        OPENAI_API_KEY: openAiApiKey,
        OPENAI_API_KEY_SSM_PARAMETER: openAiApiKeySsmParameter,
        OPENAI_BASE_URL: openAiBaseUrl,
        OPENAI_MODEL_SMALL: openAiModelSmall,
        OPENAI_MODEL_MID: openAiModelMid,
        OPENAI_MODEL_LARGE: openAiModelLarge,
        OPENAI_MAX_OUTPUT_TOKENS: openAiMaxOutputTokens,
        OPENAI_TEMPERATURE: openAiTemperature,
        QA_RATE_LIMIT_MAX: qaRateLimitMax,
        QA_RATE_LIMIT_WINDOW_MINUTES: qaRateLimitWindowMinutes,
        BEDROCK_REGION: bedrockRegion,
        BEDROCK_MODEL_SMALL: bedrockModelSmall,
        BEDROCK_MODEL_MID: bedrockModelMid,
        BEDROCK_MODEL_LARGE: bedrockModelLarge,
        BEDROCK_MAX_TOKENS: bedrockMaxTokens
      }
    });

    workerFunction.addEventSource(
      new lambdaEventSources.SqsEventSource(qaQueue, {
        batchSize: 5,
        maxBatchingWindow: Duration.seconds(5),
        reportBatchItemFailures: true
      })
    );

    questionsTable.grantReadWriteData(apiFunction);
    answersTable.grantReadWriteData(apiFunction);
    cacheTable.grantReadWriteData(apiFunction);
    rateLimitTable.grantReadWriteData(apiFunction);
    notebooksTable.grantReadWriteData(apiFunction);
    accessLogsTable.grantReadWriteData(apiFunction);
    qaQueue.grantSendMessages(apiFunction);
    notebookBucket.grantReadWrite(apiFunction);
    pythonRunnerFunction.grantInvoke(apiFunction);

    questionsTable.grantReadWriteData(workerFunction);
    answersTable.grantReadWriteData(workerFunction);
    cacheTable.grantReadWriteData(workerFunction);
    notebooksTable.grantReadWriteData(workerFunction);
    accessLogsTable.grantReadWriteData(workerFunction);
    notebookBucket.grantReadWrite(workerFunction);
    qaQueue.grantConsumeMessages(workerFunction);

    if (bedrockModelArns.length > 0) {
      const bedrockPolicy = new iam.PolicyStatement({
        sid: "AllowBedrockInvoke",
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: bedrockModelArns
      });
      apiFunction.addToRolePolicy(bedrockPolicy);
      workerFunction.addToRolePolicy(bedrockPolicy);
    }

    if (openAiApiKeySsmParameter) {
      const parameterPath = openAiApiKeySsmParameter.startsWith("/")
        ? openAiApiKeySsmParameter
        : `/${openAiApiKeySsmParameter}`;
      const parameterArn = `arn:${cdk.Aws.PARTITION}:ssm:${this.region}:${this.account}:parameter${parameterPath}`;
      const ssmReadPolicy = new iam.PolicyStatement({
        sid: "AllowReadOpenAiKeyParameter",
        actions: ["ssm:GetParameter"],
        resources: [parameterArn]
      });
      apiFunction.addToRolePolicy(ssmReadPolicy);
      workerFunction.addToRolePolicy(ssmReadPolicy);
    }

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
        allowOrigins: ["http://localhost:3000", frontendUrl]
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
      path: "/api/questions/history",
      methods: [apigwv2.HttpMethod.GET],
      integration: apiIntegration,
      authorizer: jwtAuthorizer
    });

    api.addRoutes({
      path: "/api/runtime/python",
      methods: [apigwv2.HttpMethod.POST],
      integration: apiIntegration,
      authorizer: jwtAuthorizer
    });

    api.addRoutes({
      path: "/api/runtime/python/preload",
      methods: [apigwv2.HttpMethod.POST],
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

    const apiErrorsAlarm = new cloudwatch.Alarm(this, "ApiErrorsAlarm", {
      alarmName: `${prefix}-api-errors`,
      metric: apiFunction.metricErrors({
        period: Duration.minutes(5),
        statistic: "sum"
      }),
      threshold: 1,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    apiErrorsAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    const workerErrorsAlarm = new cloudwatch.Alarm(this, "WorkerErrorsAlarm", {
      alarmName: `${prefix}-worker-errors`,
      metric: workerFunction.metricErrors({
        period: Duration.minutes(5),
        statistic: "sum"
      }),
      threshold: 1,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    workerErrorsAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    const workerThrottlesAlarm = new cloudwatch.Alarm(this, "WorkerThrottlesAlarm", {
      alarmName: `${prefix}-worker-throttles`,
      metric: workerFunction.metricThrottles({
        period: Duration.minutes(5),
        statistic: "sum"
      }),
      threshold: 1,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    workerThrottlesAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    const qaQueueBacklogAlarm = new cloudwatch.Alarm(this, "QaQueueBacklogAlarm", {
      alarmName: `${prefix}-qa-queue-backlog`,
      metric: qaQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: "max"
      }),
      threshold: 20,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    qaQueueBacklogAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    const qaDlqAlarm = new cloudwatch.Alarm(this, "QaDeadLetterQueueAlarm", {
      alarmName: `${prefix}-qa-dlq-messages`,
      metric: deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: "max"
      }),
      threshold: 1,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    qaDlqAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    const dashboard = new cloudwatch.Dashboard(this, "OperationsDashboard", {
      dashboardName: `${prefix}-operations`
    });
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Lambda Errors",
        width: 12,
        left: [apiFunction.metricErrors(), workerFunction.metricErrors()]
      }),
      new cloudwatch.GraphWidget({
        title: "SQS Queue Depth",
        width: 12,
        left: [qaQueue.metricApproximateNumberOfMessagesVisible(), deadLetterQueue.metricApproximateNumberOfMessagesVisible()]
      }),
      new cloudwatch.GraphWidget({
        title: "Lambda Duration",
        width: 12,
        left: [apiFunction.metricDuration(), workerFunction.metricDuration(), pythonRunnerFunction.metricDuration()]
      }),
      new cloudwatch.GraphWidget({
        title: "DynamoDB Throttles",
        width: 12,
        left: [
          questionsTable.metricThrottledRequestsForOperation("PutItem"),
          answersTable.metricThrottledRequestsForOperation("PutItem"),
          notebooksTable.metricThrottledRequestsForOperation("PutItem")
        ]
      })
    );

    if (createGithubDeployRole && githubRepo) {
      const githubOidcProvider = new iam.OpenIdConnectProvider(this, "GitHubOidcProvider", {
        url: "https://token.actions.githubusercontent.com",
        clientIds: ["sts.amazonaws.com"]
      });

      const githubDeployRole = new iam.Role(this, "GitHubDeployRole", {
        roleName: `${prefix}-github-deploy`,
        assumedBy: new iam.WebIdentityPrincipal(githubOidcProvider.openIdConnectProviderArn, {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
          },
          StringLike: {
            "token.actions.githubusercontent.com:sub": [
              `repo:${githubRepo}:ref:${githubRefPattern}`,
              `repo:${githubRepo}:environment:${githubEnvironmentName}`
            ]
          }
        }),
        description: "GitHub Actions OIDC role for Noema deployments"
      });
      const account = cdk.Aws.ACCOUNT_ID;
      const region = cdk.Aws.REGION;
      const bootstrapRoleArns = [
        `arn:${cdk.Aws.PARTITION}:iam::${account}:role/cdk-${cdkBootstrapQualifier}-deploy-role-${account}-${region}`,
        `arn:${cdk.Aws.PARTITION}:iam::${account}:role/cdk-${cdkBootstrapQualifier}-file-publishing-role-${account}-${region}`,
        `arn:${cdk.Aws.PARTITION}:iam::${account}:role/cdk-${cdkBootstrapQualifier}-image-publishing-role-${account}-${region}`,
        `arn:${cdk.Aws.PARTITION}:iam::${account}:role/cdk-${cdkBootstrapQualifier}-lookup-role-${account}-${region}`
      ];
      githubDeployRole.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            "cloudformation:*",
            "s3:*",
            "cloudfront:*",
            "lambda:*",
            "apigateway:*",
            "logs:*",
            "cloudwatch:*",
            "dynamodb:*",
            "sqs:*",
            "sns:*",
            "cognito-idp:*",
            "ssm:GetParameter",
            "ssm:GetParameters"
          ],
          resources: ["*"]
        })
      );
      githubDeployRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ["sts:AssumeRole"],
          resources: bootstrapRoleArns
        })
      );

      new cdk.CfnOutput(this, "GitHubDeployRoleArn", {
        value: githubDeployRole.roleArn
      });
    }

    new cdk.CfnOutput(this, "CloudFrontDomainName", {
      value: distribution.distributionDomainName
    });
    new cdk.CfnOutput(this, "CloudFrontDistributionId", {
      value: distribution.distributionId
    });

    new cdk.CfnOutput(this, "SiteBucketName", {
      value: siteBucket.bucketName
    });

    new cdk.CfnOutput(this, "NotebookBucketName", {
      value: notebookBucket.bucketName
    });
    new cdk.CfnOutput(this, "NotebooksTableName", {
      value: notebooksTable.tableName
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
    new cdk.CfnOutput(this, "QaDeadLetterQueueUrl", {
      value: deadLetterQueue.queueUrl
    });
    new cdk.CfnOutput(this, "AlarmTopicArn", {
      value: alarmTopic.topicArn
    });
    new cdk.CfnOutput(this, "CloudWatchDashboardName", {
      value: dashboard.dashboardName
    });
  }
}
