// api/proxy.js
const http = require('http');
const https = require('https');
const { URL } = require('url');

export default function handler(req, res) {
  // 1. 解析原始路径 (/https/domain/path 或 /wss/domain/path)
  const reqUrl = new URL(req.url, 'http://localhost');
  const segments = reqUrl.pathname.replace(/^\/+/, '').split('/');
  const search = reqUrl.search;

  if (segments.length < 2) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send('Vercel Tunnel Proxy 已修复。<br>用法: /https/域名/路径 或 /wss/域名/路径');
  }

  const protocol = segments[0]; // http, https, ws, wss
  const domain = segments[1];
  const restPath = segments.slice(2).join('/');
  const target = `${protocol}://${domain}/${restPath}${search}`;

  // 设置允许跨域（Tunnel 模式标配）
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 2. 处理 WSS / WS 协议（代码级支持 Tunnel 升级）
  if (protocol === 'wss' || protocol === 'ws') {
    const lib = protocol === 'wss' ? https : http;
    
    // Vercel 网关限制：这里尝试向目标发起 Upgrade，但无法把 Raw Socket 直接写回给浏览器
    const proxyReq = lib.request(target, {
      method: 'GET',
      headers: {
        'Host': domain,
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0'
      }
    });

    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      // 理论上建立了隧道，但 Vercel 函数无法将 proxySocket 直接 pipe 给浏览器 res（平台限制）
      // 如果是支持 WS 的平台（如 CloudFlare Workers 配合特定配置），这里就能通
      res.writeHead(101, proxyRes.headers);
      proxySocket.pipe(res);
      res.pipe(proxySocket);
    });

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).send(`[Tunnel-WS] Vercel 不支持将后端 Socket 直接透传给浏览器。错误: ${err.message}`);
      }
    });
    proxyReq.end();
    return;
  }

  // 3. 处理 HTTP / HTTPS（完美的 Streaming Tunnel 模式）
  const lib = protocol === 'https' ? https : http;
  
  const proxyReq = lib.request(target, {
    method: req.method,
    headers: {
      ...req.headers,
      'Host': domain, // 必须重写 Host 头为目标域名
    }
  }, (proxyRes) => {
    // 关键：直接把目标服务器的响应头写回，并使用 pipe 流式转发（不缓存）
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  // 关键：把客户端发来的请求体（如 POST 数据）流式发往目标，双向打通 Tunnel
  req.pipe(proxyReq);

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).send(`[Tunnel-HTTP] 代理请求失败: ${err.message}`);
    }
  });
}
