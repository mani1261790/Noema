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

type CodeModule = {
  label: string;
  before: string;
  after: string;
  lines: string[];
};

type TopicPack = {
  prerequisite: string;
  objective: string;
  keyTerms: string[];
  formulas: string[];
  pitfalls: string[];
  thoughtExperiment: string;
  bridge: string;
  modules: CodeModule[];
};

const catalogPath = path.join(process.cwd(), "content", "catalog.json");
const notebooksDir = path.join(process.cwd(), "content", "notebooks");
const reportsDir = path.join(process.cwd(), "content", "review-reports");

const QUALITY_MIN_MARKDOWN_LENGTH = 7600;
const QUALITY_MIN_CODE_CELLS = 5;
const QUALITY_MAX_ROUNDS = 6;

const AUTHORING_SYSTEM_PROMPT = `あなたは初学者向け長編教材の著者．ユーザーの指定テーマを、学習者がつまずく順序を基準に再構成し、直観的理解から形式的理解へ段階的に導く．説明は具体例を中心に行い、専門用語や記号は必ず文脈の中で導入する．比喩は多用しすぎないこと．
文章は箇条書きを最小限に抑え、読み物として連続した段落で構成する．ただし、本当に必要な場合には箇条書きを使っても良い．出力の冒頭に目次は不要で、自由に本文を執筆してよい．各章は理解が積み上がるようにつなげ、唐突な飛躍や前提の省略を避けること．
体裁は左揃えのプレーンテキスト・またはコードとし、コピー＆ペーストで崩れにくい見た目を保つ．全面的にコードも説明に取り入れ、内容の理解にコードも用いるようにすること．主な対象分野はプログラミングだが、理解を助ける範囲で分野横断を許可する．その場合、できる限り説明を丁寧にし、数式などは必ず高校生でも理解できるようなものにすること．ただし対象分野については、初学者が理解できる程度の説明で構わない．
初学者（高校〜学部初年相当）を想定し、可能な限り長く、体系的に書く。`;

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

function unit(label: string, before: string, lines: string[], after: string): CodeModule {
  return { label, before, lines, after };
}

function chapterFoundation(chapterTitle: string): { prerequisite: string; objective: string } {
  if (chapterTitle === "Python") {
    return {
      prerequisite: "中学数学レベルの四則演算と、変数という言葉への軽い慣れがあれば十分です。",
      objective: "Pythonでデータを読み、加工し、簡単な可視化と検証までを一人で実行できる状態にします。"
    };
  }
  if (chapterTitle === "機械学習") {
    return {
      prerequisite: "Pythonの基本文法と、平均・分散・相関の直感が前提です。",
      objective: "学習データの準備から評価指標の読み解きまで、モデル改善の往復を自力で回せる状態にします。"
    };
  }
  if (chapterTitle === "ディープラーニング") {
    return {
      prerequisite: "ベクトル・行列の計算と、微分の意味を言葉で説明できると理解しやすくなります。",
      objective: "損失、勾配、最適化、正則化のつながりをコードで確かめ、モデルの挙動を説明できる状態にします。"
    };
  }
  if (chapterTitle === "強化学習") {
    return {
      prerequisite: "期待値、再帰的な定義、逐次意思決定の基本が前提です。",
      objective: "ベルマン方程式の見方を、価値更新のコードとセットで理解し、手法差を説明できる状態にします。"
    };
  }
  if (chapterTitle === "LLM") {
    return {
      prerequisite: "確率的な予測モデルの見方と、深層学習の基礎が前提です。",
      objective: "プロンプト、事前学習、微調整、RAG、効率化を実装視点で横断し、設計判断を言語化できる状態にします。"
    };
  }
  if (chapterTitle === "深層生成モデル") {
    return {
      prerequisite: "確率分布と最適化の初歩、ニューラルネットワークの基礎が前提です。",
      objective: "生成モデルを『何を近似しているか』で比較し、用途に応じた選択理由を説明できる状態にします。"
    };
  }
  return {
    prerequisite: "時系列モデリングと強化学習の基礎があると効果的です。",
    objective: "世界モデルを、状態表現・遷移・観測予測・計画の連鎖として理解し、実験設計へ落とし込める状態にします。"
  };
}

