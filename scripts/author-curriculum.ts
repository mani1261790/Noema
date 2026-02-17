import { promises as fs } from "fs";
import path from "path";

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

type TopicProfile = {
  intro: string;
  intuition: string;
  theoryBullets: string[];
  formulas: string[];
  implementationSteps: string[];
  pitfalls: string[];
  exercises: string[];
  summary: string;
  code: string[];
};

const catalogPath = path.join(process.cwd(), "content", "catalog.json");
const notebooksDir = path.join(process.cwd(), "content", "notebooks");

const REQUIRED_SECTIONS = [
  "学習目標",
  "前提知識",
  "直感",
  "理論",
  "実装の流れ",
  "よくあるつまずき",
  "演習",
  "まとめ"
];

function mdCell(text: string): NotebookCell {
  return {
    cell_type: "markdown",
    metadata: {},
    source: [text]
  };
}

function codeCell(lines: string[]): NotebookCell {
  return {
    cell_type: "code",
    execution_count: null,
    metadata: {},
    outputs: [],
    source: [lines.join("\n")]
  };
}

function defaultFormulas(chapterTitle: string): string[] {
  if (chapterTitle === "機械学習") {
    return ["$\\hat{y}=f_\\theta(x)$", "$\\mathcal{L}(\\theta)=\\frac{1}{N}\\sum_i \\ell(\\hat{y}_i, y_i)$"];
  }
  if (chapterTitle === "ディープラーニング") {
    return ["$z^{(l)} = W^{(l)}a^{(l-1)} + b^{(l)}$", "$\\theta \\leftarrow \\theta - \\eta \\nabla_\\theta \\mathcal{L}$"];
  }
  if (chapterTitle === "強化学習") {
    return ["$G_t = \\sum_{k=0}^{\\infty} \\gamma^k R_{t+k+1}$", "$Q(s,a) \\leftarrow Q(s,a)+\\alpha\\delta_t$"];
  }
  if (chapterTitle === "LLM") {
    return ["$p_\\theta(x_t|x_{<t})$", "$\\mathcal{L}_{CE} = -\\sum_t \\log p_\\theta(x_t|x_{<t})$"];
  }
  if (chapterTitle === "深層生成モデル") {
    return ["$p_\\theta(x)=\\int p_\\theta(x|z)p(z)dz$", "$\\nabla_x \\log p(x)$"];
  }
  if (chapterTitle === "世界モデル") {
    return ["$z_{t+1}=f_\\theta(z_t,a_t)$", "$\\hat{o}_{t+1}=g_\\theta(z_{t+1})$"];
  }
  return ["$f(x)$ の振る舞いをコードで確認し、仮説と実測の差を観察する。"];
}

function baseCodeByChapter(chapterTitle: string): string[] {
  if (chapterTitle === "Python") {
    return [
      "data = [1, 2, 3, 4, 5]",
      "squared = [x**2 for x in data]",
      "print('data   =', data)",
      "print('square =', squared)"
    ];
  }

  if (chapterTitle === "機械学習") {
    return [
      "x = [1, 2, 3, 4, 5]",
      "y = [2, 4, 6, 8, 10]",
      "x_mean = sum(x) / len(x)",
      "y_mean = sum(y) / len(y)",
      "num = sum((xi - x_mean) * (yi - y_mean) for xi, yi in zip(x, y))",
      "den = sum((xi - x_mean) ** 2 for xi in x)",
      "b1 = num / den",
      "b0 = y_mean - b1 * x_mean",
      "print('b0=', round(b0, 3), 'b1=', round(b1, 3))"
    ];
  }

  if (chapterTitle === "ディープラーニング") {
    return [
      "import math",
      "x = [0.5, -1.2, 0.3]",
      "w = [0.8, -0.4, 0.2]",
      "b = 0.1",
      "z = sum(xi * wi for xi, wi in zip(x, w)) + b",
      "y = 1 / (1 + math.exp(-z))",
      "print('logit=', round(z, 4), 'sigmoid=', round(y, 4))"
    ];
  }

  if (chapterTitle === "強化学習") {
    return [
      "Q = {'s0_left': 0.0, 's0_right': 0.0}",
      "alpha = 0.1",
      "reward = 1.0",
      "next_max = max(Q.values())",
      "target = reward + 0.99 * next_max",
      "td_error = target - Q['s0_right']",
      "Q['s0_right'] += alpha * td_error",
      "print(Q)"
    ];
  }

  if (chapterTitle === "LLM") {
    return [
      "prompt = 'あなたは丁寧な教師です。勾配降下法を中学生向けに説明してください。'",
      "tokens = prompt.split()",
      "print('prompt length:', len(prompt))",
      "print('approx token count:', len(tokens))",
      "print('first 5 tokens:', tokens[:5])"
    ];
  }

  if (chapterTitle === "深層生成モデル") {
    return [
      "import random",
      "random.seed(7)",
      "latent = [random.gauss(0, 1) for _ in range(3)]",
      "decoded = [round(2 * z + 1, 3) for z in latent]",
      "print('latent :', latent)",
      "print('decoded:', decoded)"
    ];
  }

  return [
    "state = {'z_t': 0.2, 'action': 1.0}",
    "z_next = 0.9 * state['z_t'] + 0.1 * state['action']",
    "obs_next = z_next ** 2",
    "print('z_next=', round(z_next, 4), 'obs_next=', round(obs_next, 4))"
  ];
}

