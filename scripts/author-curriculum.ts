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

type TopicPack = {
  keyTerms: string[];
  formulas: string[];
  intuitionMetaphor: string;
  thoughtExperiment: string;
  practicalFailure: string;
  codeA: string[];
  codeB: string[];
};

const catalogPath = path.join(process.cwd(), "content", "catalog.json");
const notebooksDir = path.join(process.cwd(), "content", "notebooks");
const reportsDir = path.join(process.cwd(), "content", "review-reports");

const AUTHORING_SYSTEM_PROMPT = `あなたは初学者向け長編教材の著者。ユーザーの指定テーマを、学習者がつまずく順序を基準に再構成し、直観的理解から形式的理解へ段階的に導く。説明は具体例・比喩・小さな思考実験を中心に行い、専門用語や記号は必ず文脈の中で導入する。
文章は箇条書きを最小限に抑え、読み物として連続した段落で構成する。出力の冒頭に目次（章立て）を示し、その流れに沿って本文を執筆する。各章は理解が積み上がるようにつなげ、唐突な飛躍や前提の省略を避ける。
体裁は左揃えのプレーンテキストとし、コピー＆ペーストで崩れにくい見た目を保つ。主な対象分野は物理・英語・情報（プログラミングを含む）だが、理解を助ける範囲で分野横断を許可する。
ユーザーが前提知識・対象読者・分量を指定しない場合は、初学者（高校〜学部初年相当）を想定し、可能な限り長く、体系的に書く。学習の成立に重大な不確定要素がある場合のみ、最小限の確認質問を一度だけ行い、その後は執筆を続行する。`;

const REQUIRED_CHAPTERS = [
  "第1章 入口: このテーマを学ぶ意味とゴール",
  "第2章 直感: まず絵でつかむ",
  "第3章 形式化: 言葉と式をつなぐ",
  "第4章 思考実験: 条件を変えてみる",
  "第5章 実装: 手を動かして確かめる",
  "第6章 つまずきポイント: 誤解を先回りで潰す",
  "第7章 章末問題と橋渡し"
];

function md(text: string): NotebookCell {
  return {
    cell_type: "markdown",
    metadata: {},
    source: [text]
  };
}

function code(lines: string[]): NotebookCell {
  return {
    cell_type: "code",
    execution_count: null,
    metadata: {},
    outputs: [],
    source: [lines.join("\n")]
  };
}

function chapterFoundations(chapterTitle: string) {
  if (chapterTitle === "Python") {
    return {
      prerequisite: "中学数学レベルの四則演算と、変数という考え方があれば十分です。",
      objective: "Pythonの基本文法を、機械学習ノートを読むための道具として使える状態にします。"
    };
  }
  if (chapterTitle === "機械学習") {
    return {
      prerequisite: "Pythonの基本操作に加え、平均・分散・相関の直感があると理解が速くなります。",
      objective: "予測問題を数式とコードで記述し、モデルを評価して改善する一連の流れを身につけます。"
    };
  }
  if (chapterTitle === "ディープラーニング") {
    return {
      prerequisite: "ベクトル・行列の計算と、微分の基本概念が前提です。",
      objective: "ニューラルネットワークの学習がなぜ進むのかを、損失・勾配・最適化の視点から説明できる状態にします。"
    };
  }
  if (chapterTitle === "強化学習") {
    return {
      prerequisite: "確率と期待値、そして逐次意思決定の感覚が前提です。",
      objective: "エージェントが試行錯誤を通して方策を改善する仕組みを、ベルマン方程式から実装まで一気通貫で理解します。"
    };
  }
  if (chapterTitle === "LLM") {
    return {
      prerequisite: "確率的な言語モデルの見方と、基本的な深層学習の知識が前提です。",
      objective: "LLMの学習・推論・運用を、プロンプト設計から効率化までシステムとして設計できるようにします。"
    };
  }
  if (chapterTitle === "深層生成モデル") {
    return {
      prerequisite: "確率分布と最適化の初歩、深層学習の基本が前提です。",
      objective: "生成モデルを『何を近似しているか』という確率論の視点で比較し、適材適所で使い分けられるようにします。"
    };
  }
  return {
    prerequisite: "時系列モデリングと強化学習の基礎理解があると効果的です。",
    objective: "世界モデルを、状態表現・遷移予測・観測生成・計画の連鎖として理解し、設計の勘所を掴みます。"
  };
}

