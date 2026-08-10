import { parseArgs } from "node:util";
import { sendEmail } from "./lib/send-email.ts";

const { values } = parseArgs({
  options: {
    to: { type: "string" },
    from: { type: "string" },
    subject: { type: "string", default: "[stock-ai] Resend 疎通テスト" },
  },
});

const to = values.to ?? process.env.NOTIFICATION_EMAIL;
if (!to) throw new Error("--to or NOTIFICATION_EMAIL is required");

const now = new Date();
const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  .toISOString()
  .replace("T", " ")
  .slice(0, 19);

const html = `
  <p>Resend 経由の疎通テストです。</p>
  <ul>
    <li>送信時刻 (JST): ${jst}</li>
    <li>from: ${values.from ?? process.env.EMAIL_FROM ?? "noreply@stock-ai.uk"}</li>
    <li>to: ${to}</li>
  </ul>
  <p>このメールが届けば FX Phase 3 の配信基盤は稼働可能です。</p>
`;

const result = await sendEmail({
  to,
  from: values.from,
  subject: values.subject,
  html,
  text: `Resend 疎通テスト (JST ${jst})`,
});

console.log(`sent: id=${result.id}  to=${to}`);