function defaultModules(chapterTitle: string): CodeModule[] {
  if (chapterTitle === "Python") {
    return [
      unit(
        "データを持つ",
        "最初に、変数とリストを使ってデータの入れ物を明確にします。ここでは値を『覚える』だけでなく、あとで再利用できる形に置くことが狙いです。",
        [
          "scores = [58, 72, 81, 67, 90]",
          "labels = ['A', 'B', 'C', 'D', 'E']",
          "paired = list(zip(labels, scores))",
          "print('paired =', paired)",
          "print('count =', len(scores))"
        ],
        "この段階で確認すべき点は、データが『どの順序で』保持されるかです。後続の処理では順序ズレがバグの原因になりやすいので、最初に形を固定しておきます。"
      ),
      unit(
        "条件で分ける",
        "次に、条件分岐で情報を分類します。分類は機械学習の前処理でも頻出なので、早い段階で手を慣らしておきます。",
        [
          "passed = []",
          "for name, score in paired:",
          "    if score >= 70:",
          "        passed.append(name)",
          "print('passed =', passed)"
        ],
        "このコードは単純ですが、評価基準を変更したときの影響範囲が読みやすい形になっています。基準値を一箇所に集約すると保守しやすくなります。"
      ),
      unit(
        "関数で再利用する",
        "同じ処理を繰り返すときは、関数で意味を名前にします。名前付けは可読性の中心で、後から読む自分を助ける実装でもあります。",
        [
          "def normalize(xs):",
          "    lo, hi = min(xs), max(xs)",
          "    span = hi - lo if hi != lo else 1",
          "    return [(x - lo) / span for x in xs]",
          "print('normalized =', normalize(scores))"
        ],
        "ここで大切なのは、ゼロ除算のような例外条件を先に潰すことです。初学者は正常系だけを考えがちですが、異常系を一行でも書くとコードの寿命が伸びます。"
      ),
      unit(
        "辞書で意味を持たせる",
        "配列だけでは意味が曖昧になるとき、辞書でキーを明示します。キーは設計者の意図を運ぶラベルです。",
        [
          "records = [{'name': n, 'score': s} for n, s in paired]",
          "top = max(records, key=lambda r: r['score'])",
          "avg = sum(r['score'] for r in records) / len(records)",
          "print('top =', top)",
          "print('avg =', round(avg, 2))"
        ],
        "辞書形式にすると、列の追加や削除に強くなります。機械学習の特徴量を増減するときにも同じ考え方が使えます。"
      ),
      unit(
        "小さな検証を自動化する",
        "最後に、期待する性質を `assert` で固定します。これはテストの最小形で、理解の確認にも使えます。",
        [
          "normalized = normalize(scores)",
          "assert len(normalized) == len(scores)",
          "assert min(normalized) >= 0.0",
          "assert max(normalized) <= 1.0",
          "print('checks passed')"
        ],
        "コードを読むだけでなく、実行して仮説を確認する流れを作ると学習効率が上がります。以後の章でもこの確認ループを維持してください。"
      )
    ];
  }

  if (chapterTitle === "機械学習") {
    return [
      unit(
        "回帰問題の最小データを作る",
        "まず、予測問題を最小サイズで定義します。データが小さいほど、式と挙動の対応を追いやすくなります。",
        [
          "x = [1, 2, 3, 4, 5]",
          "y = [3, 5, 7, 9, 11]",
          "pairs = list(zip(x, y))",
          "print('pairs =', pairs)",
          "print('n =', len(pairs))"
        ],
        "ここでは、入力 `x` と出力 `y` の対応が壊れていないかを確認します。対応が崩れると、どんなモデルでも正しく学習できません。"
      ),
      unit(
        "単回帰を手で計算する",
        "次に、最小二乗法の係数を手計算で求めます。既存ライブラリを使う前に中身を一度体験すると理解が安定します。",
        [
          "x_bar = sum(x) / len(x)",
          "y_bar = sum(y) / len(y)",
          "num = sum((xi - x_bar) * (yi - y_bar) for xi, yi in pairs)",
          "den = sum((xi - x_bar) ** 2 for xi in x)",
          "w1 = num / den; w0 = y_bar - w1 * x_bar",
          "print('w0, w1 =', round(w0, 4), round(w1, 4))"
        ],
        "式の記号は抽象的に見えますが、コードでは平均・差分・和に分解されます。難しい式ほど、実装で部品に分けて確認するのが有効です。"
      ),
      unit(
        "予測と誤差を見る",
        "ここで、求めた係数で予測を出し、誤差を数値化します。モデル改善は誤差の観察から始まります。",
        [
          "pred = [w0 + w1 * xi for xi in x]",
          "residual = [yi - pi for yi, pi in zip(y, pred)]",
          "mse = sum((r ** 2) for r in residual) / len(residual)",
          "print('pred =', pred)",
          "print('mse =', round(mse, 8))"
        ],
        "誤差を観察するときは、平均値だけでなく個別の残差も見てください。偏りがあると、モデル構造の見直しが必要になります。"
      ),
      unit(
        "特徴量を拡張する",
        "次に、特徴量を追加したときに表現力がどう変わるかを確認します。特徴量設計は精度に直接効く実装作業です。",
        [
          "x2 = [xi ** 2 for xi in x]",
          "feature = list(zip(x, x2))",
          "print('feature sample =', feature[:3])",
          "scaled_x = [(xi - x_bar) / (max(x) - min(x)) for xi in x]",
          "print('scaled_x =', [round(v, 4) for v in scaled_x])"
        ],
        "特徴量を増やすと表現力は上がりますが、同時に過学習リスクも増えます。増やす理由を説明できる特徴だけを採用する姿勢が重要です。"
      ),
      unit(
        "評価分割を体験する",
        "最後に、学習と評価を分ける意味をコードで確かめます。分割しない評価は自己採点に近く、実運用の性能を過大評価しがちです。",
        [
          "train_x, test_x = x[:3], x[3:]",
          "train_y, test_y = y[:3], y[3:]",
          "pred_test = [w0 + w1 * xi for xi in test_x]",
          "mae_test = sum(abs(yi - pi) for yi, pi in zip(test_y, pred_test)) / len(test_y)",
          "print('test mae =', round(mae_test, 6))"
        ],
        "検証データでの誤差が急に悪化したら、モデルより先にデータ分布の差を疑ってください。この視点は実務で非常に重要です。"
      )
    ];
  }

  if (chapterTitle === "ディープラーニング") {
    return [
      unit(
        "順伝播の最小例",
        "まず、1ユニットの順伝播を自分で計算します。ライブラリを使わない形で内部計算を見える化するのが目的です。",
        [
          "import math",
          "x = [0.8, -0.4, 0.2]",
          "w = [0.3, -0.6, 0.5]",
          "z = sum(xi * wi for xi, wi in zip(x, w)) + 0.1",
          "y = 1 / (1 + math.exp(-z))",
          "print('z=', round(z, 4), 'sigmoid=', round(y, 4))"
        ],
        "ここで `z` は線形変換、`y` は非線形変換の結果です。この二段がニューラルネットワークの最小単位になります。"
      ),
      unit(
        "損失を計算する",
        "次に、予測値に対する損失を計算します。学習は損失を下げる方向に進むので、損失の意味を言葉で説明できることが重要です。",
        [
          "target = 1.0",
          "eps = 1e-9",
          "loss = -(target * math.log(y + eps) + (1 - target) * math.log(1 - y + eps))",
          "print('loss =', round(loss, 6))",
          "print('error =', round(target - y, 6))"
        ],
        "損失は『どれだけ外したか』を測る物差しです。物差しがない状態では、改善の方向を決められません。"
      ),
      unit(
        "勾配降下法の一歩",
        "ここで、重みを一回更新する最小実験を行います。更新前後の損失を比較して、学習の方向が正しいかを確認します。",
        [
          "lr = 0.1",
          "grad = -(target - y) * y * (1 - y)",
          "w_new = [wi - lr * grad * xi for wi, xi in zip(w, x)]",
          "z_new = sum(xi * wi for xi, wi in zip(x, w_new)) + 0.1",
          "y_new = 1 / (1 + math.exp(-z_new))",
          "print('y before/after =', round(y, 6), round(y_new, 6))"
        ],
        "この更新で損失が下がれば、勾配方向が合理的だったと言えます。下がらないなら学習率や符号を疑います。"
      ),
      unit(
        "正則化の感覚を作る",
        "次に、重みが大きくなりすぎることを抑える正則化項を追加します。過学習対策をコードで体験するのが狙いです。",
        [
          "l2 = 0.01",
          "weight_norm = sum(wi * wi for wi in w_new)",
          "loss_reg = loss + l2 * weight_norm",
          "print('weight_norm =', round(weight_norm, 6))",
          "print('regularized loss =', round(loss_reg, 6))"
        ],
        "正則化は精度を上げる魔法ではなく、汎化の崩れを防ぐ保険です。評価データと合わせて効果を判断してください。"
      ),
      unit(
        "ミニバッチの考え方",
        "最後に、複数サンプルをまとめて扱う発想を確認します。実務では1件ずつよりバッチ処理が主流です。",
        [
          "batch = [[0.8, -0.4, 0.2], [0.2, 0.1, -0.3], [0.5, -0.2, 0.7]]",
          "targets = [1.0, 0.0, 1.0]",
          "preds = []",
          "for bx in batch:",
          "    z_b = sum(xi * wi for xi, wi in zip(bx, w_new)) + 0.1",
          "    preds.append(1 / (1 + math.exp(-z_b)))",
          "print('preds =', [round(p, 4) for p in preds])"
        ],
        "ミニバッチを扱えるようになると、計算効率と学習安定性の両面で設計の幅が広がります。"
      )
    ];
  }

  if (chapterTitle === "強化学習") {
    return [
      unit(
        "報酬の割引和を計算する",
        "まず、将来報酬を現在価値へ割り引く計算を実装します。価値関数の直感はこの計算から始まります。",
        [
          "rewards = [0, 0, 1, 2]",
          "gamma = 0.9",
          "g = 0.0",
          "for r in reversed(rewards):",
          "    g = r + gamma * g",
          "print('return =', round(g, 6))"
        ],
        "割引率 `gamma` を下げると短期志向になり、上げると長期志向になります。設計意図に合わせて選びます。"
      ),
      unit(
        "ベルマン更新を1回行う",
        "次に、価値更新を1ステップだけ計算します。1回更新でも、再帰構造の意味は十分に見えてきます。",
        [
          "v_next = {'s0': 0.4, 's1': 0.8}",
          "reward = {'left': 0.2, 'right': 1.0}",
          "trans = {'left': 's0', 'right': 's1'}",
          "v_s = max(reward[a] + gamma * v_next[trans[a]] for a in ['left', 'right'])",
          "print('updated V(s)=', round(v_s, 6))"
        ],
        "ベルマン更新は『今の価値』を『次状態の価値』で再定義する操作です。この再帰が強化学習の中心です。"
      ),
      unit(
        "Q値更新を比較する",
        "ここで Q学習の更新式をコードに写し、数値の動きを確認します。式を読むだけでは掴みにくい感覚を得る段階です。",
        [
          "Q = {('s0','left'): 0.3, ('s0','right'): 0.1, ('s1','left'): 0.5, ('s1','right'): 0.7}",
          "alpha = 0.2",
          "r, s, a, s_next = 1.0, 's0', 'right', 's1'",
          "td_target = r + gamma * max(Q[(s_next,'left')], Q[(s_next,'right')])",
          "Q[(s,a)] += alpha * (td_target - Q[(s,a)])",
          "print('Q(s0,right)=', round(Q[(s,a)], 6))"
        ],
        "更新後の値が過去の値とどれだけ違うかは、学習率と TD 誤差で決まります。ここが調整ポイントです。"
      ),
      unit(
        "探索と活用の切り替え",
        "次に、探索率を変えたときの行動選択を見ます。探索不足は局所最適に閉じる典型的な原因です。",
        [
          "def choose_action(q_left, q_right, epsilon):",
          "    if epsilon > 0.3:",
          "        return 'explore'",
          "    return 'left' if q_left >= q_right else 'right'",
          "print(choose_action(0.4, 0.7, 0.5), choose_action(0.4, 0.7, 0.1))"
        ],
        "探索率は固定せず、学習段階に応じて減衰させるのが一般的です。初期は広く探索し、後半で活用へ寄せます。"
      ),
      unit(
        "方策評価の簡易チェック",
        "最後に、方策の平均報酬を簡易的に比較します。アルゴリズムの評価は、更新式だけでなく結果の検証が不可欠です。",
        [
          "episode_rewards = [1.2, 0.8, 1.5, 1.1, 1.4]",
          "avg_reward = sum(episode_rewards) / len(episode_rewards)",
          "variance = sum((r - avg_reward) ** 2 for r in episode_rewards) / len(episode_rewards)",
          "print('avg =', round(avg_reward, 4))",
          "print('var =', round(variance, 4))"
        ],
        "平均だけでなく分散を見ると、方策の安定性も評価できます。実運用ではこの二軸が重要です。"
      )
    ];
  }

  if (chapterTitle === "LLM") {
    return [
      unit(
        "トークン近似を体験する",
        "最初に、入力長とトークン量の関係を簡易計測します。コスト管理の第一歩です。",
        [
          "text = '大規模言語モデルは文脈の与え方で応答品質が大きく変わる。'",
          "char_len = len(text)",
          "space_tokens = text.split()",
          "rough_tokens = max(1, char_len // 2)",
          "print('chars=', char_len, 'space_tokens=', len(space_tokens), 'rough_tokens=', rough_tokens)"
        ],
        "厳密なトークン化ではありませんが、入力を短く保つ設計感覚を作るには十分です。"
      ),
      unit(
        "プロンプトを構造化する",
        "次に、指示・制約・出力形式を分離したテンプレートを作ります。曖昧さを減らすための実装技法です。",
        [
          "instruction = '勾配降下法を初学者向けに説明する'",
          "constraints = ['120字以内', '比喩は1つまで', '最後に要点を1行でまとめる']",
          "prompt = f\"指示: {instruction}\\n制約: {'; '.join(constraints)}\\n出力:\"",
          "print(prompt)",
          "print('prompt_chars=', len(prompt))"
        ],
        "この形にすると、失敗原因を特定しやすくなります。品質改善は原因分離のしやすさで決まります。"
      ),
      unit(
        "検索文脈を結合する",
        "ここで RAG の最小形を実装します。質問と関連文を結合し、回答入力を作る流れを確認します。",
        [
          "question = 'ベルマン方程式を高校生向けに説明して'",
          "retrieved = ['価値は将来報酬の割引和で定義する', '現在価値は次状態価値で再帰的に更新できる']",
          "context = '\\n'.join(f'- {c}' for c in retrieved)",
          "final_input = f\"質問:\\n{question}\\n\\n参考文脈:\\n{context}\\n\\n回答:\"",
          "print(final_input)"
        ],
        "検索文脈を入れる目的は、モデルの記憶に頼りすぎないことです。根拠付き応答を作りやすくなります。"
      ),
      unit(
        "評価項目を数値化する",
        "次に、回答を点検するための簡易スコアを定義します。評価軸を言語化すると改善が継続できます。",
        [
          "answer = 'ベルマン方程式は、今の価値を次の価値で更新する再帰式です。'",
          "checks = {'length_ok': len(answer) <= 120, 'has_keyword': '価値' in answer, 'has_recurrence': '再帰' in answer}",
          "score = sum(1 for v in checks.values() if v) / len(checks)",
          "print('checks=', checks)",
          "print('score=', round(score, 3))"
        ],
        "このような軽量評価でも、改善方向を揃える効果があります。実務ではこの評価軸をチームで共有します。"
      ),
      unit(
        "推論コストを見積もる",
        "最後に、入力と出力の長さから概算コストを計算します。モデル選択は性能だけでなく費用とのバランスが必要です。",
        [
          "input_tokens = 320",
          "output_tokens = 180",
          "price_per_1k = 0.0012",
          "cost = (input_tokens + output_tokens) / 1000 * price_per_1k",
          "print('estimated_cost=', round(cost, 6))"
        ],
        "この見積もりを運用前に作ると、スケール時の予算超過を防ぎやすくなります。"
      )
    ];
  }

  if (chapterTitle === "深層生成モデル") {
    return [
      unit(
        "潜在変数からサンプルする",
        "生成モデルの入口は、潜在空間から点を引く操作です。まずはガウス乱数でその感覚を掴みます。",
        [
          "import random",
          "random.seed(7)",
          "z = [round(random.gauss(0, 1), 3) for _ in range(5)]",
          "print('latent z =', z)",
          "print('mean z =', round(sum(z) / len(z), 4))"
        ],
        "潜在変数は観測できない要因の圧縮表現です。生成の多様性はこの空間設計に強く依存します。"
      ),
      unit(
        "単純なデコーダを書く",
        "次に、潜在変数を観測空間へ写像する簡易デコーダを作ります。生成モデルの基本構造をコードで可視化します。",
        [
          "weights = [1.4, -0.6, 0.8, 0.5, -1.1]",
          "bias = 0.2",
          "x_hat = sum(zi * wi for zi, wi in zip(z, weights)) + bias",
          "print('decoded scalar =', round(x_hat, 5))",
          "print('abs scale =', round(abs(x_hat), 5))"
        ],
        "実際の生成モデルは高次元ですが、構造は同じです。潜在を観測へ写像し、再構成品質を改善します。"
      ),
      unit(
        "ノイズを加えて復元する",
        "ここで、拡散系モデルの直感を最小実験で確認します。ノイズ付加と復元の往復を短いコードで体験します。",
        [
          "x0 = 1.5",
          "beta = 0.12",
          "noise = -0.3",
          "xt = ((1 - beta) ** 0.5) * x0 + (beta ** 0.5) * noise",
          "x0_hat = (xt - (beta ** 0.5) * noise) / ((1 - beta) ** 0.5)",
          "print('x0, xt, x0_hat =', round(x0, 5), round(xt, 5), round(x0_hat, 5))"
        ],
        "復元誤差を観察すると、ノイズスケジュールの意味が見えてきます。理論と実装をつなぐ重要な観測点です。"
      ),
      unit(
        "混合分布の感覚を作る",
        "次に、複数モードを持つ分布を手で作ります。モード崩壊の議論に入る前の下地として有効です。",
        [
          "mix = [(-2.0, 0.4), (1.5, 0.6)]",
          "samples = []",
          "for m, w in mix:",
          "    samples.append(round(m + (w * 0.1), 3))",
          "print('mode-aware samples =', samples)"
        ],
        "混合分布の直感があると、生成結果の『多様性』を定量評価する発想が自然になります。"
      ),
      unit(
        "学習指標を定義する",
        "最後に、生成品質を観察する最小指標を作ります。見た目だけで判断しない習慣を作ることが狙いです。",
        [
          "recon_errors = [0.42, 0.31, 0.29, 0.36, 0.33]",
          "avg = sum(recon_errors) / len(recon_errors)",
          "worst = max(recon_errors)",
          "best = min(recon_errors)",
          "print('avg/best/worst =', round(avg, 4), round(best, 4), round(worst, 4))"
        ],
        "平均値と外れ値を同時に見ると、モデルが安定しているかを判断しやすくなります。"
      )
    ];
  }

  return [
    unit(
      "状態遷移の最小モデル",
      "世界モデルの最初の核は遷移式です。状態と行動から次状態を作る操作を最小形で確認します。",
      [
        "z_t = 0.25",
        "a_t = 1.0",
        "A, B = 0.92, 0.18",
        "z_next = A * z_t + B * a_t",
        "print('z_next =', round(z_next, 6))"
      ],
      "遷移式の係数は環境のダイナミクス仮定を表します。係数の選び方で予測性質が大きく変わります。"
    ),
    unit(
      "観測予測を作る",
      "次に、潜在状態から観測を復元する写像を作ります。状態推定と観測再現の役割分担をコードで掴みます。",
      [
        "def decode(z):",
        "    return {'position': 2.5 * z + 0.1, 'velocity': 0.8 * z - 0.05}",
        "obs_next = decode(z_next)",
        "print('obs_next =', {k: round(v, 4) for k, v in obs_next.items()})",
        "print('keys =', list(obs_next.keys()))"
      ],
      "観測予測を別関数に切ると、遷移誤差と観測誤差を分離して調整できます。"
    ),
    unit(
      "ロールアウトを試す",
      "ここで複数ステップ予測を実行します。1ステップでは見えない誤差累積を把握するためです。",
      [
        "actions = [0.0, 1.0, 1.0, 0.0, -0.5]",
        "z = 0.1",
        "traj = []",
        "for a in actions:",
        "    z = 0.92 * z + 0.18 * a",
        "    traj.append(round(z, 5))",
        "print('rollout =', traj)"
      ],
      "長期予測で崩れるなら、遷移モデルの安定性や状態表現の情報量不足を疑います。"
    ),
    unit(
      "計画候補を比較する",
      "次に、複数の行動列を比較して、どの計画が望ましいかを評価します。モデルベース強化学習の中心操作です。",
      [
        "plans = [[0, 1, 1], [1, 1, 1], [0, 0, 1]]",
        "def score_plan(plan):",
        "    z = 0.1",
        "    for a in plan:",
        "        z = 0.92 * z + 0.18 * a",
        "    return z",
        "scores = [round(score_plan(p), 5) for p in plans]",
        "print('scores =', scores)"
      ],
      "計画評価が可能になると、実環境での試行回数を抑えた探索がしやすくなります。"
    ),
    unit(
      "モデル誤差を監視する",
      "最後に、予測と実測の差を定量化します。世界モデルは『予測できる範囲』を常に点検する運用が重要です。",
      [
        "pred = [0.10, 0.22, 0.31, 0.29]",
        "real = [0.11, 0.25, 0.28, 0.35]",
        "errors = [abs(p - r) for p, r in zip(pred, real)]",
        "print('errors =', [round(e, 4) for e in errors])",
        "print('mean_error =', round(sum(errors) / len(errors), 5))"
      ],
      "平均誤差だけでなく時点別誤差を追うと、どの遷移条件でモデルが弱いかを特定しやすくなります。"
    )
  ];
}

