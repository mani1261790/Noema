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


def insert_after(nb: dict[str, Any], needle: str, text: str, cell_type: str | None = None) -> None:
    for idx, cell in enumerate(nb["cells"]):
        if cell_type and cell.get("cell_type") != cell_type:
            continue
        if needle in cell_text(cell):
            if idx + 1 < len(nb["cells"]) and text.splitlines()[0] in cell_text(nb["cells"][idx + 1]):
                return
            nb["cells"].insert(
                idx + 1,
                {"cell_type": "markdown", "metadata": {}, "source": [text.rstrip() + "\n"]},
            )
            return
    raise ValueError(f"insert_after target not found: {needle}")


def patch_td_learning() -> None:
    nb = load_notebook("td-learning")
    set_cell_text(
        find_cell(nb, "## 出力の読み方", "markdown"),
        """## 出力の読み方

- `mode=explore` ならランダム行動、`mode=greedy` なら現在の価値推定で一番良い行動を選んでいます。
- この探索セルは TD(0) の更新式そのものではなく、価値を集めるために一緒に使う行動選択の最小例です。""",
    )
    set_cell_text(
        find_cell(nb, "def choose_action(q_left, q_right, epsilon):", "code"),
        """import random

random.seed(7)


def choose_action(q_left, q_right, epsilon):
    greedy = 'left' if q_left >= q_right else 'right'
    if random.random() < epsilon:
        action = random.choice(['left', 'right'])
        return {'mode': 'explore', 'action': action, 'greedy': greedy}
    return {'mode': 'greedy', 'action': greedy, 'greedy': greedy}


for eps in [0.5, 0.1]:
    out = choose_action(0.4, 0.7, eps)
    print(f"epsilon={eps:.1f}", 'mode=', out['mode'], 'action=', out['action'], 'greedy=', out['greedy'])""",
    )
    save_notebook("td-learning", nb)


def patch_rl_foundation() -> None:
    nb = load_notebook("rl-foundation")
    set_cell_text(
        find_cell(nb, "## 出力の読み方", "markdown"),
        """## 出力の読み方

- `mode=explore` ならランダム行動、`mode=greedy` なら現在の価値推定で一番良い行動を選んでいます。
- このセルは価値更新式そのものではなく、学習中にどの行動を集めるかを見るための `epsilon-greedy` の最小例です。""",
    )
    set_cell_text(
        find_cell(nb, "def choose_action(q_left, q_right, epsilon):", "code"),
        """import random

random.seed(11)


def choose_action(q_left, q_right, epsilon):
    greedy = 'left' if q_left >= q_right else 'right'
    if random.random() < epsilon:
        action = random.choice(['left', 'right'])
        return {'mode': 'explore', 'action': action, 'greedy': greedy}
    return {'mode': 'greedy', 'action': greedy, 'greedy': greedy}


for eps in [0.5, 0.1]:
    out = choose_action(0.4, 0.7, eps)
    print(f"epsilon={eps:.1f}", 'mode=', out['mode'], 'action=', out['action'], 'greedy=', out['greedy'])""",
    )
    set_cell_text(
        find_cell(nb, "## このノートの守備範囲", "markdown"),
        """## このノートの守備範囲

このノートでは次の点は入口だけ触れるか、別ノートに分けて扱います。

- ここでは `epsilon-greedy` の最小例を見せており、探索戦略の理論比較や最適化までは扱いません。""",
    )
    save_notebook("rl-foundation", nb)


def patch_bellman_equations() -> None:
    nb = load_notebook("bellman-equations")
    set_cell_text(
        find_cell(nb, "## 実行前の見取り図", "markdown"),
        """## 実行前の見取り図

1. `mc_return=` が、終端まで足し切った参照値として出ているか。
2. `updated V(s)=` が、1回のベルマン更新の結果になっているか。
3. `Q(s0,right)=` と `choose_action(...)` の出力で、更新と行動選択の両方が見えているか。""",
    )
    code_cell = None
    for needle in [
        "print('task = bellman-equations', 'boot_return='",
        "print('task = bellman-equations', 'mc_return='",
    ]:
        try:
            code_cell = find_cell(nb, needle, "code")
            break
        except ValueError:
            continue
    if code_cell is None:
        raise ValueError("bellman-equations return cell not found")

    set_cell_text(
        code_cell,
        """rewards = [1.0, 0.4, 0.0, 1.2]
gamma = 0.92
g = 0.0
for r in reversed(rewards):
    g = r + gamma * g
print('task = bellman-equations', 'mc_return=', round(g, 6))""",
    )
    set_cell_text(
        find_cell(nb, "def choose_action(q_left, q_right, epsilon):", "code"),
        """import random

random.seed(13)


def choose_action(q_left, q_right, epsilon):
    greedy = 'left' if q_left >= q_right else 'right'
    if random.random() < epsilon:
        action = random.choice(['left', 'right'])
        return {'mode': 'explore', 'action': action, 'greedy': greedy}
    return {'mode': 'greedy', 'action': greedy, 'greedy': greedy}


for eps in [0.5, 0.1]:
    out = choose_action(0.4, 0.7, eps)
    print(f"epsilon={eps:.1f}", 'mode=', out['mode'], 'action=', out['action'], 'greedy=', out['greedy'])""",
    )
    insert_after(
        nb,
        "print('task = bellman-equations', 'mc_return=', round(g, 6))",
        """この `mc_return` は終端までの実報酬を足し切った Monte Carlo 参照値です。ベルマン更新で使う bootstrapped target は、次状態価値 `V(s')` や `Q(s', a')` を入れた別の量です。""",
        "code",
    )
    save_notebook("bellman-equations", nb)


