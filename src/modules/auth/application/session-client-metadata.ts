export interface SessionClientMetadata {
  deviceType: 'Desktop' | 'Mobile' | 'Tablet' | 'Unknown';
  browser: 'Chrome' | 'Edge' | 'Firefox' | 'Safari' | 'Unknown';
}

export function getSessionClientMetadata(userAgent?: string): SessionClientMetadata {
  const value = userAgent?.trim();
  if (!value) {
    return { deviceType: 'Unknown', browser: 'Unknown' };
  }

  return {
    deviceType: getDeviceType(value),
    browser: getBrowser(value),
  };
}

function getDeviceType(userAgent: string): SessionClientMetadata['deviceType'] {
  if (/iPad|Tablet|Kindle|Silk\//i.test(userAgent)) return 'Tablet';
  if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(userAgent)) return 'Mobile';
  if (/Windows|Macintosh|Linux|X11|CrOS/i.test(userAgent)) return 'Desktop';
  return 'Unknown';
}

function getBrowser(userAgent: string): SessionClientMetadata['browser'] {
  if (/Edg(A|iOS)?\//i.test(userAgent)) return 'Edge';
  if (/(Chrome|CriOS)\//i.test(userAgent)) return 'Chrome';
  if (/(Firefox|FxiOS)\//i.test(userAgent)) return 'Firefox';
  if (/Version\/.*Safari\//i.test(userAgent)) return 'Safari';
  return 'Unknown';
}