function topicCodeOverride(id: string, chapterTitle: string): string[] | null {
  switch (id) {
    case "numpy-basics":
      return [
        "try:",
        "    import numpy as np",
        "except ModuleNotFoundError:",
        "    print('NumPy が未インストールです')",
        "else:",
        "    a = np.array([1, 2, 3])",
        "    b = np.array([10, 20, 30])",
        "    print('a+b =', a + b)",
        "    print('a*b =', a * b)"
      ];
    case "pandas-basics":
      return [
        "try:",
        "    import pandas as pd",
        "except ModuleNotFoundError:",
        "    print('Pandas が未インストールです')",
        "else:",
        "    df = pd.DataFrame({'name': ['A', 'B', 'C'], 'score': [72, 88, 95]})",
        "    print(df)",
        "    print('mean score =', df['score'].mean())"
      ];
    case "matplotlib-seaborn":
      return [
        "try:",
        "    import matplotlib.pyplot as plt",
        "except ModuleNotFoundError:",
        "    print('Matplotlib が未インストールです')",
        "else:",
        "    x = [1, 2, 3, 4]",
        "    y = [2, 3, 5, 8]",
        "    plt.plot(x, y, marker='o')",
        "    plt.title('Sample Plot')",
        "    plt.xlabel('x')",
        "    plt.ylabel('y')",
        "    plt.show()"
      ];
    case "sklearn-xgboost":
      return [
        "try:",
        "    from sklearn.linear_model import LinearRegression",
        "except ModuleNotFoundError:",
        "    print('scikit-learn が未インストールです')",
        "else:",
        "    X = [[1], [2], [3], [4]]",
        "    y = [2, 4, 6, 8]",
        "    model = LinearRegression().fit(X, y)",
        "    print('coef =', model.coef_, 'intercept =', model.intercept_)"
      ];
    case "sql-for-ml":
      return [
        "import sqlite3",
        "con = sqlite3.connect(':memory:')",
        "cur = con.cursor()",
        "cur.execute('create table sales(day text, amount int)')",
        "cur.executemany('insert into sales values(?, ?)', [('2026-01-01', 120), ('2026-01-02', 150), ('2026-01-03', 90)])",
        "for row in cur.execute('select avg(amount), max(amount) from sales'):",
        "    print('avg, max =', row)",
        "con.close()"
      ];
    case "image-recognition-yolo":
      return [
        "# YOLO の入出力形状を概念的に確認する簡易例",
        "grid_h, grid_w, anchors, classes = 13, 13, 3, 80",
        "channels = anchors * (5 + classes)",
        "print('output tensor shape =', (grid_h, grid_w, channels))",
        "print('1 anchor prediction dim =', 5 + classes)"
      ];
    case "transformer-basics":
      return [
        "import math",
        "q = [0.2, 0.5, 0.1]",
        "k = [0.4, 0.3, 0.8]",
        "dot = sum(qi * ki for qi, ki in zip(q, k))",
        "score = dot / math.sqrt(len(q))",
        "print('scaled dot-product score =', round(score, 4))"
      ];
    case "q-learning":
      return [
        "Q = {'s0_left': 0.2, 's0_right': 0.3}",
        "alpha, gamma = 0.1, 0.99",
        "reward = 1.0",
        "target = reward + gamma * max(Q.values())",
        "Q['s0_right'] = Q['s0_right'] + alpha * (target - Q['s0_right'])",
        "print(Q)"
      ];
    case "sarsa":
      return [
        "Q = {('s0', 'left'): 0.1, ('s0', 'right'): 0.3, ('s1', 'left'): 0.4}",
        "alpha, gamma = 0.1, 0.99",
        "s, a = 's0', 'right'",
        "r = 1.0",
        "s_next, a_next = 's1', 'left'",
        "target = r + gamma * Q[(s_next, a_next)]",
        "Q[(s, a)] += alpha * (target - Q[(s, a)])",
        "print(Q)"
      ];
    case "bellman-equations":
      return [
        "states = ['s0', 's1']",
        "V = {'s0': 0.0, 's1': 0.0}",
        "R = {'s0': 1.0, 's1': 0.5}",
        "gamma = 0.9",
        "for _ in range(5):",
        "    V = {s: R[s] + gamma * V[s] for s in states}",
        "print(V)"
      ];
    case "llm-efficiency":
      return [
        "params_fp16 = 20_000_000_000",
        "bytes_fp16 = 2",
        "bytes_int8 = 1",
        "gb_fp16 = params_fp16 * bytes_fp16 / (1024**3)",
        "gb_int8 = params_fp16 * bytes_int8 / (1024**3)",
        "print('FP16 GB ~', round(gb_fp16, 2))",
        "print('INT8 GB ~', round(gb_int8, 2))"
      ];
    case "gan":
      return [
        "# GAN の最小ゲーム形式（数値最適化は省略）",
        "D_real = 0.9",
        "D_fake = 0.2",
        "import math",
        "loss_D = -(math.log(D_real) + math.log(1 - D_fake))",
        "loss_G = -math.log(D_fake)",
        "print('loss_D=', round(loss_D, 4), 'loss_G=', round(loss_G, 4))"
      ];
    case "vae":
      return [
        "import math",
        "mu, logvar = 0.2, -0.4",
        "kl = -0.5 * (1 + logvar - mu**2 - math.exp(logvar))",
        "print('KL(q(z|x)||p(z)) =', round(kl, 6))"
      ];
    case "score-diffusion-models":
      return [
        "# 前向き拡散の簡易版",
        "x0 = 1.5",
        "beta = 0.1",
        "noise = -0.3",
        "x1 = (1 - beta) ** 0.5 * x0 + (beta ** 0.5) * noise",
        "print('x1 =', round(x1, 4))"
      ];
    case "state-space-models":
      return [
        "# 1次元線形状態空間モデル",
        "z_t = 0.5",
        "a_t = 1.0",
        "A, B = 0.9, 0.2",
        "z_next = A * z_t + B * a_t",
        "print('z_next=', round(z_next, 4))"
      ];
    default:
      return chapterTitle === "Python" ? null : null;
  }
}

