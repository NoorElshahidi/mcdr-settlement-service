import { CorrelationIdMiddleware } from './correlation-id.middleware';

describe('CorrelationIdMiddleware', () => {
  it('preserves a valid incoming correlation id and returns it', () => {
    const request = { header: () => 'request-123' } as never;
    const response = { setHeader: jest.fn() } as { setHeader: jest.Mock };
    const next = jest.fn();

    new CorrelationIdMiddleware().use(request, response as never, next);

    expect(response.setHeader).toHaveBeenCalledWith('X-Correlation-Id', 'request-123');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('replaces an invalid incoming correlation id', () => {
    const request = { header: () => 'bad id' } as never;
    const response = { setHeader: jest.fn() } as { setHeader: jest.Mock };
    const next = jest.fn();

    new CorrelationIdMiddleware().use(request, response as never, next);

    expect(response.setHeader).toHaveBeenCalledWith('X-Correlation-Id', expect.any(String));
    expect(response.setHeader.mock.calls[0][1]).not.toBe('bad id');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
