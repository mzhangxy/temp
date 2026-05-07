const express = require("express");
const app = express();
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

// --- 配置参数 ---
const FILE_PATH = process.env.FILE_PATH || './tmp';
const SUB_PATH = process.env.SUB_PATH || 'sub';
const PORT = process.env.SERVER_PORT || process.env.PORT || 8080; // 适配 BTP 默认端口
const UUID = process.env.UUID || 'ef297268-33dd-4a44-9eff-2b6afdca7547';
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || 'sapss.1791765.xyz';
const ARGO_AUTH = process.env.ARGO_AUTH || 'eyJhIjoiZDY1NWNiOTk2NzNlZTYzMDE4NDFkMmQyNmYxNTY5N2EiLCJ0IjoiOTQ0OTYwMGUtYzE4My00YmUwLThlNmUtZTdiZDg2NmIxNWNmIiwicyI6Ik5qRTBZakE0T1RJdE0ySTFZeTAwWW1abUxXRXlNVFl0WVRreFlUazNaRFk0TmpCayJ9'; // 请确保这里是您完整的 Token
const ARGO_PORT = process.env.ARGO_PORT || 8001;
const CFIP = process.env.CFIP || 'saas.sin.fan';
const CFPORT = process.env.CFPORT || 443;
const NAME = process.env.NAME || 'SAP-SS-ARGO';

const SS_METHOD = 'chacha20-ietf-poly1305';
const SS_PASSWORD = UUID;
const SS_PATH = '/ss-argo';

// 固定文件名，确保存储在 tmp 目录下的文件能被找到
const webName = 'web';
const botName = 'bot';
const webPath = path.join(FILE_PATH, webName);
const botPath = path.join(FILE_PATH, botName);
const configPath = path.join(FILE_PATH, 'config.json');
const subPath = path.join(FILE_PATH, 'sub.txt');

// 确保目录存在
if (!fs.existsSync(FILE_PATH)) {
    fs.mkdirSync(FILE_PATH);
}

// --- 路由设置 ---

// 1. 主页
app.get('/', (req, res) => {
    res.send('<h1>Welcome to nginx!</h1><p>Server is running.</p>');
});

// 2. 关键：日志查看路由 (部署后访问 /log 查看报错)
app.get('/log', (req, res) => {
    let logContent = '=== WEB (Xray) 运行日志 ===\n\n';
    try {
        logContent += fs.readFileSync(path.join(FILE_PATH, 'web.log'), 'utf8');
    } catch (e) {
        logContent += '暂无 web 日志或程序未运行\n';
    }
    
    logContent += '\n\n=== BOT (Argo 隧道) 运行日志 ===\n\n';
    try {
        logContent += fs.readFileSync(path.join(FILE_PATH, 'bot.log'), 'utf8');
    } catch (e) {
        logContent += '暂无 bot 日志或程序未运行\n';
    }
    
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(logContent);
});

// --- 核心逻辑 ---

async function generateConfig() {
    const config = {
        "log": { "access": "/dev/null", "error": "/dev/null", "loglevel": "none" },
        "inbounds": [{
            "port": ARGO_PORT,
            "listen": "127.0.0.1",
            "protocol": "shadowsocks",
            "settings": { "method": SS_METHOD, "password": SS_PASSWORD, "network": "tcp,udp" },
            "streamSettings": { "network": "ws", "wsSettings": { "path": SS_PATH } }
        }],
        "outbounds": [{ "protocol": "freedom", "tag": "direct" }]
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

async function runBinaries() {
    // 赋予执行权限
    [webPath, botPath].forEach(p => {
        if (fs.existsSync(p)) {
            fs.chmodSync(p, 0o775);
        } else {
            console.error(`[错误] 找不到二进制文件: ${p}`);
        }
    });

    // 启动 Xray 并将日志写入 web.log
    const webCommand = `nohup ${webPath} -c ${configPath} > ${FILE_PATH}/web.log 2>&1 &`;
    try {
        await exec(webCommand);
        console.log('web is running');
    } catch (err) {
        console.error('web start error: ' + err);
    }

    // 启动 Argo 并将日志写入 bot.log
    if (fs.existsSync(botPath)) {
        const argoCmdArgs = `tunnel --edge-ip-version 4 --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;
        try {
            await exec(`nohup ${botPath} ${argoCmdArgs} > ${FILE_PATH}/bot.log 2>&1 &`);
            console.log('bot is running');
        } catch (err) {
            console.error('bot start error: ' + err);
        }
    }
}

async function start() {
    await generateConfig();
    await runBinaries();
    
    // 生成订阅逻辑
    const creds = Buffer.from(SS_METHOD + ':' + SS_PASSWORD).toString('base64');
    const pluginOptions = `v2ray-plugin;mode=websocket;host=${ARGO_DOMAIN};path=${SS_PATH};tls;sni=${ARGO_DOMAIN}`;
    const link = `ss://${creds}@${CFIP}:${CFPORT}?plugin=${encodeURIComponent(pluginOptions)}#${NAME}`;
    
    console.log('Subscription Content (Base64):');
    console.log(Buffer.from(link).toString('base64'));

    app.get('/' + SUB_PATH, (req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(Buffer.from(link).toString('base64'));
    });
}

start();
app.listen(PORT, () => console.log(`http server is running on port:${PORT}!`));
