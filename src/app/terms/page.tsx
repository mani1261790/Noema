import type { Metadata } from "next";
import Link from "next/link";
import { toAbsoluteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "利用規約",
  description: "Noemaの利用規約です。Noemaのアカウント利用条件、禁止事項、免責などを定めています。",
  alternates: {
    canonical: "/terms"
  },
  openGraph: {
    title: "利用規約",
    description: "Noemaの利用規約です。Noemaのアカウント利用条件、禁止事項、免責などを定めています。",
    url: toAbsoluteUrl("/terms"),
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Noema 利用規約"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "利用規約",
    description: "Noemaの利用規約です。Noemaのアカウント利用条件、禁止事項、免責などを定めています。",
    images: ["/opengraph-image"]
  }
};

const sectionStyle = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "24px",
  padding: "24px"
} as const;

export default function TermsPage() {
  return (
    <main style={{ fontFamily: '"IBM Plex Sans", system-ui, sans-serif', background: "#f8fafc", color: "#0f172a", minHeight: "100vh" }}>
      <div style={{ maxWidth: "920px", margin: "0 auto", padding: "40px 20px 80px" }}>
        <nav aria-label="breadcrumb" style={{ marginBottom: "18px", color: "#64748b" }}>
          <Link href="/" style={{ color: "#64748b", textDecoration: "none" }}>Noema</Link>
          {" / "}
          <span>利用規約</span>
        </nav>

        <header style={{ marginBottom: "28px" }}>
          <p style={{ color: "#2563eb", fontWeight: 700, marginBottom: "10px" }}>Terms of Service</p>
          <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.2rem)", lineHeight: 1.1, margin: 0 }}>利用規約</h1>
          <p style={{ color: "#475569", lineHeight: 1.8, marginTop: "18px", maxWidth: "780px" }}>
            本利用規約は、Noemaが提供する学習プラットフォームおよび関連サービスの利用条件を定めるものです。ユーザーは、本サービスを利用することで、本規約に同意したものとみなされます。
          </p>
          <p style={{ color: "#64748b", marginTop: "12px" }}>最終更新日: 2026年4月19日</p>
        </header>

        <div style={{ display: "grid", gap: "18px" }}>
          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>第1条 適用</h2>
            <p style={{ color: "#334155", lineHeight: 1.8, marginBottom: 0 }}>
              本規約は、Noemaが提供する教材閲覧、ノートブック学習、関連する認証機能、問い合わせ対応その他これらに付随する一切のサービスに適用されます。個別の案内、ヘルプ、画面上の注意事項は、本規約の一部を構成します。
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>第2条 アカウント登録と管理</h2>
            <p style={{ color: "#334155", lineHeight: 1.8 }}>
              ユーザーは、正確かつ最新の情報を用いてアカウント登録を行うものとします。ログイン情報の管理責任はユーザー自身にあり、第三者への貸与、譲渡、共有はできません。
            </p>
            <p style={{ color: "#334155", lineHeight: 1.8, marginBottom: 0 }}>
              登録情報に虚偽、誤記、なりすまし、または不正利用のおそれがあると当社が判断した場合、当社はアカウントの利用停止、削除、本人確認の要請その他必要な措置を行うことがあります。
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>第3条 本サービスの内容</h2>
            <p style={{ color: "#334155", lineHeight: 1.8, marginBottom: 0 }}>
              本サービスは、機械学習、LLM、強化学習、Python等に関する教材、ノートブック形式の学習コンテンツ、関連情報へのアクセス手段を提供します。当社は、サービス内容、掲載教材、提供機能、画面仕様を、継続的改善のため予告なく変更することがあります。
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>第4条 禁止事項</h2>
            <p style={{ color: "#334155", lineHeight: 1.8 }}>
              ユーザーは、本サービスの利用にあたり、以下の行為を行ってはなりません。
            </p>
            <ul style={{ color: "#334155", lineHeight: 1.9, marginBottom: 0, paddingLeft: "20px" }}>
              <li>法令、公序良俗または本規約に違反する行為</li>
              <li>不正アクセス、過度な負荷の送信、認証回避、脆弱性探索その他サービス運営を妨害する行為</li>
              <li>他人のアカウントまたは資格情報を不正に利用する行為</li>
              <li>教材、文章、画像、プログラムその他のコンテンツを、当社または権利者の許諾なく転載、複製、再配布、販売する行為</li>
              <li>本サービスを通じて取得した情報を、違法行為または第三者に損害を与える目的で利用する行為</li>
              <li>当社または第三者の権利、利益、名誉、信用、プライバシーを侵害する行為</li>
            </ul>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>第5条 知的財産権</h2>
            <p style={{ color: "#334155", lineHeight: 1.8, marginBottom: 0 }}>
              本サービスに含まれるテキスト、教材構成、デザイン、商標、プログラムその他一切のコンテンツに関する権利は、当社または正当な権利者に帰属します。ユーザーは、私的利用その他法令上認められる範囲を超えて利用してはなりません。
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>第6条 サービスの変更、中断、停止</h2>
            <p style={{ color: "#334155", lineHeight: 1.8, marginBottom: 0 }}>
              当社は、保守、障害対応、外部サービスの停止、セキュリティ上の必要性、事業上の判断その他の理由により、本サービスの全部または一部を変更、中断または停止することがあります。
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>第7条 免責</h2>
            <p style={{ color: "#334155", lineHeight: 1.8 }}>
              当社は、本サービスの継続性、完全性、正確性、特定目的適合性、学習成果、外部リンク先の内容について、明示または黙示を問わず保証しません。
            </p>
            <p style={{ color: "#334155", lineHeight: 1.8, marginBottom: 0 }}>
              当社は、本サービスの利用または利用不能によってユーザーまたは第三者に生じた損害について、当社の故意または重過失がある場合を除き、責任を負いません。
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>第8条 規約の変更</h2>
            <p style={{ color: "#334155", lineHeight: 1.8, marginBottom: 0 }}>
              当社は、必要と判断した場合、本規約を変更できます。重要な変更を行う場合は、本サービス上への掲載その他相当の方法で周知します。変更後にユーザーが本サービスを利用した場合、当該変更に同意したものとみなします。
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>第9条 お問い合わせ</h2>
            <p style={{ color: "#334155", lineHeight: 1.8, marginBottom: 0 }}>
              本規約または本サービスに関するお問い合わせは、当社が別途案内する窓口から受け付けます。
            </p>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>第10条 準拠法・管轄</h2>
            <p style={{ color: "#334155", lineHeight: 1.8, marginBottom: 0 }}>
              本規約は日本法に準拠して解釈されます。本サービスに関して当社とユーザーとの間で紛争が生じた場合には、当社の主たる事業所所在地を管轄する裁判所を第一審の専属的合意管轄裁判所とします。
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
