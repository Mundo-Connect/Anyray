/*
 * Anyray xhttp服务端示例，本服务端用于服务端上动态执行并注册vless+xhttp兼容的Anyray的js服务端。
 * 注意，使用这个脚本需要服务端把xhttpSettings改成anyraySettings，也就是重命名json的那个字段并且服务端安装该脚本。
 */
(function () {
  'use strict';

  const http = mundoKit.NetworkKit.http;

  function toBytes(data) {
	  // TODO: 换高性能实现，懒得搞了，复制粘贴。。。
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

  function copyBuffer(data) {
    const bytes = toBytes(data);
    const out = new Uint8Array(bytes.length);
    out.set(bytes);
    return out.buffer;
  }

  function normalizePath(rawPath) {
    let path = String(rawPath || '/');
    const queryAt = path.indexOf('?');
    if (queryAt >= 0) path = path.slice(0, queryAt);
    if (path.charAt(0) !== '/') path = '/' + path;
    if (path.charAt(path.length - 1) !== '/') path += '/';
    return path;
  }

  function parseQuery(raw) {
    const out = {};
    if (!raw) return out;
    const parts = String(raw).split('&');
    for (let i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      const eq = parts[i].indexOf('=');
      const key = eq >= 0 ? parts[i].slice(0, eq) : parts[i];
      const val = eq >= 0 ? parts[i].slice(eq + 1) : '';
      out[decodeURIComponent(key)] = decodeURIComponent(val);
    }
    return out;
  }

  function parseCookies(headers) {
    const out = {};
    const raw = headers && (headers.Cookie || headers.cookie);
    if (!raw) return out;
    const parts = String(raw).split(';');
    for (let i = 0; i < parts.length; i++) {
      const text = parts[i].trim();
      const eq = text.indexOf('=');
      if (eq <= 0) continue;
      out[decodeURIComponent(text.slice(0, eq))] = decodeURIComponent(text.slice(eq + 1));
    }
    return out;
  }

  function header(ctx, name) {
    const v = ctx.header(name);
    return v === undefined || v === null ? '' : String(v);
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

  function pathSegments(ctx, base) {
    const path = String(ctx.path || '');
    if (path.indexOf(base) !== 0) return [];
    const rest = path.slice(base.length);
    if (!rest) return [];
    const raw = rest.split('/');
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] !== '') out.push(decodeURIComponent(raw[i]));
    }
    return out;
  }

  function metaFromRequest(ctx, settings, base) {
	// TODO: 全换成Uri，Uri比自带的parse性能更好
    const seg = pathSegments(ctx, base);
    const query = parseQuery(ctx.query);
    const cookies = parseCookies(ctx.headers || {});
    const sessionPlacement = placement(settings, 'sessionPlacement', 'path');
    const seqPlacement = placement(settings, 'seqPlacement', 'path');
    const sessionKey = keyFor(settings, 'sessionPlacement', 'sessionKey', '', 'X-Session', 'x_session');
    const seqKey = keyFor(settings, 'seqPlacement', 'seqKey', '', 'X-Seq', 'x_seq');
    let pathAt = 0;
    let sid = '';
    let seq = '';

    if (sessionPlacement === 'path') sid = seg[pathAt++] || '';
    else if (sessionPlacement === 'query') sid = query[sessionKey] || '';
    else if (sessionPlacement === 'header') sid = header(ctx, sessionKey);
    else if (sessionPlacement === 'cookie') sid = cookies[sessionKey] || '';

    if (seqPlacement === 'path') seq = seg[pathAt++] || '';
    else if (seqPlacement === 'query') seq = query[seqKey] || '';
    else if (seqPlacement === 'header') seq = header(ctx, seqKey);
    else if (seqPlacement === 'cookie') seq = cookies[seqKey] || '';

    return { sid, seq };
  }

  function bodyFromRequest(ctx, settings) {
    const dataPlacement = String(settings.uplinkDataPlacement || 'body').toLowerCase();
    if (dataPlacement === 'body' || dataPlacement === 'auto') {
      return copyBuffer(ctx.body || new ArrayBuffer(0));
    }
    const key = settings.uplinkDataKey || (dataPlacement === 'cookie' ? 'x_data' : 'X-Data');
    let encoded = '';
    if (dataPlacement === 'header') {
      for (let i = 0; ; i++) {
        const part = header(ctx, key + '-' + i);
        if (!part) break;
        encoded += part;
      }
    } else if (dataPlacement === 'cookie') {
      const cookies = parseCookies(ctx.headers || {});
      for (let i = 0; ; i++) {
        const part = cookies[key + '_' + i];
        if (!part) break;
        encoded += part;
      }
    }
    return encoded ? mundo.Base64.decode(encoded).buffer : new ArrayBuffer(0);
  }

  function serverOptions(context, settings) {
    const target = context.Target || {};
    const address = settings.listen || settings.serverIP || target.Address || '0.0.0.0';
    const out = {
      address: address,
      port: target.Port || settings.serverPort || 0,
      requestTimeout: settings.requestTimeout || 300000
    };
    if (settings.http2) out.http2 = true;
    if (settings.http3) out.http3 = true;
    if (settings.protocols) out.protocols = settings.protocols;
    if (settings.usingProtocol !== undefined) out.usingProtocol = settings.usingProtocol;
    if (settings.serverCert) out.serverCert = settings.serverCert;
    if (settings.realityConfig) out.realityConfig = settings.realityConfig;
    if (settings.serverName) out.serverName = settings.serverName;
    if (settings.fingerprint) out.fingerprint = settings.fingerprint;
    return out;
  }

  function getSession(sessions, listener, id) {
    let s = sessions[id];
    if (s) return s;
    s = sessions[id] = {
      id: id,
      queue: [],
      down: null,
      closed: false,
      stream: null
    };
    s.stream = listener.accept((stream) => {
      stream.recv((data) => {
        const body = copyBuffer(data);
        if (s.down) {
          const out = s.down;
          s.down = null;
          out.status(200).set('Cache-Control', 'no-store');
          out.write(body);
          return true;
        }
        s.queue.push(body);
        return true;
      });
      stream.onClose(() => {
        s.closed = true;
        if (s.down) {
          const out = s.down;
          s.down = null;
          out.status(410).end('');
        }
        return true;
      });
    });
    return s;
  }

// 核心实现，具体h2/h3什么的服务端配置可以参考Mundo Connect的js脚本文档
  function listenXHTTP(context) {
	  // 兼容xhttpSettings的做法
    const settings = context.StreamSettings || {};
    const base = normalizePath(settings.path || '/');
    const server = http.createHttpServer();
    const listener = context;
	// 对应vless的session id，具体看 xray-core项目，目前支持的模式是package up，别的自己搞吧
    const sessions = Object.create(null);

    listener.onClose(() => {
      for (const id in sessions) {
        const s = sessions[id];
        s.closed = true;
        if (s.down) s.down.status(410).end('');
      }
      server.stop();
      return true;
    });

    server.get(base + '*', (ctx) => {
      const meta = metaFromRequest(ctx, settings, base);
      if (!meta.sid) {
        ctx.status(400).end('');
        return;
      }
      const s = getSession(sessions, listener, meta.sid);
      if (s.queue.length > 0) {
        ctx.status(200).header('Cache-Control', 'no-store').result(s.queue.shift());
        return;
      }
      if (s.closed) {
        ctx.status(410).end('');
        return;
      }
	  // 类似Java的输出流
      s.down = ctx.outputStream();
      s.down.status(200).set('Cache-Control', 'no-store');
      if (!settings.noSSEHeader) s.down.set('Content-Type', 'text/event-stream');
	  // 这步可以省略，不过建议不要省略用来兼容各种xhttp的服务端，例如mihomo和xray的
      s.down.write(new ArrayBuffer(0));
    });

    server.post(base + '*', (ctx) => {
      const meta = metaFromRequest(ctx, settings, base);
      if (!meta.sid) {
        ctx.status(400).end('');
        return;
      }
      const s = getSession(sessions, listener, meta.sid);
      if (s.closed) {
        ctx.status(410).end('');
        return;
      }
	// ctx.body 是数据，可以是vless的数据
      s.stream.send(bodyFromRequest(ctx, settings));
      ctx.status(200).end('');
    });

    server.listen(serverOptions(context, settings)).catch((err) => {
      listener.abort(err);
    });
    return listener;
  }

  mundo.registerHook('onAnyrayServerNodeAccepted', (context) => {
    context.setResult(listenXHTTP(context));
  });
})();
