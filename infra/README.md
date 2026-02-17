# Noema Infra (AWS CDK)

This directory provisions production AWS infrastructure for Noema:

- Cognito User Pool + App Client
- API Gateway (HTTP API) + Lambda (API)
- SQS + Lambda (Worker)
- DynamoDB tables
- S3 buckets (site + notebooks)
- CloudFront distribution

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

## Useful outputs

After deploy, note these stack outputs:

- `CloudFrontDomainName`
- `HttpApiUrl`
- `CognitoUserPoolId`
- `CognitoUserPoolClientId`
- `NotebookBucketName`
