/**
 * @fileoverview Unit tests for askSommelier API function.
 * Verifies image fields are included/omitted correctly in the request body.
 */

const mockFetch = vi.fn();

vi.mock('../../../public/js/api/base.js', () => ({
  API_BASE: '',
  apiFetch: mockFetch,
  fetch: mockFetch,
  handleResponse: vi.fn(async (res) => res.json())
}));

const { askSommelier } = await import('../../../public/js/api/pairing.js');

describe('askSommelier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ json: async () => ({ chatId: 'abc', recommendations: [] }) });
  });

  it('omits image fields when image is null', async () => {
    await askSommelier('grilled salmon', 'all', 'any', null);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.dish).toBe('grilled salmon');
    expect(body.image).toBeUndefined();
    expect(body.mediaType).toBeUndefined();
  });

  it('includes image and mediaType when image is provided', async () => {
    const image = { base64: 'abc123', mediaType: 'image/jpeg' };
    await askSommelier('pasta', 'all', 'any', image);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.image).toBe('abc123');
    expect(body.mediaType).toBe('image/jpeg');
  });

  it('omits dish field when dish is null (image-only submission)', async () => {
    const image = { base64: 'xyz', mediaType: 'image/png' };
    await askSommelier(null, 'all', 'any', image);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.dish).toBeUndefined();
    expect(body.image).toBe('xyz');
    expect(body.mediaType).toBe('image/png');
  });
});