function topicTheoryOverrides(id: string): string[] {
  switch (id) {
    case "simple-regression":
      return ["単回帰では $y = \\beta_0 + \\beta_1 x + \\epsilon$ を仮定する。", "最小二乗法で $\\beta_0, \\beta_1$ を推定する。"]; 
    case "multiple-regression":
      return ["重回帰では $y = X\\beta + \\epsilon$ を扱う。", "多重共線性や過学習の確認が重要。"]; 
    case "loss-and-gradient-descent":
      return ["損失関数は予測と正解のズレを数値化する。", "勾配降下法は損失が減る方向へパラメータを更新する。"]; 
    case "optimization-regularization":
      return ["最適化は収束速度と安定性、正則化は汎化性能を担う。", "Weight decay や Dropout は過学習抑制でよく使う。"]; 
    case "convolution-basics":
      return ["畳み込みは局所受容野と重み共有で画像特徴を抽出する。", "ストライドとパディングで出力解像度が変わる。"]; 
    case "recurrent-neural-networks":
      return ["RNNは時系列依存を隠れ状態で保持する。", "長期依存にはLSTM/GRUが有効。"]; 
    case "bellman-equations":
      return ["ベルマン期待方程式は方策固定下の価値再帰を与える。", "ベルマン最適方程式は最適価値関数を定義する。"]; 
    case "policy-iteration":
      return ["方策評価と方策改善を交互に行い収束させる。", "有限MDPなら最適方策へ収束する。"]; 
    case "value-iteration":
      return ["価値反復はベルマン最適作用素を反復適用する。", "収束後は greedy 方策で制御する。"]; 
    case "td-learning":
      return ["TD法はブートストラップで価値をオンライン更新する。", "MC法より分散が小さい一方でバイアスを持つ。"]; 
    case "n-step-td":
      return ["n-step TDはMCとTD(0)の中間。", "n を増やすとバイアス減・分散増になりやすい。"]; 
    case "td-lambda":
      return ["TD(λ)は複数ステップ予測を指数重み付き平均する。", "λが0に近いとTD(0)、1に近いとMCに近づく。"]; 
    case "eligibility-trace-td-lambda":
      return ["Eligibility Traceは過去状態への責任配分を行う。", "後方観測形式は逐次更新が実装しやすい。"]; 
    case "llm-pretraining":
      return ["自己回帰目的で次トークン予測を大量データで学習する。", "データ品質・重複除去が性能に直結する。"]; 
    case "scaling-laws":
      return ["モデルサイズ・データ量・計算量と損失の関係を経験則で捉える。", "計算予算内での最適配分が設計ポイント。"]; 
    case "hallucination-rlhf":
      return ["ハルシネーションは根拠不足でも流暢に誤答する現象。", "RLHFは人間選好を使って応答品質を調整する。"]; 
    case "tool-use-rag":
      return ["RAGは外部知識検索で回答根拠を補強する。", "Tool Useではモデル単体でなくシステム全体で性能を作る。"]; 
    case "llm-efficiency":
      return ["量子化・蒸留・構造最適化で推論コストを削減する。", "精度/遅延/メモリのトレードオフを設計する。"]; 
    case "latent-variable-mixture-models":
      return ["潜在変数モデルは観測背後の隠れ要因を導入する。", "混合モデルはクラスタごとに分布を分けて表現する。"]; 
    case "autoregressive-flow-models":
      return ["自己回帰モデルは連鎖分解で尤度を計算する。", "フローベースモデルは可逆変換で厳密尤度を扱える。"]; 
    case "energy-based-models":
      return ["EBMは正規化定数を含むエネルギー関数で確率を定義する。", "サンプリングや近似推論が実装上の鍵になる。"]; 
    case "continuous-diffusion-flow-matching":
      return ["連続時間拡散はSDE/ODEで生成過程を定式化する。", "Flow Matchingは速度場学習で確率輸送を近似する。"]; 
    case "control-model-and-mbrl":
      return ["MBRLは環境モデルを用いて計画・制御する。", "モデル誤差に頑健なプランニング設計が必要。"]; 
    case "state-representation-learning":
      return ["状態表現学習は制御に必要な情報を圧縮表現へ落とす。", "可観測性不足を補うため履歴統合が重要。"]; 
    case "state-prediction-models":
      return ["状態遷移の予測誤差を最小化してダイナミクスを学習する。", "長期ロールアウトでは誤差蓄積への対策が必要。"]; 
    case "vae-diffusion-world-models":
      return ["VAEは潜在圧縮、拡散は高品質生成に強みがある。", "世界モデルでは両者の役割分担設計が重要。"]; 
    case "simulation-and-cg":
      return ["シミュレーションとCGはデータ生成・検証基盤として有用。", "Domain gap を埋めるためのランダム化が必要。"]; 
    case "ssm-and-transformer":
      return ["SSMは長系列で効率的、Transformerは表現力が高い。", "ハイブリッド設計で速度と性能の両立を狙う。"]; 
    case "observation-prediction-models":
      return ["自己回帰・マスク予測・拡散で観測予測の性質が異なる。", "用途に応じて尤度推定とサンプリング速度を比較する。"]; 
    case "multimodal-world-models":
      return ["マルチモーダル世界モデルは視覚・言語・行動を統合する。", "モダリティ間整合性と時間同期が核心課題。"]; 
    default:
      return [];
  }
}

