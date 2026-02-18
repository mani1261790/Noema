#!/usr/bin/env python3
import json
from pathlib import Path
from typing import Dict, List, Tuple

CATALOG = Path("content/catalog.json")
NOTEBOOK_DIR = Path("content/notebooks")

BASE_TERMS: Dict[str, List[Tuple[str, str]]] = {
    "Python": [
        ("変数", "値に名前を付ける箱です。計算結果を後で再利用するために使います。"),
        ("型", "値の種類です。数値・文字列・リストなどで、使える操作が変わります。"),
        ("関数", "入力を受けて出力を返す処理のまとまりです。再利用と可読性のために使います。")
    ],
    "機械学習": [
        ("特徴量", "モデルが予測に使う入力変数です。列の作り方が精度に直結します。"),
        ("目的変数", "当てたい値です。回帰では連続値、分類ではラベルになります。"),
        ("損失関数", "予測のずれを数値化する関数です。学習はこの値を下げる方向に進みます。")
    ],
    "ディープラーニング": [
        ("パラメータ θ", "モデルが学習で更新する重み集合です。予測の形を決めます。"),
        ("順伝播", "入力から出力へ値を流して予測を計算する過程です。"),
        ("逆伝播", "損失から勾配を計算して各パラメータの更新量を求める過程です。")
    ],
    "強化学習": [
        ("状態 s", "エージェントが観測している環境の要約です。"),
        ("行動 a", "状態で選べる操作です。行動が次状態と報酬を変えます。"),
        ("報酬 r", "行動の直後に得る評価信号です。将来報酬の合計を最大化します。")
    ],
    "LLM": [
        ("トークン", "モデルが処理する最小単位です。日本語では1文字単位とは限りません。"),
        ("次トークン確率", "文脈に対して次に出る候補の確率分布です。生成の中核です。"),
        ("コンテキスト", "モデルに渡す入力全体です。指示・資料・履歴が含まれます。")
    ],
    "深層生成モデル": [
        ("確率分布", "データがどの値を取りやすいかを表す規則です。生成モデルの土台です。"),
        ("サンプリング", "分布から実際のデータ点を取り出す操作です。生成結果そのものに対応します。"),
        ("目的関数", "学習で最適化する指標です。モデルの学習挙動を決めます。")
    ],
    "世界モデル": [
        ("状態表現 z", "観測を圧縮した内部表現です。予測と計画の共通基盤になります。"),
        ("遷移モデル", "現在状態と行動から次状態を予測するモデルです。"),
        ("観測モデル", "内部状態から画像やセンサ値などの観測を再構成するモデルです。")
    ]
}

