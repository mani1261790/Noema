import { useRef, useState } from "react";
import { mcpDiagnostics, pluginQuickstart, studioMcpEndpoint, studioMcpGuide } from "./mcp-connection";

export function StudioMcpConnection() {
  const endpoint = useRef<HTMLInputElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const [symptom, setSymptom] = useState("");
  const diagnosis = mcpDiagnostics.find((item) => item.id === symptom);

  async function copyEndpoint() {
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(studioMcpEndpoint);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
      endpoint.current?.focus();
      endpoint.current?.select();
    }
  }

  return (
    <section className="studio-mcp" aria-labelledby="studio-mcp-heading">
      <h1 id="studio-mcp-heading" tabIndex={-1}>AIから接続</h1>
      <p>Studio MCPで、AIクライアントから記事の検索、下書きの検証・保存、レビューができます。公開操作はStudioで行います。</p>
      <p>GitHub連携、クライアントへの登録、Cloudflare Access認証、CMSの役割はそれぞれ別です。Studioにログインしていても、外部クライアントの接続状態はこの画面では確認できません。</p>
      <h2>1. 接続先を確認する</h2>
      <label htmlFor="studio-mcp-endpoint">MCPエンドポイント（Streamable HTTP）</label>
      <div className="studio-mcp__endpoint">
        <input id="studio-mcp-endpoint" ref={endpoint} readOnly value={studioMcpEndpoint} onFocus={(event) => event.currentTarget.select()} />
        <button type="button" className="dads-button" data-size="sm" data-type="outline" disabled={copyState === "copying"} onClick={() => void copyEndpoint()}>{copyState === "failed" ? "コピーを再試行" : "URLをコピー"}</button>
      </div>
      <p role="status">{copyState === "copied" ? "URLをコピーしました。接続の確認はクライアントで行ってください。" : copyState === "failed" ? "コピーできませんでした。URLを選択して手動でコピーするか、再試行してください。" : "URL欄を選択して手動でコピーすることもできます。"}</p>
      <p>Cloudflare Accessの許可と、有効なStudioメンバー登録が必要です。下書き保存にはeditorまたはadminの編集権限が必要です。</p>
      <h2>2. クライアントに登録する</h2>
      <details open>
        <summary>Codex — 既存のプロジェクト設定を使う</summary>
        <ol>
          <li>Noemaリポジトリを開いて信頼し、初回はアプリ・IDE拡張を再起動します。</li>
          <li><code>.codex/config.toml</code>の<code>scopes = ["openid"]</code>を維持します。MCP一覧の<code>noema-studio</code>からAuthenticate、または<code>codex mcp login noema-studio</code>を実行します。</li>
          <li>初回認証・再認証をブラウザで完了し、新しいタスクで下記の確認を行います。グローバル設定のみの場合は<code>codex mcp login noema-studio --scopes openid</code>を使います。</li>
        </ol>
        <p>2026年10月1日、Codex CLI 0.157.0でOAuth認証、本人・編集権限の確認、記事一覧の取得、保存しない原稿検証まで確認しました。接続時にはご自身のアカウントでも確認してください。</p>
      </details>
      <details>
        <summary>ChatGPT — personal pluginを登録・インストールする</summary>
        <p><a href={pluginQuickstart} target="_blank" rel="noreferrer">公式quickstart（別タブ）</a>に沿って、Settings → Security and loginのDeveloper mode、Pluginsの追加画面で上記URLを登録します。personal pluginsからインストールし、新しいWorkチャットで@から選択します。</p>
        <p>公式例は認証不要です。NoemaのOAuth完了・ツール実行は未検証です。認証なしの設定や共有tokenで代用しないでください。</p>
      </details>
      <details>
        <summary>dot — 利用する環境で確認する</summary>
        <p>利用中のdotの画面・環境で、Noemaのプラグインが一覧に現れ、選択・利用できるかを確認してください。ChatGPTで作成しただけではdotでも使えるとは限りません。表示されない場合はクライアント側の利用条件を確認します。NoemaのOAuth・ツール実行は未検証です。</p>
      </details>
      <h2>3. 保存せずに接続を確認する</h2>
      <ol>
        <li><code>studio_whoami</code>で本人と役割、<code>capabilities.canEdit</code>を確認します。</li>
        <li><code>studio_list_articles</code>で読み取りを確認します。</li>
        <li><code>studio_validate_draft</code>で原稿を検証します。検証だけでは保存されません。</li>
      </ol>
      <p>保存を明示的に選んだときだけ、編集権限を確認して<code>studio_create_draft</code>を実行します。接続確認用の下書きは<code>visibility: "internal"</code>を使い、書き込みの確認を省略しないでください。</p>
      <h2>困ったとき</h2>
      <label htmlFor="studio-mcp-symptom">止まった段階・表示</label>
      <select id="studio-mcp-symptom" value={symptom} onChange={(event) => setSymptom(event.target.value)}>
        <option value="">選択してください</option>
        {mcpDiagnostics.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <p role="status">{diagnosis?.next ?? "表示に近い項目を選ぶと、次の操作が表示されます。自動の接続診断は行いません。"}</p>
      <p>選択内容は送信・保存しません。相談時はクライアント名・バージョン・確認日・止まった段階・エラーコードだけを共有してください。token、cookie、認可コード、認可URL全体、メール本文は貼らないでください。</p>
      <a href={studioMcpGuide} target="_blank" rel="noreferrer">接続・運用ガイドと互換性の確認記録（別タブ）</a>
    </section>
  );
}
