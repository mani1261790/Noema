# Noema Data Model (MVP)

## 1. DynamoDB Tables

## users

- PK: `USER#<userId>`
- Attributes:
- `email`
- `role` (`admin` | `member`)
- `createdAt`
- `lastLoginAt`

## notebooks

- PK: `NOTEBOOK#<notebookId>`
- SK: `META`
- Attributes:
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
- Attributes:
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
- Attributes:
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
- Attributes:
- `questionId`
- `answerSnapshot`
- `expiresAt` (TTL)

## audit_logs

- PK: `LOG#<date>`
- SK: `<timestamp>#<type>#<id>`
- Attributes:
- `actorId`
- `action`
- `payload`

## 2. Retrieval Index

OpenSearch または pgvector を利用。

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
- 高頻度質問は TTL 延長

## 4. 監査・分析

- CloudWatch Logs: API/Lambda 監査
- Athena or OpenSearch Dashboards: 学習統計とアクセス分析