EXTRA_TERMS: Dict[str, List[Tuple[str, str]]] = {
    "python-basic-operations": [
        ("条件分岐", "条件が真か偽かで実行経路を切り替える仕組みです。"),
        ("反復", "同じ処理を複数回回す仕組みです。for と while を使います。")
    ],
    "numpy-basics": [
        ("ndarray", "NumPyの多次元配列です。高速な数値計算の基本構造です。"),
        ("ブロードキャスト", "形の異なる配列を規則に従って自動拡張し演算する仕組みです。"),
        ("軸 (axis)", "どの次元方向に集約・演算するかを指定する引数です。")
    ],
    "pandas-basics": [
        ("DataFrame", "表形式データを行列として扱う構造です。列ごとに型を持てます。"),
        ("インデックス", "行ラベルです。抽出や結合の基準として働きます。"),
        ("欠損値", "値が未観測のセルです。学習前に補完・除外の方針が必要です。")
    ],
    "matplotlib-seaborn": [
        ("可視化", "データの分布や関係を図で確認する工程です。仮説検証の入り口です。"),
        ("軸スケール", "線形・対数などの軸設定で見える傾向が変わる点に注意します。")
    ],
    "simple-regression": [
        ("回帰直線", "入力 x と出力 y の関係を直線で近似したモデルです。"),
        ("最小二乗法", "誤差二乗和が最小になる係数を求める推定法です。")
    ],
    "multiple-regression": [
        ("多重共線性", "説明変数同士が強く相関し、係数推定が不安定になる問題です。"),
        ("係数解釈", "他変数を固定したときの1単位変化の寄与として読みます。")
    ],
    "sklearn-xgboost": [
        ("fit/predict", "fit で学習し、predict で推論するのが標準インターフェースです。"),
        ("勾配ブースティング", "弱学習器を逐次追加して誤差を減らす手法群です。")
    ],
    "feature-engineering": [
        ("リーク", "学習時点で利用できない未来情報を特徴量に含めてしまう誤りです。"),
        ("スケーリング", "特徴量のスケール差を調整して最適化を安定させる処理です。")
    ],
    "supervised-unsupervised-learning": [
        ("教師あり学習", "正解ラベル付きデータから入力→出力の対応を学ぶ方法です。"),
        ("教師なし学習", "ラベルなしデータから構造や類似性を抽出する方法です。")
    ],
    "time-series-data": [
        ("時系列分割", "時間順序を保って訓練・検証を分ける評価法です。"),
        ("時系列リーク", "未来時点の情報を過去予測に混ぜる誤りです。")
    ],
    "sql-for-ml": [
        ("JOIN", "複数テーブルをキーで結合して学習用の表を作る操作です。"),
        ("GROUP BY", "集約単位を指定して統計量を作る操作です。特徴量作成で多用します。")
    ],
    "neural-network-basics": [
        ("活性化関数", "線形変換の後に非線形性を入れる関数です。表現力を決めます。"),
        ("パーセプトロン", "重み付き和と活性化で出力を作る最小単位です。")
    ],
    "loss-and-gradient-descent": [
        ("勾配", "損失を増やす方向と変化率を表すベクトルです。"),
        ("学習率", "1回の更新でどれだけ動かすかを決める係数です。")
    ],
    "optimization-regularization": [
        ("正則化", "訓練誤差だけに過剰適合しないように制約を加える方法です。"),
        ("過学習", "訓練では良いが未知データで性能が落ちる状態です。")
    ],
    "convolution-basics": [
        ("カーネル", "局所領域に適用する重み行列です。特徴抽出を担います。"),
        ("ストライド", "カーネルをずらす幅です。出力解像度に影響します。")
    ],
    "image-recognition-yolo": [
        ("バウンディングボックス", "物体位置を矩形で表す予測形式です。"),
        ("IoU", "予測矩形と正解矩形の重なり率です。検出評価の基礎です。"),
        ("NMS", "重複検出を抑える後処理です。")
    ],
    "recurrent-neural-networks": [
        ("隠れ状態", "時刻をまたいで情報を保持する内部ベクトルです。"),
        ("勾配消失", "長系列で勾配が小さくなり学習が進みにくくなる問題です。"),
        ("ゲート機構", "LSTM/GRUで情報の通過量を制御する仕組みです。")
    ],
    "transformer-basics": [
        ("自己注意 (Self-Attention)", "系列内の各位置が他位置を参照して重み付けする仕組みです。"),
        ("Q/K/V", "注意計算で使う3種類の射影ベクトルです。関連度を計算します。")
    ],
    "nlp-deep-learning": [
        ("トークナイズ", "文字列をモデル入力単位に分割する処理です。"),
        ("埋め込み", "離散トークンを連続ベクトルに写像する表現です。")
    ],
    "rl-foundation": [
        ("MDP", "状態・行動・遷移・報酬で意思決定問題を表す枠組みです。"),
        ("収益 (Return)", "将来報酬の割引和です。強化学習の最適化対象です。")
    ],
    "value-function": [
        ("状態価値 V(s)", "状態 s から得られる期待収益です。"),
        ("行動価値 Q(s,a)", "状態 s で行動 a を選んだときの期待収益です。")
    ],
    "bellman-equations": [
        ("ベルマン期待方程式", "方策固定時の価値を再帰的に定義する式です。"),
        ("ベルマン最適方程式", "最適行動を仮定した価値の再帰式です。")
    ],
    "policy-iteration": [
        ("方策評価", "現在の方策で価値関数を計算する段階です。"),
        ("方策改善", "価値に基づいてより良い行動選択へ更新する段階です。")
    ],
    "value-iteration": [
        ("価値バックアップ", "ベルマン最適方程式で価値を反復更新する操作です。"),
        ("貪欲方策", "推定価値が最大の行動を選ぶ方策です。")
    ],
    "td-learning": [
        ("ブートストラップ", "将来推定値を使って現在値を更新する考え方です。"),
        ("TD誤差", "予測値と1ステップ先を使った目標値との差です。")
    ],
    "q-learning": [
        ("オフポリシー", "行動生成方策と学習対象方策が異なる更新方式です。"),
        ("max 演算", "次状態で最良行動を仮定して更新する点が特徴です。")
    ],
    "sarsa": [
        ("オンポリシー", "実際に選んだ次行動で更新する方式です。"),
        ("探索依存更新", "探索方策の影響を受けたまま価値が更新されます。")
    ],
    "n-step-td": [
        ("n-step収益", "n ステップ分の実報酬と先の推定値を組み合わせた目標です。"),
        ("バイアス・分散", "n を増やすとバイアスは下がり分散は上がる傾向があります。")
    ],
    "td-lambda": [
        ("λ-return", "複数の n-step 目標を指数重みで混ぜた目標値です。"),
        ("λ", "短期更新と長期更新の混合比を調整する係数です。")
    ],
    "eligibility-trace-td-lambda": [
        ("Eligibility Trace", "過去状態への責任を時間減衰で保持する仕組みです。"),
        ("後方視点更新", "現在の TD 誤差を過去状態へ一括配分する実装形です。")
    ],
    "deep-rl": [
        ("関数近似", "価値関数を表でなくニューラルネットで近似する方法です。"),
        ("経験再生", "過去遷移をバッファから再利用して相関を下げる手法です。"),
        ("ターゲットネット", "更新目標を安定化するために遅延コピーを使う仕組みです。")
    ],
    "prompt-engineering": [
        ("指示・制約・出力形式", "目的と禁止事項と返答形を分離して指定する設計です。"),
        ("評価観点", "良い応答の基準を先に決めることで改善ループが回ります。")
    ],
    "llm-pretraining": [
        ("事前学習", "大規模コーパスで次トークン予測を学ぶ段階です。"),
        ("言語モデリング損失", "正解トークン確率の対数尤度に基づく損失です。")
    ],
    "scaling-laws": [
        ("スケーリング則", "モデルサイズ・データ量・計算量と損失の経験則です。"),
        ("計算予算", "同じ予算下でモデルとデータをどう配分するかが重要です。")
    ],
    "fine-tuning": [
        ("SFT", "教師データでモデルを目的タスクへ適応させる微調整です。"),
        ("分布ずれ", "事前学習分布と実運用分布の差が性能劣化を生む現象です。")
    ],
    "hallucination-rlhf": [
        ("ハルシネーション", "根拠がない内容をもっともらしく生成する現象です。"),
        ("RLHF", "人間の選好を報酬にして応答方針を調整する手法です。")
    ],
    "tool-use-rag": [
        ("RAG", "検索で得た外部文脈を使って生成を根拠付きにする手法です。"),
        ("グラウンディング", "回答を参照情報に結び付けることで幻覚を抑える考え方です。")
    ],
    "domain-specialization": [
        ("ドメイン適応", "対象領域のデータ特性に合わせてモデルを調整することです。"),
        ("評価セット", "運用条件を反映した固定評価で改善の実効性を測ります。")
    ],
    "llm-efficiency": [
        ("量子化", "重みや活性を低ビット化して計算・メモリを削減する方法です。"),
        ("蒸留", "大モデルの挙動を小モデルへ移す学習方法です。"),
        ("レイテンシ", "1リクエスト応答までの時間です。運用品質に直結します。")
    ],
    "generative-model-overview": [
        ("生成モデル", "データ分布を学習し新しいサンプルを作るモデル群です。"),
        ("尤度", "観測データがモデルでどれだけ説明できるかを示す量です。")
    ],
    "latent-variable-mixture-models": [
        ("潜在変数", "直接観測されない要因を表す変数です。"),
        ("混合分布", "複数成分分布の重み付き和で複雑な分布を表します。")
    ],
    "vae": [
        ("エンコーダ/デコーダ", "入力を潜在へ圧縮し、潜在から再構成する2段構成です。"),
        ("KL項", "近似事後分布を事前分布へ近づける正則化項です。")
    ],
    "gan": [
        ("生成器", "ノイズからサンプルを生成するネットワークです。"),
        ("識別器", "本物/生成物を判定するネットワークで、生成器と競合学習します。")
    ],
    "autoregressive-flow-models": [
        ("自己回帰分解", "同時分布を条件付き分布の積で表す分解です。"),
        ("正規化フロー", "可逆変換で密度を厳密計算できる生成モデルです。")
    ],
    "energy-based-models": [
        ("エネルギー関数", "入力の尤もらしさをスカラー値で表す関数です。低いほど尤もらしいです。"),
        ("分配関数", "正規化に必要な積分項で、学習を難しくする要因です。")
    ],
    "score-diffusion-models": [
        ("スコア", "対数密度の勾配です。高密度方向を示します。"),
        ("ノイズスケジュール", "拡散過程でノイズ量を時刻ごとに決める設計です。")
    ],
    "continuous-diffusion-flow-matching": [
        ("確率フロー ODE", "拡散過程と同じ周辺分布を持つ連続時間の決定論的方程式です。"),
        ("フローマッチング", "目標ベクトル場に速度場を一致させる学習方式です。")
    ],
    "world-models-and-generative-models": [
        ("世界モデル", "環境遷移を内部で予測し計画に使うモデルです。"),
        ("潜在ダイナミクス", "観測空間ではなく潜在空間で遷移を学ぶ考え方です。")
    ],
    "control-model-and-mbrl": [
        ("モデルベース強化学習", "遷移モデルを用いて行動計画を行う強化学習です。"),
        ("MPC", "短い予測地平で最適化し、先頭行動だけ実行する制御法です。")
    ],
    "state-space-models": [
        ("状態空間モデル", "潜在状態の遷移と観測生成を分けて記述するモデルです。"),
        ("フィルタリング", "観測履歴から現在状態を逐次推定する操作です。")
    ],
    "state-representation-learning": [
        ("表現学習", "下流タスクに有効な潜在表現をデータから学ぶことです。"),
        ("識別可能性", "異なる真状態を区別できる表現になっているかという性質です。")
    ],
    "state-prediction-models": [
        ("1ステップ予測", "次時刻だけを予測する設定です。"),
        ("多ステップ予測", "連鎖予測で誤差累積が起こるため評価が重要です。")
    ],
    "vae-diffusion-world-models": [
        ("潜在生成モデル", "世界モデル内で観測分布を扱うためにVAE/拡散を組み込む設計です。"),
        ("再構成誤差", "観測再生成のズレで表現品質を測る指標です。")
    ],
    "simulation-and-cg": [
        ("シミュレータギャップ", "シミュレーションと実世界の差で性能が落ちる問題です。"),
        ("ドメインランダム化", "見た目や物理を揺らして実環境への頑健性を高める手法です。")
    ],
    "ssm-and-transformer": [
        ("長期依存", "離れた時刻間の関係を保持して予測に使う性質です。"),
        ("SSM と Attention", "線形再帰と注意機構の計算特性の違いを比較する視点です。")
    ],
    "observation-prediction-models": [
        ("観測予測", "将来観測を直接予測して環境理解に使う設定です。"),
        ("自己回帰/マスク/拡散", "観測生成を行う代表的な3つのモデリング様式です。")
    ],
    "multimodal-world-models": [
        ("マルチモーダル", "画像・テキスト・行動など複数モダリティを同時に扱う設定です。"),
        ("アラインメント", "異なるモダリティの意味空間を対応付ける学習です。")
    ]
}


