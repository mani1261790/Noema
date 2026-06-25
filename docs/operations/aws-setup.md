# AWS セットアップ（Owner 手順）

この手順は、Noema のインフラを AWS 上で運用するリポジトリ owner 向けです。

## 0. 現在の状態（この環境）

アカウント `437089831576`、profile `noema-prod` で SSO は完了済みです。

```bash
aws sts get-caller-identity --profile noema-prod
```

期待する account: `437089831576`

## 1. 初回だけ必要なローカル準備

### 1.1 ツールのインストール

- AWS CLI v2
- Node.js 20+
- npm
- `mani1261790/Noema` にアクセスできる GitHub account

バージョン確認:

```bash
aws --version
node -v
npm -v
```

### 1.2 リポジトリを clone して依存関係を入れる

```bash
git clone https://github.com/mani1261790/Noema.git
cd Noema
npm ci
cd infra
npm ci
cd ..
```

## 2. AWS SSO profile を設定する（初回のみ）

すでに実施済みですが、標準手順は次です。

```bash
aws configure sso --profile noema-prod
```

入力値:

- `SSO start URL`: `https://ssoins-7223a092685f44dd.portal.us-east-1.app.aws`
- `SSO region`: `us-east-1`
- `SSO registration scopes`: `sso:account:access`（既定値）
- Account: `437089831576`
- Role: `AdministratorAccess`
- `Default client Region`: `ap-northeast-3`
- `CLI default output format`: `json`

`RegisterClient` で `InvalidRequestException` が出る場合、多くは `SSO region` が `us-east-1` になっていないことが原因です。

## 3. デプロイ前の日次ログイン

```bash
aws sso login --profile noema-prod
aws sts get-caller-identity --profile noema-prod
```

同じターミナルセッションで環境変数を設定します。

```bash
export AWS_PROFILE=noema-prod
export AWS_REGION=ap-northeast-3
export CDK_DEFAULT_ACCOUNT=437089831576
export CDK_DEFAULT_REGION=ap-northeast-3
```

## 4. CDK bootstrap（初回デプロイ時のみ）

```bash
cd infra
npx cdk bootstrap aws://437089831576/ap-northeast-3
cd ..
```

すでに bootstrap 済みでも、再実行して問題ありません。

## 5. インフラをデプロイする（推奨設定）

推奨 stage:

- `dev` -> GitHub Environment `development`, branch `develop`
- `prod` -> GitHub Environment `production`, branch `main`

```bash
cd infra
npm run deploy -- --require-approval never \
  -c stage=prod \
  -c frontendUrl=https://your-frontend-domain \
  -c alarmEmail=you@example.com \
  -c cognitoDomainPrefix=noema-prod-auth \
  -c createGithubDeployRole=true \
  -c githubRepo=mani1261790/Noema \
  -c githubRefPattern=refs/heads/main \
  -c githubEnvironmentName=production
cd ..
```

注意:

- `https://your-frontend-domain` は実際の CloudFront/app domain に置き換えます。
- `alarmEmail` は任意ですが、設定を推奨します。
- GitHub Actions が stack 管理の deploy role（`noema-<stage>-github-deploy`）を使う場合、role 削除を避けるため infra deploy では `createGithubDeployRole=true` を維持します。
- `githubEnvironmentName` は workflow の environment 名（既定値 `production`）と合わせます。

### 5.0 development 用の別 stack を作る

`develop` からの自動デプロイを有効にする前に、development 用の2つ目の stack をデプロイします。

```bash
cd infra
npm run deploy -- --require-approval never \
  -c stage=dev \
  -c frontendUrl=https://your-dev-frontend-domain \
  -c cognitoDomainPrefix=noema-dev-auth \
  -c createGithubDeployRole=true \
  -c githubRepo=mani1261790/Noema \
  -c githubRefPattern=refs/heads/develop \
  -c githubEnvironmentName=development
cd ..
```

これで `noema-dev` stack と対応する deploy role が作られます。

## 5.1 AWS だけで Q&A を動かす（Bedrock 推奨）

外部 API key は不要です。Bedrock を primary provider としてデプロイします。

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

## 5.2 OpenAI key を SSM に設定する（任意 fallback）

OpenAI key は SSM SecureString として保存します。デプロイ引数に平文で渡さないでください。

```bash
aws ssm put-parameter \
  --name /noema/prod/openai-api-key \
  --type SecureString \
  --overwrite \
  --value '<OPENAI_API_KEY>'
```

