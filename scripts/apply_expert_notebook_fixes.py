#!/usr/bin/env python3

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK_DIR = ROOT / "content" / "notebooks"


def cell_text(cell: dict[str, Any]) -> str:
    return "".join(cell.get("source", []))


def set_cell_text(cell: dict[str, Any], text: str) -> None:
    cell["source"] = [text.rstrip() + "\n"]


def load_notebook(name: str) -> dict[str, Any]:
    return json.loads((NOTEBOOK_DIR / f"{name}.ipynb").read_text())


def save_notebook(name: str, nb: dict[str, Any]) -> None:
    (NOTEBOOK_DIR / f"{name}.ipynb").write_text(json.dumps(nb, ensure_ascii=False, indent=2) + "\n")


def find_cell(nb: dict[str, Any], needle: str, cell_type: str | None = None) -> dict[str, Any]:
    for cell in nb["cells"]:
        if cell_type and cell.get("cell_type") != cell_type:
            continue
        if needle in cell_text(cell):
            return cell
    raise ValueError(f"cell not found: {needle}")


def insert_after(nb: dict[str, Any], needle: str, text: str, cell_type: str = "markdown") -> None:
    for idx, cell in enumerate(nb["cells"]):
        if cell_type and cell.get("cell_type") != cell_type:
            continue
        if needle in cell_text(cell):
            if any(text.splitlines()[0] in cell_text(next_cell) for next_cell in nb["cells"][idx + 1 : idx + 2]):
                return
            nb["cells"].insert(
                idx + 1,
                {
                    "cell_type": "markdown",
                    "metadata": {},
                    "source": [text.rstrip() + "\n"],
                },
            )
            return
    raise ValueError(f"insert_after target not found: {needle}")


def patch_numpy() -> None:
    nb = load_notebook("numpy-basics")
    cell = find_cell(nb, "ブールマスクは `True/False` の配列", "markdown")
    text = cell_text(cell)
    addition = (
        "\n\n`arr[mask]` は `True` の要素だけを 1 次元に並べ直した配列を返します。"
        " たとえば `arr.shape == (3, 4)` でも、返り値の shape は `(True の個数,)` になり、"
        "元の 2 次元構造は保たれません。"
    )
    if addition.strip() not in text:
        set_cell_text(cell, text + addition)
    save_notebook("numpy-basics", nb)


def patch_pandas() -> None:
    nb = load_notebook("pandas-basics")
    cell = find_cell(nb, "列選択と条件抽出は、Pandas の最も基本的な操作です。", "markdown")
    text = cell_text(cell)
    addition = (
        "\n\n`df[\"math\"]` のように 1 列だけ選ぶと戻り値は `Series` になり、"
        "`df[[\"student\", \"math\"]]` のように複数列を選ぶと `DataFrame` になります。"
        " 後続の `groupby` や `merge` では、この型の違いがそのまま操作の違いになります。"
    )
    if addition.strip() not in text:
        set_cell_text(cell, text + addition)
    save_notebook("pandas-basics", nb)


def patch_matplotlib() -> None:
    nb = load_notebook("matplotlib-seaborn")
    cell = find_cell(nb, "カテゴリ比較では、箱ひげ図や棒グラフが便利です。", "markdown")
    text = cell_text(cell)
    addition = (
        "\n\n箱ひげ図では、箱が第1四分位から第3四分位、中央線が中央値、"
        "ひげが通常は `1.5 × IQR` の範囲を表します。"
        " まず中央値の差と、箱やひげの広がりの差を分けて読むと誤解しにくくなります。"
    )
    if addition.strip() not in text:
        set_cell_text(cell, text + addition)
    save_notebook("matplotlib-seaborn", nb)


