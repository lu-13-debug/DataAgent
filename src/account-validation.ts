export interface RegistrationInput { username: string; displayName: string; password: string; confirmPassword: string }

export function registrationError(input: RegistrationInput): string {
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(input.username)) return '用户名须为 3–32 个英文字母、数字或下划线。';
  if (!input.displayName.trim() || [...input.displayName.trim()].length > 40) return '显示名称须为 1–40 个字符，可以使用中文。';
  return newPasswordError(input.password, input.confirmPassword);
}

function newPasswordError(password: string, confirmPassword: string): string {
  if (password.length < 10 || password.length > 128) return '密码须为 10–128 个字符，空格会原样保留。';
  if (password !== confirmPassword) return '两次输入的密码不一致。';
  return '';
}

export function passwordChangeError(currentPassword: string, newPassword: string, confirmPassword: string): string {
  if (!currentPassword) return '请填写当前密码。';
  return newPasswordError(newPassword, confirmPassword);
}
