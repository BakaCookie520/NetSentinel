import i18n from "./i18n";

const zh = {
  description: "配置用于账户验证、密码重置和工作流的 SMTP 发件服务。",
  enabled: "启用 SMTP 发件", host: "SMTP 服务器", port: "端口", tls: "加密方式", implicit: "隐式 TLS", starttls: "STARTTLS（必需）",
  user: "SMTP 用户名（可选）", password: "SMTP 密码", passwordKept: "密码已保存。服务器和认证用户不变时，留空可保留原密码。",
  from: "发件邮箱", to: "测试收件地址", test: "发送测试邮件", sent: "SMTP 服务器已接收测试邮件。", saved: "邮件设置已保存。", save: "保存邮件设置",
  transport: "邮件发送方式", credential: "使用独立 SMTP 凭据", system: "使用系统 SMTP",
  account: "账户邮箱", emailHint: "绑定并验证邮箱后可使用邮箱登录和找回密码。", disabled: "系统 SMTP 未启用，暂时不能发送验证码。已绑定的邮箱仍可登录。",
  unverified: "未验证", verified: "已验证", noEmail: "尚未绑定邮箱", newEmail: "要验证的邮箱", request: "发送验证码", resend: "重新发送验证码", confirm: "验证并绑定", remove: "解绑邮箱", removed: "邮箱已解绑。", bound: "邮箱已验证，可用于登录。", code: "邮件验证码", checkInbox: "如果邮箱符合条件，请查收邮件。",
  rename: "修改账号名称", renamed: "账号名称已更新。", useEmail: "使用邮箱找回密码", useKey: "使用恢复密钥", reset: "重置密码", retain2fa: "邮箱重置不会关闭双重验证。",
};
const en = {
  description: "Configure SMTP for account verification, password resets and workflows.",
  enabled: "Enable SMTP delivery", host: "SMTP server", port: "Port", tls: "Encryption", implicit: "Implicit TLS", starttls: "STARTTLS (required)",
  user: "SMTP username (optional)", password: "SMTP password", passwordKept: "A password is saved. Leave it blank to retain it if the server and user are unchanged.",
  from: "Sender email", to: "Test recipient", test: "Send test email", sent: "The SMTP server accepted the test email.", saved: "Mail settings saved.", save: "Save mail settings",
  transport: "Mail transport", credential: "Use a dedicated SMTP credential", system: "Use system SMTP",
  account: "Account email", emailHint: "Verify an email address to use it for sign-in and password recovery.", disabled: "SMTP is disabled, so verification messages cannot be sent. Your linked email still works for sign-in.",
  unverified: "Unverified", verified: "Verified", noEmail: "No email linked", newEmail: "Email to verify", request: "Send code", resend: "Resend code", confirm: "Verify and link", remove: "Unlink email", removed: "Email unlinked.", bound: "Email verified and ready for sign-in.", code: "Email verification code", checkInbox: "If this email address is eligible, check your inbox.",
  rename: "Change account name", renamed: "Account name updated.", useEmail: "Recover by email", useKey: "Use recovery key", reset: "Reset password", retain2fa: "An email reset does not turn off two-factor authentication.",
};
i18n.addResourceBundle("zh-CN", "translation", { mail: zh }, true, true);
i18n.addResourceBundle("en-US", "translation", { mail: en }, true, true);
