/** Office-site address lookup from OpenStreetMap Nominatim. */
import { isValidCoordinate, osmMapUrl, reverseGeocode } from '@/lib/hr/staff-app/reverse-geocode';

describe('reverseGeocode', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  });

  it('asks Nominatim with an identifying User-Agent and returns the address', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ display_name: 'Kalyani Nagar, Pune, Maharashtra, India' }) });
    await expect(reverseGeocode(18.553959, 73.920811)).resolves.toBe('Kalyani Nagar, Pune, Maharashtra, India');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('nominatim.openstreetmap.org/reverse');
    expect(url).toContain('lat=18.553959');
    expect(init.headers['User-Agent']).toMatch(/Khatario/);
  });

  it('serves nearby points from the cache', async () => {
    await expect(reverseGeocode(18.55396, 73.92081)).resolves.toBe('Kalyani Nagar, Pune, Maharashtra, India');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when there is no address and throws when Nominatim fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ error: 'Unable to geocode' }) });
    await expect(reverseGeocode(0.5, -30.5)).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    await expect(reverseGeocode(28.6, 77.2)).rejects.toThrow('Nominatim 503');
  }, 10000);
});

test('coordinates and map link', () => {
  expect(isValidCoordinate(18.5, 73.9)).toBe(true);
  expect(isValidCoordinate(91, 0)).toBe(false);
  expect(isValidCoordinate(Number.NaN, 0)).toBe(false);
  expect(osmMapUrl(18.5, 73.9)).toBe('https://www.openstreetmap.org/?mlat=18.5&mlon=73.9#map=18/18.5/73.9');
});
