/*
 * Anyray WebSocket 服务端示例，简单粗暴，复制wsSettings到anyraySettings即可
 * 支持 trojan mx vless vmess anytls 等，anytls + ws需要用Mundo Connect作为客户端和服务端，不过都websocket了不如直接mx
 */
(function () {
  'use strict';

  const webSocket = mundoKit.NetworkKit.webSocket;
  const streams = new WeakMap();

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

  function serverOptions(context, settings) {
    const target = context.Target || {};
    const out = {
      serverIP: settings.listen || settings.serverIP || target.Address || '0.0.0.0',
      serverPort: target.Port || settings.serverPort || 0
    };
    if (settings.protocol) out.protocol = settings.protocol;
    if (settings.maxConcurrentClientsNumber) out.maxConcurrentClientsNumber = settings.maxConcurrentClientsNumber;
    if (settings.maxConnectionsForOneClient) out.maxConnectionsForOneClient = settings.maxConnectionsForOneClient;
    if (settings.serverCert) out.serverCert = settings.serverCert;
    if (settings.realityConfig) out.realityConfig = settings.realityConfig;
    if (settings.serverName) out.serverName = settings.serverName;
    if (settings.fingerprint) out.fingerprint = settings.fingerprint;
    return out;
  }

  function listenWebSocket(context) {
    const settings = context.StreamSettings || {};
	// 参考开源鸿蒙 openharmony的websocket服务端实现
    const server = webSocket.createWebSocketServer();
    const listener = context;

    listener.onClose(() => {
      server.stop();
      return true;
    });

    server.on('connect', (client) => {
      if (!client) return;
      listener.accept((stream) => {
        streams.set(client, stream);
        stream.recv((data) => {
			// 反正就是流式，非常简单
          server.send(copyBuffer(data), client).catch((err) => stream.abort(err));
          return true;
        });
        stream.onClose(() => {
          server.close(client, { code: 1000, reason: '' });
          streams.delete(client);
          return true;
        });
      });
    });

    server.on('messageReceive', (message) => {
      const client = message && message.clientConnection;
      const stream = streams.get(client);
	  // 流式，非常简单
      if (stream) stream.send(copyBuffer(message.data));
    });

    server.on('close', (client) => {
      const stream = streams.get(client);
      if (stream) stream.end();
      streams.delete(client);
    });

    server.on('error', (err) => {
      mundo.log('anyray-demo-ws-server', err);
    });

    server.start(serverOptions(context, settings)).catch((err) => listener.abort(err));
    return listener;
  }

  mundo.registerHook('onAnyrayServerNodeAccepted', (context) => {
    context.setResult(listenWebSocket(context));
  });
})();
