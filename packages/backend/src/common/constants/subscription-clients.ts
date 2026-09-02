/**
 * Client identification strings sent to subscription backends that gate model
 * lists or requests by client version. Lifted into one place so bumping a
 * version when an upstream releases a new model is a single edit.
 *
 * Codex (`https://chatgpt.com/backend-api/codex/...`): the `client_version`
 * URL param is enforced — older versions silently receive an older model
 * subset. Bump `CODEX_CLI_VERSION` to track the current `openai/codex` CLI
 * release. The user-agent string is not enforced, so it stays synthetic.
 *
 * Claude (`https://api.anthropic.com/...`): model gates validate the Claude
 * Code version embedded in the user-agent. Keep it at or above the minimum
 * required by the newest curated subscription model.
 *
 * Copilot (`https://api.githubcopilot.com/...`): GitHub validates the
 * `Editor-Version` and `Editor-Plugin-Version` headers; both are bumped
 * together when GitHub deprecates an older pair.
 */

export const CODEX_CLI_VERSION = '0.128.0';
export const CODEX_CLI_ORIGINATOR = 'codex_cli_rs';
export const CODEX_CLI_USER_AGENT = 'codex_cli_rs/0.0.0 (Unknown 0; unknown) unknown';

export const CLAUDE_CODE_VERSION = '2.1.258';
const CLAUDE_CODE_PACKAGE_URL = 'https://registry.npmjs.org/@anthropic-ai%2fclaude-code/latest';
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const VERSION_FETCH_TIMEOUT_MS = 10_000;
let currentClaudeCodeVersion = CLAUDE_CODE_VERSION;

export function getClaudeCodeVersion(): string {
  return currentClaudeCodeVersion;
}

export async function refreshClaudeCodeVersion(): Promise<string | null> {
  try {
    const response = await fetch(CLAUDE_CODE_PACKAGE_URL, {
      signal: AbortSignal.timeout(VERSION_FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown };
    if (typeof body.version !== 'string' || !VERSION_RE.test(body.version)) return null;
    currentClaudeCodeVersion = body.version;
    return currentClaudeCodeVersion;
  } catch {
    return null;
  }
}
export const CLAUDE_CODE_STAINLESS_PACKAGE_VERSION = '0.80.0';
export const CLAUDE_CODE_STAINLESS_RUNTIME_VERSION = 'v24.14.0';
export const CLAUDE_CODE_BETA_FLAGS = [
  'claude-code-20250219',
  'oauth-2025-04-20',
  'context-management-2025-06-27',
  'effort-2025-11-24',
].join(',');

export function claudeCodeStainlessArch(arch = process.arch): string {
  switch (arch) {
    case 'arm64':
      return 'arm64';
    case 'x64':
      return 'x64';
    default:
      return `Other:${arch}`;
  }
}

export function claudeCodeStainlessOs(platform = process.platform): string {
  switch (platform) {
    case 'darwin':
      return 'MacOS';
    case 'linux':
      return 'Linux';
    case 'win32':
      return 'Windows';
    case 'freebsd':
      return 'FreeBSD';
    default:
      return `Other:${platform}`;
  }
}

export const buildClaudeCodeSubscriptionHeaders = (apiKey: string): Record<string, string> => ({
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'anthropic-version': '2023-06-01',
  'anthropic-beta': CLAUDE_CODE_BETA_FLAGS,
  'anthropic-dangerous-direct-browser-access': 'true',
  'user-agent': `claude-cli/${getClaudeCodeVersion()} (external, sdk-cli)`,
  'x-app': 'cli',
  'x-stainless-arch': claudeCodeStainlessArch(),
  'x-stainless-helper-method': 'stream',
  'x-stainless-lang': 'js',
  'x-stainless-os': claudeCodeStainlessOs(),
  'x-stainless-package-version': CLAUDE_CODE_STAINLESS_PACKAGE_VERSION,
  'x-stainless-retry-count': '0',
  'x-stainless-runtime': 'node',
  'x-stainless-runtime-version': CLAUDE_CODE_STAINLESS_RUNTIME_VERSION,
  'x-stainless-timeout': '600',
});

export const COPILOT_EDITOR_VERSION = 'vscode/1.100.0';
export const COPILOT_PLUGIN_VERSION = 'copilot/1.300.0';
