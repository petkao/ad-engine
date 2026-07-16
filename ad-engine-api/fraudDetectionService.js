const axios = require('axios');

// AbuseIPDB API for IP reputation checking
async function checkIpReputation(ip) {
  const apiKey = process.env.ABUSEIPDB_API_KEY;
  if (!apiKey) {
    console.log('[AbuseIPDB] API key not configured, skipping IP reputation check');
    return { score: 0, details: 'API key not configured' };
  }

  // Skip private/local IPs
  if (isPrivateIp(ip)) {
    console.log(`[AbuseIPDB] Skipping private/local IP: ${ip}`);
    return { score: 0, details: 'Private/local IP address' };
  }

  console.log(`[AbuseIPDB] Checking IP: ${ip}`);

  try {
    const response = await axios.get('https://api.abuseipdb.com/api/v2/check', {
      headers: {
        'Key': apiKey,
        'Accept': 'application/json'
      },
      params: {
        ipAddress: ip,
        maxAgeInDays: 90
      },
      timeout: 5000
    });

    const data = response.data.data;
    const abuseConfidenceScore = data.abuseConfidenceScore || 0;
    const totalReports = data.totalReports || 0;
    console.log(`[AbuseIPDB] Result for ${ip}: confidence=${abuseConfidenceScore}, reports=${totalReports}`);

    // Convert AbuseIPDB score (0-100) to our fraud score contribution
    // AbuseIPDB score > 50 is considered high risk
    let fraudScore = 0;
    if (abuseConfidenceScore >= 80) {
      fraudScore = 40; // Very high risk IP
    } else if (abuseConfidenceScore >= 50) {
      fraudScore = 25; // High risk IP
    } else if (abuseConfidenceScore >= 25) {
      fraudScore = 15; // Medium risk IP
    } else if (abuseConfidenceScore > 0) {
      fraudScore = 5; // Low risk IP
    }

    return {
      score: fraudScore,
      details: `AbuseIPDB score: ${abuseConfidenceScore}, Reports: ${totalReports}`,
      abuseConfidenceScore,
      totalReports,
      countryCode: data.countryCode,
      isp: data.isp
    };
  } catch (error) {
    console.error('AbuseIPDB API error:', error.message);
    return { score: 0, details: `API error: ${error.message}` };
  }
}

