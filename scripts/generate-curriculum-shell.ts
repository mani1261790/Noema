import { promises as fs } from "fs";
import path from "path";

type NotebookSpec = {
  id: string;
  title: string;
  tags: string[];
};

type ChapterSpec = {
  id: string;
  title: string;
  notebooks: NotebookSpec[];
};

type CatalogNotebook = {
  id: string;
  title: string;
  order: number;
  tags: string[];
  htmlPath: string;
  colabUrl: string;
};

type CatalogChapter = {
  id: string;
  title: string;
  order: number;
  notebooks: CatalogNotebook[];
};

type Catalog = {
  chapters: CatalogChapter[];
};

type NotebookCell = {
  cell_type: "markdown" | "code";
  metadata: Record<string, unknown>;
  source: string[];
  execution_count?: number | null;
  outputs?: unknown[];
};

type NotebookFile = {
  cells: NotebookCell[];
  metadata: {
    kernelspec: {
      display_name: string;
      language: string;
      name: string;
    };
    language_info: {
      name: string;
    };
  };
  nbformat: number;
  nbformat_minor: number;
};

const COLAB_BASE = "https://colab.research.google.com/github/mani1261790/Noema/blob/main/content/notebooks";

const chapters: ChapterSpec[] = [
  {
    id: "python",
    title: "Python",
    notebooks: [
      { id: "python-basic-operations", title: "基本的なPythonの操作", tags: ["python", "basics", "syntax"] },
      { id: "numpy-basics", title: "NumPyの使い方", tags: ["python", "numpy", "array"] },
      { id: "pandas-basics", title: "Pandasの使い方", tags: ["python", "pandas", "dataframe"] },
      {
        id: "matplotlib-seaborn",
        title: "MatplotlibとSeabornの使い方",
        tags: ["python", "matplotlib", "seaborn", "visualization"]
      }
    ]
  },
  {
    id: "machine-learning",
    title: "機械学習",
    notebooks: [
      { id: "simple-regression", title: "単回帰分析", tags: ["machine-learning", "regression", "linear"] },
      { id: "multiple-regression", title: "重回帰分析", tags: ["machine-learning", "regression", "multivariate"] },
      {
        id: "sklearn-xgboost",
        title: "scikit-learnとXGBoostの使い方",
        tags: ["machine-learning", "sklearn", "xgboost"]
      },
      {
        id: "feature-engineering",
        title: "特徴量エンジニアリング",
        tags: ["machine-learning", "feature-engineering", "preprocessing"]
      },
      {
        id: "supervised-unsupervised-learning",
        title: "教師あり学習と教師なし学習",
        tags: ["machine-learning", "supervised", "unsupervised"]
      },
      { id: "time-series-data", title: "時系列データの扱い", tags: ["machine-learning", "time-series", "forecasting"] },
      { id: "sql-for-ml", title: "機械学習のためのSQL", tags: ["machine-learning", "sql", "data-engineering"] }
    ]
  },
  {
    id: "deep-learning",
    title: "ディープラーニング",
    notebooks: [
      { id: "neural-network-basics", title: "ニューラルネットワーク", tags: ["deep-learning", "neural-network", "mlp"] },
      {
        id: "loss-and-gradient-descent",
        title: "損失関数と勾配降下法",
        tags: ["deep-learning", "loss", "gradient-descent"]
      },
      {
        id: "optimization-regularization",
        title: "最適化と正則化",
        tags: ["deep-learning", "optimization", "regularization"]
      },
      { id: "convolution-basics", title: "畳み込みとCNN", tags: ["deep-learning", "cnn", "convolution"] },
      {
        id: "image-recognition-yolo",
        title: "画像認識（YOLOを含む）",
        tags: ["deep-learning", "computer-vision", "yolo"]
      },
      {
        id: "recurrent-neural-networks",
        title: "再帰型ニューラルネットワーク（RNN/LSTM/GRU）",
        tags: ["deep-learning", "rnn", "lstm", "gru"]
      },
      { id: "transformer-basics", title: "Transformer", tags: ["deep-learning", "transformer", "attention"] },
      { id: "nlp-deep-learning", title: "自然言語処理", tags: ["deep-learning", "nlp", "language"] }
    ]
  },
  {
    id: "reinforcement-learning",
    title: "強化学習",
    notebooks: [
      { id: "rl-foundation", title: "強化学習の考え方", tags: ["reinforcement-learning", "mdp", "foundation"] },
      { id: "value-function", title: "価値関数", tags: ["reinforcement-learning", "value-function", "mdp"] },
      {
        id: "bellman-equations",
        title: "ベルマン方程式（期待方程式・最適方程式）",
        tags: ["reinforcement-learning", "bellman", "dynamic-programming"]
      },
      { id: "policy-iteration", title: "方策反復法", tags: ["reinforcement-learning", "dynamic-programming", "policy"] },
      { id: "value-iteration", title: "価値反復法", tags: ["reinforcement-learning", "dynamic-programming", "value"] },
      { id: "td-learning", title: "TD法", tags: ["reinforcement-learning", "temporal-difference", "prediction"] },
      { id: "q-learning", title: "Q学習", tags: ["reinforcement-learning", "q-learning", "off-policy"] },
      { id: "sarsa", title: "SARSA", tags: ["reinforcement-learning", "sarsa", "on-policy"] },
      { id: "n-step-td", title: "n-step TD法", tags: ["reinforcement-learning", "n-step", "temporal-difference"] },
      { id: "td-lambda", title: "TD(λ)", tags: ["reinforcement-learning", "td-lambda", "trace"] },
      {
        id: "eligibility-trace-td-lambda",
        title: "後方観測TD(λ)とEligibility Trace",
        tags: ["reinforcement-learning", "eligibility-trace", "td-lambda"]
      },
      {
        id: "deep-rl",
        title: "深層強化学習",
        tags: ["reinforcement-learning", "deep-rl", "function-approximation"]
      }
    ]
  },
  {
    id: "llm",
    title: "LLM",
    notebooks: [
      { id: "prompt-engineering", title: "プロンプトエンジニアリング", tags: ["llm", "prompt", "inference"] },
      { id: "llm-pretraining", title: "事前学習", tags: ["llm", "pretraining", "data"] },
      { id: "scaling-laws", title: "スケーリング則", tags: ["llm", "scaling-law", "compute"] },
      { id: "fine-tuning", title: "ファインチューニング", tags: ["llm", "fine-tuning", "adaptation"] },
      { id: "hallucination-rlhf", title: "ハルシネーションとRLHF", tags: ["llm", "hallucination", "rlhf"] },
      { id: "tool-use-rag", title: "Tool UseとRAG", tags: ["llm", "tool-use", "rag"] },
      { id: "domain-specialization", title: "ドメイン特化", tags: ["llm", "domain", "specialization"] },
      {
        id: "llm-efficiency",
        title: "軽量化（圧縮・最適化・効率化）",
        tags: ["llm", "quantization", "distillation", "inference"]
      }
    ]
  },
  {
    id: "deep-generative-models",
    title: "深層生成モデル",
    notebooks: [
      {
        id: "generative-model-overview",
        title: "生成モデルの全体像",
        tags: ["generative-model", "overview", "probabilistic"]
      },
      {
        id: "latent-variable-mixture-models",
        title: "潜在変数モデルと混合モデル",
        tags: ["generative-model", "latent-variable", "mixture-model"]
      },
      { id: "vae", title: "VAE", tags: ["generative-model", "vae", "variational-inference"] },
      { id: "gan", title: "GAN", tags: ["generative-model", "gan", "adversarial"] },
      {
        id: "autoregressive-flow-models",
        title: "自己回帰モデルとフローベースモデル",
        tags: ["generative-model", "autoregressive", "normalizing-flow"]
      },
      {
        id: "energy-based-models",
        title: "エネルギーベースモデル",
        tags: ["generative-model", "energy-based-model", "ebm"]
      },
      {
        id: "score-diffusion-models",
        title: "スコアベースモデルと拡散モデル",
        tags: ["generative-model", "score-based", "diffusion"]
      },
      {
        id: "continuous-diffusion-flow-matching",
        title: "連続時間拡散モデルとフローマッチング理論",
        tags: ["generative-model", "continuous-time", "flow-matching"]
      }
    ]
  },
  {
    id: "world-models",
    title: "世界モデル",
    notebooks: [
      {
        id: "world-models-and-generative-models",
        title: "世界モデルと深層生成モデル",
        tags: ["world-model", "generative-model", "dynamics"]
      },
      {
        id: "control-model-and-mbrl",
        title: "制御モデルとモデルベース強化学習",
        tags: ["world-model", "control", "model-based-rl"]
      },
      { id: "state-space-models", title: "状態空間モデル", tags: ["world-model", "state-space-model", "ssm"] },
      {
        id: "state-representation-learning",
        title: "状態表現学習",
        tags: ["world-model", "representation-learning", "latent-state"]
      },
      {
        id: "state-prediction-models",
        title: "状態予測モデル",
        tags: ["world-model", "prediction", "dynamics"]
      },
      {
        id: "vae-diffusion-world-models",
        title: "VAEと拡散モデル",
        tags: ["world-model", "vae", "diffusion"]
      },
      {
        id: "simulation-and-cg",
        title: "シミュレーションとコンピュータグラフィックス",
        tags: ["world-model", "simulation", "computer-graphics"]
      },
      {
        id: "ssm-and-transformer",
        title: "状態空間モデルとTransformer",
        tags: ["world-model", "state-space-model", "transformer"]
      },
      {
        id: "observation-prediction-models",
        title: "観測予測モデル（自己回帰・マスク予測・拡散）",
        tags: ["world-model", "autoregressive", "masked-modeling", "diffusion"]
      },
      {
        id: "multimodal-world-models",
        title: "マルチモーダルな世界モデル",
        tags: ["world-model", "multimodal", "vision-language-action"]
      }
    ]
  }
];

