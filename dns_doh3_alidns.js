/*
 * AliDNS-over-QUIC — DNS over HTTP/3 脚本
 *
 * 通过 HTTP/3 (QUIC) 向阿里公共 DNS (dns.alidns.com) 发起 DNS 查询。
 * 利用 requestSync 同步调用，直接在 onDns hook 中完成解析并返回结果。
 *
 * 阿里 DNS JSON API 端点: https://dns.alidns.com/resolve?name=X&type=1
 * 返回标准 DNS JSON 格式 (RFC 8427)，Answer 字段直接提取 IP。
 *
 * 参考配置:
 *   [General]
 *   dns-server = 223.5.5.5, 119.29.29.29
 *   encrypted-dns-server = quic://dns.alidns.com
 *
 * API 参考: https://668993.xyz/mundojs-api.html
 */
(function () {
  'use strict';

  var http = mundoKit.NetworkKit.http;
  var ALIDNS_BASE = 'https://dns.alidns.com/resolve';

  // 简单内存缓存：key = domain:type → {ips, expire}
  var cache = {};
  var CACHE_TTL = 120000; // 120 秒

  // DNS 记录类型
  var TYPE_A = 1;
  var TYPE_AAAA = 28;

  // ---- 工具函数 ----

  function normalizeDomain(domain) {
    return String(domain || '').trim().toLowerCase();
  }

  function cacheKey(domain, type) {
    return domain + ':' + type;
  }

  function cacheGet(domain, type) {
    var key = cacheKey(domain, type);
    var entry = cache[key];
    if (entry && Date.now() < entry.expire) {
      return entry.ips;
    }
    delete cache[key];
    return null;
  }

  function cacheSet(domain, type, ips) {
    var key = cacheKey(domain, type);
    cache[key] = { ips: ips, expire: Date.now() + CACHE_TTL };
  }

  // ---- DoQ 查询（通过 HTTP/3） ----

  function doh3Query(domain, type) {
    // 构造 DoH JSON API URL
    var url = ALIDNS_BASE + '?name=' + encodeURIComponent(domain) + '&type=' + type;

    var response = client.requestSync(url, {
      usingProtocol: http.HttpProtocol.HTTP3,
      method: http.RequestMethod.GET,
      expectDataType: http.HttpDataType.OBJECT,
      connectTimeout: 3000,
      readTimeout: 5000,
      skipServerCertVerification: false
    });

    if (response.responseCode !== 200) return null;

    var data = response.result;
    if (!data || !Array.isArray(data.Answer)) return null;

    // 提取答案中的 IP 地址
    var ips = [];
    for (var i = 0; i < data.Answer.length; i++) {
      var answer = data.Answer[i];
      if (answer.type === type && answer.data) {
        ips.push(answer.data);
      }
    }
    return ips.length > 0 ? ips : null;
  }

  // ---- DNS 解析入口 ----

  function resolve(domain) {
    var allIPs = [];

    // 查缓存
    var cachedA = cacheGet(domain, TYPE_A);
    var cachedAAAA = cacheGet(domain, TYPE_AAAA);

    if (cachedA && cachedAAAA) {
      return cachedA.concat(cachedAAAA);
    }

    try {
      // 查询 A 记录 (IPv4)
      if (!cachedA) {
        var aIPs = doh3Query(domain, TYPE_A);
        if (aIPs) {
          cacheSet(domain, TYPE_A, aIPs);
          allIPs = allIPs.concat(aIPs);
        }
      } else {
        allIPs = allIPs.concat(cachedA);
      }

      // 查询 AAAA 记录 (IPv6)
      if (!cachedAAAA) {
        var aaaaIPs = doh3Query(domain, TYPE_AAAA);
        if (aaaaIPs) {
          cacheSet(domain, TYPE_AAAA, aaaaIPs);
          allIPs = allIPs.concat(aaaaIPs);
        }
      } else {
        allIPs = allIPs.concat(cachedAAAA);
      }
    } catch (e) {
      // HTTP/3 请求失败（网络错误、超时、服务器不可达）
      // 静默回退到系统默认 DNS
    }

    return allIPs;
  }

  // ---- Hook 注册 ----

  mundo.registerHook('onDns', function (context) {
    var domain = normalizeDomain(context.domain);
    if (!domain) return;

    var ips = resolve(domain);

    // 只在成功解析时才覆盖结果，否则由系统 DNS 兜底
    if (ips.length > 0) {
      context.setResult(ips);
    }
  });

  mundo.registerHook('onDisconnected', function () {
    cache = {};
  });
})();
