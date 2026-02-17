# AWS Setup (Owner Steps)

## Prerequisites

- AWS account access
- IAM Identity Center user assigned to target account/role
- AWS CLI v2 installed

## Verify CLI + SSO

```bash
aws --version
aws configure sso --profile noema-prod
aws sso login --profile noema-prod
aws sts get-caller-identity --profile noema-prod
```

Expected: JSON with your `Account` and assumed role ARN.

## Configure shell for deploy

```bash
export AWS_PROFILE=noema-prod
export AWS_REGION=ap-northeast-3
export CDK_DEFAULT_ACCOUNT=437089831576
export CDK_DEFAULT_REGION=ap-northeast-3
```

## Bootstrap and deploy infra

```bash
cd infra
npm install
npx cdk bootstrap aws://437089831576/ap-northeast-3
npm run deploy -- --require-approval never -c frontendUrl=https://your-frontend-domain
```

## Deploy with monitoring + GitHub OIDC role (recommended)

```bash
npm run deploy -- --require-approval never \
  -c frontendUrl=https://your-frontend-domain \
  -c alarmEmail=you@example.com \
  -c createGithubDeployRole=true \
  -c githubRepo=mani1261790/Noema \
  -c githubRefPattern=refs/heads/main
```

## Required GitHub secret

For GitHub Actions deploy workflows, add repository secret:

- `AWS_DEPLOY_ROLE_ARN`

Set this to stack output `GitHubDeployRoleArn` (if you enabled `createGithubDeployRole=true`).

This role must trust GitHub OIDC and have permissions for CDK deploy + app artifact publish.