その後、QA model context を指定してデプロイします。

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

## 6. アプリデプロイに必要な stack output を読む

```bash
aws cloudformation describe-stacks \
  --stack-name noema-prod \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' \
  --output table
```

重要な output:

- `SiteBucketName`
- `NotebookBucketName`
- `CloudFrontDistributionId`
- `CloudFrontDomainName`
- `HttpApiUrl`
- `GitHubDeployRoleArn`（OIDC role 作成を有効にした場合のみ）

development 環境を接続するときは、`noema-dev` に対しても同じコマンドを実行します。

## 7. GitHub Actions の secret / variable を設定する

各 GitHub Environment に必要な GitHub Actions secret:

- `AWS_DEPLOY_ROLE_ARN`

推奨設定:

- GitHub Environment `production`: `AWS_DEPLOY_ROLE_ARN` に `noema-prod` output の `GitHubDeployRoleArn` を設定
- GitHub Environment `development`: `AWS_DEPLOY_ROLE_ARN` に `noema-dev` output の `GitHubDeployRoleArn` を設定

GitHub UI path:

- `Noema` repo -> `Settings` -> `Secrets and variables` -> `Actions`

各 GitHub Environment の自動デプロイに必要な environment variable:

- `NOEMA_AWS_REGION` = `ap-northeast-3`
- `NOEMA_SITE_BUCKET` = output `SiteBucketName`
- `NOEMA_NOTEBOOK_BUCKET` = output `NotebookBucketName`
- `NOEMA_NOTEBOOKS_TABLE` = output `NotebooksTableName`
- `NOEMA_CLOUDFRONT_DISTRIBUTION_ID` = output `CloudFrontDistributionId`
- `NOEMA_STACK_STAGE` = `dev` または `prod`
- `NOEMA_FRONTEND_URL` = 環境ごとの frontend origin
- `NOEMA_GITHUB_REF_PATTERN` = development は `refs/heads/develop`、production は `refs/heads/main`
- `NOEMA_GITHUB_ENVIRONMENT_NAME` = `development` または `production`

任意ですが推奨:

- GitHub Environments `development` と `production` を作成する。
- reviewer approval は `production` だけ必須にする。

## 8. GitHub Actions から静的アセットをデプロイする

手順 7 の後:

- development 環境が完全に接続されるまでは、`development` は manual workflow dispatch を使う
- `main` への push は `production` へデプロイする

手動 fallback: workflow `Deploy Static Assets` を次の入力で実行します。

- `target_environment`: `development` または `production`
- `aws_region`: `ap-northeast-3`
- `site_bucket`: `SiteBucketName`
- `notebook_bucket`: `NotebookBucketName`
- `notebooks_table`: stack output の table name（通常 `noema-prod-notebooks`）
- `cloudfront_distribution_id`: `CloudFrontDistributionId`

workflow `Deploy Infra` は次の入力で実行します。

- `target_environment=development`: `noema-dev` を更新する場合
- `target_environment=production`: `noema-prod` を更新する場合

通常のデプロイでは `run_cdk_bootstrap=false` のままにします。
CDK bootstrap がまだ初期化されていない場合だけ `run_cdk_bootstrap=true` にします。

## 9. デプロイ後の smoke check

### 9.1 フロントエンド

```bash
curl -I https://<CloudFrontDomainName>
```

期待値: HTTP `200` または `304`

### 9.2 API health

```bash
curl -sS <HttpApiUrl>/health
```

期待値: JSON response（health check payload）

### 9.3 Alarm subscription confirmation

`alarmEmail` を設定した場合は、SNS subscription email を承認し、status が `Confirmed` になっていることを確認します。

## 10. よくあるエラーと修正

### `aws configure sso` 中の `InvalidRequestException`

- 原因: `SSO region` が誤っている。
- 修正: `SSO region=us-east-1` で再実行する。

### `The security token included in the request is invalid`

- 原因: SSO session が期限切れ。
- 修正:

```bash
aws sso login --profile noema-prod
```

### CDK/AWS CLI の `NoCredentialProviders`

- 原因: 現在の shell で `AWS_PROFILE` が設定されていない。
- 修正:

```bash
export AWS_PROFILE=noema-prod
```

### GitHub Actions が role を assume できない

- `AWS_DEPLOY_ROLE_ARN` secret の値を確認する。
- role 作成時に使った `githubRepo` と `githubRefPattern` を確認する。
- workflow の branch が `githubRefPattern` と一致していることを確認する。