def patch_time_series() -> None:
    nb = load_notebook("time-series-data")
    set_cell_text(
        find_cell(nb, "## 出力の読み方", "markdown"),
        """## 出力の読み方

- `MAE` は小さいほど良く、`TimeSeriesSplit MAE` は平均だけでなく最悪 fold が極端に悪くないかも見ます。
- `recursive 12-step` は予測値を次のラグへ戻すので、1-step より悪化しやすく、ここでの差が長期予測の難しさです。""",
    )
    set_cell_text(
        find_cell(nb, "`promo` は「6か月ごとに実施される既知の計画値」を使える前提にしています。", "markdown"),
        """固定起点で12か月先まで当てるには、逐次予測のバックテストが必要です。
ここでは学習期間を固定し、予測値を次月ラグへ入れながら12ステップ先まで進めます。
`promo` は「6か月ごとに実施される既知の計画値」を使える前提にしています。広告出稿や価格改定のように将来予定が分かる外生変数なら使えますが、未来時点で未定の変数ならこの形では入れられません。""",
    )
    insert_after(
        nb,
        'print("mean:", round(cv_mae.mean(), 3), "std:", round(cv_mae.std(), 3))',
        """`TimeSeriesSplit MAE` は fold ごとに「過去で学習して次の時点を当てた誤差」です。平均だけでなく、最後の fold だけ急に悪化していないかを見ると、直近の分布変化やドリフトを疑えます。`random split ridge MAE` が見かけ上よく見えても、時系列では未来近傍の情報が混ざるので基準にはしません。""",
        "code",
    )
    save_notebook("time-series-data", nb)


def patch_sql_for_ml() -> None:
    nb = load_notebook("sql-for-ml")
    set_cell_text(
        find_cell(nb, "ここから機械学習用テーブルを作ります。", "markdown"),
        """ここから機械学習用テーブルを作ります。

時点の定義:
- `snapshot`: 予測時点
- 特徴量窓: `snapshot` より前30日
- ラベル窓: `snapshot` 以上かつ `snapshot+30日` 未満

point-in-time テーブルでは、1行は「`snapshot` 時点で見えてよい情報だけ」を表します。ラベルは未来窓から作りますが、その未来情報を特徴量へ戻してはいけません。""",
    )
    insert_after(
        nb,
        "print('leaky feature mean by label')",
        """`clean` と `leaky` の差は、未来窓のイベントを見てしまった瞬間に「まだ起きていない購買」を先回りして当てられてしまうことを示しています。SQL の条件式は些細に見えても、`snapshot` 境界をまたぐだけで学習データ全体が壊れます。""",
        "code",
    )
    save_notebook("sql-for-ml", nb)


def patch_llm_pretraining() -> None:
    nb = load_notebook("llm-pretraining")
    set_cell_text(
        find_cell(nb, "## 出力の読み方", "markdown"),
        """## 出力の読み方

- `perplexity` は小さいほど良いですが、同じコーパス・同じ語彙・同じ単位で計算した値同士でだけ比べます。
- unigram / bigram は事前学習そのものではなく、より強いモデルと比べるための古典的ベースラインです。
- train/val の差が小さくても、この toy 設定だけで実際の LLM 品質までは判断できません。""",
    )
    insert_after(
        nb,
        "print('val perplexity bigram :', round(perplexity_bigram(val_ids), 4))",
        """ここでの unigram / bigram は「事前学習の入口を理解するための比較対象」です。現代の LLM そのものではありません。さらに、このノートの perplexity は小さな文字集合で計算しているので、値の絶対的な大小よりも「モデル間でどちらが下がったか」を読むために使います。""",
        "code",
    )
    save_notebook("llm-pretraining", nb)


