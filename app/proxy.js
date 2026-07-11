// api/proxy.js
export default async function handler(req, res) {
  // 1. 获取原始请求路径，例如: /https/google.com/search?q=1
  const reqUrl = new URL(req.url, 'http://localhost');
  let pathname = reqUrl.pathname; // /https/google.com/search
  const search = reqUrl.search;   // ?q=1

  // 去掉开头的斜杠并按斜杠分割
  const segments = pathname.replace(/^\/+/, '').split('/');

  // 2. 解析原项目的规则：第一段是协议，第二段是域名，剩下的是路径
  // 例如: ['https', 'google.com', 'search']
  if (segments.length < 2) {
    return res.status(200).send('Vercel Proxy 已修复。<br>用法: /https/域名/路径<br>例如: /https/google.com/search');
  }

  const protocol = segments[0]; // http, https, wss 等
  const domain = segments[1];   // google.com
  const restPath = segments.slice(2).join('/'); // search

  // 3. 拼接真实目标网址
  let target = `${protocol}://${domain}/${restPath}${search}`;

  // 简单的安全限制：只允许多见的网页协议（避免被当成恶意跳板）
  if (!['http', 'https'].includes(protocol)) {
    return res.status(400).send('暂仅支持 http/https 代理 (wss 在 Serverless 下无法原生透传)');
  }

  try {
    // 4. 由 Vercel 服务端发起真实请求（绕过浏览器跨域）
    const response = await fetch(target, {
      method: req.method,
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'Accept': '*/*',
        'Referer': domain,
      },
      // 如果有 POST 数据，这里简单处理（如需完整透传 body 可扩展）
    });

    const buffer = await response.arrayBuffer();

    // 5. 设置跨域并返回给浏览器
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', response.headers.get('content-type') || 'text/html; charset=utf-8');
    res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    res.status(500).send(`代理请求失败: ${err.message}<br><br>目标: ${target}`);
  }
}