def clean_title(markdown_text: str) -> str:
    first = markdown_text.strip().splitlines()[0] if markdown_text.strip() else ""
    if first.startswith("#"):
        return first.lstrip("#").strip()
    return first


def build_concept_cell(chapter_title: str, notebook_id: str, title: str) -> str:
    terms: List[Tuple[str, str]] = []
    seen = set()
    for term, definition in BASE_TERMS.get(chapter_title, []):
        if term not in seen:
            terms.append((term, definition))
            seen.add(term)
    for term, definition in EXTRA_TERMS.get(notebook_id, []):
        if term not in seen:
            terms.append((term, definition))
            seen.add(term)

    # 6個程度に抑えて読みやすくする
    terms = terms[:6]

    lines = [
        "## 概念の土台",
        "",
        f"{title}に入る前に、つまずきやすい用語を先にそろえます。以降のコードでは、変数がどの概念を表しているかを対応付けながら読んでください。",
        ""
    ]
    for term, definition in terms:
        lines.append(f"- **{term}**: {definition}")

    lines.extend([
        "",
        "このノートでは、ここで定義した語を実験セルの変数・式に直接対応させて確認します。"
    ])
    return "\n".join(lines).strip() + "\n"


def is_concept_cell(text: str) -> bool:
    t = text.strip()
    return t.startswith("## 概念の土台")