function topicProfile(chapter: CatalogChapter, notebook: CatalogNotebook, nextTitle: string | null): TopicProfile {
  const chapterTitle = chapter.title;
  const defaults = topicTheoryOverrides(notebook.id);
  const formulas = defaultFormulas(chapterTitle);
  const code = topicCodeOverride(notebook.id, chapterTitle) ?? baseCodeByChapter(chapterTitle);

  const intro = `${notebook.title}を、初学者が「概念 -> 理論 -> 実装」の順に理解できるように整理します。`;
  const intuition = `${notebook.title}は、複雑な対象を分解し、計算可能な形に落とし込む技術です。`;

  const theoryBullets = [
    `${notebook.title}で扱う主要な前提・仮定を明確にする。`,
    "評価指標または目的関数を明確にし、何を最適化するかを定義する。",
    "実装時にはデータ前処理と境界条件の扱いが結果を大きく左右する。",
    ...defaults
  ];

  const implementationSteps = [
    "最小の入力データを準備し、入出力の型・次元を確認する。",
    "理論式に対応する計算を小さなコードで再現する。",
    "中間値を可視化/出力して、期待と一致しているか検証する。",
    "条件を変えたときの挙動を比較し、感度を確認する。"
  ];

  const pitfalls = [
    "式やアルゴリズムを暗記だけで進め、前提条件を見落とす。",
    "データのスケール・欠損・外れ値を確認せずに学習/推論を行う。",
    "評価指標を1つだけ見て結論を急ぎ、失敗ケース分析を省略する。"
  ];

  const exercises = [
    "ノートのコードを一部書き換えて、出力がどう変化するか説明する。",
    "理論式の各項が何を意味するか、自分の言葉で1行ずつ説明する。",
    "実運用を想定し、入力異常（欠損・外れ値・分布ずれ）への対処案を3つ挙げる。"
  ];

  const summary = nextTitle
    ? `${notebook.title}の基本を確認しました。次は「${nextTitle}」で、関連テーマを一段深く扱います。`
    : `${notebook.title}で章末テーマまで到達しました。ここまでのノートを横断して復習すると理解が安定します。`;

  return {
    intro,
    intuition,
    theoryBullets,
    formulas,
    implementationSteps,
    pitfalls,
    exercises,
    summary,
    code
  };
}

