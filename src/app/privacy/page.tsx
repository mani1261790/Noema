import type { Metadata } from "next";
import Link from "next/link";
import { toAbsoluteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "プライバシーポリシー",
  description: "Noemaのプライバシーポリシーです。取得する情報、その利用目的、外部サービス利用、安全管理などを説明しています。",
  alternates: {
    canonical: "/privacy"
  },
  openGraph: {
    title: "プライバシーポリシー",
    description: "Noemaのプライバシーポリシーです。取得する情報、その利用目的、外部サービス利用、安全管理などを説明しています。",
    url: toAbsoluteUrl("/privacy"),
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Noema プライバシーポリシー"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "プライバシーポリシー",
    description: "Noemaのプライバシーポリシーです。取得する情報、その利用目的、外部サービス利用、安全管理などを説明しています。",
    images: ["/opengraph-image"]
  }
};

const sectionStyle = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "24px",
  padding: "24px"
} as const;

export default function PrivacyPage() {
  return (
    <main style={{ fontFamily: '"IBM Plex Sans", system-ui, sans-serif', background: "#f8fafc", color: "#0f172a", minHeight: "100vh" }}>
      <div style={{ maxWidth: "920px", margin: "0 auto", padding: "40px 20px 80px" }}>
        <nav aria-label="breadcrumb" style={{ marginBottom: "18px", color: "#64748b" }}>
          <Link href="/" style={{ color: "#64748b", textDecoration: "none" }}>Noema</Link>
          {" / "}
          <span>プライバシーポリシー</span>
        </nav>

        <header style={{ marginBottom: "28px" }}>
          <p style={{ color: "#2563eb", fontWeight: 700, marginBottom: "10px" }}>Privacy Policy</p>
          <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.2rem)", lineHeight: 1.1, margin: 0 }}>プライバシーポリシー</h1>
          <p style={{ color: "#475569", lineHeight: 1.8, marginTop: "18px", maxWidth: "780px" }}>
            Noemaは、学習プラットフォームの提供にあたり、ユーザーのプライバシーを尊重します。本ポリシーは、当社が取得する情報、その利用目的、管理方法およびユーザーの権利に関する基本方針を定めるものです。
          </p>
          <p style={{ color: "#64748b", marginTop: "12px" }}>最終更新日: 2026年4月19日</p>
        </header>

        <div style={{ display: "grid", gap: "18px" }}>
          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>1. 取得する情報</h2>
            <p style={{ color: "#334155", lineHeight: 1.8 }}>
              当社は、本サービスの提供にあたり、以下の情報を取得することがあります。
            </p>
            <ul style={{ color: "#334155", lineHeight: 1.9, marginBottom: 0, paddingLeft: "20px" }}>
              <li>メールアドレス、認証に必要なアカウント情報</li>
              <li>ログイン状態の維持やセッション管理に必要な情報</li>
              <li>利用日時、閲覧ページ、エラー情報、端末・ブラウザに関する技術情報</li>
              <li>お問い合わせ時にユーザーが任意に提供する情報</li>
            </ul>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>2. 利用目的</h2>
            <p style={{ color: "#334155", lineHeight: 1.8 }}>
              取得した情報は、以下の目的で利用します。
            </p>
            <ul style={{ color: "#334155", lineHeight: 1.9, marginBottom: 0, paddingLeft: "20px" }}>
              <li>ユーザー認証、アカウント管理および不正利用防止のため</li>
              <li>教材閲覧、ノートブック学習機能その他サービス提供のため</li>
              <li>障害対応、品質改善、セキュリティ対策、利用状況分析のため</li>
              <li>お問い合わせ対応、重要なお知らせ、利用規約変更等の通知のため</li>
            </ul>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>3. 外部サービスの利用</h2>
            <p style={{ color: "#334155", lineHeight: 1.8 }}>
              当社は、本サービスの認証およびインフラ運用のため、外部事業者が提供するクラウドサービスを利用することがあります。現時点では、認証基盤としてAWS Cognitoを含むAWS関連サービスを利用しています。
            </p>
            <p style={{ color: "#334155", lineHeight: 1.8, marginBottom: 0 }}>
              これらの外部サービス事業者は、当社の委託先またはインフラ提供者として、サービス提供上必要な範囲で情報を取り扱う場合があります。
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>4. Cookie等の利用</h2>
            <p style={{ color: "#334155", lineHeight: 1.8, marginBottom: 0 }}>
              当社は、ログイン状態の維持、利便性向上、障害解析、セキュリティ確保のために、Cookie、ローカルストレージその他これに類する技術を利用することがあります。ブラウザ設定により一部を無効化した場合、本サービスの一部機能が正常に動作しないことがあります。
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>5. 第三者提供</h2>
            <p style={{ color: "#334155", lineHeight: 1.8, marginBottom: 0 }}>
              当社は、法令に基づく場合、本人の同意がある場合、または業務委託・サービス提供に必要な範囲で取り扱いを委託する場合を除き、取得した個人情報を第三者に提供しません。
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>6. 安全管理</h2>
            <p style={{ color: "#334155", lineHeight: 1.8, marginBottom: 0 }}>
              当社は、取得した情報への不正アクセス、漏えい、改ざん、滅失または毀損を防止するため、合理的な安全管理措置を講じます。ただし、インターネット通信およびクラウド基盤の性質上、完全な安全性を保証するものではありません。
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>7. 保有情報の開示・訂正・削除等</h2>
            <p style={{ color: "#334155", lineHeight: 1.8, marginBottom: 0 }}>
              ユーザーは、法令の定めに従い、当社に対して自己の個人情報の開示、訂正、追加、削除または利用停止を求めることができます。具体的な手続は、当社が別途案内する窓口を通じて受け付けます。
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>8. 未成年者の利用</h2>
            <p style={{ color: "#334155", lineHeight: 1.8, marginBottom: 0 }}>
              未成年のユーザーは、必要に応じて親権者その他法定代理人の同意を得たうえで本サービスを利用してください。
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>9. 改定</h2>
            <p style={{ color: "#334155", lineHeight: 1.8, marginBottom: 0 }}>
              当社は、必要に応じて本ポリシーを改定することがあります。重要な変更を行う場合は、本サービス上への掲載その他相当の方法で周知します。
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>10. お問い合わせ</h2>
            <p style={{ color: "#334155", lineHeight: 1.8, marginBottom: 0 }}>
              本ポリシーに関するお問い合わせは、当社が別途案内する窓口から受け付けます。
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
