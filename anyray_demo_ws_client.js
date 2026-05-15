/*
 * Anyray WebSocket客户端，wsSettings换成anyraySettings即可使用，简单粗暴
 * 理论上支持各种协议，例如mx trojan vless vmess anytls 等等，其中anytls+ws只支持Mundo Connect，别的核不一定实现了这个功能
 */
(function () {
  'use strict';

  const webSocket = mundoKit.NetworkKit.webSocket;

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data && data.buffer instanceof ArrayBuffer && typeof data.byteLength === 'number') {
      return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength);
    }
    if (data && data.data) return toBytes(data.data);
    if (data && data.message) return toBytes(data.message);
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

  function normalizePath(path) {
    path = String(path || '/');
    if (path.charAt(0) !== '/') path = '/' + path;
    return path;
  }

  function mergeHeaders(a, b) {
    const out = {};
    if (a) {
      for (const key in a) out[key] = a[key];
    }
    if (b) {
      for (const key in b) out[key] = b[key];
    }
    return out;
  }

  function wsURL(context, settings) {
    const target = context.Target || {};
    const secure = settings.security === 'tls' || settings.echConfig || settings.realityConfig || settings.serverName;
    const scheme = settings.scheme ? String(settings.scheme).replace(':', '') : (secure ? 'wss' : 'ws');
    const host = settings.host || target.Address || '127.0.0.1';
    const port = target.Port ? ':' + target.Port : '';
    return scheme + '://' + host + port + normalizePath(settings.path || '/');
  }

  function wsOptions(context, settings) {
    const target = context.Target || {};
    const hostHeader = settings.host && target.Address && String(settings.host) !== String(target.Address)
      ? { Host: settings.host }
      : null;
    const out = {
      header: mergeHeaders(settings.headers, hostHeader),
      pingInterval: settings.pingInterval === undefined ? 0 : settings.pingInterval,
      pongTimeout: settings.pongTimeout === undefined ? 30 : settings.pongTimeout
    };
    if (settings.protocol) out.protocol = settings.protocol;
    if (settings.connectTimeout) out.connectTimeout = settings.connectTimeout;
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

  function connectWebSocket(context) {
    const settings = context.StreamSettings || {};
	// 创建ws的客户端，参考openharmony实现
    const ws = webSocket.createWebSocket();
    const stream = context;
    let opened = false;
    const pending = [];

    function send(data) {
      const task = ws.send(copyBuffer(data));
      if (task && typeof task.catch === 'function') {
        task.catch((err) => stream.abort(err));
      }
      return true;
    }

    function flush() {
      if (opened) return;
      opened = true;
      while (pending.length) send(pending.shift());
    }

    stream.recv((data) => {
		// 简单粗暴，具体参考openharmony的WebSocket文档
      if (!opened) {
        pending.push(copyBuffer(data));
        return true;
      }
      return send(data);
    });
    stream.onClose(() => {
      ws.close({ code: 1000, reason: '' });
      return true;
    });
    ws.on('open', flush);
    ws.on('message', (data) => stream.send(copyBuffer(data)));
    ws.on('close', () => stream.end());
    ws.on('error', (err) => stream.abort(err));

    ws.connect(wsURL(context, settings), wsOptions(context, settings))
      .then(flush)
      .catch((err) => stream.abort(err));
    return stream;
  }

  mundo.registerHook('onAnyrayClientNodeAccepted', (context) => {
    context.setResult(connectWebSocket(context));
  });
})();