function makeNotebookScaffold(chapterTitle: string, notebookTitle: string): NotebookFile {
  return {
    cells: [
      {
        cell_type: "markdown",
        metadata: {},
        source: [
          `# ${notebookTitle}\n`,
          "\n",
          `このノートは **${chapterTitle}** セクションの教材です。`,
          "現在は教材骨組み（v0）で、今後この枠に沿って中身を拡充します。"
        ]
      },
      {
        cell_type: "markdown",
        metadata: {},
        source: [
          "## 学習目標\n",
          "- このテーマの基本概念を説明できる\n",
          "- 最低限の数式・アルゴリズムの意味を追える\n",
          "- 実装例を動かして挙動を確認できる"
        ]
      },
      {
        cell_type: "markdown",
        metadata: {},
        source: [
          "## このノートで扱う内容（骨組み）\n",
          "1. 背景と問題設定\n",
          "2. 核となる理論・数式\n",
          "3. 実装ステップ\n",
          "4. 典型的な失敗と対処\n",
          "5. 演習課題"
        ]
      },
      {
        cell_type: "markdown",
        metadata: {},
        source: [
          "## 前提知識\n",
          "- 必須: Python基礎\n",
          "- 推奨: 線形代数・微分積分・確率統計（必要に応じて）"
        ]
      },
      {
        cell_type: "code",
        execution_count: null,
        metadata: {},
        outputs: [],
        source: [
          "# TODO: このノートの実行コードを追加\n",
          "print(\"Notebook scaffold is ready\")"
        ]
      },
      {
        cell_type: "markdown",
        metadata: {},
        source: [
          "## 演習課題（ドラフト）\n",
          "- 問1: 用語の意味を自分の言葉で説明する\n",
          "- 問2: 実装セルを改変し、出力の変化を観察する\n",
          "- 問3: 制約条件を変えたときの挙動を考察する"
        ]
      },
      {
        cell_type: "markdown",
        metadata: {},
        source: [
          "## 参考資料（追加予定）\n",
          "- 公式ドキュメント\n",
          "- 代表的な教科書・論文\n",
          "- 実運用の実装例"
        ]
      }
    ],
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3"
      },
      language_info: {
        name: "python"
      }
    },
    nbformat: 4,
    nbformat_minor: 5
  };
}

