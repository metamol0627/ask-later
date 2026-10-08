// OS 通知。補助手段であり、すべて best-effort（出せない環境でも番兵ファイルは既に置いてある）。
//   Windows  PowerShell の toast（WinRT）。powershell.exe は .exe なのでシェル無しで起動できる
//   macOS    osascript の display notification
//   Linux    notify-send（無ければ何もしない）
import { execFile } from "node:child_process";

function run(cmd, args, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
        resolve({ ok: !err, error: err ? (stderr || err.message).toString().trim().split("\n")[0] : null });
      });
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
    if (child && child.unref) child.unref();
  });
}

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
const asQuote = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export async function notify({ title, body, platform = process.platform }) {
  const t = String(title ?? "").slice(0, 120);
  const b = String(body ?? "").slice(0, 200);
  try {
    if (platform === "win32") {
      const script = [
        "[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]",
        "$tmpl = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
        '$nodes = $tmpl.GetElementsByTagName("text")',
        `$nodes.Item(0).AppendChild($tmpl.CreateTextNode(${psQuote(t)})) | Out-Null`,
        `$nodes.Item(1).AppendChild($tmpl.CreateTextNode(${psQuote(b)})) | Out-Null`,
        "$toast = [Windows.UI.Notifications.ToastNotification]::new($tmpl)",
        "$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)",
      ].join("; ");
      const r = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
      return { ...r, method: "toast" };
    }
    if (platform === "darwin") {
      const r = await run("osascript", ["-e", `display notification ${asQuote(b)} with title ${asQuote(t)}`]);
      return { ...r, method: "osascript" };
    }
    const r = await run("notify-send", [t, b]);
    return { ...r, method: "notify-send" };
  } catch (e) {
    return { ok: false, method: null, error: e.message };
  }
}
