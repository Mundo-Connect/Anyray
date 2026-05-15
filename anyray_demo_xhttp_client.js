/*
 * Anyray xhttp客户端，跟服务端差不多，具体看服务端源码，把xhttpSettings改成anyraySettings就行了，支持json配置。
 */
(function () {
  'use strict';

  const http = mundoKit.NetworkKit.http;

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data && data.buffer instanceof ArrayBuffer && typeof data.byteLength === 'number') {
      return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength);
    }
    if (data === undefined || data === null) return new Uint8Array(0);
    const text = String(data);
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 255;
    return out;
  }

  function copyBuffer(bytes) {
    const view = toBytes(bytes);
    const out = new Uint8Array(view.length);
    out.set(view);
    return out.buffer;
  }

  function mergeHeaders(base, extra) {
    const out = {};
    if (base) {
      for (const key in base) out[key] = base[key];
    }
    if (extra) {
      for (const key in extra) out[key] = extra[key];
    }
    return out;
  }

  function normalizePath(rawPath) {
    let path = String(rawPath || '/');
    let query = '';
    const queryAt = path.indexOf('?');
    if (queryAt >= 0) {
      query = path.slice(queryAt + 1);
      path = path.slice(0, queryAt);
    }
    if (path.charAt(0) !== '/') path = '/' + path;
    if (path.charAt(path.length - 1) !== '/') path += '/';
    return { path, query };
  }

  function encodePathPart(value) {
    return encodeURIComponent(String(value));
  }

  function appendQuery(url, key, value) {
    if (value === undefined || value === null || value === '') return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') +
      encodeURIComponent(key) + '=' + encodeURIComponent(String(value));
  }

  function paddingLength(settings) {
    const range = settings && settings.xPaddingBytes;
    let n = range && (range.from || range.From || range.to || range.To);
    n = n ? (n | 0) : 100;
    if (n < 1) n = 1;
    if (n > 4096) n = 4096;
    return n;
  }

  function padding(settings) {
    let out = '';
    const n = paddingLength(settings);
    for (let i = 0; i < n; i++) out += 'X';
    return out;
  }

  function applyPadding(url, headers, settings) {
    const value = padding(settings);
    if (settings && settings.xPaddingObfsMode) {
		// 支持过cdn，建议自己定义xpadding在http头里面的字段，服务端也要一起更改
      const key = settings.xPaddingKey || 'x_padding';
      const placement = String(settings.xPaddingPlacement || 'query').toLowerCase();
      if (placement === 'header') {
        headers[settings.xPaddingHeader || key] = value;
        return url;
      }
      if (placement === 'cookie') {
        headers.Cookie = (headers.Cookie ? headers.Cookie + '; ' : '') +
          encodeURIComponent(key) + '=' + encodeURIComponent(value);
        return url;
      }
      if (placement === 'query-in-header') {
        headers[settings.xPaddingHeader || 'Referer'] = appendQuery(url, key, value);
        return url;
      }
      return appendQuery(url, key, value);
    }
    return appendQuery(url, 'x_padding', value);
  }

  function placement(settings, name, fallback) {
    const value = settings && settings[name];
    return value ? String(value).toLowerCase() : fallback;
  }

  function keyFor(settings, placementName, explicitName, pathDefault, headerDefault, queryDefault) {
    if (settings && settings[explicitName]) return settings[explicitName];
    const place = placement(settings, placementName, 'path');
    if (place === 'header') return headerDefault;
    if (place === 'query' || place === 'cookie') return queryDefault;
    return pathDefault;
  }

  function applyMeta(url, headers, settings, sid, seq) {
    let out = url;
    const sessionPlacement = placement(settings, 'sessionPlacement', 'path');
    const seqPlacement = placement(settings, 'seqPlacement', 'path');
    const sessionKey = keyFor(settings, 'sessionPlacement', 'sessionKey', '', 'X-Session', 'x_session');
    const seqKey = keyFor(settings, 'seqPlacement', 'seqKey', '', 'X-Seq', 'x_seq');

    if (sid) {
      if (sessionPlacement === 'path') out += encodePathPart(sid);
      else if (sessionPlacement === 'query') out = appendQuery(out, sessionKey, sid);
      else if (sessionPlacement === 'header') headers[sessionKey] = sid;
      else if (sessionPlacement === 'cookie') {
        headers.Cookie = (headers.Cookie ? headers.Cookie + '; ' : '') +
          encodeURIComponent(sessionKey) + '=' + encodeURIComponent(sid);
      }
    }
    if (seq !== undefined && seq !== null && seq !== '') {
      if (seqPlacement === 'path') out += (out.charAt(out.length - 1) === '/' ? '' : '/') + encodePathPart(seq);
      else if (seqPlacement === 'query') out = appendQuery(out, seqKey, seq);
      else if (seqPlacement === 'header') headers[seqKey] = String(seq);
      else if (seqPlacement === 'cookie') {
        headers.Cookie = (headers.Cookie ? headers.Cookie + '; ' : '') +
          encodeURIComponent(seqKey) + '=' + encodeURIComponent(String(seq));
      }
    }
    return out;
  }

  function protocolOption(settings) {
    if (!settings) return undefined;
    if (settings.usingProtocol !== undefined) return settings.usingProtocol;
    if (settings.http3 || String(settings.protocol || '').toLowerCase() === 'h3') return 'HTTP3';
    if (settings.http2 || String(settings.protocol || '').toLowerCase() === 'h2') return 'HTTP2';
    return undefined;
  }

  function schemeFor(settings) {
    if (settings && settings.scheme) return String(settings.scheme).replace(':', '');
    if (settings && (settings.security === 'tls' || settings.echConfig || settings.realityConfig)) return 'https';
    return 'http';
  }

  function targetAuthority(context, settings) {
    const target = context.Target || {};
    const host = settings && settings.host ? String(settings.host) : String(target.Address || '127.0.0.1');
    const port = target.Port ? ':' + target.Port : '';
    return host + port;
  }

  function requestOptions(context, settings, method, headers, data) {
    const target = context.Target || {};
    const hostHeader = settings && settings.host && target.Address && String(settings.host) !== String(target.Address)
      ? { Host: settings.host }
      : null;
    const out = {
      method: method || settings.uplinkHTTPMethod || 'POST',
      header: mergeHeaders(mergeHeaders(settings.headers, hostHeader), headers),
      readTimeout: settings.readTimeout || 30000,
      connectTimeout: settings.connectTimeout || 30000
    };
    if (data !== undefined) out.extraData = data;
    const protocol = protocolOption(settings);
    if (protocol !== undefined) out.usingProtocol = protocol;
    if (settings.echConfig) out.echConfig = settings.echConfig;
    if (settings.echForceQuery) out.echForceQuery = settings.echForceQuery;
    if (settings.realityConfig) out.realityConfig = settings.realityConfig;
    if (settings.serverName) out.serverName = settings.serverName;
    if (settings.fingerprint) out.fingerprint = settings.fingerprint;
    if (settings.skipServerCertVerification !== undefined) {
      out.skipServerCertVerification = !!settings.skipServerCertVerification;
    }
    return out;
  }

  function baseURL(context, settings) {
	  // 建议用uri库实现，这是复制粘贴的源码，具体查看文档
    const base = normalizePath(settings.path || '/');
    let url = schemeFor(settings) + '://' + targetAuthority(context, settings) + base.path;
    if (base.query) url += '?' + base.query;
    return url;
  }

  function sessionID() {
    return 's' + Date.now().toString(36) + Math.floor(Math.random() * 0x7fffffff).toString(36);
  }

  function sliceBuffer(bytes, start, end) {
    const part = bytes.subarray(start, end);
    const out = new Uint8Array(part.length);
    out.set(part);
    return out.buffer;
  }

  function maxPostBytes(settings) {
    const range = settings && settings.scMaxEachPostBytes;
    const n = range && (range.to || range.To || range.from || range.From);
    return n && n > 0 ? n | 0 : 1000000;
  }

  function makeUpload(url, settings, sid, seq, bytes) {
    const headers = {};
    let body = sliceBuffer(bytes, 0, bytes.length);
    const dataPlacement = String(settings.uplinkDataPlacement || 'body').toLowerCase();
    if (dataPlacement === 'header' || dataPlacement === 'cookie') {
      const key = settings.uplinkDataKey || (dataPlacement === 'cookie' ? 'x_data' : 'X-Data');
      const encoded = mundo.Base64.encodeToString(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      body = undefined;
      if (dataPlacement === 'header') {
        headers[key + '-0'] = encoded;
      } else {
        headers.Cookie = encodeURIComponent(key + '_0') + '=' + encodeURIComponent(encoded);
      }
    }
    let requestURL = applyMeta(url, headers, settings, sid, String(seq));
    requestURL = applyPadding(requestURL, headers, settings);
    return { url: requestURL, headers, body };
  }

  function connectXHTTP(context) {
	  // 兼容xhttp的做法，需要适配xhttp设置
    const settings = context.StreamSettings || {};
    const stream = context;
    const sid = sessionID();
    const root = baseURL(context, settings);
    const limit = maxPostBytes(settings);
    const down = http.createHttp();
    let seq = 0;
    let closing = false;

    stream.recv((data) => {
      const bytes = toBytes(data);
      for (let off = 0; off < bytes.length || (bytes.length === 0 && off === 0); off += limit || bytes.length || 1) {
        const end = bytes.length === 0 ? 0 : Math.min(bytes.length, off + limit);
        const upload = makeUpload(root, settings, sid, seq++, bytes.subarray(off, end));
        const post = http.createHttp();
		// 注意这是package up实现
        post.request(upload.url, requestOptions(context, settings, settings.uplinkHTTPMethod || 'POST', upload.headers, upload.body))
          .then(() => { if (post.destroy) post.destroy(); })
          .catch((err) => {
            if (post.destroy) post.destroy();
            if (!closing) stream.abort(err);
          });
        if (bytes.length === 0) break;
      }
      return true;
    });

    stream.onClose(() => {
      closing = true;
      if (down.destroy) down.destroy();
      return true;
    });

    down.on('dataReceive', (chunk) => stream.send(chunk));
    down.on('error', (err) => {
      if (!closing) stream.abort(err);
    });

    function openDownlink() {
      if (closing) return;
      const headers = {};
      let url = applyMeta(root, headers, settings, sid, '');
      url = applyPadding(url, headers, settings);
      down.requestInStream(url, requestOptions(context, settings, 'GET', headers))
        .then((code) => {
          if (closing) return;
          if ((code | 0) >= 400) {
            closing = true;
            stream.end();
            return;
          }
          openDownlink();
        })
        .catch((err) => {
          if (!closing) stream.abort(err);
        });
    }

    openDownlink();
    return stream;
  }

  mundo.registerHook('onAnyrayClientNodeAccepted', (context) => {
    context.setResult(connectXHTTP(context));
  });
})();
