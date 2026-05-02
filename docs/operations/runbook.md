# Operations Runbook

## Environment URLs

- `development`: `https://d8mpxq2nx10ai.cloudfront.net/`

Notes:
- Frontend URLs are public identifiers, not secrets.
- The canonical value should also be kept in the GitHub Environment variable `NOEMA_FRONTEND_URL`.

## Daily checks

1. Confirm CI passed for latest `develop` and `main` commits.
2. Check CloudWatch error rate for API and worker Lambdas.
3. Check SQS backlog (`ApproximateNumberOfMessagesVisible`).
4. Check DynamoDB throttling metrics.
5. Check LLM usage/cost spikes (OpenAI or Bedrock).
6. Check CloudWatch dashboard `CloudWatchDashboardName`.
7. Confirm SNS alarm emails are received (if `alarmEmail` is configured).

## Deployment checklist

1. Merge to `develop` first after CI green.
2. Validate the `development` environment.
3. Promote to `main` only after the dev environment is confirmed healthy.
4. Run infra deploy workflow only when stack changes.
5. Run app deploy workflow if auto deploy was skipped or needs rerun.
6. Validate:
   - login
   - notebook page render
   - question submit / answer fetch
   - admin Q&A edit

### Infra workflow inputs (`Deploy Infra`)

- `aws_region`: usually `ap-northeast-3`
- `target_environment`: `development` or `production`
- `stack_stage`: usually `dev` for development, `prod` for production
- `frontend_url`: public frontend URL (for Cognito callback/logout), example `https://noema.example.com`
- `alarm_email` (optional): email for SNS alarm notifications
- `cognito_domain_prefix` (optional): custom Cognito domain prefix
- `create_github_deploy_role` (recommended): `true` when using `noema-<stage>-github-deploy`
- `github_repo` (required if previous is `true`): e.g. `mani1261790/Noema`
- `github_ref_pattern` (optional): trusted git ref pattern, e.g. `refs/heads/develop` or `refs/heads/main`
- `github_environment_name` (optional): GitHub Environment trust name, usually `development` or `production`
- `qa_model_provider` (optional): `auto` / `openai` / `bedrock` / `mock`
- `bedrock_region` (optional): `us-east-1` / `us-west-2` / `ap-northeast-1` / `ap-northeast-3`
- `bedrock_model_small` (required when `qa_model_provider=bedrock`): `amazon.nova-micro-v1:0` or `amazon.nova-lite-v1:0`
- `bedrock_model_mid`, `bedrock_model_large` (optional): same allowlist as above
- `openai_model_small` (optional): default `gpt-5-nano`
- `openai_model_mid`, `openai_model_large` (optional): fallback model IDs
- `openai_api_key_ssm_parameter` (optional): SSM SecureString name for OpenAI key
- `admin_emails` (optional): comma-separated admin emails
- `noema_inline_qa` (optional): `true` to process synchronously in API
- `qa_rate_limit_max` (optional): max asks per user in window (default `6`)
- `qa_rate_limit_window_minutes` (optional): rate-limit window minutes (default `1`)
- `run_cdk_bootstrap` (optional): `true` only for first-time bootstrap (default `false`)

### Static asset deploy (`Deploy Static Assets`)

- Normal operation:
  - `development` is deployed manually until the environment bootstrap is finished
  - `main` push -> `production`
- Manual fallback: run `Deploy Static Assets` workflow with inputs below.
- Manual inputs:
  - `target_environment`
  - `aws_region`
  - `site_bucket`
  - `notebook_bucket`
  - `notebooks_table`
  - `cloudfront_distribution_id`
- Required GitHub Environment variables for auto deploy:
  - `NOEMA_AWS_REGION` (usually `ap-northeast-3`)
  - `NOEMA_SITE_BUCKET` (stack output `SiteBucketName`)
  - `NOEMA_NOTEBOOK_BUCKET` (stack output `NotebookBucketName`)
  - `NOEMA_NOTEBOOKS_TABLE` (stack output `NotebooksTableName`)
  - `NOEMA_CLOUDFRONT_DISTRIBUTION_ID` (stack output `CloudFrontDistributionId`)
  - `NOEMA_STACK_STAGE` (`dev` or `prod`)
  - `NOEMA_FRONTEND_URL`
  - `NOEMA_GITHUB_REF_PATTERN`
  - `NOEMA_GITHUB_ENVIRONMENT_NAME`

## Incident: Q&A delayed

1. Verify SQS backlog.
2. Inspect worker Lambda logs.
3. If retries exhausted, inspect DLQ messages.
4. Requeue failed messages after fix.
5. Check alarm state for `*-qa-queue-backlog` and `*-qa-dlq-messages`.

## Incident: login failures

1. Check Cognito user pool health.
2. Verify callback URLs and app client settings.
3. Verify JWT audience/issuer in API Gateway authorizer.
4. Confirm Cognito domain output `CognitoDomain` is active.

## Incident: static content missing

1. Check S3 object keys for notebooks/site.
2. Invalidate CloudFront cache.
3. Re-run deploy-app workflow.

## Rollback

1. Re-deploy previous known-good commit.
2. Re-run app deploy workflow for previous artifact.
3. If infra broke, run `cdk deploy` from previous infra commit.

## Key stack outputs

- `CloudFrontDomainName`
- `CloudFrontDistributionId`
- `HttpApiUrl`
- `CognitoUserPoolId`
- `CognitoUserPoolClientId`
- `SiteBucketName`
- `NotebookBucketName`
- `NotebooksTableName`
- `AlarmTopicArn`
- `CloudWatchDashboardName`
- `GitHubDeployRoleArn` (optional)
