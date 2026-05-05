const http = require('http');
const fs = require('fs');
const axios = require('axios');
const net = require('net');
const path = require('path');
const { Buffer } = require('buffer');
const { WebSocket, createWebSocketStream } = require('ws');

// 环境变量配置
const UUID = process.env.UUID || 'f54ffa9f-0fa6-4a99-9ee6-6c21e7bc1d53';
const DOMAIN = process.env.DOMAIN || 'your-domain.com';    // 填写项目域名或已反代的域名
const AUTO_ACCESS = process.env.AUTO_ACCESS || false;      // 是否开启自动访问保活
const WSPATH = process.env.WSPATH || UUID.slice(0, 8);     // WebSocket 路径
const SUB_PATH = process.env.SUB_PATH || 'sub';            // 订阅路径
const NAME = process.env.NAME || '';                       // 节点名称
const PORT = process.env.PORT || 3000;                     // 服务端口

let CurrentDomain = DOMAIN, Tls = 'tls', CurrentPort = 443, ISP = '';
const BLOCKED_DOMAINS = [
    'speedtest.net', 'fast.com', 'speedtest.cn', 'speed.cloudflare.com', 'speedof.me',
     'testmy.net', 'bandwidth.place', 'speed.io', 'librespeed.org', 'speedcheck.org'
];

// 屏蔽测速域名
function isBlockedDomain(host) {
    if (!host) return false;
    const hostLower = host.toLowerCase();
    return BLOCKED_DOMAINS.some(blocked => {
        return hostLower === blocked || hostLower.endsWith('.' + blocked);
    });
}

// 获取当前网络配置 (IP/ISP)
const GetConfig = async () => {    
    try {
        const res = await axios.get('https://speed.cloudflare.com/meta');
        const data = res.data;
        ISP = `${data.country}-${data.asOrganization}`.replace(/ /g, '_');
    } catch (e) {
        ISP = 'Unknown';
    }

    if (!DOMAIN || DOMAIN === 'your-domain.com') {
        try {
            const res = await axios.get('https://api.ip.sb/ip', { timeout: 8000 });
            const ip = res.data.trim();
            CurrentDomain = ip, Tls = 'none', CurrentPort = PORT;
        } catch (e) {
            console.error('Failed to get IP', e.message);
            CurrentDomain = 'your-domain.com', Tls = 'tls', CurrentPort = 443;
        }
    } else {
        CurrentDomain = DOMAIN, Tls = 'tls', CurrentPort = 443;
    }
}

const httpServer = http.createServer((req, res) => {
    if (req.url === '/') {
        const filePath = path.join(__dirname, 'index.html');
        fs.readFile(filePath, 'utf8', (err, content) => {
            if (err) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('Hello world!');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
        });
        return;
    } else if (req.url === `/${SUB_PATH}`) {
        GetConfig().then(() => { 
            const namePart = NAME ? `${NAME}-${ISP}` : ISP;
            const ssTlsParam = Tls === 'tls' ? 'tls;' : '';
            // SS 使用 none 加密 (依赖外部 TLS)，密码使用 UUID
            const ssMethodPassword = Buffer.from(`none:${UUID}`).toString('base64');
            
            // 生成 SS 链接 (使用 v2ray-plugin 格式)
            const ssURL = `ss://${ssMethodPassword}@${CurrentDomain}:${CurrentPort}?plugin=v2ray-plugin;mode%3Dwebsocket;host%3D${CurrentDomain};path%3D%2F${WSPATH};${ssTlsParam}sni%3D${CurrentDomain};skip-cert-verify%3Dtrue;mux%3D0#${namePart}`;
            
            const base64Content = Buffer.from(ssURL).toString('base64');
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(base64Content + '\n');
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found\n');
    }
});

// ShadowSocket Connection Handler
// 处理 SS over WebSocket 流量
function handleSsConnection(ws, msg) {
    try {
        let offset = 0;
        // SS 头部解析: [ATYP] [ADDR] [PORT]
        const atyp = msg[offset];
        offset += 1;

        let host, port;
        if (atyp === 0x01) { // IPv4
            host = msg.slice(offset, offset + 4).join('.');
            offset += 4;
        } else if (atyp === 0x03) { // Domain
            const hostLen = msg[offset];
            offset += 1;
            host = msg.slice(offset, offset + hostLen).toString();
            offset += hostLen;
        } else if (atyp === 0x04) { // IPv6
            host = msg.slice(offset, offset + 16).reduce((s, b, i, a) =>
                (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), [])
                .map(b => b.readUInt16BE(0).toString(16)).join(':');
            offset += 16;
        } else {
            return false;
        }

        port = msg.readUInt16BE(offset);
        offset += 2;
        
        if (isBlockedDomain(host)) {
            ws.close(); 
            return false;
        }
        
        const duplex = createWebSocketStream(ws);
        
        // 移除多余的自定义 DNS 解析，直接使用 Node.js 原生底层解析和连接
        net.connect({ host: host, port: port }, function () {
            if (offset < msg.length) {
                this.write(msg.slice(offset));
            }
            // 绑定错误处理，防止流异常导致应用崩溃
            duplex.on('error', () => {}).pipe(this).on('error', () => {}).pipe(duplex);
        }).on('error', () => {
            // 目标地址不可达时静默断开，不让程序崩溃
            ws.close();
        });

        return true;
    } catch (error) {
        ws.close();
        return false;
    }
}

const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws, req) => {
    const url = req.url || '';
    const expectedPath = `/${WSPATH}`;
    if (!url.startsWith(expectedPath)) {
        ws.close();
        return;
    }
    
    ws.once('message', msg => {
        // SS 协议判断 (ATYP开头: 0x01=IPv4, 0x03=Domain, 0x04=IPv6)
        if (msg.length > 0 && (msg[0] === 0x01 || msg[0] === 0x03 || msg[0] === 0x04)) {
            if (handleSsConnection(ws, msg)) {
                return;
            }
        }
        
        // 如果不符合 SS 协议特征，直接关闭
        ws.close();
    }).on('error', () => { });
});

async function addAccessTask() {
    if (!AUTO_ACCESS) return;

    if (!DOMAIN) {
        return;
    }
    const fullURL = `https://${DOMAIN}/${SUB_PATH}`;
    try {
        const res = await axios.post("https://oooo.serv00.net/add-url", {
            url: fullURL
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        console.log('Automatic Access Task added successfully');
    } catch (error) {
        // console.error('Error adding Task:', error.message);
    }
}

httpServer.listen(PORT, async () => {
    addAccessTask();
    console.log(`Server is running on port ${PORT} (Shadowsocks Only)`);
});