def patch_llm_pretraining() -> None:
    nb = load_notebook("llm-pretraining")
    cell = find_cell(nb, "## 背景と目的", "markdown")
    text = cell_text(cell)
    if "LLMの能力の大半は事前学習で形成され" in text:
        set_cell_text(
            cell,
            """## 背景と目的

事前学習は LLM の基盤能力を作る段階ですが、それだけで最終用途の性能や安全性が決まり切るわけではありません。SFT・RLHF・RAG・ツール利用は、その基盤の上でタスク適応、応答方針、更新性を大きく変えます。

事前学習の目的を理解すると、どこが土台で、どこが後工程で改善できるかを切り分けて考えられます。

学習目標と獲得能力の対応を整理します。""",
        )
    save_notebook("llm-pretraining", nb)


def patch_scaling_laws() -> None:
    nb = load_notebook("scaling-laws")
    cell = find_cell(nb, "その近傍を候補として探索します。", "markdown")
    text = cell_text(cell)
    addition = (
        "\nここでの探索範囲は、合成データを扱う教育用の便宜的な設定です。"
        " 実データでは観測最小値からかなり離れた `L_inf` が推定されることもあるため、"
        "より広い候補範囲や制約付き最適化で floor を推定するのが一般的です。"
    )
    if addition.strip() not in text:
        set_cell_text(cell, text + addition)
    save_notebook("scaling-laws", nb)


def patch_domain_specialization() -> None:
    nb = load_notebook("domain-specialization")
    insert_after(
        nb,
        "## つまずきやすい点",
        """## このノートの守備範囲

ドメイン特化には大きく 3 段階あります。

1. prompt-only: 用語、制約、出力形式を固定して、失敗要因を切り分ける。
2. RAG-based: 最新の規定や社内知識を参照して、根拠付き回答に寄せる。
3. fine-tuning-based: ふるまいそのものを学習で寄せる。十分な教師データと評価設計が必要です。

このノートでは 1 と 2 の入口を扱います。3 の学習ベース適応は別のファインチューニング章で扱う前提です。

## 小さな評価セットの作り方

最小でも、代表質問を 10〜20 件ほど集めて「期待回答の要点」「必須用語」「禁則」を表にしておくと、改善前後を比較できます。最低限見る指標は、正解率、用語一致、禁則違反数、必要ならコストです。""",
    )
    save_notebook("domain-specialization", nb)


def patch_loss_and_optimization(name: str, bias: float) -> None:
    nb = load_notebook(name)
    x_values = [1.0, -0.5, 0.3] if name == "loss-and-gradient-descent" else [0.9, -0.3, 0.1]
    w_values = [0.2, -0.4, 0.6] if name == "loss-and-gradient-descent" else [0.5, -0.2, 0.4]
    pred_label = "pred" if name == "loss-and-gradient-descent" else "init_pred"

    cell = find_cell(nb, "z = sum(xi * wi for xi, wi in zip(x, w))", "code")
    set_cell_text(
        cell,
        f"""x = {x_values}
w = {w_values}
b = {bias}
z = sum(xi * wi for xi, wi in zip(x, w)) + b
y = 1 / (1 + math.exp(-z))
print('task = {name}', '{pred_label}=', round(y, 6))""",
    )

    formula_cell = find_cell(nb, "## 計算の対応表" if name == "loss-and-gradient-descent" else "## 式と実装の往復", "markdown")
    formula_text = cell_text(formula_cell)
    extra_formula = "\n3. BCE + sigmoid のとき、出力前活性 `z` に対する勾配は $y - target$"
    if extra_formula.strip() not in formula_text:
        set_cell_text(formula_cell, formula_text + extra_formula)

    update_cell = find_cell(nb, "lr = 0.1", "code")
    set_cell_text(
        update_cell,
        """lr = 0.1
grad_z = y - target  # BCE + sigmoid のとき dL/dz
w_new = [wi - lr * grad_z * xi for wi, xi in zip(w, x)]
b_new = b - lr * grad_z
z_new = sum(xi * wi for xi, wi in zip(x, w_new)) + b_new
y_new = 1 / (1 + math.exp(-z_new))
print('grad_z =', round(grad_z, 6))
print('b before/after =', round(b, 6), round(b_new, 6))
print('y before/after =', round(y, 6), round(y_new, 6))""",
    )

    after_cell = find_cell(nb, "この更新で損失が下がれば", "markdown")
    after_text = cell_text(after_cell)
    extra_note = "\n\nここでは重みだけでなく bias も同時に更新し、BCE と勾配の対応が崩れないようにしています。"
    if extra_note.strip() not in after_text:
        set_cell_text(after_cell, after_text + extra_note)

    batch_cell = find_cell(nb, "for bx in batch:", "code")
    batch_text = cell_text(batch_cell).replace("+ 0.1", "+ b_new")
    set_cell_text(batch_cell, batch_text)

    save_notebook(name, nb)


