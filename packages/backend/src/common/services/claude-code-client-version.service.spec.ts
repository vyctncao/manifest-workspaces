import { ClaudeCodeClientVersionService } from './claude-code-client-version.service';
import { refreshClaudeCodeVersion } from '../constants/subscription-clients';

jest.mock('../constants/subscription-clients', () => ({
  refreshClaudeCodeVersion: jest.fn(),
}));

const mockRefresh = refreshClaudeCodeVersion as jest.MockedFunction<
  typeof refreshClaudeCodeVersion
>;

describe('ClaudeCodeClientVersionService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refreshes the client identity on startup without blocking', async () => {
    let resolve!: (version: string | null) => void;
    mockRefresh.mockReturnValue(new Promise((done) => (resolve = done)));
    const service = new ClaudeCodeClientVersionService();

    expect(service.onModuleInit()).toBeUndefined();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    resolve('2.1.300');
    await Promise.resolve();
  });

  it('refreshes the client identity on schedule', async () => {
    mockRefresh.mockResolvedValue('2.1.300');
    const service = new ClaudeCodeClientVersionService();

    await service.refresh();

    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
