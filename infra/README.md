# Noema Infra (AWS CDK)

This directory provisions production AWS infrastructure for Noema:

- Cognito User Pool + App Client
- API Gateway (HTTP API) + Lambda (API)
- SQS + Lambda (Worker)
- DynamoDB tables
- S3 buckets (site + notebooks)
- CloudFront distribution
- CloudWatch alarms + operations dashboard
- SNS alarm topic (optional email subscription)
- Optional GitHub OIDC deploy role

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
  -c alarmEmail=you@example.com \
  -c createGithubDeployRole=true \
  -c githubRepo=mani1261790/Noema \
  -c githubRefPattern=refs/heads/main
```

Enable OpenAI-based QA worker (recommended low-cost setup):

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
  -c adminEmails=admin@example.com
```

## Useful outputs

After deploy, note these stack outputs:

- `CloudFrontDomainName`
- `CloudFrontDistributionId`
- `HttpApiUrl`
- `CognitoUserPoolId`
- `CognitoUserPoolClientId`
- `NotebookBucketName`
- `AlarmTopicArn`
- `CloudWatchDashboardName`
- `GitHubDeployRoleArn` (when `createGithubDeployRole=true`)