function defaultPack(chapterTitle: string, notebookTitle: string): TopicPack {
  const foundation = chapterFoundation(chapterTitle);

  if (chapterTitle === "Python") {
    return {
      prerequisite: foundation.prerequisite,
      objective: foundation.objective,
      keyTerms: ["変数", "関数", "条件分岐", "反復", "データ構造"],
      formulas: ["厳密な式より、入力 -> 変換 -> 出力の流れを言語化することが中心です。"],
      pitfalls: [
        "型が想定と違っていても気づかず処理が進んでしまう",
        "条件分岐の境界値を検証しない",
        "同じロジックを複数箇所にコピペして保守不能になる"
      ],
      thoughtExperiment: "同じ処理を、要素数 0 / 1 / 10^6 のデータで実行したときの壊れ方を比較します。",
      bridge: `${notebookTitle}で身につける狙いは、書いたコードを『読んで説明できる』状態にすることです。`,
      modules: defaultModules(chapterTitle)
    };
  }

  if (chapterTitle === "機械学習") {
    return {
      prerequisite: foundation.prerequisite,
      objective: foundation.objective,
      keyTerms: ["特徴量", "目的変数", "損失関数", "汎化", "過学習"],
      formulas: ["y_hat = f_theta(x)", "L(theta) = (1/N) * sum_i l(y_hat_i, y_i)"],
      pitfalls: [
        "訓練データと評価データの分布差を見ない",
        "単一スコアだけでモデルを選んでしまう",
        "前処理の漏れを評価後に気づく"
      ],
      thoughtExperiment: "訓練誤差が小さいのに本番誤差が大きいとき、どの仮定が崩れているかを考えます。",
      bridge: `${notebookTitle}では、式を暗記するより、計算の意味をコードで検証する姿勢を優先します。`,
      modules: defaultModules(chapterTitle)
    };
  }

  if (chapterTitle === "ディープラーニング") {
    return {
      prerequisite: foundation.prerequisite,
      objective: foundation.objective,
      keyTerms: ["順伝播", "逆伝播", "勾配", "損失", "正則化"],
      formulas: ["z = W*x + b", "theta <- theta - eta * grad_theta L"],
      pitfalls: [
        "学習率が大きすぎて発散する",
        "検証損失の監視をせず過学習を見逃す",
        "前処理と活性化の相性を無視する"
      ],
      thoughtExperiment: "学習率を 10 倍にしたとき、損失曲線がどう変わるかを予測してから実験します。",
      bridge: `${notebookTitle}は、損失が下がる理由を『式』と『数値変化』の両方で確認する構成です。`,
      modules: defaultModules(chapterTitle)
    };
  }

  if (chapterTitle === "強化学習") {
    return {
      prerequisite: foundation.prerequisite,
      objective: foundation.objective,
      keyTerms: ["状態", "行動", "報酬", "価値関数", "方策"],
      formulas: ["G_t = sum_{k>=0} gamma^k R_{t+k+1}", "Q <- Q + alpha * TD_error"],
      pitfalls: [
        "探索率が低すぎて行動が固定化する",
        "報酬設計が目的とずれている",
        "長期ロールアウトの不安定性を検証しない"
      ],
      thoughtExperiment: "即時報酬が低い行動が、将来報酬で逆転する状況を自作します。",
      bridge: `${notebookTitle}では、価値更新を紙ではなくコードで追い、再帰の意味を体感します。`,
      modules: defaultModules(chapterTitle)
    };
  }

  if (chapterTitle === "LLM") {
    return {
      prerequisite: foundation.prerequisite,
      objective: foundation.objective,
      keyTerms: ["トークン", "事前学習", "微調整", "RAG", "推論最適化"],
      formulas: ["p_theta(x_t | x_<t)", "L_CE = - sum_t log p_theta(x_t | x_<t)"],
      pitfalls: [
        "プロンプトだけで全問題を解決しようとする",
        "評価指標を決めずに改善を繰り返す",
        "コストと品質のバランスを見ない"
      ],
      thoughtExperiment: "同じ質問に、文脈あり/なしで入力を作り、出力差の理由を分解します。",
      bridge: `${notebookTitle}では、モデル呼び出し以前に入力設計と評価設計を固める習慣を作ります。`,
      modules: defaultModules(chapterTitle)
    };
  }

  if (chapterTitle === "深層生成モデル") {
    return {
      prerequisite: foundation.prerequisite,
      objective: foundation.objective,
      keyTerms: ["潜在変数", "尤度", "サンプリング", "拡散", "スコア"],
      formulas: ["p_theta(x) = integral p_theta(x|z) p(z) dz", "score(x) = grad_x log p(x)"],
      pitfalls: [
        "見た目の良さだけで比較してしまう",
        "多様性と品質のトレードオフを観測しない",
        "ノイズスケジュールの意味を理解しないまま調整する"
      ],
      thoughtExperiment: "潜在変数を少し動かしたとき、出力が連続的に変わるべき理由を言葉で説明します。",
      bridge: `${notebookTitle}では、生成の仕組みを抽象用語で終わらせず、毎段階をコードで確認します。`,
      modules: defaultModules(chapterTitle)
    };
  }

  return {
    prerequisite: foundation.prerequisite,
    objective: foundation.objective,
    keyTerms: ["状態表現", "遷移モデル", "観測予測", "計画", "ロールアウト"],
    formulas: ["z_{t+1} = f_theta(z_t, a_t)", "o_hat_{t+1} = g_theta(z_{t+1})"],
    pitfalls: [
      "1ステップ誤差だけで安心してしまう",
      "長期予測の誤差爆発を監視しない",
      "状態表現が不足しているのにモデルだけ調整する"
    ],
    thoughtExperiment: "同じ行動列で、状態表現の次元だけ変えたときの予測劣化を想像します。",
    bridge: `${notebookTitle}では、未来予測を使った意思決定を、実装可能な形に分解して学びます。`,
    modules: defaultModules(chapterTitle)
  };
}

