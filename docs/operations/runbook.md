# Operations Runbook

## Daily checks

1. Confirm CI passed for latest `main` commit.
2. Check CloudWatch error rate for API and worker Lambdas.
3. Check SQS backlog (`ApproximateNumberOfMessagesVisible`).
4. Check DynamoDB throttling metrics.
5. Check Bedrock usage/cost spikes.

## Deployment checklist

1. Merge to `main` only after CI green.
2. Run infra deploy workflow (if stack changes).
3. Run app deploy workflow.
4. Validate:
   - login
   - notebook page render
   - question submit / answer fetch
   - admin Q&A edit

### Infra workflow inputs (`Deploy Infra`)

- `aws_region`: usually `ap-northeast-3`
- `stack_stage`: usually `prod`
- `frontend_url`: public frontend URL (for Cognito callback/logout), example `https://noema.example.com`

### Static asset workflow inputs (`Deploy Static Assets`)

- `aws_region`: usually `ap-northeast-3`
- `site_bucket`: stack output `SiteBucketName`
- `notebook_bucket`: stack output `NotebookBucketName`
- `cloudfront_distribution_id`: CloudFront distribution ID from AWS Console (Distribution detail page)

## Incident: Q&A delayed

1. Verify SQS backlog.
2. Inspect worker Lambda logs.
3. If retries exhausted, inspect DLQ messages.
4. Requeue failed messages after fix.

## Incident: login failures

1. Check Cognito user pool health.
2. Verify callback URLs and app client settings.
3. Verify JWT audience/issuer in API Gateway authorizer.

## Incident: static content missing

1. Check S3 object keys for notebooks/site.
2. Invalidate CloudFront cache.
3. Re-run deploy-app workflow.

## Rollback

1. Re-deploy previous known-good commit.
2. Re-run app deploy workflow for previous artifact.
3. If infra broke, run `cdk deploy` from previous infra commit.
