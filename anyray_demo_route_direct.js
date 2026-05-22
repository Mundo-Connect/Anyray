/*
 * 动态路由示例，支持分流、动态选择节点、DNS 广告拦截等。
 */
(function () {
  'use strict';

  const directDomains = [
    // 中国可以直连的域名
    'dl.google.com'
  ];

  const adDomainRules = [
    '+.a.baidu.cn',
    '+.a.baidu.com',
    '+.ad.duapps.com',
    '+.ad.player.baidu.com',
    '+.adm.baidu.cn',
    '+.adm.baidu.com',
    '+.adscdn.baidu.cn',
    '+.adscdn.baidu.com',
    '+.adx.xiaodutv.com',
    '+.ae.bdstatic.com',
    '+.afd.baidu.cn',
    '+.afd.baidu.com',
    '+.als.baidu.cn',
    '+.als.baidu.com'
  ];

  function normalizeDomain(domain) {
    return String(domain || '').trim().toLowerCase().replace(/\.$/, '');
  }

  function normalizeRule(rule) {
    rule = normalizeDomain(rule);
    if (rule.startsWith('+.')) return rule.slice(2);
    if (rule.startsWith('.')) return rule.slice(1);
    return rule;
  }

  function domainMatches(domain, rule) {
    domain = normalizeDomain(domain);
    rule = normalizeRule(rule);
    return domain === rule || domain.endsWith('.' + rule);
  }

  function shouldDirectByDomain(domain) {
    for (let i = 0; i < directDomains.length; i++) {
      if (domainMatches(domain, directDomains[i])) return true;
    }
    return false;
  }

  function shouldBlockAdDomain(domain) {
    for (let i = 0; i < adDomainRules.length; i++) {
      if (domainMatches(domain, adDomainRules[i])) return true;
    }
    return false;
  }

  function shouldDirectByGeoIP(ip) {
    if (!ip) return false;
    // geoip 分流
    return mundo.ipMatch(ip, ['cn', 'ru']) === true;
  }

  mundo.registerHook('onProxiesLoaded', (context) => {
    const availableProxies = [];

    const proxies = Array.isArray(context.proxies) ? context.proxies : [];
    for (let i = 0; i < proxies.length; i++) {
      const proxy = proxies[i];
	  // tag是字符串，具体参考文档
      if (!proxy || !proxy.tag) continue;
      availableProxies.push({
        tag: proxy.tag,
		// address 是出站的域名或者IP，可以拿去做geoip，假如挂载了geoip的话，注意中转或者专线不适合该查询
        address: proxy.address || ''
      });
    }

    mundo.global.proxies = availableProxies;
    mundo.log('route-demo', 'loaded proxies:', availableProxies.map((proxy) => proxy.tag).join(','));
  });

  mundo.registerHook('onDisconnected', () => {
    delete mundo.global.proxies;
  });

  mundo.registerHook('onDns', (context) => {
	  // 去广告示例，仅供参考，适用于http代理。
    if (shouldBlockAdDomain(context.domain)) {
      context.setResult('0.0.0.0');
    }
  });

  mundo.registerHook('onNewConnectionToBeEstablished', (context) => {
    if (shouldDirectByDomain(context.domain) || shouldDirectByGeoIP(context.ip)) {
      context.setResult('direct');
    }
    // Do nothing here.
    // 如果不修改出站的话，这里不要修改，setResult 对应的是出站的 tag，规定直连出站是 direct，其它出站禁止使用 direct。
    // 假设香港地区出站的 tag 是 tag1、美国地区出站是tag2，
	// 打开claude网站的时候，此时因为匹配不到默认的直连 geoip，
	// 所以使用的是 tag1 出站，可以设置到tag2来连接。
	// 你可以从 onProxiesLoaded 获取所有出站，不要使用不存在的出站否则无法连接。
  });
})();
