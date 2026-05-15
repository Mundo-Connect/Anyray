/*
 * 动态路由示例，支持分流、动态选择节点等等
 */
(function () {
  'use strict';

  const directDomains = [
  // 中国可以直连的域名
    'dl.google.com'
  ];

  function normalizeDomain(domain) {
    return String(domain || '').trim().toLowerCase().replace(/\.$/, '');
  }

  function domainMatches(domain, rule) {
    domain = normalizeDomain(domain);
    rule = normalizeDomain(rule);
    return domain === rule || domain.endsWith('.' + rule);
  }

  function shouldDirectByDomain(domain) {
    for (let i = 0; i < directDomains.length; i++) {
      if (domainMatches(domain, directDomains[i])) return true;
    }
    return false;
  }

  function shouldDirectByGeoIP(ip) {
    if (!ip) return false;
	// geoip分流
    return mundo.ipMatch(ip, ['cn', 'ru']) === true;
  }

  mundo.registerHook('onNewConnectionToBeEstablished', (context) => {
    if (shouldDirectByDomain(context.domain) || shouldDirectByGeoIP(context.ip)) {
      context.setResult('direct');
    }
  });
})();