def patch_nlp_deep_learning() -> None:
    nb = load_notebook("nlp-deep-learning")
    set_cell_text(
        find_cell(nb, "## 出力の読み方", "markdown"),
        """## 出力の読み方

- `supervised_after_shift` は「回答部分が入力長のうち何割を占めるか」を見る比率で、精度そのものではありません。
- 生成結果が一見もっともらしくても、この toy 例だけで言語モデル品質全体を判断してはいけません。""",
    )
    set_cell_text(
        find_cell(nb, "このノートでは文字単位トークンを使っているので、未知語問題は「未知文字」の形で現れます。", "markdown"),
        """次に語彙（vocabulary）を作って、トークンをIDへ変換します。
`<pad>` と `<unk>` を先頭に置くのは実務でもよくある設計です。

このノートでは文字単位トークンを使っているので、未知語問題は「未知文字」の形で現れます。`<unk>` が出たときは、その文字の情報を細かく失って「未知として一括処理した」ことを意味します。""",
    )
    set_cell_text(
        find_cell(nb, "最後に、PyTorchで小さな文字レベル言語モデルを学習し、", "markdown"),
        """最後に、PyTorchで小さな文字レベル言語モデルを学習し、
次トークン予測の最小形を見ます。前半の word / char の比較は「トークン化と語彙設計」の話、ここは「実際に次トークン予測をどう学習するか」の話で、役割が違います。""",
    )
    save_notebook("nlp-deep-learning", nb)


def patch_vae() -> None:
    nb = load_notebook("vae")
    set_cell_text(
        find_cell(nb, "## 出力の読み方", "markdown"),
        """## 出力の読み方

- `reconstruction term` は大きいほど再構成が良く、`KL term` は小さいほど事前分布に近いので、ELBO はその綱引きで決まります。
- `beta=1` と `beta=4` を比べるときは、再構成誤差だけでなく潜在平均や分散がつぶれすぎていないかも一緒に見ます。""",
    )
    insert_after(
        nb,
        "print('ELBO                =', round(elbo, 4))",
        """普通のオートエンコーダは「再構成が良いこと」だけを押しますが、VAE はそこに `KL` を足して「生成しやすい潜在空間であること」も同時に求めます。だから `reconstruction term` が良くても `KL` を無視しすぎると、サンプルしやすい潜在空間になりません。""",
        "code",
    )
    save_notebook("vae", nb)


def patch_gan() -> None:
    nb = load_notebook("gan")
    set_cell_text(
        find_cell(nb, "## 出力の読み方", "markdown"),
        """## 出力の読み方

- `L_D` と `L_G` だけでは十分でなく、`W1` と左右モード比率 `left/right` を一緒に見て mode collapse を疑います。
- `left/right` が 0.5 から大きく崩れているのに損失だけ安定しているなら、見た目より多様性が落ちている可能性があります。""",
    )
    save_notebook("gan", nb)


def patch_score_diffusion() -> None:
    nb = load_notebook("score-diffusion-models")
    set_cell_text(
        find_cell(nb, "## 出力の読み方", "markdown"),
        """## 出力の読み方

- `forward noising trajectory` ではモードがつぶれて 1 つの広い雲に近づき、`naive reverse` が戻り切れないなら「逆過程に十分な予測器がない」ことを示します。
- `eval_eps_mse` は局所的なノイズ予測誤差なので、最終的な左右モード比率や mean/std と合わせて生成品質を見ます。""",
    )
    insert_after(
        nb,
        "print('target left/right =', round(real_stats['left'], 4), round(real_stats['right'], 4))",
        """`eval_eps_mse` がある程度下がっていても、逆過程を間引くと左右モード比率や分散が崩れることがあります。拡散モデルでは「局所のノイズ予測精度」と「最終サンプル品質」が完全には一致しない、という点をここで押さえてください。""",
        "code",
    )
    save_notebook("score-diffusion-models", nb)