def main() -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    chapter_of: Dict[str, str] = {}
    for chapter in catalog["chapters"]:
        for nb in chapter["notebooks"]:
            chapter_of[nb["id"]] = chapter["title"]

    changed = 0
    for nb_path in sorted(NOTEBOOK_DIR.glob("*.ipynb")):
        notebook_id = nb_path.stem
        chapter_title = chapter_of.get(notebook_id, "")
        data = json.loads(nb_path.read_text(encoding="utf-8"))
        cells = data.get("cells", [])
        if not cells:
            continue

        first_md_idx = None
        for idx, cell in enumerate(cells):
            if cell.get("cell_type") == "markdown":
                first_md_idx = idx
                break
        if first_md_idx is None:
            continue

        first_text = "".join(cells[first_md_idx].get("source", []))
        title = clean_title(first_text) or notebook_id

        concept_text = build_concept_cell(chapter_title, notebook_id, title)
        concept_cell = {
            "cell_type": "markdown",
            "metadata": {},
            "source": [concept_text]
        }

        insert_pos = first_md_idx + 1
        if insert_pos < len(cells) and cells[insert_pos].get("cell_type") == "markdown":
            second_text = "".join(cells[insert_pos].get("source", []))
            if is_concept_cell(second_text):
                if second_text != concept_text:
                    cells[insert_pos]["source"] = [concept_text]
                    changed += 1
            else:
                cells.insert(insert_pos, concept_cell)
                changed += 1
        else:
            cells.insert(insert_pos, concept_cell)
            changed += 1

        data["cells"] = cells
        nb_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"updated_notebooks={changed}")


if __name__ == "__main__":
    main()
