# Noema Data Model (Current + Migration)

This document reflects the real implementation and the next migration step.

## Current situation

Data is split across:

Cognito
identity

DynamoDB
questions, answers, rate limits

S3
notebook html

localStorage
progress, playground drafts, chapter-final answer drafts, api keys

## Current ER diagram

```mermaid
erDiagram
  USER ||--o{ QUESTION : asks
  QUESTION ||--|| ANSWER : has
  USER ||--o{ RATE_LIMIT : uses
  NOTEBOOK ||--o{ QUESTION : context

  USER ||--o| LOCAL_PROGRESS : browser
  NOTEBOOK ||--o{ LOCAL_PROGRESS_ITEM : browser
  USER ||--o{ LOCAL_FINAL_DRAFT : browser
  CHAPTER ||--o{ LOCAL_FINAL_DRAFT : browser
```

## Target

Move only progress to AWS

```mermaid
erDiagram
  USER ||--o{ NOTEBOOK_PROGRESS : tracks
  NOTEBOOK ||--o{ NOTEBOOK_PROGRESS : tracked_by
```

## Table design

PK userId
SK NOTEBOOK#<id>

Fields
visits
completed
completedAt

## Migration

1 read localStorage
2 send to API
3 store in DynamoDB
4 switch reads