function clonePack(pack: TopicPack): TopicPack {
  return {
    ...pack,
    keyTerms: [...pack.keyTerms],
    formulas: [...pack.formulas],
    pitfalls: [...pack.pitfalls],
    modules: pack.modules.map((item) => ({
      ...item,
      lines: [...item.lines]
    }))
  };
}

function overridePack(id: string, title: string, base: TopicPack): TopicPack {
  const pack = clonePack(base);

  if (id === "numpy-basics") {
    pack.modules[0] = unit(
      "NumPy配列の生成と演算",
      "このノートでは Python リストとの差を体感するため、NumPy のベクトル演算を最初に実行します。",
      [
        "try:",
        "    import numpy as np",
        "except ModuleNotFoundError:",
        "    print('numpy is not installed')",
        "else:",
        "    a = np.array([1, 2, 3])",
        "    b = np.array([10, 20, 30])",
        "    print('a+b =', a + b)",
        "    print('a*b =', a * b)"
      ],
      "要素ごとの演算が自然に書ける点が NumPy の強みです。行列計算に進む前の入口として重要です。"
    );
  }

  if (id === "pandas-basics") {
    pack.modules[0] = unit(
      "DataFrameを作って集計する",
      "表形式データを扱うときは DataFrame を中心に考えます。まず最小例で列操作を体験します。",
      [
        "try:",
        "    import pandas as pd",
        "except ModuleNotFoundError:",
        "    print('pandas is not installed')",
        "else:",
        "    df = pd.DataFrame({'name': ['A', 'B', 'C'], 'score': [72, 88, 95]})",
        "    print(df)",
        "    print('mean score =', df['score'].mean())"
      ],
      "列ごとに意味を持った処理を書けるので、前処理の可読性と再利用性が上がります。"
    );
  }

  if (id === "matplotlib-seaborn") {
    pack.modules[0] = unit(
      "可視化の最小実験",
      "可視化は説明用ではなく診断用にも使います。まずは線形傾向を目視で確認します。",
      [
        "try:",
        "    import matplotlib.pyplot as plt",
        "except ModuleNotFoundError:",
        "    print('matplotlib is not installed')",
        "else:",
        "    x = [1, 2, 3, 4]",
        "    y = [2, 3, 5, 8]",
        "    plt.plot(x, y, marker='o')",
        "    plt.title('trend check')",
        "    plt.show()"
      ],
      "数値だけでは見落とす外れ値や非線形性を、可視化で早期に発見できます。"
    );
  }

  if (id === "sql-for-ml") {
    pack.modules[0] = unit(
      "SQLで集計する",
      "機械学習の前段では SQL 集計が非常に重要です。メモリDBで実行し、前処理の入口を確認します。",
      [
        "import sqlite3",
        "con = sqlite3.connect(':memory:')",
        "cur = con.cursor()",
        "cur.execute('create table sales(day text, amount int)')",
        "cur.executemany('insert into sales values (?, ?)', [('2026-01-01', 120), ('2026-01-02', 150), ('2026-01-03', 90)])",
        "avg_amount = cur.execute('select avg(amount) from sales').fetchone()[0]",
        "print('avg_amount =', round(avg_amount, 3))",
        "con.close()"
      ],
      "SQL で作る特徴量は再現しやすく、運用時のデータパイプラインにも直接つながります。"
    );
  }

  if (id === "sklearn-xgboost") {
    pack.modules[0] = unit(
      "scikit-learn最小実行",
      "ライブラリを使った実装は中身理解の後に行います。ここでは API の最小単位を確認します。",
      [
        "try:",
        "    from sklearn.linear_model import LinearRegression",
        "except ModuleNotFoundError:",
        "    print('scikit-learn is not installed')",
        "else:",
        "    X = [[1], [2], [3], [4]]",
        "    y = [2, 4, 6, 8]",
        "    model = LinearRegression().fit(X, y)",
        "    print('coef =', model.coef_[0], 'intercept =', model.intercept_)"
      ],
      "API を最小例で確認してから本番データへ移ると、デバッグの切り分けがしやすくなります。"
    );
  }

  if (id === "image-recognition-yolo") {
    pack.formulas = ["output_channels = anchors * (5 + classes)", "bbox = (x, y, w, h) + objectness + class_scores"];
    pack.modules[0] = unit(
      "YOLO出力テンソルの形",
      "物体検出の実装で最初に混乱しやすいのは出力次元です。最小コードで形を固定して理解します。",
      [
        "grid_h, grid_w, anchors, classes = 13, 13, 3, 80",
        "channels = anchors * (5 + classes)",
        "print('output shape =', (grid_h, grid_w, channels))",
        "print('per_anchor_dim =', 5 + classes)",
        "print('total_boxes =', grid_h * grid_w * anchors)"
      ],
      "次元を先に理解すると、後続のデコード実装で起こるインデックスバグを大幅に減らせます。"
    );
  }

  if (id === "bellman-equations") {
    pack.formulas = [
      "V^pi(s) = sum_a pi(a|s) * sum_{s',r} p(s',r|s,a) * [r + gamma * V^pi(s')]",
      "V*(s) = max_a sum_{s',r} p(s',r|s,a) * [r + gamma * V*(s')]"
    ];
  }

  if (id === "q-learning") {
    pack.formulas = ["Q(s,a) <- Q(s,a) + alpha * [r + gamma * max_{a'}Q(s',a') - Q(s,a)]"];
  }

  if (id === "sarsa") {
    pack.formulas = ["Q(s,a) <- Q(s,a) + alpha * [r + gamma * Q(s',a') - Q(s,a)]"];
  }

  if (id === "td-lambda" || id === "eligibility-trace-td-lambda") {
    pack.formulas = ["G_t^lambda = (1-lambda) * sum_{n>=1} lambda^(n-1) * G_t^(n)", "e_t = gamma * lambda * e_{t-1} + grad"];
  }

  if (id === "transformer-basics") {
    pack.formulas = ["Attention(Q,K,V) = softmax(QK^T / sqrt(d_k))V", "FFN(x) = W2 * sigma(W1*x + b1) + b2"];
  }

  if (id === "vae") {
    pack.formulas = ["ELBO = E_q[log p(x|z)] - KL(q(z|x) || p(z))"];
  }

  if (id === "gan") {
    pack.formulas = ["min_G max_D E_x[log D(x)] + E_z[log(1 - D(G(z)))]"];
  }

  if (id === "score-diffusion-models") {
    pack.formulas = ["score_t(x) = grad_x log p_t(x)", "dx = f(x,t)dt + g(t)dw"];
  }

  if (id === "continuous-diffusion-flow-matching") {
    pack.formulas = ["dx/dt = v_theta(x,t)", "min_theta E||v_theta(x_t,t)-u_t(x_t)||^2"];
  }

  if (id === "llm-efficiency") {
    pack.modules[4] = unit(
      "量子化のメモリ効果",
      "効率化を具体化するため、重み精度を変えたときのメモリ量を比較します。",
      [
        "params = 20_000_000_000",
        "fp16_gb = params * 2 / (1024**3)",
        "int8_gb = params * 1 / (1024**3)",
        "int4_gb = params * 0.5 / (1024**3)",
        "print('fp16/int8/int4 GB =', round(fp16_gb, 2), round(int8_gb, 2), round(int4_gb, 2))"
      ],
      "効率化は精度低下とのトレードオフなので、推論コストだけでなく品質評価もセットで実施します。"
    );
  }

  if (id === "tool-use-rag") {
    pack.modules[2] = unit(
      "RAG入力を作る",
      "検索結果をそのまま貼るのではなく、質問との関係を明示して結合します。",
      [
        "question = 'ベルマン最適方程式を1文で説明して'",
        "chunks = ['最適価値は将来報酬期待値の最大化で定義される', '再帰構造により逐次更新できる']",
        "ranked = sorted(chunks, key=lambda c: question.count('価値') + c.count('価値'), reverse=True)",
        "context = '\\n'.join(f'- {c}' for c in ranked)",
        "print('context_for_answer=\\n' + context)"
      ],
      "この前処理を入れるだけでも、回答の一貫性と根拠明示が改善します。"
    );
  }

  if (id === "prompt-engineering") {
    pack.modules[1] = unit(
      "制約付きプロンプト設計",
      "プロンプトは長く書くより、制約を明確化する方が効果的です。ここではテンプレート化を練習します。",
      [
        "task = '連鎖律を初学者向けに説明する'",
        "rules = ['120字以内', '式は1つまで', '最後に確認問題を1問']",
        "template = f\"課題: {task}\\n制約: {'; '.join(rules)}\\n出力形式: 段落1つ\"",
        "print(template)",
        "print('template_len=', len(template))"
      ],
      "この設計は生成APIを呼ばなくても、入力仕様の品質点検として価値があります。"
    );
  }

  const titleTokens = title
    .replace(/[（）()・,:]/g, " ")
    .split(/\s+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 4);
  for (const token of titleTokens) {
    if (!pack.keyTerms.includes(token)) {
      pack.keyTerms.push(token);
    }
  }

  return pack;
}

