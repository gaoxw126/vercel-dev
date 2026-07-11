// api/proxy.js
const http = require('http');
const https = require('https');
const { URL } = require('url');

// 使用 CommonJS 导出，Vercel Node.js 函数原生支持，不再有语法冲突
module.exports = function handler(req, res) {
  // 1. 解析路径: /https/域名/路径 或 /wss/域名/路径
  const reqUrl = new URL(req.url, 'http://localhost');
  const segments = reqUrl.pathname.replace(/^\/+/, '').split('/');
  const search = reqUrl.search;

  if (segments.length < 2) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send('Vercel Tunnel Proxy 运行中。<br>用法: /https/域名/路径');
  }

  const protocol = segments[0]; // http, https, ws, wss
  const domain = segments[1];
  const restPath = segments.slice(2).join('/');
  const target = `${protocol}://${domain}/${restPath}${search}`;

  res.setHeader('Access-Control-Allow-Origin', '*');

  // 2. 关于 WSS / WS（平台限制说明 + 安全处理）
  if (protocol === 'wss' || protocol === 'ws') {
    // Vercel Serverless 函数无法将后端的 Raw Socket 透传给浏览器
    // 这里我们直接返回说明，避免发起非法请求导致函数崩溃
    return res.status(400).send('[Tunnel-WS] Vercel 不支持原生的 WebSocket 隧道透传。请仅使用 /http 或 /https 进行流式代理。');
  }

  // 3. HTTP / HTTPS 流式 Tunnel 模式（完美支持）
  const lib = protocol === 'https' ? https : http;

  try {
    const proxyReq = lib.request(target, {
      method: req.method,
      headers: {
        ...req.headers,
        'Host': domain, // 必须重写 Host 头
      }
    }, (proxyRes) => {
      // 将目标服务器的响应头写回，并流式 pipe（不缓存内存，支持大文件/长连接）
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    // 将客户端发来的请求体（POST/PUT数据）流式发往目标服务器
    req.pipe(proxyReq);

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).send(`[Tunnel-HTTP] 代理失败: ${err.message}`);
      }
    });
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).send(`请求异常: ${err.message}`);
    }
  }
};