def patch_fine_tuning() -> None:
    nb = load_notebook("fine-tuning")
    set_cell_text(
        find_cell(nb, "## 出力の読み方", "markdown"),
        """## 出力の読み方

- `attack block rate` は高いほど安全側ですが、同時に `normal pass rate` が下がりすぎると過剰遮断です。
- この toy 例では厳密な正解線はありませんが、少なくとも「攻撃だけ止まり、通常質問は通る」方向に両方を見る必要があります。""",
    )
    insert_after(
        nb,
        "実際のファインチューニングでは、事前学習済みモデルを初期値として学習します。",
        """実務での切り分け目安は、「振る舞い全体を大きく変えたい・十分な計算資源がある」なら Full fine-tuning、「限られたGPUで特定タスクへ寄せたい」なら PEFT です。まず PEFT で十分か確かめ、足りない場合だけ全重み更新を検討するのが一般的です。""",
        "markdown",
    )
    insert_after(
        nb,
        "print('normal pass rate  =', round(normal_passed / len(normal_inputs), 3))",
        """この toy 評価では、`attack block rate` を上げつつ `normal pass rate` を落としすぎないことが狙いです。たとえば攻撃遮断だけが高くても通常質問が通らなければ使いにくく、逆に通常質問だけ通って攻撃も通るなら安全性が足りません。""",
        "code",
    )
    save_notebook("fine-tuning", nb)


def patch_tool_use_rag() -> None:
    nb = load_notebook("tool-use-rag")
    set_cell_text(
        find_cell(nb, "## 出力の読み方", "markdown"),
        """## 出力の読み方

- `retrieve` と `rerank` は候補の質を見る指標、`generate_with_citations` は最終文と根拠の対応を見る指標で、役割が違います。
- `hit@k` や lexical overlap が高くても、最終回答の自然さ・要約のうまさまでは別に確認が必要です。""",
    )
    insert_after(
        nb,
        "print('lexical overlap RAG      =', round(lexical_overlap_ratio(rag_out['answer_text'], rag_out['used_chunks']), 4))",
        """ここでの `generate_with_citations` は自由生成モデルではなく、取得した文脈から最も重なる文を抜き出して引用を付ける extractive toy 実装です。`rerank` も学習済み reranker ではなく手作りスコアなので、「検索して根拠を付ける流れ」を理解するための最小例として読んでください。""",
        "code",
    )
    save_notebook("tool-use-rag", nb)


def patch_hallucination_rlhf() -> None:
    nb = load_notebook("hallucination-rlhf")
    set_cell_text(
        find_cell(nb, "## 出力の読み方", "markdown"),
        """## 出力の読み方

- `grounding score` はここでは語の一致度に近い proxy なので、事実性そのものの完全な指標ではありません。
- 攻撃遮断率や選好損失も単独では不十分で、通常応答の通りやすさや言い換えへの頑健性と一緒に見ます。""",
    )
    insert_after(
        nb,
        "plt.show()",
        """この `grounding score` は、根拠文中の語と回答語がどれだけ重なったかを見る簡易 proxy です。言い換えや同義表現に弱いので、スコアが高いことと「本当に事実に grounded していること」は同じではありません。""",
        "code",
    )
    save_notebook("hallucination-rlhf", nb)


def patch_scope_wording() -> None:
    rewrites = {
        "fine-tuning": (
            "実装は文字レベルの toy SFT で、実際の subword token 学習とは別物に見える。",
            "実装は文字レベルの toy SFT で、実際の subword token 学習そのものではありません。",
        ),
        "tool-use-rag": (
            "このパイプラインは本物の生成器ではなく、検索と引用の流れを見る toy 実装に見える。",
            "このパイプラインは本物の生成器そのものではなく、検索と引用の流れを見るための toy 実装です。",
        ),
        "hallucination-rlhf": (
            "DPO / GRPO / rails は本番実装ではなく、概念確認の toy proxy に見える。",
            "DPO / GRPO / rails は本番実装そのものではなく、概念確認のための toy proxy です。",
        ),
        "scaling-laws": (
            "きれいに直線が出ても、実データのノイズとは別物に見える。",
            "きれいに直線が出ても、合成データ上の結果であり、実データのノイズ構造そのものではありません。",
        ),
    }
    for name, (before, after) in rewrites.items():
        nb = load_notebook(name)
        cell = find_cell(nb, before, "markdown")
        set_cell_text(cell, cell_text(cell).replace(before, after))
        save_notebook(name, nb)


def main() -> None:
    patch_rl_foundation()
    patch_bellman_equations()
    patch_td_learning()
    patch_time_series()
    patch_sql_for_ml()
    patch_llm_pretraining()
    patch_nlp_deep_learning()
    patch_vae()
    patch_gan()
    patch_score_diffusion()
    patch_fine_tuning()
    patch_tool_use_rag()
    patch_hallucination_rlhf()
    patch_scope_wording()
    print("targeted pass2 fixes applied")


if __name__ == "__main__":
    main()