function buildCatalog(): Catalog {
  return {
    chapters: chapters.map((chapter, chapterIndex) => ({
      id: chapter.id,
      title: chapter.title,
      order: chapterIndex + 1,
      notebooks: chapter.notebooks.map((notebook, notebookIndex) => ({
        id: notebook.id,
        title: notebook.title,
        order: notebookIndex + 1,
        tags: notebook.tags,
        htmlPath: `/notebooks/${notebook.id}.html`,
        colabUrl: `${COLAB_BASE}/${notebook.id}.ipynb`
      }))
    }))
  };
}

async function writeNotebookFiles() {
  const notebooksDir = path.join(process.cwd(), "content", "notebooks");
  await fs.mkdir(notebooksDir, { recursive: true });

  const existing = await fs.readdir(notebooksDir);
  await Promise.all(
    existing
      .filter((name) => name.endsWith(".ipynb"))
      .map((name) => fs.unlink(path.join(notebooksDir, name)))
  );

  const writes: Promise<void>[] = [];
  for (const chapter of chapters) {
    for (const notebook of chapter.notebooks) {
      const notebookFile = makeNotebookScaffold(chapter.title, notebook.title);
      const outputPath = path.join(notebooksDir, `${notebook.id}.ipynb`);
      writes.push(fs.writeFile(outputPath, `${JSON.stringify(notebookFile, null, 2)}\n`, "utf8"));
    }
  }

  await Promise.all(writes);
}

async function writeCatalogFile() {
  const catalog = buildCatalog();
  const outputPath = path.join(process.cwd(), "content", "catalog.json");
  await fs.writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

async function main() {
  await writeNotebookFiles();
  await writeCatalogFile();

  const notebookCount = chapters.reduce((acc, chapter) => acc + chapter.notebooks.length, 0);
  console.log(`Curriculum shell generated: ${chapters.length} chapters, ${notebookCount} notebooks.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