def patch_td_learning() -> None:
    nb = load_notebook("td-learning")

    guide = find_cell(nb, "`Q(s0,right)=` の更新後値が", "markdown")
    set_cell_text(
        guide,
        cell_text(guide).replace("`Q(s0,right)=` の更新後値が、TD誤差で動いているか。", "`updated V(s0)=` の更新後値が、TD誤差で動いているか。"),
    )

    step_cell = find_cell(nb, "## 手を動かす 2: ベルマン更新を1回行う", "markdown")
    set_cell_text(
        step_cell,
        """## 手を動かす 2: TD(0) の状態価値更新を1回行う

次に、TD(0) で状態価値を 1 ステップだけ更新します。まずは `max` を使わない評価側の更新を見て、TD 法の中心であるブートストラップをはっきり区別します。""",
    )

    code_cell = find_cell(nb, "v_next = {'s0': 0.4, 's1': 0.8}", "code")
    set_cell_text(
        code_cell,
        """alpha = 0.2
V = {'s0': 0.3, 's1': 0.8}
r, s, s_next = 1.0, 's0', 's1'
td_target = r + gamma * V[s_next]
td_error = td_target - V[s]
V[s] = V[s] + alpha * td_error
print('TD target =', round(td_target, 6))
print('TD error =', round(td_error, 6))
print('updated V(s0)=', round(V[s], 6))""",
    )

    after = find_cell(nb, "ベルマン更新は『今の価値』を『次状態の価値』で再定義する操作です。", "markdown")
    set_cell_text(
        after,
        "TD(0) では、`r + gamma * V(s')` を 1 ステップ先の目標値として使い、今の `V(s)` を少しだけ寄せます。これが TD 法の基本で、次のセルで Q 学習との差分として `max` を導入します。",
    )

    formulas = find_cell(nb, "## 数式メモ", "markdown")
    set_cell_text(
        formulas,
        """## 数式メモ

1. $G_t = \\sum_{k\\ge 0} \\gamma^k R_{t+k+1}$
2. $V(s_t) \\leftarrow V(s_t) + \\alpha[r_{t+1} + \\gamma V(s_{t+1}) - V(s_t)]$""",
    )

    later = find_cell(nb, "## 手を動かす 3: Q値更新を比較する", "markdown")
    set_cell_text(
        later,
        """## 手を動かす 3: Q学習との差分を見る

ここでは TD の枠組みを Q 学習へ拡張し、状態価値 `V` の更新が行動価値 `Q` と `max` を使う形へどう変わるかを確認します。""",
    )

    save_notebook("td-learning", nb)


def patch_q_learning() -> None:
    nb = load_notebook("q-learning")
    cell = find_cell(nb, "def choose_action(q_left, q_right, epsilon):", "code")
    set_cell_text(
        cell,
        """import random

random.seed(7)

def choose_action(q_left, q_right, epsilon):
    if random.random() < epsilon:
        return random.choice(['left', 'right'])
    return 'left' if q_left >= q_right else 'right'

samples_high_eps = [choose_action(0.4, 0.7, 0.5) for _ in range(8)]
samples_low_eps = [choose_action(0.4, 0.7, 0.1) for _ in range(8)]
print('epsilon=0.5 ->', samples_high_eps)
print('epsilon=0.1 ->', samples_low_eps)""",
    )
    save_notebook("q-learning", nb)


