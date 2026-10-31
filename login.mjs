// ログイン: 画面ありのブラウザ（ツール専用プロファイル auth/profile/）を開き、利用者が手動でログインする。
// ログイン完了は自動で検知する（Enter 不要）。既にログイン済みならそのまま終了する。
// 投稿系コマンドもセッション切れ時は自動でこの画面を開くので、このコマンドは事前に済ませたいとき用。
// パスワードはこのスクリプトでは一切扱わない（ユーザーが画面で入力する）。
import { openAuthedContext, profileDir } from './lib/ourly.mjs';
import { config, run } from './lib/cli.mjs';

run(async () => {
  const { close } = await openAuthedContext(config, { headless: false });
  await close();
  console.log(`\n✅ ログイン済みです。セッションは ${profileDir(config)} に保持されています。`);
});
