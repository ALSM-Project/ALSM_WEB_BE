export interface SessionClientMetadata {
  deviceType: 'Desktop' | 'Mobile' | 'Tablet' | 'Unknown';
  browser: 'Chrome' | 'Edge' | 'Firefox' | 'Opera' | 'Safari' | 'Samsung Internet' | 'Unknown';
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
  if (/Android/i.test(userAgent)) return /Mobi|Mobile/i.test(userAgent) ? 'Mobile' : 'Tablet';
  if (/Mobi|iPhone|iPod|Windows Phone/i.test(userAgent)) return 'Mobile';
  if (/Windows|Macintosh|Linux|X11|CrOS/i.test(userAgent)) return 'Desktop';
  return 'Unknown';
}

function getBrowser(userAgent: string): SessionClientMetadata['browser'] {
  if (/Edg(A|iOS)?\//i.test(userAgent)) return 'Edge';
  if (/OPR\/|Opera\//i.test(userAgent)) return 'Opera';
  if (/SamsungBrowser\//i.test(userAgent)) return 'Samsung Internet';
  if (/(Chrome|CriOS)\//i.test(userAgent)) return 'Chrome';
  if (/(Firefox|FxiOS)\//i.test(userAgent)) return 'Firefox';
  if (/Version\/.*Safari\//i.test(userAgent)) return 'Safari';
  return 'Unknown';
}