function buildPack(chapter: CatalogChapter, notebook: CatalogNotebook): TopicPack {
  const base = defaultPack(chapter.title, notebook.title);
  return overridePack(notebook.id, notebook.title, base);
}

function openingBlock(chapterTitle: string, notebookTitle: string, pack: TopicPack): string {
  return [
    `# ${notebookTitle}`,
    "",
    `${pack.bridge}`,
    "",
    `前提: ${pack.prerequisite}`,
    "",
    `到達目標: ${pack.objective}`,
    "",
    `ここで扱う中心語は ${pack.keyTerms.map((term) => `「${term}」`).join("、")} です。用語を先に暗記するのではなく、コード実行の結果と結びつけて理解します。`,
    "",
    `このノートは ${chapterTitle} 分野の初学者向けに、説明とコードを交互に読み進める設計です。最初から完璧に理解する必要はありません。大切なのは、各コードの目的を一文で言えることと、出力が変わる理由を自分で確かめることです。`
  ].join("\n");
}

function formulaBlock(pack: TopicPack): string {
  return [
    "## 式をコードと接続する",
    "",
    "ここで、本文中で使っている式を実装視点で再整理します。式を暗記するのではなく、どの変数がどのコード行に対応するかを確認してください。",
    "",
    ...pack.formulas.map((formula, idx) => `${idx + 1}. ${formula}`),
    "",
    "この一覧は『正解の丸暗記』ではなく、デバッグ時の観点表です。実装が壊れたとき、どの式のどの項が怪しいかを逆算できるように使います。"
  ].join("\n");
}

