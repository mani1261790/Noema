# Noema Infra (AWS CDK)

This directory provisions production AWS infrastructure for Noema:

- Cognito User Pool + App Client
- API Gateway (HTTP API) + Lambda (API)
- SQS + Lambda (Worker)
- DynamoDB tables
- S3 buckets (site + notebooks)
- CloudFront distribution
- Optional CloudWatch alarms + operations dashboard
- Optional SNS alarm topic (optional email subscription)
- Optional GitHub OIDC deploy role

Low-cost defaults:

- DynamoDB point-in-time recovery is disabled by default
- S3 bucket versioning is disabled by default
- Access log DynamoDB writes are disabled by default
- CloudWatch alarms/dashboard/SNS are disabled by default
- Lambda log retention defaults to 1 week

## Prerequisites

- AWS CLI v2 configured with SSO profile (`noema-prod`)
- CDK bootstrap (once per account/region)

## Commands

```bash
cd infra
npm install

# use your profile and region
export AWS_PROFILE=noema-prod
export AWS_REGION=ap-northeast-3

# one-time bootstrap
npx cdk bootstrap aws://437089831576/ap-northeast-3

# synth
npm run synth

# deploy (replace with your frontend URL)
npm run deploy -- --require-approval never -c frontendUrl=https://your-frontend-domain
```

If Cognito domain prefix conflicts, deploy with:

```bash
npm run deploy -- --require-approval never -c cognitoDomainPrefix=noema-mani-auth
```

Enable alarm notification email and GitHub OIDC role (optional):

```bash
npm run deploy -- --require-approval never \
  -c frontendUrl=https://your-frontend-domain \
  -c enableOperationalMonitoring=true \
  -c alarmEmail=you@example.com \
  -c createGithubDeployRole=true \
  -c githubRepo=mani1261790/Noema \
  -c githubRefPattern=refs/heads/main
```

Enable extra durability / audit features only when needed:

```bash
npm run deploy -- --require-approval never \
  -c frontendUrl=https://your-frontend-domain \
  -c enablePointInTimeRecovery=true \
  -c enableBucketVersioning=true \
  -c enableAccessLogs=true
```

Enable AWS-only QA worker on Bedrock (recommended):

```bash
npm run deploy -- --require-approval never \
  -c frontendUrl=https://your-frontend-domain \
  -c qaModelProvider=bedrock \
  -c bedrockRegion=us-east-1 \
  -c bedrockModelSmall=amazon.nova-micro-v1:0 \
  -c adminEmails=admin@example.com \
  -c qaRateLimitMax=6 \
  -c qaRateLimitWindowMinutes=1
```

Enable OpenAI-based QA worker (optional fallback):

```bash
# store key once (SecureString)
aws ssm put-parameter \
  --name /noema/prod/openai-api-key \
  --type SecureString \
  --overwrite \
  --value '<OPENAI_API_KEY>'

npm run deploy -- --require-approval never \
  -c frontendUrl=https://your-frontend-domain \
  -c qaModelProvider=openai \
  -c openAiModelSmall=gpt-5-nano \
  -c openAiApiKeySsmParameter=/noema/prod/openai-api-key \
  -c adminEmails=admin@example.com \
  -c qaRateLimitMax=6 \
  -c qaRateLimitWindowMinutes=1
```

## Useful outputs

After deploy, note these stack outputs:

- `CloudFrontDomainName`
- `CloudFrontDistributionId`
- `HttpApiUrl`
- `CognitoUserPoolId`
- `CognitoUserPoolClientId`
- `NotebookBucketName`
- `NotebooksTableName`
- `AlarmTopicArn` (when `enableOperationalMonitoring=true`)
- `CloudWatchDashboardName` (when `enableOperationalMonitoring=true`)
- `GitHubDeployRoleArn` (when `createGithubDeployRole=true`)