// Google Safe Browsing API for URL safety
async function checkUrlSafety(url) {
  const apiKey = process.env.GOOGLE_SAFE_BROWSING_KEY;
  if (!apiKey) {
    console.log('GOOGLE_SAFE_BROWSING_KEY not configured, skipping URL safety check');
    return { score: 0, details: 'API key not configured', safe: true };
  }

  if (!url) {
    return { score: 0, details: 'No URL provided', safe: true };
  }

  try {
    const response = await axios.post(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`,
      {
        client: {
          clientId: 'pinkcurve',
          clientVersion: '1.0.0'
        },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url }]
        }
      },
      { timeout: 5000 }
    );

    const matches = response.data.matches || [];
    if (matches.length > 0) {
      const threatTypes = matches.map(m => m.threatType).join(', ');
      return {
        score: 50, // High fraud score for unsafe URLs
        details: `Unsafe URL detected: ${threatTypes}`,
        safe: false,
        threats: threatTypes
      };
    }

    return { score: 0, details: 'URL is safe', safe: true };
  } catch (error) {
    console.error('Google Safe Browsing API error:', error.message);
    return { score: 0, details: `API error: ${error.message}`, safe: true };
  }
}

// Check domain age using WHOIS lookup
async function checkDomainAge(url) {
  const apiKey = process.env.WHOISXML_API_KEY;
  if (!apiKey) {
    console.log('WHOISXML_API_KEY not configured, skipping domain age check');
    return { score: 0, details: 'API key not configured' };
  }

  if (!url) {
    return { score: 0, details: 'No URL provided' };
  }

  try {
    // Extract domain from URL
    let domain;
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      domain = urlObj.hostname;
    } catch {
      return { score: 0, details: 'Invalid URL format' };
    }

    const response = await axios.get('https://www.whoisxmlapi.com/whoisserver/WhoisService', {
      params: {
        apiKey,
        domainName: domain,
        outputFormat: 'JSON'
      },
      timeout: 10000
    });

    const whoisRecord = response.data.WhoisRecord;
    if (!whoisRecord || !whoisRecord.createdDate) {
      return { score: 10, details: 'Domain creation date not available' };
    }

    const createdDate = new Date(whoisRecord.createdDate);
    const now = new Date();
    const ageInDays = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));

    let fraudScore = 0;
    let ageDescription = '';

    if (ageInDays < 30) {
      fraudScore = 25; // Very new domain - high risk
      ageDescription = 'less than 30 days old';
    } else if (ageInDays < 90) {
      fraudScore = 15; // New domain - medium risk
      ageDescription = 'less than 90 days old';
    } else if (ageInDays < 180) {
      fraudScore = 5; // Relatively new - low risk
      ageDescription = 'less than 6 months old';
    } else {
      ageDescription = `${Math.floor(ageInDays / 365)} years old`;
    }

    return {
      score: fraudScore,
      details: `Domain ${domain} is ${ageDescription}`,
      ageInDays,
      createdDate: createdDate.toISOString()
    };
  } catch (error) {
    console.error('WhoisXML API error:', error.message);
    return { score: 0, details: `API error: ${error.message}` };
  }
}

// Check for multiple accounts from same IP
async function checkMultipleAccounts(ip, pool) {
  if (!ip || !pool) {
    return { score: 0, details: 'Missing IP or database connection', count: 0 };
  }

  // Skip private/local IPs
  if (isPrivateIp(ip)) {
    return { score: 0, details: 'Private/local IP address', count: 0 };
  }

  try {
    // Check seller_geo_log for registrations from same IP in last 24 hours
    const result = await pool.query(`
      SELECT COUNT(DISTINCT seller_id) as account_count
      FROM seller_geo_log
      WHERE ip = $1
        AND created_at > NOW() - INTERVAL '24 hours'
    `, [ip]);

    const accountCount = parseInt(result.rows[0]?.account_count || 0);

    let fraudScore = 0;
    if (accountCount >= 5) {
      fraudScore = 40; // 5+ accounts from same IP - very suspicious
    } else if (accountCount >= 3) {
      fraudScore = 25; // 3-4 accounts - suspicious
    } else if (accountCount >= 2) {
      fraudScore = 10; // 2 accounts - slightly suspicious
    }

    return {
      score: fraudScore,
      details: `${accountCount} account(s) registered from this IP in last 24 hours`,
      count: accountCount
    };
  } catch (error) {
    console.error('Multi-account check error:', error.message);
    return { score: 0, details: `Database error: ${error.message}`, count: 0 };
  }
}

// Calculate combined fraud score
async function calculateFraudScore(ip, url, pool) {
  const results = {
    ipReputation: { score: 0, details: 'Not checked' },
    urlSafety: { score: 0, details: 'Not checked', safe: true },
    domainAge: { score: 0, details: 'Not checked' },
    multipleAccounts: { score: 0, details: 'Not checked', count: 0 }
  };

  // Run all checks in parallel
  const [ipResult, urlResult, domainResult, multiAccountResult] = await Promise.all([
    checkIpReputation(ip),
    url ? checkUrlSafety(url) : Promise.resolve({ score: 0, details: 'No URL provided', safe: true }),
    url ? checkDomainAge(url) : Promise.resolve({ score: 0, details: 'No URL provided' }),
    checkMultipleAccounts(ip, pool)
  ]);

  results.ipReputation = ipResult;
  results.urlSafety = urlResult;
  results.domainAge = domainResult;
  results.multipleAccounts = multiAccountResult;

  // Calculate total score (max 100)
  const totalScore = Math.min(100,
    results.ipReputation.score +
    results.urlSafety.score +
    results.domainAge.score +
    results.multipleAccounts.score
  );

  // Determine action based on score
  let action = 'allow';
  if (totalScore >= 60) {
    action = 'block';
  } else if (totalScore >= 30) {
    action = 'review';
  }

  console.log(`[Fraud] IP: ${ip}, Score: ${totalScore}, Action: ${action}, IP: ${results.ipReputation.score}, Multi: ${results.multipleAccounts.score}`);

  return {
    totalScore,
    action,
    results,
    timestamp: new Date().toISOString()
  };
}

// Helper function to check if IP is private/local
function isPrivateIp(ip) {
  if (!ip) return true;

  // IPv4 private ranges
  const privateRanges = [
    /^127\./,           // Loopback
    /^10\./,            // Class A private
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Class B private
    /^192\.168\./,      // Class C private
    /^169\.254\./,      // Link-local
    /^0\./,             // Current network
  ];

  // IPv6 private/local
  if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) {
    return true;
  }

  return privateRanges.some(regex => regex.test(ip));
}

// Log fraud check to database
async function logFraudCheck(pool, data) {
  try {
    await pool.query(`
      INSERT INTO fraud_logs (
        ip_address, url, entity_type, entity_id,
        total_score, action, ip_reputation_score, ip_reputation_details,
        url_safety_score, url_safety_details, domain_age_score, domain_age_details,
        multi_account_score, multi_account_details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, [
      data.ip,
      data.url,
      data.entityType,
      data.entityId,
      data.fraudResult.totalScore,
      data.fraudResult.action,
      data.fraudResult.results.ipReputation.score,
      data.fraudResult.results.ipReputation.details,
      data.fraudResult.results.urlSafety.score,
      data.fraudResult.results.urlSafety.details,
      data.fraudResult.results.domainAge.score,
      data.fraudResult.results.domainAge.details,
      data.fraudResult.results.multipleAccounts.score,
      data.fraudResult.results.multipleAccounts.details
    ]);
  } catch (error) {
    console.error('Error logging fraud check:', error.message);
  }
}

module.exports = {
  checkIpReputation,
  checkUrlSafety,
  checkDomainAge,
  checkMultipleAccounts,
  calculateFraudScore,
  logFraudCheck,
  isPrivateIp
};
