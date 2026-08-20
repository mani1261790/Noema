export const CLOUDFLARE_SIGN_UP_URL = "https://dash.cloudflare.com/sign-up";

export function buildPasswordLoginInstructions(email: string): string {
  return [
    "Noema Studioのログイン方法変更のお願い",
    "",
    `Studioに登録されているメールアドレス: ${email}`,
    "",
    "1. 次のページで、上記と完全に同じメールアドレスを使ってCloudflareアカウントとパスワードを準備してください。",
    CLOUDFLARE_SIGN_UP_URL,
    "2. Cloudflareから届くメールでメールアドレスを確認してください。",
    "3. すでに同じメールアドレスのCloudflareアカウントがある場合は、新規作成せず既存アカウントのパスワードを確認してください。",
    "4. StudioにOTPでログインし、画面の「パスワードを準備済みとして記録」を完了してください。",
    "5. 管理者から切替確認の案内が届いたら、Studioからログアウトし、Cloudflareを選んでログインしてください。",
    "",
    "別のメールアドレスを使うと、現在のCMS権限を引き継げません。OTPは移行確認が終わるまで利用できます。"
  ].join("\n");
}
