# AWS Setup (Owner Steps)

This guide is for the repository owner who will run production infra on AWS.

## 0. Current status (your environment)

You already completed SSO successfully for account `437089831576` with profile `noema-prod`.

```bash
aws sts get-caller-identity --profile noema-prod
```

Expected account: `437089831576`.

## 1. One-time local prerequisites

### 1.1 Install tools

- AWS CLI v2
- Node.js 20+
- npm
- GitHub account access to `mani1261790/Noema`

Check versions:

```bash
aws --version
node -v
npm -v
```

### 1.2 Clone repository and install dependencies

```bash
git clone https://github.com/mani1261790/Noema.git
cd Noema
npm ci
cd infra
npm ci
cd ..
```

## 2. Configure AWS SSO profile (one-time)

You already did this, but this is the canonical setup.

```bash
aws configure sso --profile noema-prod
```

Use these values:

- `SSO start URL`: `https://ssoins-7223a092685f44dd.portal.us-east-1.app.aws`
- `SSO region`: `us-east-1`
- `SSO registration scopes`: `sso:account:access` (default)
- Account: `437089831576`
- Role: `AdministratorAccess`
- `Default client Region`: `ap-northeast-3`
- `CLI default output format`: `json`

If you see `InvalidRequestException` at `RegisterClient`, the usual fix is correcting `SSO region` to `us-east-1`.

## 3. Daily login before any deploy

```bash
aws sso login --profile noema-prod
aws sts get-caller-identity --profile noema-prod
```

Then export environment variables in the same terminal session:

```bash
export AWS_PROFILE=noema-prod
export AWS_REGION=ap-northeast-3
export CDK_DEFAULT_ACCOUNT=437089831576
export CDK_DEFAULT_REGION=ap-northeast-3
```

## 4. Bootstrap CDK (first deploy only)

```bash
cd infra
npx cdk bootstrap aws://437089831576/ap-northeast-3
cd ..
```

If it was already bootstrapped, this is safe to re-run.

## 5. Deploy infrastructure (recommended settings)

```bash
cd infra
npm run deploy -- --require-approval never \
  -c stage=prod \
  -c frontendUrl=https://your-frontend-domain \
  -c alarmEmail=you@example.com \
  -c cognitoDomainPrefix=noema-prod-auth \
  -c createGithubDeployRole=true \
  -c githubRepo=mani1261790/Noema \
  -c githubRefPattern=refs/heads/main
cd ..
```

Notes:

- Replace `https://your-frontend-domain` with your actual CloudFront/app domain.
- `alarmEmail` is optional but strongly recommended.
- `createGithubDeployRole=true` is only needed when creating the GitHub OIDC role.

## 5.1 AWS-only QA (Bedrock, recommended)

No external API key is required. Deploy with Bedrock as primary provider:

```bash
cd infra
npm run deploy -- --require-approval never \
  -c stage=prod \
  -c frontendUrl=https://your-frontend-domain \
  -c qaModelProvider=bedrock \
  -c bedrockRegion=us-east-1 \
  -c bedrockModelSmall=amazon.nova-micro-v1:0 \
  -c adminEmails=admin@example.com \
  -c noemaInlineQa=false \
  -c qaRateLimitMax=6 \
  -c qaRateLimitWindowMinutes=1
cd ..
```

## 5.2 Configure OpenAI key in SSM (optional fallback)

Store your OpenAI key as SSM SecureString (avoid plaintext in deploy args):

```bash
aws ssm put-parameter \
  --name /noema/prod/openai-api-key \
  --type SecureString \
  --overwrite \
  --value '<OPENAI_API_KEY>'
```

Then deploy with QA model context:

```bash
cd infra
npm run deploy -- --require-approval never \
  -c stage=prod \
  -c frontendUrl=https://your-frontend-domain \
  -c qaModelProvider=openai \
  -c openAiModelSmall=gpt-5-nano \
  -c openAiApiKeySsmParameter=/noema/prod/openai-api-key \
  -c adminEmails=admin@example.com \
  -c noemaInlineQa=false \
  -c qaRateLimitMax=6 \
  -c qaRateLimitWindowMinutes=1
cd ..
```

## 6. Read stack outputs you need for app deploy

```bash
aws cloudformation describe-stacks \
  --stack-name noema-prod \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' \
  --output table
```

Important outputs:

- `SiteBucketName`
- `NotebookBucketName`
- `CloudFrontDistributionId`
- `CloudFrontDomainName`
- `HttpApiUrl`
- `GitHubDeployRoleArn` (only if OIDC role creation was enabled)

## 7. Configure GitHub Actions secret/variables

Repository secret required:

- `AWS_DEPLOY_ROLE_ARN` = output `GitHubDeployRoleArn`

GitHub UI path:

- `Noema` repo -> `Settings` -> `Secrets and variables` -> `Actions`

Repository variables required for automatic static deploy:

- `NOEMA_AWS_REGION` = `ap-northeast-3`
- `NOEMA_SITE_BUCKET` = output `SiteBucketName`
- `NOEMA_NOTEBOOK_BUCKET` = output `NotebookBucketName`
- `NOEMA_NOTEBOOKS_TABLE` = output `NotebooksTableName`
- `NOEMA_CLOUDFRONT_DISTRIBUTION_ID` = output `CloudFrontDistributionId`

Optional but recommended:

- Create GitHub Environment `production` and require reviewer approval for deploy workflows.

## 8. Deploy static assets from GitHub Actions

After step 7, static assets are deployed automatically on `main` push when app/content files change.

Manual fallback: run workflow `Deploy Static Assets` with:

- `aws_region`: `ap-northeast-3`
- `site_bucket`: `SiteBucketName`
- `notebook_bucket`: `NotebookBucketName`
- `notebooks_table`: stack output table name (usually `noema-prod-notebooks`)
- `cloudfront_distribution_id`: `CloudFrontDistributionId`

Run workflow `Deploy Infra` with `run_cdk_bootstrap=false` for normal deploys.
Set `run_cdk_bootstrap=true` only when CDK bootstrap is not initialized yet.

## 9. Smoke checks after deploy

### 9.1 Frontend

```bash
curl -I https://<CloudFrontDomainName>
```

Expect HTTP `200` or `304`.

### 9.2 API health

```bash
curl -sS <HttpApiUrl>/health
```

Expect JSON response (health check payload).

### 9.3 Alarm subscription confirmation

If `alarmEmail` was set, confirm the SNS subscription email and verify status is `Confirmed`.

## 10. Common errors and fixes

### `InvalidRequestException` during `aws configure sso`

- Cause: wrong `SSO region`.
- Fix: re-run with `SSO region=us-east-1`.

### `The security token included in the request is invalid`

- Cause: SSO session expired.
- Fix:

```bash
aws sso login --profile noema-prod
```

### `NoCredentialProviders` from CDK/AWS CLI

- Cause: `AWS_PROFILE` not set in current shell.
- Fix:

```bash
export AWS_PROFILE=noema-prod
```

### GitHub Actions cannot assume role

- Check `AWS_DEPLOY_ROLE_ARN` secret value.
- Check `githubRepo` and `githubRefPattern` used when role was created.
- Check workflow branch matches `githubRefPattern`.
