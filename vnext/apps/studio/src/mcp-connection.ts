export const studioMcpEndpoint = "https://mcp.noema-learn.uk/mcp";
export const studioMcpGuide = "https://github.com/mani1261790/Noema/blob/develop/docs/studio-mcp.md";
export const pluginQuickstart = "https://developers.openai.com/plugins/quickstart";

// Fixed choices only: never accept or collect raw error messages, URLs or credentials.
export const mcpDiagnostics = [
  { id: "client", label: "ツールが見つからない・登録や操作許可で止まる", next: "クライアントへのログイン、MCP登録・プラグインのインストール、現在のタスクでの選択と操作許可を確認してください。この段階だけではNoemaの認証障害とは判断できません。" },
  { id: "unauthorized", label: "401 unauthorized", next: "MCPクライアントから再認証し、新しいタスクでstudio_whoamiを実行してください。Studioへのログインとは別の認証です。" },
  { id: "member", label: "403 member_not_registered", next: "Studioで招待の受け入れと初回登録を完了してください。同じメールアドレスで認証しているか、有効なメンバーかを確認し、解決しなければ管理者へ相談してください。" },
  { id: "scope", label: "scope不足・Consent request is malformed", next: "Codexではプロジェクト設定のscopes = [\"openid\"]を確認し、codex mcp login noema-studio --scopes openidで再認証してください。他クライアントではscopeとresourceの対応状況を確認します。Accessの保護を解除しないでください。" },
  { id: "forbidden", label: "forbidden・編集権限がない", next: "studio_whoamiの役割とcapabilities.canEditを確認してください。保存にはeditorまたはadminが必要です。権限がなければ保存せず、管理者へ相談してください。" },
  { id: "network", label: "通信エラー・503 authentication_unavailable", next: "接続先とネットワークを確認し、時間を置いてstudio_whoamiから再試行してください。保存結果が不明なときは、同じ入力と同じrequestIdでのみ再送します。" }
] as const;
