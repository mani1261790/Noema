# 運用 runbook

## 環境 URL

- `development`: `https://d8mpxq2nx10ai.cloudfront.net/`

注意:

- フロントエンド URL は公開識別子であり、秘密情報ではありません。
- 正の値は GitHub Environment 変数 `NOEMA_FRONTEND_URL` にも保持します。

## 日次確認

1. 最新の `develop` と `main` の CI が成功していることを確認する。
2. API Lambda と worker Lambda の CloudWatch エラー率を見る。
3. SQS backlog（`ApproximateNumberOfMessagesVisible`）を見る。
4. DynamoDB throttling メトリクスを見る。
5. LLM 利用量とコストの急増を確認する（OpenAI または Bedrock）。
6. CloudWatch ダッシュボード `CloudWatchDashboardName` を確認する。
7. `alarmEmail` を設定している場合は、SNS アラームメールが届いていることを確認する。

## デプロイチェックリスト

1. CI が green になった後、まず `develop` に merge する。
2. `development` 環境を検証する。
3. dev 環境が健全であることを確認してから `main` に昇格する。
4. スタック変更がある場合だけ infra deploy workflow を実行する。
5. 自動デプロイがスキップされた、または再実行が必要な場合は app deploy workflow を実行する。
6. 次を検証する。
   - login
   - notebook page render
   - 質問送信 / 回答取得
   - admin Q&A edit

### Infra workflow の入力（`Deploy Infra`）

- `aws_region`: 通常は `ap-northeast-3`
- `target_environment`: `development` または `production`
- `stack_stage`: 通常は development なら `dev`、production なら `prod`
- `frontend_url`: 公開フロントエンド URL（Cognito callback/logout 用）。例: `https://noema.example.com`
- `alarm_email`（任意）: SNS アラーム通知用メールアドレス
- `cognito_domain_prefix`（任意）: Cognito のカスタムドメイン prefix
- `create_github_deploy_role`（推奨）: `noema-<stage>-github-deploy` を使う場合は `true`
- `github_repo`（上記が `true` の場合は必須）: 例 `mani1261790/Noema`
- `github_ref_pattern`（任意）: 信頼する git ref pattern。例 `refs/heads/develop` または `refs/heads/main`
- `github_environment_name`（任意）: 信頼する GitHub Environment 名。通常は `development` または `production`
- `qa_model_provider`（任意）: `auto` / `openai` / `bedrock` / `mock`
- `bedrock_region`（任意）: `us-east-1` / `us-west-2` / `ap-northeast-1` / `ap-northeast-3`
- `bedrock_model_small`（`qa_model_provider=bedrock` の場合は必須）: `amazon.nova-micro-v1:0` または `amazon.nova-lite-v1:0`
- `bedrock_model_mid`, `bedrock_model_large`（任意）: 上と同じ allowlist
- `openai_model_small`（任意）: 既定値 `gpt-5-nano`
- `openai_model_mid`, `openai_model_large`（任意）: fallback model ID
- `openai_api_key_ssm_parameter`（任意）: OpenAI key を保存した SSM SecureString 名
- `admin_emails`（任意）: カンマ区切りの管理者メールアドレス
- `noema_inline_qa`（任意）: API 内で同期処理する場合は `true`
- `qa_rate_limit_max`（任意）: window 内でユーザーが質問できる最大数（既定値 `6`）
- `qa_rate_limit_window_minutes`（任意）: rate-limit window の分数（既定値 `1`）
- `run_cdk_bootstrap`（任意）: 初回 bootstrap の場合だけ `true`（既定値 `false`）

### 静的アセットデプロイ（`Deploy Static Assets`）

- 通常運用:
  - `development` は環境 bootstrap が完了するまで手動デプロイする
  - `main` push -> `production`
- 手動 fallback: 以下の入力で `Deploy Static Assets` workflow を実行する。
- 手動入力:
  - `target_environment`
  - `aws_region`
  - `site_bucket`
  - `notebook_bucket`
  - `notebooks_table`
  - `cloudfront_distribution_id`
- 自動デプロイに必要な GitHub Environment 変数:
  - `NOEMA_AWS_REGION`（通常は `ap-northeast-3`）
  - `NOEMA_SITE_BUCKET`（stack output `SiteBucketName`）
  - `NOEMA_NOTEBOOK_BUCKET`（stack output `NotebookBucketName`）
  - `NOEMA_NOTEBOOKS_TABLE`（stack output `NotebooksTableName`）
  - `NOEMA_CLOUDFRONT_DISTRIBUTION_ID`（stack output `CloudFrontDistributionId`）
  - `NOEMA_STACK_STAGE`（`dev` または `prod`）
  - `NOEMA_FRONTEND_URL`
  - `NOEMA_GITHUB_REF_PATTERN`
  - `NOEMA_GITHUB_ENVIRONMENT_NAME`

## インシデント: Q&A が遅延している

1. SQS backlog を確認する。
2. worker Lambda のログを見る。
3. retry が尽きている場合は DLQ message を確認する。
4. 修正後、失敗 message を再投入する。
5. `*-qa-queue-backlog` と `*-qa-dlq-messages` のアラーム状態を見る。

## インシデント: login 失敗

1. Cognito user pool の状態を確認する。
2. callback URL と app client 設定を確認する。
3. API Gateway authorizer の JWT audience/issuer を確認する。
4. Cognito domain output `CognitoDomain` が有効であることを確認する。

## インシデント: 静的コンテンツが見つからない

1. notebook/site の S3 object key を確認する。
2. CloudFront cache を invalidate する。
3. deploy-app workflow を再実行する。

## ロールバック

1. 直近で動作確認済みの commit を再デプロイする。
2. 以前の artifact に対して app deploy workflow を再実行する。
3. infra が壊れた場合は、以前の infra commit から `cdk deploy` を実行する。

## 主要 stack output

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
- `GitHubDeployRoleArn`（任意）