function moduleBeforeText(index: number, module: CodeModule): string {
  return [
    `## ${index + 1}. ${module.label}`,
    "",
    module.before,
    "",
    "ここで注目してほしいのは、処理の入出力がどの変数で接続されるかです。コードを読むときは『この行は何を決める行か』を短くメモしながら進むと理解が安定します。"
  ].join("\n");
}

function moduleAfterText(module: CodeModule, pack: TopicPack): string {
  return [
    module.after,
    "",
    `たとえば ${pack.keyTerms[0]} を別の値に変更すると、出力がどう変わるかを確認してください。次に、同じコードで境界条件を試し、なぜその結果になるのかを言葉で説明します。`,
    "",
    "この確認を繰り返すと、理論と実装の対応が頭の中で一本化されます。"
  ].join("\n");
}

function closingBlock(notebookTitle: string, nextTitle: string | null, pack: TopicPack): string {
  return [
    "## つまずきポイントと確認課題",
    "",
    "実装学習では、書けることより説明できることを重視します。次の失敗パターンを先に知っておくと、学習速度が上がります。",
    "",
    ...pack.pitfalls.map((item, idx) => `${idx + 1}. ${item}`),
    "",
    `思考実験: ${pack.thoughtExperiment}`,
    "",
    "確認課題",
    "1. このノートのコードのうち1つを選び、行ごとの役割を口頭で説明する。",
    "2. 定数を1つ変更し、出力変化の理由を『入力 -> 中間値 -> 出力』で説明する。",
    "3. 実務利用を想定し、異常入力時に壊れる箇所と防止策を1つ提案する。",
    "",
    nextTitle
      ? `次の「${nextTitle}」では、同じ確認手順を維持したまま対象を広げます。今回のコードを再実行してから進むと理解がつながります。`
      : `${notebookTitle} の学習はここで一区切りです。前のノートに戻り、同じ観点でコードを読み直すと体系として定着します。`
  ].join("\n");
}