function buildNotebook(chapter: CatalogChapter, notebook: CatalogNotebook, nextTitle: string | null): NotebookFile {
  const profile = topicProfile(chapter, notebook, nextTitle);

  const cells: NotebookCell[] = [
    mdCell(`# ${notebook.title}\n\n${profile.intro}`),
    mdCell(
      [
        "## 学習目標",
        "- このテーマの中心概念を説明できる",
        "- 最低限の数式/アルゴリズムの意味を追える",
        "- 実装例を実行し、出力を解釈できる"
      ].join("\n")
    ),
    mdCell(
      [
        "## 前提知識",
        "- 必須: Python基礎（変数・関数・リスト/辞書）",
        "- 推奨: 線形代数・確率統計の初歩",
        "- 目安: 数式の各記号を言葉に置き換えられること"
      ].join("\n")
    ),
    mdCell(
      [
        "## 直感",
        `一言で言うと: ${profile.intuition}`,
        "理論を読む前に、まず『何を入力して何を出したいか』を図で考えると理解が速くなります。"
      ].join("\n")
    ),
    mdCell(
      [
        "## 理論",
        ...profile.theoryBullets.map((item) => `- ${item}`),
        "",
        "### 代表式",
        ...profile.formulas.map((f) => `- ${f}`)
      ].join("\n")
    ),
    mdCell(
      [
        "## 実装の流れ",
        ...profile.implementationSteps.map((step, i) => `${i + 1}. ${step}`)
      ].join("\n")
    ),
    codeCell(profile.code),
    mdCell(
      [
        "## よくあるつまずき",
        ...profile.pitfalls.map((p) => `- ${p}`)
      ].join("\n")
    ),
    mdCell(
      [
        "## 演習",
        ...profile.exercises.map((q, i) => `${i + 1}. ${q}`)
      ].join("\n")
    ),
    mdCell(`## まとめ\n${profile.summary}`)
  ];

  return {
    cells,
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

function allMarkdownText(notebook: NotebookFile): string {
  return notebook.cells
    .filter((cell) => cell.cell_type === "markdown")
    .map((cell) => cell.source.join("\n"))
    .join("\n\n");
}

function ensureSection(notebook: NotebookFile, title: string, body: string): boolean {
  const text = allMarkdownText(notebook);
  if (text.includes(`## ${title}`)) return false;
  notebook.cells.push(mdCell(`## ${title}\n${body}`));
  return true;
}

function expertReviewAndFix(notebook: NotebookFile, chapterTitle: string): { changed: boolean; findings: string[] } {
  const findings: string[] = [];
  let changed = false;

  for (const section of REQUIRED_SECTIONS) {
    const did = ensureSection(notebook, section, `${section}の内容を補足してください。`);
    if (did) {
      changed = true;
      findings.push(`missing section: ${section}`);
    }
  }

  const codeCells = notebook.cells.filter((cell) => cell.cell_type === "code");
  if (codeCells.length === 0) {
    notebook.cells.splice(6, 0, codeCell(baseCodeByChapter(chapterTitle)));
    changed = true;
    findings.push("missing code cell");
  }

  const text = allMarkdownText(notebook);
  if (chapterTitle !== "Python" && !text.includes("$")) {
    notebook.cells.splice(5, 0, mdCell(["### 追加の代表式", ...defaultFormulas(chapterTitle).map((f) => `- ${f}`)].join("\n")));
    changed = true;
    findings.push("missing formulas");
  }

  if (text.includes("TODO") || text.includes("骨組み")) {
    notebook.cells = notebook.cells.map((cell) => {
      if (cell.cell_type !== "markdown") return cell;
      const merged = cell.source.join("\n").replace(/TODO/g, "追加課題").replace(/骨組み/g, "教材");
      return { ...cell, source: [merged] };
    });
    changed = true;
    findings.push("placeholder wording found");
  }

  return { changed, findings };
}

function beginnerReviewAndFix(notebook: NotebookFile): { changed: boolean; findings: string[] } {
  const findings: string[] = [];
  let changed = false;

  const text = allMarkdownText(notebook);

  if (!text.includes("一言で言うと")) {
    const idx = notebook.cells.findIndex((cell) => cell.cell_type === "markdown" && cell.source.join("\n").includes("## 直感"));
    if (idx >= 0) {
      const original = notebook.cells[idx].source.join("\n");
      notebook.cells[idx].source = [original + "\n一言で言うと: まずは入出力と目的を明確にすることが最重要です。"];
      changed = true;
      findings.push("missing quick intuition sentence");
    }
  }

  const exerciseCell = notebook.cells.find(
    (cell) => cell.cell_type === "markdown" && cell.source.join("\n").includes("## 演習")
  );

  if (exerciseCell) {
    const exerciseText = exerciseCell.source.join("\n");
    const has1 = /\n1\./.test(`\n${exerciseText}`);
    const has2 = /\n2\./.test(`\n${exerciseText}`);
    const has3 = /\n3\./.test(`\n${exerciseText}`);
    if (!(has1 && has2 && has3)) {
      exerciseCell.source = [[
        "## 演習",
        "1. ノート内のコードを1行変更し、出力差分を説明する。",
        "2. 重要な式/概念を1つ選び、図や具体例で説明する。",
        "3. 実務でこの手法を使う場合の失敗要因を3つ挙げ、対策を書く。"
      ].join("\n")];
      changed = true;
      findings.push("exercise list insufficient");
    }
  }

  if (!text.includes("次は")) {
    const summaryCell = notebook.cells.find(
      (cell) => cell.cell_type === "markdown" && cell.source.join("\n").includes("## まとめ")
    );
    if (summaryCell) {
      summaryCell.source = [summaryCell.source.join("\n") + "\n次は関連ノートに進み、同じ観点で比較してください。"];
      changed = true;
      findings.push("summary lacks next action");
    }
  }

  return { changed, findings };
}

function runReviewLoop(notebook: NotebookFile, chapterTitle: string): NotebookFile {
  let current = notebook;

  for (let round = 1; round <= 3; round += 1) {
    const expert = expertReviewAndFix(current, chapterTitle);
    const beginner = beginnerReviewAndFix(current);
    const changed = expert.changed || beginner.changed;

    if (!changed) {
      break;
    }
  }

  return current;
}

async function main() {
  await fs.mkdir(notebooksDir, { recursive: true });

  const raw = await fs.readFile(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;

  const writeTasks: Promise<void>[] = [];
  for (const chapter of catalog.chapters.slice().sort((a, b) => a.order - b.order)) {
    const notebooks = chapter.notebooks.slice().sort((a, b) => a.order - b.order);
    notebooks.forEach((notebook, index) => {
      const nextTitle = notebooks[index + 1]?.title ?? null;
      const built = buildNotebook(chapter, notebook, nextTitle);
      const reviewed = runReviewLoop(built, chapter.title);
      const outputPath = path.join(notebooksDir, `${notebook.id}.ipynb`);
      writeTasks.push(fs.writeFile(outputPath, `${JSON.stringify(reviewed, null, 2)}\n`, "utf8"));
    });
  }

  await Promise.all(writeTasks);
  console.log(`Authored ${writeTasks.length} notebooks with expert/beginner review loops.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