def patch_n_step_td() -> None:
    nb = load_notebook("n-step-td")
    warn = find_cell(nb, "`n=T-t` がモンテカルロ更新に一致する理由が明示されていない。", "markdown")
    set_cell_text(
        warn,
        cell_text(warn).replace(
            "`n=T-t` がモンテカルロ更新に一致する理由が明示されていない。",
            "`n=T-t` では終端までの実報酬を使い切るので、bootstrap 項が落ちて Monte Carlo return に一致することを明示する必要があります。",
        ),
    )
    cell = find_cell(nb, "def n_step_return(rews, n, gamma, v_boot):", "code")
    set_cell_text(
        cell,
        """import math

gamma = 0.9
rewards = [0.2, 0.0, 1.0, -0.1, 0.5]  # R_{t+1}, R_{t+2}, ...
V_boot = 0.7  # V(S_{t+n})


def n_step_return(rews, n, gamma, v_boot):
    n = min(n, len(rews))
    g = 0.0
    for k in range(n):
        g += (gamma ** k) * rews[k]
    if n < len(rews):
        g += (gamma ** n) * v_boot
    return g

for n in [1, 2, 3, 5]:
    print(f'n={n}: G_t^(n)=', round(n_step_return(rewards, n, gamma, V_boot), 6))""",
    )
    save_notebook("n-step-td", nb)


def patch_td_lambda() -> None:
    nb = load_notebook("td-lambda")
    terms = find_cell(nb, "- `lambda-return`:", "markdown")
    text = cell_text(terms)
    addition = "\n- `λ→1 の極限`: 終端までの full return を使う設定では、Monte Carlo return に近づきます。終端で bootstrap を切ることが前提です。"
    if addition.strip() not in text:
        set_cell_text(terms, text + addition)
    cell = find_cell(nb, "def n_step_return(rews, n, gamma, v_boot):", "code")
    set_cell_text(
        cell,
        """import math

gamma = 0.9
rewards = [0.4, -0.2, 0.8, 1.1]
v_boot = 0.5


def n_step_return(rews, n, gamma, v_boot):
    n = min(n, len(rews))
    g = 0.0
    for k in range(n):
        g += (gamma ** k) * rews[k]
    if n < len(rews):
        g += (gamma ** n) * v_boot
    return g


def lambda_return(rews, gamma, lam, v_boot):
    T = len(rews)
    out = 0.0
    for n in range(1, T + 1):
        w = (1 - lam) * (lam ** (n - 1)) if n < T else (lam ** (n - 1))
        out += w * n_step_return(rews, n, gamma, v_boot)
    return out

for lam in [0.0, 0.3, 0.7, 0.95]:
    print('lambda=', lam, 'G^lambda=', round(lambda_return(rewards, gamma, lam, v_boot), 6))""",
    )
    save_notebook("td-lambda", nb)


def patch_deep_rl() -> None:
    nb = load_notebook("deep-rl")
    cell = find_cell(nb, "# 深層強化学習", "markdown")
    set_cell_text(
        cell,
        """# 深層強化学習

深層強化学習は、状態空間が大きい問題で価値関数や方策をニューラルネットで近似する方法の総称です。表形式では持てない連続状態や高次元観測を扱える点が実務上の利点です。

このノートでは、その中でも DQN 系の value-based deep RL に絞って扱います。policy-based や actor-critic は別系統の設計として、ここでは範囲外に置きます。""",
    )
    save_notebook("deep-rl", nb)


