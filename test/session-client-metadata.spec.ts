import { getSessionClientMetadata } from '../src/modules/auth/application/session-client-metadata';

describe('session client metadata', () => {
  it('normalizes known browser and desktop device values from the User-Agent header', () => {
    expect(
      getSessionClientMetadata(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
      ),
    ).toEqual({ deviceType: 'Desktop', browser: 'Chrome' });
  });

  it('normalizes tablet and Edge user agents before generic browser matches', () => {
    expect(
      getSessionClientMetadata(
        'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1 Version/18.0 EdgiOS/130.0',
      ),
    ).toEqual({ deviceType: 'Tablet', browser: 'Edge' });
  });

  it('uses safe Unknown values for missing or malformed user agents', () => {
    expect(getSessionClientMetadata()).toEqual({ deviceType: 'Unknown', browser: 'Unknown' });
    expect(getSessionClientMetadata('not-a-browser')).toEqual({
      deviceType: 'Unknown',
      browser: 'Unknown',
    });
  });
});