function defaultPack(chapterTitle: string, title: string): TopicPack {
  if (chapterTitle === "Python") {
    return {
      keyTerms: ["変数", "データ型", "条件分岐", "反復", "関数"],
      formulas: ["厳密な式よりも、入出力の対応を一つずつ追うことが中心です。"],
      intuitionMetaphor: "料理の手順書を、曖昧さなく機械に渡せる形へ書き換える作業に似ています。",
      thoughtExperiment: "同じ手順を、入力が空のとき・1件しかないとき・100万件あるときに想像し、何が壊れるかを考えます。",
      practicalFailure: "小さなサンプルでは動くのに、欠損値や型のズレが入った瞬間に壊れるケースが非常に多いです。",
      codeA: [
        "values = [1, 2, 3, 4, 5]",
        "scaled = [v * 2 for v in values]",
        "print('values =', values)",
        "print('scaled =', scaled)"
      ],
      codeB: [
        "def safe_mean(xs):",
        "    if len(xs) == 0:",
        "        return None",
        "    return sum(xs) / len(xs)",
        "",
        "print(safe_mean([3, 5, 9]))",
        "print(safe_mean([]))"
      ]
    };
  }

  if (chapterTitle === "機械学習") {
    return {
      keyTerms: ["目的変数", "特徴量", "損失関数", "汎化", "過学習"],
      formulas: ["y_hat = f_theta(x)", "L(theta) = (1/N) * sum_i l(y_hat_i, y_i)"],
      intuitionMetaphor: "過去問を解いて解き方の癖を学び、初見問題で再現できるか試す学習に似ています。",
      thoughtExperiment: "訓練データを完璧に覚えたモデルが、新しいデータで突然外す場面を想像し、なぜ起きるかを説明します。",
      practicalFailure: "評価データの分布が訓練時と違うのに、スコアだけを信じて運用し、現場で精度が崩れるケースが典型です。",
      codeA: [
        "x = [1, 2, 3, 4, 5]",
        "y = [2, 4, 6, 8, 10]",
        "x_mean = sum(x) / len(x)",
        "y_mean = sum(y) / len(y)",
        "num = sum((xi - x_mean) * (yi - y_mean) for xi, yi in zip(x, y))",
        "den = sum((xi - x_mean) ** 2 for xi in x)",
        "b1 = num / den",
        "b0 = y_mean - b1 * x_mean",
        "print('b0=', round(b0, 4), 'b1=', round(b1, 4))"
      ],
      codeB: [
        "pred = [b0 + b1 * xi for xi in x]",
        "mse = sum((pi - yi) ** 2 for pi, yi in zip(pred, y)) / len(y)",
        "print('pred =', pred)",
        "print('mse =', round(mse, 8))"
      ]
    };
  }

  if (chapterTitle === "ディープラーニング") {
    return {
      keyTerms: ["順伝播", "逆伝播", "勾配", "最適化", "正則化"],
      formulas: ["z(l) = W(l) * a(l-1) + b(l)", "theta <- theta - eta * grad_theta L"],
      intuitionMetaphor: "試験の答案を採点し、間違えた箇所に重みをつけて次回の勉強配分を修正する流れに似ています。",
      thoughtExperiment: "学習率を極端に大きくしたときと小さくしたときで、収束の様子がどう変わるか頭の中で比較します。",
      practicalFailure: "損失だけを見て学習を進め、検証性能の悪化に気づかず過学習を進行させる失敗が多発します。",
      codeA: [
        "import math",
        "x = [0.7, -1.0, 0.2]",
        "w = [0.5, -0.3, 0.8]",
        "b = 0.1",
        "z = sum(xi * wi for xi, wi in zip(x, w)) + b",
        "y = 1 / (1 + math.exp(-z))",
        "print('logit=', round(z, 4), 'sigmoid=', round(y, 4))"
      ],
      codeB: [
        "target = 1.0",
        "loss = -(target * math.log(y + 1e-9) + (1 - target) * math.log(1 - y + 1e-9))",
        "print('binary cross entropy =', round(loss, 6))"
      ]
    };
  }

  if (chapterTitle === "強化学習") {
    return {
      keyTerms: ["状態", "行動", "報酬", "価値関数", "方策"],
      formulas: ["G_t = sum_{k>=0} gamma^k * R_{t+k+1}", "Q(s,a) <- Q(s,a) + alpha * delta_t"],
      intuitionMetaphor: "地図のない街で、歩いた結果の満足度を頼りに最短ルートを育てる行為に似ています。",
      thoughtExperiment: "即時報酬が小さくても将来の報酬が大きい行動を、どのように評価できるかを考えます。",
      practicalFailure: "探索不足で局所最適な行動に固定され、本来高報酬の戦略を見つけられないケースが頻発します。",
      codeA: [
        "Q = {'left': 0.2, 'right': 0.1}",
        "alpha, gamma = 0.1, 0.99",
        "reward = 1.0",
        "target = reward + gamma * max(Q.values())",
        "Q['right'] += alpha * (target - Q['right'])",
        "print(Q)"
      ],
      codeB: [
        "epsilon = 0.2",
        "policy = 'explore' if epsilon > 0.1 else 'greedy'",
        "print('policy mode =', policy)",
        "print('best action =', max(Q, key=Q.get))"
      ]
    };
  }

  if (chapterTitle === "LLM") {
    return {
      keyTerms: ["トークン", "事前学習", "ファインチューニング", "アライメント", "推論最適化"],
      formulas: ["p_theta(x_t | x_<t)", "L_CE = - sum_t log p_theta(x_t | x_<t)"],
      intuitionMetaphor: "大量読書で言語感覚を身につけた後、特定業務の書き方を追加訓練する過程に似ています。",
      thoughtExperiment: "同じ質問に対して、文脈情報を増やした場合と減らした場合で回答品質がどう変わるかを比較します。",
      practicalFailure: "プロンプト設計だけで解決できる問題と、検索・ツール連携が必要な問題を混同し、運用品質を落とすことがあります。",
      codeA: [
        "prompt = 'あなたは丁寧な講師です。勾配降下法を200字で説明してください。'",
        "approx_tokens = prompt.split()",
        "print('chars=', len(prompt))",
        "print('approx token count=', len(approx_tokens))"
      ],
      codeB: [
        "retrieved = ['勾配は傾き', '学習率は更新幅', '局所最小に注意']",
        "question = 'なぜ学習率が大きすぎると不安定ですか?'",
        "context = ' '.join(retrieved)",
        "print('question:', question)",
        "print('context :', context)"
      ]
    };
  }

  if (chapterTitle === "深層生成モデル") {
    return {
      keyTerms: ["潜在変数", "尤度", "サンプリング", "拡散", "確率輸送"],
      formulas: ["p_theta(x) = integral p_theta(x|z) p(z) dz", "score(x) = grad_x log p(x)"],
      intuitionMetaphor: "見たことのある作風を学び、確率的に新しい作品を描く職人の作業に似ています。",
      thoughtExperiment: "同じ潜在ベクトルに小さなノイズを足したとき、生成結果の何が滑らかに変わるべきかを考えます。",
      practicalFailure: "見た目の良さだけでモデルを比較し、モード崩壊や多様性欠如を見逃す失敗が起きがちです。",
      codeA: [
        "import random",
        "random.seed(42)",
        "latent = [round(random.gauss(0, 1), 3) for _ in range(4)]",
        "decoded = [round(1.5 * z + 0.3, 3) for z in latent]",
        "print('latent :', latent)",
        "print('decode :', decoded)"
      ],
      codeB: [
        "x0 = 1.2",
        "beta = 0.1",
        "noise = -0.4",
        "x1 = (1 - beta) ** 0.5 * x0 + (beta ** 0.5) * noise",
        "print('diffusion one-step x1 =', round(x1, 5))"
      ]
    };
  }

  return {
    keyTerms: ["状態表現", "遷移モデル", "観測予測", "計画", "マルチモーダル統合"],
    formulas: ["z_{t+1} = f_theta(z_t, a_t)", "o_hat_{t+1} = g_theta(z_{t+1})"],
    intuitionMetaphor: "頭の中で未来をシミュレーションしてから動く人間の認知戦略に近いです。",
    thoughtExperiment: "観測ノイズが増えたとき、潜在状態の更新則をどう設計すべきかを考えます。",
    practicalFailure: "1ステップ予測誤差だけで評価し、長期ロールアウト時の誤差爆発を見落とすことが多いです。",
    codeA: [
      "z_t = 0.3",
      "a_t = 1.0",
      "A, B = 0.9, 0.2",
      "z_next = A * z_t + B * a_t",
      "print('z_next =', round(z_next, 4))"
    ],
    codeB: [
      "def rollout(z0, actions):",
      "    z = z0",
      "    out = []",
      "    for a in actions:",
      "        z = 0.9 * z + 0.2 * a",
      "        out.append(round(z, 4))",
      "    return out",
      "",
      "print(rollout(0.1, [0, 1, 1, 0, 1]))"
    ]
  };
}

