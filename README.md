# Noema

Noema is a learning platform for beginners studying machine learning, LLMs, reinforcement learning, and world models.

It combines three things in one place:

- notebook-based course materials
- in-context question answering tied to each lesson
- browser-based Python execution for lightweight experimentation

## What Noema Does

- Serves lesson content from Jupyter notebooks
- Lets learners open the same material in Colab
- Answers questions with notebook-aware context
- Runs Python snippets without requiring local setup
- Keeps infrastructure mostly serverless to reduce operating cost

## Learning Flow

```mermaid
flowchart LR
  A["Learner opens a lesson"] --> B["Notebook source is rendered as lesson content"]
  B --> C["Learner reads, runs code, or opens Colab"]
  C --> D["Learner asks a question"]
  D --> E["Noema retrieves notebook-linked context"]
  E --> F["LLM generates an answer"]
  F --> G["Answer is shown with lesson context"]
```

## System Overview

```mermaid
flowchart TD
  A["content/notebooks/*.ipynb"] --> B["Static lesson pages"]
  A --> C["Notebook metadata"]
  B --> D["Learner UI"]
  C --> D
  D --> E["API Gateway + Lambda"]
  E --> F["DynamoDB"]
  E --> G["Python runner"]
  E --> H["LLM provider"]
  H --> I["Amazon Bedrock or OpenAI"]
  B --> J["S3 + CloudFront"]
  D --> K["Cognito login"]
```

## Repository Structure

- `content/notebooks`: lesson source notebooks
- `content/catalog.json`: lesson catalog and ordering
- `public`: generated public assets
- `src`: app shell and shared logic
- `infra`: AWS CDK infrastructure
- `docs`: architecture and operations notes

## For Learners

The repository is public because the curriculum itself is part of the product.  
The source of truth for lessons lives in `content/notebooks`, and the platform is built around keeping those notebooks easy to inspect, improve, and reuse.

## For Contributors

### Content Pipeline

```mermaid
flowchart LR
  A["Edit ipynb in content/notebooks"] --> B["Update content/catalog.json if needed"]
  B --> C["Build notebook artifacts"]
  C --> D["Review rendered lesson output"]
  D --> E["Deploy app and infrastructure"]
```

### Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

Useful commands:

- `npm run build`
- `npm run build:notebooks`
- `npm run typecheck`
- `python3 scripts/check-notebook-code.py`

If you need AWS infrastructure details, see `infra/README.md`.  
If you need deeper system notes, see:

- `docs/system-architecture.md`
- `docs/operations/aws-setup.md`
- `docs/operations/dev-loop.md`
- `docs/operations/runbook.md`
