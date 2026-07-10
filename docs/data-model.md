# Noema データモデル（MVP）

## 1. DynamoDB テーブル

## users

- PK: `USER#<userId>`
- 属性:
- `email`
- `role` (`admin` | `member`)
- `createdAt`
- `lastLoginAt`

## notebooks

- PK: `NOTEBOOK#<notebookId>`
- SK: `META`
- 属性:
- `title`
- `chapter`
- `order`
- `tags` (string[])
- `htmlPath` (S3 key)
- `colabUrl`
- `videoUrl`
- `updatedAt`

## questions

- PK: `QUESTION#<questionId>`
- SK: `META`
- GSI1PK: `USER#<userId>`
- GSI1SK: `createdAt`
- GSI2PK: `NOTEBOOK#<notebookId>`
- GSI2SK: `createdAt`
- 属性:
- `userId`
- `notebookId`
- `sectionId`
- `questionText`
- `questionHash` (normalized hash)
- `status` (`QUEUED` | `PROCESSING` | `COMPLETED` | `FAILED`)
- `createdAt`

## answers

- PK: `QUESTION#<questionId>`
- SK: `ANSWER#v1`
- 属性:
- `answerText`
- `sourceReferences` (json)
- `tokensPrompt`
- `tokensCompletion`
- `modelId`
- `latencyMs`
- `createdAt`

## question_cache

- PK: `QHASH#<questionHash>`
- SK: `NOTEBOOK#<notebookId>#SECTION#<sectionId>`
- 属性:
- `questionId`
- `answerSnapshot`
- `expiresAt` (TTL)

## audit_logs

- PK: `LOG#<date>`
- SK: `<timestamp>#<type>#<id>`
- 属性:
- `actorId`
- `action`
- `payload`

## 2. 検索インデックス

OpenSearch または pgvector を利用します。

1ドキュメント（チャンク）例:

- `chunkId`
- `notebookId`
- `sectionId`
- `text`
- `embedding`
- `position`
- `title`
- `tags`

## 3. キャッシュ方針

- キー: `normalized(questionText) + notebookId + sectionId`
- TTL: 7日（初期値）
- 高頻度質問は TTL を延長

## 4. 監査・分析

- CloudWatch Logs: API/Lambda 監査
- Athena または OpenSearch Dashboards: 学習統計とアクセス分析
