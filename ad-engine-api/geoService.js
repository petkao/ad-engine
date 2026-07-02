/**
 * IP Geolocation Service using geoip-lite
 *
 * geoip-lite includes a bundled MaxMind GeoLite database,
 * no external download required.
 */

const geoip = require('geoip-lite');

/**
 * Resolve IP address to geographic location
 * @param {string} ip - IP address (IPv4 or IPv6)
 * @returns {{city: string, state: string, country: string}}
 */
function resolveGeo(ip) {
  const defaultResult = { city: '', state: '', country: '' };

  if (!ip) return defaultResult;

  // Handle localhost/private IPs
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return { city: 'localhost', state: '', country: 'local' };
  }

  try {
    const geo = geoip.lookup(ip);

    if (!geo) {
      return defaultResult;
    }

    return {
      city: geo.city || '',
      state: geo.region || '',
      country: geo.country || '',
    };
  } catch (err) {
    console.error(`GeoIP lookup error for ${ip}:`, err.message);
    return defaultResult;
  }
}

/**
 * Extract client IP from Express request
 * Handles proxies (X-Forwarded-For) and direct connections
 * @param {object} req - Express request object
 * @returns {string} Client IP address
 */
function getClientIp(req) {
  // Trust proxy headers (app.set('trust proxy', 1) must be enabled)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // Take the first IP in the chain (original client)
    return forwarded.split(',')[0].trim();
  }

  // Cloud Run uses x-real-ip
  const realIp = req.headers['x-real-ip'];
  if (realIp) return realIp;

  // Direct connection
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '';
}

module.exports = {
  resolveGeo,
  getClientIp,
};