def patch_world_models() -> None:
    specs = {
        "world-models-and-generative-models": {
            "score_note": "この `score_plan` は、最終潜在値が高いほど良いと仮定した教育用の代理スコアです。実際の計画では、予測した状態から報酬・コスト・制約違反を計算して評価します。ここで使う `A` と `B` も、本番ではデータから学習される遷移係数です。",
        },
        "control-model-and-mbrl": {
            "score_note": "ここでの `score_plan` は、最終潜在値をそのまま比較するデモ用の代理指標です。MBRL では通常、予測した将来状態を報酬やコストへ変換して計画を選びます。",
        },
        "state-space-models": {
            "replace_after": (
                "この線形遷移を起点に表現学習へ接続します。",
                "この線形遷移を起点に表現学習へ接続します。ここでは `A`、`B`、`decode` を手書きで置く最小例ですが、実際の状態空間モデルでは観測データからこれらの係数を推定・学習します。",
            ),
        },
        "state-representation-learning": {
            "insert_after": (
                "## つまずきやすい点",
                """## このノートの位置づけ

ここでは学習済み encoder の代わりに、手で置いた圧縮状態 `z` を使って「良い表現が下流予測や計画にどう効くか」を先に見ています。実際の状態表現学習では、encoder/decoder と再構成損失、予測損失、あるいは対比損失を使って `z` をデータから学習します。""",
            ),
        },
        "state-prediction-models": {
            "replace_after": (
                "平均誤差だけでなく時点別誤差を追うと、どの遷移条件でモデルが弱いかを特定しやすくなります。",
                "平均誤差だけでなく時点別誤差を追うと、どの遷移条件でモデルが弱いかを特定しやすくなります。異常検知に使うなら、たとえば `mean_error` ではなく各時点誤差の 95 パーセンタイルや固定閾値を超えた時点を異常候補とみなします。",
            ),
        },
        "ssm-and-transformer": {
            "replace_after": (
                "SSMは更新コストが低く長系列に有利です。Transformer側は学習済みmulti-head self-attentionの簡略近似として実装しており、長距離参照の考え方を確認することを目的にしています。",
                "SSMは更新コストが低く長系列に有利です。ここでの Transformer 側は、学習された content-based attention ではなく距離に応じた positional smoothing を使う簡略代理です。そのため、この MSE 比較は『本物の Transformer が優れているか』を測る実験ではなく、系列集約の考え方の違いを見るための教材用比較です。",
            ),
        },
        "observation-prediction-models": {
            "replace_after": (
                "自己回帰は逐次予測に強く、マスク予測は欠損補完に強い設計です。拡散型はノイズ耐性が高い一方で反復計算コストが増えます。",
                "自己回帰は逐次予測に強く、マスク予測は欠損補完に強い設計です。拡散型はノイズ耐性が高い一方で反復計算コストが増えます。ここで並べた 3 つの MSE は、予測タスクと評価条件がそろった厳密比較ではなく、入力の使い方の違いを示す定性的な例として読んでください。",
            ),
        },
    }

    for name, spec in specs.items():
        nb = load_notebook(name)
        if "score_note" in spec:
            insert_after(nb, "def score_plan(plan):", spec["score_note"], "code")
        if "replace_after" in spec:
            needle, replacement = spec["replace_after"]
            cell = find_cell(nb, needle, "markdown")
            set_cell_text(cell, replacement)
        if "insert_after" in spec:
            needle, addition = spec["insert_after"]
            insert_after(nb, needle, addition, "markdown")
        save_notebook(name, nb)


def main() -> None:
    patch_numpy()
    patch_pandas()
    patch_matplotlib()
    patch_llm_pretraining()
    patch_scaling_laws()
    patch_domain_specialization()
    patch_loss_and_optimization("loss-and-gradient-descent", 0.12)
    patch_loss_and_optimization("optimization-regularization", 0.03)
    patch_td_learning()
    patch_q_learning()
    patch_n_step_td()
    patch_td_lambda()
    patch_deep_rl()
    patch_world_models()
    print("expert fixes applied")


if __name__ == "__main__":
    main()
