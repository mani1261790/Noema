# 教材デュアルレビュー（初学者視点 + 専門家視点）

- 実施日: 2026-02-18
- 対象: content/notebooks/*.ipynb (57件)

## 初学者視点の主要指摘

1. 多くのノートで、最初の実験セルに入る前の概念定義が不足しており、変数や記号の意味を推測させてしまう。
2. 用語（例: 価値関数、自己注意、KL項、RAG）が先に登場し、最低限の直感説明が後回しになっている。
3. 「何を確認する実験か」は書かれているが、「その実験で何を見れば理解したことになるか」が曖昧な箇所がある。

## 専門家視点の主要指摘

1. 数式とコードの対応関係が先に宣言されていないため、記号の読解で誤解が生じうる。
2. アルゴリズム間の差分（オン/オフポリシー、近似/厳密など）を前提知識として扱っている箇所がある。
3. 教材としては正確でも、初学者に必要な「厳密さの入口（定義語彙）」が不足していた。

## 対応方針と実施内容

- 全57ノートの先頭に `## 概念の土台` セクションを追加。
- 章共通の基礎語彙（3語）+ ノート固有の重要語彙（2〜3語）を定義。
- 実験に入る前に、変数・式と概念を対応づける読み方を明示。
- 各ノートで4語以上の定義を必須化。

## ノート別適用結果

### Python
- python-basic-operations: 概念の土台を追加・更新済み
- numpy-basics: 概念の土台を追加・更新済み
- pandas-basics: 概念の土台を追加・更新済み
- matplotlib-seaborn: 概念の土台を追加・更新済み

### 機械学習
- simple-regression: 概念の土台を追加・更新済み
- multiple-regression: 概念の土台を追加・更新済み
- sklearn-xgboost: 概念の土台を追加・更新済み
- feature-engineering: 概念の土台を追加・更新済み
- supervised-unsupervised-learning: 概念の土台を追加・更新済み
- time-series-data: 概念の土台を追加・更新済み
- sql-for-ml: 概念の土台を追加・更新済み

### ディープラーニング
- neural-network-basics: 概念の土台を追加・更新済み
- loss-and-gradient-descent: 概念の土台を追加・更新済み
- optimization-regularization: 概念の土台を追加・更新済み
- convolution-basics: 概念の土台を追加・更新済み
- image-recognition-yolo: 概念の土台を追加・更新済み
- recurrent-neural-networks: 概念の土台を追加・更新済み
- transformer-basics: 概念の土台を追加・更新済み
- nlp-deep-learning: 概念の土台を追加・更新済み

### 強化学習
- rl-foundation: 概念の土台を追加・更新済み
- value-function: 概念の土台を追加・更新済み
- bellman-equations: 概念の土台を追加・更新済み
- policy-iteration: 概念の土台を追加・更新済み
- value-iteration: 概念の土台を追加・更新済み
- td-learning: 概念の土台を追加・更新済み
- q-learning: 概念の土台を追加・更新済み
- sarsa: 概念の土台を追加・更新済み
- n-step-td: 概念の土台を追加・更新済み
- td-lambda: 概念の土台を追加・更新済み
- eligibility-trace-td-lambda: 概念の土台を追加・更新済み
- deep-rl: 概念の土台を追加・更新済み

### LLM
- prompt-engineering: 概念の土台を追加・更新済み
- llm-pretraining: 概念の土台を追加・更新済み
- scaling-laws: 概念の土台を追加・更新済み
- fine-tuning: 概念の土台を追加・更新済み
- hallucination-rlhf: 概念の土台を追加・更新済み
- tool-use-rag: 概念の土台を追加・更新済み
- domain-specialization: 概念の土台を追加・更新済み
- llm-efficiency: 概念の土台を追加・更新済み

### 深層生成モデル
- generative-model-overview: 概念の土台を追加・更新済み
- latent-variable-mixture-models: 概念の土台を追加・更新済み
- vae: 概念の土台を追加・更新済み
- gan: 概念の土台を追加・更新済み
- autoregressive-flow-models: 概念の土台を追加・更新済み
- energy-based-models: 概念の土台を追加・更新済み
- score-diffusion-models: 概念の土台を追加・更新済み
- continuous-diffusion-flow-matching: 概念の土台を追加・更新済み

### 世界モデル
- world-models-and-generative-models: 概念の土台を追加・更新済み
- control-model-and-mbrl: 概念の土台を追加・更新済み
- state-space-models: 概念の土台を追加・更新済み
- state-representation-learning: 概念の土台を追加・更新済み
- state-prediction-models: 概念の土台を追加・更新済み
- vae-diffusion-world-models: 概念の土台を追加・更新済み
- simulation-and-cg: 概念の土台を追加・更新済み
- ssm-and-transformer: 概念の土台を追加・更新済み
- observation-prediction-models: 概念の土台を追加・更新済み
- multimodal-world-models: 概念の土台を追加・更新済み

## 自動検証

- check-notebook-code: pass (57/57)
- check-notebook-isolated-run: pass (57/57)
- build:notebooks: pass