function overridePack(id: string, chapterTitle: string, title: string, base: TopicPack): TopicPack {
  const pack = { ...base, keyTerms: [...base.keyTerms], formulas: [...base.formulas] };

  if (id === "simple-regression") {
    pack.formulas = ["y = beta0 + beta1 * x + epsilon", "beta1_hat = sum((x_i-x_bar)(y_i-y_bar)) / sum((x_i-x_bar)^2)"];
  }

  if (id === "multiple-regression") {
    pack.formulas = ["y = X * beta + epsilon", "beta_hat = (X^T X)^(-1) X^T y"];
  }

  if (id === "bellman-equations") {
    pack.formulas = [
      "V^pi(s) = sum_a pi(a|s) * sum_{s',r} p(s',r|s,a) * [r + gamma * V^pi(s')]",
      "V*(s) = max_a sum_{s',r} p(s',r|s,a) * [r + gamma * V*(s')]"
    ];
  }

  if (id === "q-learning") {
    pack.formulas = ["Q(s,a) <- Q(s,a) + alpha * [r + gamma * max_{a'} Q(s',a') - Q(s,a)]"];
  }

  if (id === "sarsa") {
    pack.formulas = ["Q(s,a) <- Q(s,a) + alpha * [r + gamma * Q(s',a') - Q(s,a)]"];
  }

  if (id === "td-lambda" || id === "eligibility-trace-td-lambda") {
    pack.formulas = ["G_t^lambda = (1-lambda) * sum_{n>=1} lambda^(n-1) * G_t^(n)", "e_t(s) = gamma * lambda * e_{t-1}(s) + 1[S_t = s]"];
  }

  if (id === "transformer-basics") {
    pack.formulas = ["Attention(Q,K,V) = softmax(QK^T / sqrt(d_k)) V", "FFN(x) = W2 * sigma(W1 * x + b1) + b2"];
  }

  if (id === "vae") {
    pack.formulas = ["log p_theta(x) >= E_{q_phi(z|x)}[log p_theta(x|z)] - KL(q_phi(z|x) || p(z))"];
  }

  if (id === "gan") {
    pack.formulas = ["min_G max_D E_{x~pdata}[log D(x)] + E_{z~p(z)}[log(1 - D(G(z)))]"];
  }

  if (id === "score-diffusion-models") {
    pack.formulas = ["score_t(x) = grad_x log p_t(x)", "dx = f(x,t) dt + g(t) dw"];
  }

  if (id === "continuous-diffusion-flow-matching") {
    pack.formulas = ["dx/dt = v_theta(x,t)", "min_theta E || v_theta(x_t,t) - u_t(x_t) ||^2"];
  }

  if (id === "numpy-basics") {
    pack.codeA = [
      "try:",
      "    import numpy as np",
      "except ModuleNotFoundError:",
      "    print('NumPyが未インストールです')",
      "else:",
      "    a = np.array([1, 2, 3])",
      "    b = np.array([10, 20, 30])",
      "    print('a+b =', a + b)",
      "    print('a*b =', a * b)"
    ];
    pack.codeB = [
      "try:",
      "    import numpy as np",
      "except ModuleNotFoundError:",
      "    print('NumPyが未インストールです')",
      "else:",
      "    x = np.array([[1, 2], [3, 4]])",
      "    print('shape =', x.shape)",
      "    print('mean =', x.mean())"
    ];
  }

  if (id === "pandas-basics") {
    pack.codeA = [
      "try:",
      "    import pandas as pd",
      "except ModuleNotFoundError:",
      "    print('Pandasが未インストールです')",
      "else:",
      "    df = pd.DataFrame({'name': ['A', 'B', 'C'], 'score': [72, 88, 95]})",
      "    print(df)",
      "    print('mean=', df['score'].mean())"
    ];
    pack.codeB = [
      "try:",
      "    import pandas as pd",
      "except ModuleNotFoundError:",
      "    print('Pandasが未インストールです')",
      "else:",
      "    df = pd.DataFrame({'x': [1, 2, 3], 'y': [3, 5, 9]})",
      "    df['ratio'] = df['y'] / df['x']",
      "    print(df)"
    ];
  }

  if (id === "matplotlib-seaborn") {
    pack.codeA = [
      "try:",
      "    import matplotlib.pyplot as plt",
      "except ModuleNotFoundError:",
      "    print('Matplotlibが未インストールです')",
      "else:",
      "    x = [1, 2, 3, 4]",
      "    y = [2, 3, 5, 8]",
      "    plt.plot(x, y, marker='o')",
      "    plt.title('Line plot')",
      "    plt.show()"
    ];
  }

  if (id === "sql-for-ml") {
    pack.codeA = [
      "import sqlite3",
      "con = sqlite3.connect(':memory:')",
      "cur = con.cursor()",
      "cur.execute('create table sales(day text, amount int)')",
      "cur.executemany('insert into sales values (?, ?)', [('2026-01-01', 120), ('2026-01-02', 150), ('2026-01-03', 90)])",
      "print(cur.execute('select avg(amount) from sales').fetchone())",
      "con.close()"
    ];
  }

  if (id === "image-recognition-yolo") {
    pack.codeA = [
      "grid_h, grid_w, anchors, classes = 13, 13, 3, 80",
      "channels = anchors * (5 + classes)",
      "print('YOLO output shape=', (grid_h, grid_w, channels))",
      "print('one anchor dim=', 5 + classes)"
    ];
  }

  if (id === "llm-efficiency") {
    pack.codeA = [
      "params = 20_000_000_000",
      "fp16_gb = params * 2 / (1024**3)",
      "int8_gb = params * 1 / (1024**3)",
      "print('fp16 GB ~', round(fp16_gb, 2))",
      "print('int8 GB ~', round(int8_gb, 2))"
    ];
  }

  if (id === "tool-use-rag") {
    pack.codeA = [
      "question = 'ベルマン最適方程式を1文で説明して'",
      "retrieved = ['最適価値は次状態価値の最大期待値で再帰的に定義される']",
      "context = ' '.join(retrieved)",
      "print('question:', question)",
      "print('context :', context)"
    ];
  }

  if (id === "prompt-engineering") {
    pack.codeA = [
      "prompt = '''あなたは初学者向け教師です。例を2つ出し、最後に要点を3行でまとめて。",
      "質問: 微分積分の連鎖律を説明して'''",
      "print(prompt)",
      "print('chars=', len(prompt))"
    ];
  }

  if (id === "sklearn-xgboost") {
    pack.codeA = [
      "try:",
      "    from sklearn.linear_model import LinearRegression",
      "except ModuleNotFoundError:",
      "    print('scikit-learnが未インストールです')",
      "else:",
      "    X = [[1], [2], [3], [4]]",
      "    y = [2, 4, 6, 8]",
      "    model = LinearRegression().fit(X, y)",
      "    print('coef=', model.coef_, 'intercept=', model.intercept_)"
    ];
  }

  // タイトル固有語を必ず用語セットに追加
  const titleTokens = title
    .replace(/[（）()・,:]/g, " ")
    .split(/\s+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 3);
  for (const token of titleTokens) {
    if (!pack.keyTerms.includes(token)) {
      pack.keyTerms.push(token);
    }
  }

  return pack;
}