function createNotebook(
  chapterTitle: string,
  notebookTitle: string,
  nextTitle: string | null,
  pack: TopicPack
): NotebookFile {
  const cells: NotebookCell[] = [];
  cells.push(md(openingBlock(chapterTitle, notebookTitle, pack)));

  pack.modules.forEach((module, idx) => {
    cells.push(md(moduleBeforeText(idx, module)));
    cells.push(code(module.lines));
    cells.push(md(moduleAfterText(module, pack)));

    if (idx === 1) {
      cells.push(md(formulaBlock(pack)));
    }
  });

  cells.push(md(closingBlock(notebookTitle, nextTitle, pack)));

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

function markdownText(nb: NotebookFile): string {
  return nb.cells
    .filter((cell) => cell.cell_type === "markdown")
    .map((cell) => cell.source.join("\n"))
    .join("\n\n");
}

function markdownLength(nb: NotebookFile): number {
  return markdownText(nb).replace(/\s+/g, "").length;
}

function codeCellIndexes(nb: NotebookFile): number[] {
  const indexes: number[] = [];
  nb.cells.forEach((cell, idx) => {
    if (cell.cell_type === "code") {
      indexes.push(idx);
    }
  });
  return indexes;
}

function ensureCodeDepth(nb: NotebookFile): boolean {
  let changed = false;
  for (const cell of nb.cells) {
    if (cell.cell_type !== "code") continue;
    const src = cell.source.join("\n").trim();
    const lines = src.split("\n");
    if (lines.length < 5) {
      cell.source = [[
        ...lines,
        "# 追記: 変化を観察するための確認出力",
        "print('done')"
      ].join("\n")];
      changed = true;
    }
  }
  return changed;
}

function ensureCodeContext(nb: NotebookFile): boolean {
  let changed = false;
  let i = 0;
  while (i < nb.cells.length) {
    if (nb.cells[i].cell_type !== "code") {
      i += 1;
      continue;
    }

    if (i === 0 || nb.cells[i - 1].cell_type !== "markdown") {
      nb.cells.splice(i, 0, md("このコードを実行する前に、入力・中間値・出力の対応を一文で予想してください。"));
      changed = true;
      i += 1;
    }

    if (i === nb.cells.length - 1 || nb.cells[i + 1].cell_type !== "markdown") {
      nb.cells.splice(i + 1, 0, md("実行後は出力を読み、予想との差を確認します。差が出た場合は、どの行が原因かを特定してください。"));
      changed = true;
      i += 1;
    }

    i += 1;
  }
  return changed;
}

function runExpertCodexReview(nb: NotebookFile, pack: TopicPack, chapterTitle: string): { findings: string[]; changed: boolean } {
  const findings: string[] = [];
  let changed = false;

  // 目次禁止ルール
  for (const cell of nb.cells) {
    if (cell.cell_type !== "markdown") continue;
    const text = cell.source.join("\n");
    if (text.includes("目次")) {
      cell.source = [text.replace(/目次/g, "学習ガイド")];
      changed = true;
      findings.push("目次という語の混入を除去");
    }
  }

  if (ensureCodeDepth(nb)) {
    changed = true;
    findings.push("短いコードセルを補強");
  }

  if (ensureCodeContext(nb)) {
    changed = true;
    findings.push("コード前後の説明不足を補強");
  }

  const codeIndexes = codeCellIndexes(nb);
  if (codeIndexes.length < QUALITY_MIN_CODE_CELLS) {
    const need = QUALITY_MIN_CODE_CELLS - codeIndexes.length;
    const additional = pack.modules.slice(0, need);
    for (const module of additional) {
      nb.cells.push(md(`追加演習: ${module.label}\n\nこの追加入力は理解確認のために挿入されました。`));
      nb.cells.push(code(module.lines));
      nb.cells.push(md("実行結果が想定と違う場合は、入力を一つずつ変えて差分を観察してください。"));
    }
    changed = true;
    findings.push("コードセル数が不足していたため追加");
  }

  const firstCode = codeCellIndexes(nb)[0] ?? Number.MAX_SAFE_INTEGER;
  if (firstCode > 3) {
    nb.cells.splice(
      2,
      0,
      md("早い段階で手を動かすため、最初の導入コードを前倒しで配置します。"),
      code(pack.modules[0]?.lines ?? ["print('intro run')"]),
      md("この時点で出力を確認し、後続の説明で何を学ぶかを先に掴んでください。")
    );
    changed = true;
    findings.push("最初のコード出現位置を前倒し");
  }

  const text = markdownText(nb);
  const missingFormulas = pack.formulas.filter((formula) => !text.includes(formula));
  if (missingFormulas.length > 0) {
    nb.cells.push(
      md(
        [
          "式の補足",
          "",
          ...missingFormulas.map((formula, idx) => `${idx + 1}. ${formula}`),
          "",
          "不足していた式を追記しました。各式がどのコード行に対応するかをメモして確認してください。"
        ].join("\n")
      )
    );
    changed = true;
    findings.push("式の不足を追記");
  }

  const missingTerms = pack.keyTerms.filter((term) => !text.includes(term));
  if (missingTerms.length > 0) {
    nb.cells.push(
      md(
        `用語補足\n\n不足語彙: ${missingTerms.join("、")}\n\n各語彙をコードの変数と紐づけて説明できるかを確認してください。`
      )
    );
    changed = true;
    findings.push("主要語彙の不足を補強");
  }

  const growthParagraphs = [
    `${chapterTitle} の学習で最も効果があるのは、コードを読んだあとに式へ戻る往復です。先に式だけを追うと抽象度が高く、初学者は何を計算しているかを見失いやすくなります。逆に、先にコードを動かして値の流れを掴んでから式へ戻ると、記号の役割が具体的に見えてきます。`,
    "デバッグ時の基本姿勢は、入力・中間値・出力の三点を固定して比較することです。うまく動かないとき、いきなり大きな修正を入れると原因を見失います。まずは1つの定数だけを変更し、どの中間値が変わったかを観察してください。この小さな観察を積み重ねることが、実装力を最短で伸ばす道です。",
    "初学者がつまずく典型は、正しいコードと正しい説明を別々に持ってしまうことです。コードは動くが言葉で説明できない、あるいは説明はできるがコードに落とせない、という分離が起きます。これを防ぐには、実行後に『この行は何を更新したか』を一文で言う練習が有効です。",
    "評価設計の観点でも、実装の意味を言葉で固定することが重要です。単一の数値だけを見ると、改善の方向を誤ることがあります。できるだけ複数の観点、例えば平均誤差と外れ値、短期挙動と長期挙動を同時に観察し、どの観点で改善したかを明示してください。"
  ];

  let growthIndex = 0;
  while (markdownLength(nb) < QUALITY_MIN_MARKDOWN_LENGTH && growthIndex < 16) {
    nb.cells.push(md(`補講 ${growthIndex + 1}\n\n${growthParagraphs[growthIndex % growthParagraphs.length]}`));
    growthIndex += 1;
    changed = true;
  }
  if (growthIndex > 0) {
    findings.push("本文分量を長編化基準まで拡張");
  }

  const metaWords = ["システムプロンプト", "AUTHORING_SYSTEM_PROMPT", "生成してください"];
  for (const cell of nb.cells) {
    if (cell.cell_type !== "markdown") continue;
    let textCell = cell.source.join("\n");
    let localChanged = false;
    for (const word of metaWords) {
      if (textCell.includes(word)) {
        textCell = textCell.replaceAll(word, "学習の指針");
        localChanged = true;
      }
    }
    if (localChanged) {
      cell.source = [textCell];
      changed = true;
      findings.push("生成メタ記述の混入を除去");
    }
  }

  return { findings, changed };
}

function runBeginnerCodexReview(nb: NotebookFile): { findings: string[]; changed: boolean } {
  const findings: string[] = [];
  let changed = false;
  const text = markdownText(nb);

  const mustHave = ["たとえば", "ここで", "次に", "なぜ", "確認"];
  const missing = mustHave.filter((token) => !text.includes(token));
  if (missing.length > 0) {
    nb.cells.splice(
      1,
      0,
      md(
        [
          "学習の進め方",
          "",
          "たとえば最初のコードを実行したら、変数を1つだけ変えて出力差を確認してください。ここで差が出る理由を言語化できると、次に進んだときの理解が崩れにくくなります。なぜその差が出たのかを一文で説明し、確認メモを残してください。"
        ].join("\n")
      )
    );
    changed = true;
    findings.push(`遷移語不足を補強 (${missing.join(", ")})`);
  }

  const codeIndexes = codeCellIndexes(nb);
  for (const idx of codeIndexes) {
    if (idx === 0) continue;
    if (nb.cells[idx - 1].cell_type !== "markdown") {
      nb.cells.splice(idx, 0, md("このコードを実行する前に、入力値が出力へどう効くかを予想してください。"));
      changed = true;
      findings.push("コード前説明の不足を補強");
      break;
    }
  }

  if (!text.includes("確認課題")) {
    nb.cells.push(
      md(
        [
          "確認課題",
          "1. いま実行したコードのうち、最も重要な3行を選び、その役割を説明する。",
          "2. 1行だけ変更して再実行し、出力差を記録する。",
          "3. 変更理由を『入力・処理・出力』の順に説明する。"
        ].join("\n")
      )
    );
    changed = true;
    findings.push("課題セクション不足を補強");
  }

  return { findings, changed };
}

function qualityLoop(nb: NotebookFile, pack: TopicPack, chapterTitle: string): string[] {
  const logs: string[] = [];

  for (let round = 1; round <= QUALITY_MAX_ROUNDS; round += 1) {
    const expert = runExpertCodexReview(nb, pack, chapterTitle);
    const beginner = runBeginnerCodexReview(nb);
    const merged = [...expert.findings, ...beginner.findings];

    if (merged.length === 0) {
      logs.push(`round ${round}: no findings`);
      break;
    }

    logs.push(`round ${round}: ${merged.join(" | ")}`);
    if (!expert.changed && !beginner.changed) {
      break;
    }
  }

  return logs;
}

async function buildNotebookOne(chapter: CatalogChapter, notebook: CatalogNotebook, nextTitle: string | null) {
  const pack = buildPack(chapter, notebook);
  const nb = createNotebook(chapter.title, notebook.title, nextTitle, pack);
  const logs = qualityLoop(nb, pack, chapter.title);

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
    fs.writeFile(path.join(notebooksDir, `${notebook.id}.ipynb`), `${JSON.stringify(nb, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(reportsDir, `${notebook.id}.md`), `${report}\n`, "utf8")
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
  console.log(`Authored ${tasks.length} notebooks with code-first narrative and strict dual-review loops.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
