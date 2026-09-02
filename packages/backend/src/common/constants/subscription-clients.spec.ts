import {
  buildClaudeCodeSubscriptionHeaders,
  CLAUDE_CODE_VERSION,
  getClaudeCodeVersion,
  refreshClaudeCodeVersion,
  claudeCodeStainlessArch,
  claudeCodeStainlessOs,
} from './subscription-clients';

describe('claudeCodeStainlessArch', () => {
  it.each([
    ['arm64', 'arm64'],
    ['x64', 'x64'],
    ['mips', 'Other:mips'],
  ])('maps %s to %s', (arch, expected) => {
    expect(claudeCodeStainlessArch(arch as NodeJS.Architecture)).toBe(expected);
  });
});

describe('claudeCodeStainlessOs', () => {
  it.each([
    ['darwin', 'MacOS'],
    ['linux', 'Linux'],
    ['win32', 'Windows'],
    ['freebsd', 'FreeBSD'],
    ['sunos', 'Other:sunos'],
  ])('maps %s to %s', (platform, expected) => {
    expect(claudeCodeStainlessOs(platform as NodeJS.Platform)).toBe(expected);
  });
});

describe('buildClaudeCodeSubscriptionHeaders', () => {
  it('sets the bearer token and stainless metadata headers', () => {
    const headers = buildClaudeCodeSubscriptionHeaders('key-123');
    expect(headers.Authorization).toBe('Bearer key-123');
    expect(headers['x-app']).toBe('cli');
    expect(headers['user-agent']).toBe(`claude-cli/${getClaudeCodeVersion()} (external, sdk-cli)`);
    expect(CLAUDE_CODE_VERSION).toBe('2.1.258');
    expect(headers['x-stainless-arch']).toBeDefined();
    expect(headers['x-stainless-os']).toBeDefined();
  });
});

describe('refreshClaudeCodeVersion', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses the latest published Claude Code version in subsequent headers', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '2.1.300' }),
    }) as jest.MockedFunction<typeof fetch>;

    await expect(refreshClaudeCodeVersion()).resolves.toBe('2.1.300');

    expect(buildClaudeCodeSubscriptionHeaders('key')['user-agent']).toContain('claude-cli/2.1.300');
  });

  it('keeps the current version when the registry response is invalid', async () => {
    const before = getClaudeCodeVersion();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: 'not a version' }),
    }) as jest.MockedFunction<typeof fetch>;

    await expect(refreshClaudeCodeVersion()).resolves.toBeNull();
    expect(getClaudeCodeVersion()).toBe(before);
  });
});