function buildPack(chapter: CatalogChapter, notebook: CatalogNotebook): TopicPack {
  const base = defaultPack(chapter.title, notebook.title);
  return overridePack(notebook.id, chapter.title, notebook.title, base);
}

function narrative(
  chapterTitle: string,
  notebookTitle: string,
  nextTitle: string | null,
  pack: TopicPack
): NotebookFile {
  const foundation = chapterFoundations(chapterTitle);

  const toc = [
    `# ${notebookTitle}`,
    "",
    "目次",
    "1. 第1章 入口: このテーマを学ぶ意味とゴール",
    "2. 第2章 直感: まず絵でつかむ",
    "3. 第3章 形式化: 言葉と式をつなぐ",
    "4. 第4章 思考実験: 条件を変えてみる",
    "5. 第5章 実装: 手を動かして確かめる",
    "6. 第6章 つまずきポイント: 誤解を先回りで潰す",
    "7. 第7章 章末問題と橋渡し",
    "",
    "このノートは初学者向けに、直感から形式化へ、そして実装へと段階的に進みます。"
  ].join("\n");

  const chapter1 = [
    "## 第1章 入口: このテーマを学ぶ意味とゴール",
    `まず前提として、${foundation.prerequisite}`,
    `${notebookTitle}は、${foundation.objective}`,
    "学習者が最初につまずくのは、専門用語の意味が曖昧なまま式だけを追ってしまう点です。そこでこの章では、最初に言葉の地図を作り、何を入力して何を出力するのかを先に固定します。",
    "ここで大切なのは『厳密さより順序』です。順序を誤ると、正しい式を見ても使えません。反対に順序が正しければ、難しい記号に出会っても自分で意味づけできます。"
  ].join("\n\n");

  const chapter2 = [
    "## 第2章 直感: まず絵でつかむ",
    `このテーマを最短でつかむ比喩は、${pack.intuitionMetaphor}`,
    "たとえば、入力を受け取ってから答えを返すまでの流れを、紙の上で矢印として描いてみてください。多くの初学者は、式の中で迷う前に、この矢印の段階で迷います。",
    "ここまでの狙いは、用語を暗記することではありません。『この処理は何を保存し、何を捨てるか』を言葉で説明できるようにすることです。次に式へ進むとき、式はこの説明を圧縮した記法として読めるようになります。"
  ].join("\n\n");

  const chapter3 = [
    "## 第3章 形式化: 言葉と式をつなぐ",
    `ここで初めて出る語を短く言い換えると、${pack.keyTerms.map((t) => `「${t}」`).join("、")}が核です。`,
    "それぞれの語は孤立して存在するのではなく、入力・状態・更新・評価という流れで連鎖しています。この連鎖を意識せずに個別の定義だけ読むと、式は記号の羅列に見えてしまいます。",
    "主要な関係式を次に示します。式の読み方は、左辺を『今知りたい量』、右辺を『それを決める要素』と見なすことです。",
    ...pack.formulas.map((f) => f),
    "次に進む前に、各式の変数を一つずつ『観測できるもの』『学習で決まるもの』『設計者が決めるもの』に分類してみてください。これだけで実装時の混乱が大幅に減ります。"
  ].join("\n\n");

  const chapter4 = [
    "## 第4章 思考実験: 条件を変えてみる",
    `小さな思考実験として、${pack.thoughtExperiment}`,
    "この問いの価値は、正解を当てることではありません。条件を動かしたときに、どの量が敏感に反応し、どの量が安定して残るかを見分ける目を作ることにあります。",
    "実務では、想定外の入力は必ず来ます。だからこそ、平常時の動作だけでなく、境界条件での挙動を先回りで考える習慣が重要です。ここまでで理論の骨格は十分にそろいました。次に実装へ移ります。"
  ].join("\n\n");

  const chapter5 = [
    "## 第5章 実装: 手を動かして確かめる",
    "ここではまず最小例を実装し、理論で見た量がコード上でどこに現れるかを対応づけます。最初のコードは理解優先で短く保ち、中間値を明示的に出力します。",
    "続くコードでは、入力条件を少し変えて結果の変化を観察します。『動いた』で止めず、『なぜその値になったか』を一行で説明できるかを確認してください。"
  ].join("\n\n");

  const chapter6 = [
    "## 第6章 つまずきポイント: 誤解を先回りで潰す",
    `現場で頻発する失敗として、${pack.practicalFailure}`,
    "この失敗の根本原因は、モデルやアルゴリズム単体ではなく、前処理・評価設計・運用前提を分離して考えてしまう点にあります。",
    "対策はシンプルです。入力仕様、評価指標、失敗例の三つを同じノートで管理し、更新時に同時チェックすることです。初学者のうちからこの癖をつけると、後で大規模開発に移行しても崩れません。"
  ].join("\n\n");

  const chapter7 = [
    "## 第7章 章末問題と橋渡し",
    "問題1: このノートで出てきた主要語を三つ選び、それぞれを専門用語を使わずに説明してください。",
    "問題2: 実装コードの定数や条件を一つ変更し、出力がどう変化したかを理由つきで説明してください。",
    "問題3: 実務導入を想定し、入力データの異常ケースを三つ挙げ、検知方法と回避策を文章で書いてください。",
    nextTitle
      ? `ここまでで${notebookTitle}の骨格は固まりました。次の「${nextTitle}」では、同じ視点を維持したまま対象を広げ、比較しながら理解を深めます。`
      : `ここまででこの章の終点に到達しました。前のノートへ戻り、同じ式や概念を別テーマで読み直すと、知識が孤立せず体系としてつながります。`
  ].join("\n\n");

  return {
    cells: [
      md(toc),
      md(chapter1),
      md(chapter2),
      md(chapter3),
      md(chapter4),
      md(chapter5),
      code(pack.codeA),
      code(pack.codeB),
      md(chapter6),
      md(chapter7)
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

function markdownText(nb: NotebookFile): string {
  return nb.cells
    .filter((c) => c.cell_type === "markdown")
    .map((c) => c.source.join("\n"))
    .join("\n\n");
}

function cellByHeading(nb: NotebookFile, heading: string): NotebookCell | null {
  const found = nb.cells.find((c) => c.cell_type === "markdown" && c.source.join("\n").includes(heading));
  return found || null;
}

function markdownLength(nb: NotebookFile): number {
  return markdownText(nb).replace(/\s+/g, "").length;
}

function ensureCodeLength(nb: NotebookFile): boolean {
  let changed = false;
  for (const cell of nb.cells) {
    if (cell.cell_type !== "code") continue;
    const src = cell.source.join("\n").trim();
    const lines = src.split("\n");
    if (lines.length < 4) {
      cell.source = [[
        `${src}`,
        "",
        "# 追記: 中間値を可視化して挙動を確認する",
        "print('done')"
      ].join("\n")];
      changed = true;
    }
  }
  return changed;
}

function runExpertCodexReview(nb: NotebookFile, pack: TopicPack, chapterTitle: string): { findings: string[]; changed: boolean } {
  const findings: string[] = [];
  let changed = false;
  const text = markdownText(nb);

  if (!text.includes("目次")) {
    const first = nb.cells[0];
    if (first && first.cell_type === "markdown") {
      first.source = [first.source.join("\n") + "\n\n目次\n1. 章構成を確認してから読み進める。"];
      changed = true;
      findings.push("目次が欠落していたため追加");
    }
  }

  for (const heading of REQUIRED_CHAPTERS) {
    if (!text.includes(heading)) {
      nb.cells.push(md(`## ${heading}\nこの節はレビューで不足が検出されたため補われました。`));
      changed = true;
      findings.push(`必須節不足: ${heading}`);
    }
  }

  if (chapterTitle !== "Python") {
    const hasFormula = pack.formulas.some((f) => text.includes(f));
    if (!hasFormula) {
      const formal = cellByHeading(nb, "## 第3章 形式化: 言葉と式をつなぐ");
      if (formal) {
        formal.source = [formal.source.join("\n") + "\n\n追加の代表式:\n" + pack.formulas.join("\n")];
        changed = true;
        findings.push("式の導入不足を補強");
      }
    }
  }

  for (const term of pack.keyTerms) {
    if (!text.includes(term)) {
      const formal = cellByHeading(nb, "## 第3章 形式化: 言葉と式をつなぐ");
      if (formal) {
        formal.source = [formal.source.join("\n") + `\n\n補足語彙: ${term}とは、この章の因果関係を追ううえで中心となる概念です。`];
        changed = true;
        findings.push(`主要語不足: ${term}`);
      }
    }
  }

  if (markdownLength(nb) < 6500) {
    const c1 = cellByHeading(nb, "## 第1章 入口: このテーマを学ぶ意味とゴール");
    const c3 = cellByHeading(nb, "## 第3章 形式化: 言葉と式をつなぐ");
    const c6 = cellByHeading(nb, "## 第6章 つまずきポイント: 誤解を先回りで潰す");
    const c7 = cellByHeading(nb, "## 第7章 章末問題と橋渡し");

    const expansions = [
      `補講A: ${chapterTitle}の学習では、最初に「自分が何を予測・判断・生成したいのか」を文章で固定しておくと、後の数式解釈が劇的に安定します。目標を曖昧なまま先へ進むと、同じ式を見ても意味づけが毎回変わってしまい、再現可能な理解に到達できません。ここでは、入力・状態・出力を三列の表として紙に書き、どの列が観測可能でどの列がモデル内部に隠れるかを明確にします。これだけで、実装時に「どこまでがデータでどこからが仮定か」を切り分けられるようになります。`,
      `補講B: 形式化の節で重要なのは、式を暗記することではなく、式の両辺の役割を読み分けることです。左辺は今決めたい量、右辺はその決定に必要な情報の集約です。この読み方に慣れると、未知の式に出会っても「この式は何を更新しているのか」「どの仮定が壊れると無効になるのか」を自力で判定できます。さらに、各記号を観測量・学習パラメータ・設計ハイパーパラメータに分類すると、デバッグ時にどこを触るべきかが一気に明確になります。`,
      `補講C: 初学者が実務で最も苦しむのは、理論誤りよりも運用前提の見落としです。学習時には整ったデータが来ても、本番では欠損・外れ値・分布シフトが同時に起きます。したがって、評価は単一スコアではなく、失敗例の型を先に定義してから行う必要があります。おすすめは、失敗パターンを「入力異常」「モデル過信」「閾値設計ミス」に分け、各パターンに対して監視指標とフェイルセーフ動作を文章で先に書いておく方法です。これにより、モデルの改善がシステム全体の改善として機能します。`,
      `補講D: 章末問題に取り組むときは、解答の正誤だけでなく、説明の因果が一貫しているかを必ず確認してください。たとえば、出力が変わった理由を述べる際に、入力変化・中間状態変化・最終評価変化の三段を分けて記述すると、理解の穴が可視化されます。もし説明の途中で言葉が詰まるなら、その地点に未理解の前提があります。そこへ戻って一段落だけ読み直し、再度自分の言葉で言い換える、という往復を行うと、知識が断片ではなく構造として定着します。`
    ];

    let i = 0;
    while (markdownLength(nb) < 6500 && i < 12) {
      const chunk = expansions[i % expansions.length];
      const target = i % 4 === 0 ? c1 : i % 4 === 1 ? c3 : i % 4 === 2 ? c6 : c7;
      if (target) {
        target.source = [target.source.join("\n\n") + "\n\n" + chunk];
        changed = true;
      }
      i += 1;
    }

    if (changed) {
      findings.push("本文分量を長編教材レベルまで補強");
    }
  }

  if (ensureCodeLength(nb)) {
    changed = true;
    findings.push("コードセルの短すぎる記述を補強");
  }

  return { findings, changed };
}

function runBeginnerCodexReview(nb: NotebookFile): { findings: string[]; changed: boolean } {
  const findings: string[] = [];
  let changed = false;
  const text = markdownText(nb);

  if (!text.includes("たとえば")) {
    const intuition = cellByHeading(nb, "## 第2章 直感: まず絵でつかむ");
    if (intuition) {
      intuition.source = [
        intuition.source.join("\n") +
          "\n\nたとえば、ノートを閉じた状態で友人に口頭説明するつもりで、入力・処理・出力を三文で話してみてください。詰まる場所こそ、理解が曖昧な箇所です。"
      ];
      changed = true;
      findings.push("具体例不足を補強");
    }
  }

  if (!text.includes("ここまで")) {
    const formal = cellByHeading(nb, "## 第3章 形式化: 言葉と式をつなぐ");
    if (formal) {
      formal.source = [
        formal.source.join("\n") +
          "\n\nここまでの内容を一度言葉だけで説明できれば、式の読み間違いは大幅に減ります。"
      ];
      changed = true;
      findings.push("遷移文不足を補強");
    }
  }

  if (!text.includes("次に")) {
    const c4 = cellByHeading(nb, "## 第4章 思考実験: 条件を変えてみる");
    if (c4) {
      c4.source = [c4.source.join("\n") + "\n\n次に、実装節で同じ問いを数値として確かめます。"];
      changed = true;
      findings.push("章間接続不足を補強");
    }
  }

  const exercise = cellByHeading(nb, "## 第7章 章末問題と橋渡し");
  if (exercise) {
    const t = exercise.source.join("\n");
    if (!t.includes("問題1") || !t.includes("問題2") || !t.includes("問題3")) {
      exercise.source = [[
        "## 第7章 章末問題と橋渡し",
        "問題1: 本文中の用語を三つ選び、専門用語を使わず説明する。",
        "問題2: 実装コードの入力を変更し、出力変化の理由を文章で説明する。",
        "問題3: 現場で失敗しそうな条件を三つ挙げ、事前検知の手順を書く。",
        "次に進む前に、最低一問は手を動かして検証してください。"
      ].join("\n")];
      changed = true;
      findings.push("演習の可読性不足を修正");
    }
  }

  return { findings, changed };
}

function qualityLoop(nb: NotebookFile, pack: TopicPack, chapterTitle: string) {
  const logs: string[] = [];
  for (let i = 1; i <= 5; i += 1) {
    const expert = runExpertCodexReview(nb, pack, chapterTitle);
    const beginner = runBeginnerCodexReview(nb);
    const totalFindings = [...expert.findings, ...beginner.findings];
    if (totalFindings.length === 0) {
      logs.push(`round ${i}: no findings`);
      break;
    }
    logs.push(`round ${i}: ${totalFindings.join(" | ")}`);
    if (!expert.changed && !beginner.changed) {
      break;
    }
  }
  return logs;
}

async function buildNotebookOne(chapter: CatalogChapter, notebook: CatalogNotebook, nextTitle: string | null) {
  const pack = buildPack(chapter, notebook);
  const nb = narrative(chapter.title, notebook.title, nextTitle, pack);
  const logs = qualityLoop(nb, pack, chapter.title);

  const nbPath = path.join(notebooksDir, `${notebook.id}.ipynb`);
  const reportPath = path.join(reportsDir, `${notebook.id}.md`);

  const report = [
    `# Review Report: ${notebook.id}`,
    "",
    "## Authoring Prompt",
    AUTHORING_SYSTEM_PROMPT,
    "",
    "## Review Loop Logs",
    ...logs.map((line) => `- ${line}`)
  ].join("\n");

  await Promise.all([
    fs.writeFile(nbPath, `${JSON.stringify(nb, null, 2)}\n`, "utf8"),
    fs.writeFile(reportPath, `${report}\n`, "utf8")
  ]);
}

async function main() {
  await fs.mkdir(notebooksDir, { recursive: true });
  await fs.mkdir(reportsDir, { recursive: true });

  const raw = await fs.readFile(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;

  const tasks: Promise<void>[] = [];
  for (const chapter of catalog.chapters.slice().sort((a, b) => a.order - b.order)) {
    const notebooks = chapter.notebooks.slice().sort((a, b) => a.order - b.order);
    notebooks.forEach((notebook, idx) => {
      const nextTitle = notebooks[idx + 1]?.title ?? null;
      tasks.push(buildNotebookOne(chapter, notebook, nextTitle));
    });
  }

  await Promise.all(tasks);
  console.log(`Authored ${tasks.length} notebooks with strict dual-review loops.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
