const express = require("express");
const app = express();
// const axios = require("axios"); // 【修改1】注释掉 axios，因为不再需要动态下载
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

const FILE_PATH = process.env.FILE_PATH || './tmp';                                      // 运行路径 必填 请保持默认
const SUB_PATH = process.env.SUB_PATH || 'sub';                                         // 订阅token 必填 默认sub
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;                      // 网页端口 必填 请保持默认
const UUID = process.env.UUID || 'ef297268-33dd-4a44-9eff-2b6afdca7547';              // UUID 必填
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || 'sapss.1791765.xyz';                                   // 隧道域名 必填
const ARGO_AUTH = process.env.ARGO_AUTH || 'eyJhIjoiZDY1NWNiOTk2NzNlZTYzMDE4NDFkMmQyNmYxNTY5N2EiLCJ0IjoiOTQ0OTYwMGUtYzE4My00YmUwLThlNmUtZTdiZDg2NmIxNWNmIiwicyI6Ik5qRTBZakE0T1RJdE0ySTFZeTAwWW1abUxXRXlNVFl0WVRreFlUazNaRFk0TmpCayJ9';                                      // 隧道token 必填
const ARGO_PORT = process.env.ARGO_PORT || 8001;                                   // 隧道端口 必填 默认8001
const CFIP = process.env.CFIP || 'saas.sin.fan';                                  // 优选域名 必填 默认saas.sin.fan
const CFPORT = process.env.CFPORT || 443;                                        // 优选域名端口 必填 请保持默认
const NAME = process.env.NAME || 'SAP-SS-ARGO';                                 // 节点名称 选填

const SS_METHOD = 'chacha20-ietf-poly1305';
const SS_PASSWORD = UUID;
const SS_PATH = '/ss-argo';

if (!fs.existsSync(FILE_PATH)) {
    fs.mkdirSync(FILE_PATH);
    console.log(FILE_PATH + ' is created');
} else {
    console.log(FILE_PATH + ' already exists');
}

// 【修改2】注释掉随机名生成，使用固定的文件名，以便匹配本地的 web 和 bot 文件
/*
function generateRandomName() {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
const webName = generateRandomName();
const botName = generateRandomName();
*/
const webName = 'web';
const botName = 'bot';

let webPath = path.join(FILE_PATH, webName);
let botPath = path.join(FILE_PATH, botName);
let subPath = path.join(FILE_PATH, 'sub.txt');
let configPath = path.join(FILE_PATH, 'config.json');

function cleanupOldFiles() {
    try {
        const files = fs.readdirSync(FILE_PATH);
        files.forEach(file => {
            const filePath = path.join(FILE_PATH, file);
            try {
                const stats = fs.statSync(filePath);
                if (stats.isFile() && file !== 'web' && file !== 'bot') { // 防止误删本地文件
                    fs.unlinkSync(filePath);
                }
            } catch (e) {}
        });
    } catch (e) {}
}

app.get('/', function (req, res) {
    res.send(`
    <html>
      <head><title>Welcome to nginx!</title></head>
      <body>
        <h1>Welcome to nginx!</h1>
        <p>If you see this page, the nginx web server is successfully installed and working.</p>
      </body>
    </html>
  `);
});

async function generateConfig() {
    const config = {
        "log": {
            "access": "/dev/null",
            "error": "/dev/null",
            "loglevel": "none"
        },
        "policy": {
            "levels": {
                "0": {
                    "handshake": 3,
                    "connIdle": 60,
                    "uplinkOnly": 2,
                    "downlinkOnly": 5,
                    "bufferSize": 512,
                    "statsUserUplink": false,
                    "statsUserDownlink": false
                }
            }
        },
        "inbounds": [
            {
                "port": ARGO_PORT,
                "listen": "127.0.0.1",
                "protocol": "shadowsocks",
                "settings": {
                    "method": SS_METHOD,
                    "password": SS_PASSWORD,
                    "network": "tcp,udp"
                },
                "streamSettings": {
                    "network": "ws",
                    "wsSettings": {
                        "path": SS_PATH
                    },
                    "sockopt": {
                        "tcpFastOpen": true,
                        "tcpNoDelay": true,
                        "tcpKeepAliveInterval": 15,
                        "tfoQueueLength": 4096
                    }
                },
                "sniffing": {
                    "enabled": true,
                    "destOverride": ["http", "tls", "quic"],
                    "metadataOnly": false
                }
            }
        ],
        "dns": {
            "servers": [
                "https+local://1.1.1.1/dns-query",
                "https+local://8.8.8.8/dns-query",
                "localhost"
            ],
            "queryStrategy": "UseIPv4",
            "disableCache": false
        },
        "outbounds": [
            {
                "protocol": "freedom",
                "tag": "direct"
            },
            {
                "protocol": "blackhole",
                "tag": "block"
            }
        ]
    };
    fs.writeFileSync(path.join(FILE_PATH, 'config.json'), JSON.stringify(config, null, 2));
}

// 【修改3】注释掉 downloadFile 函数
/*
function downloadFile(filePath, fileUrl, callback) {
    if (!fs.existsSync(FILE_PATH)) {
        fs.mkdirSync(FILE_PATH, { recursive: true });
    }
    const writer = fs.createWriteStream(filePath);
    axios({
        method: 'get',
        url: fileUrl,
        responseType: 'stream'
    }).then(response => {
        response.data.pipe(writer);
        writer.on('finish', () => {
            writer.close();
            console.log('Download ' + path.basename(filePath) + ' successfully');
            callback(null, filePath);
        });
        writer.on('error', err => {
            fs.unlink(filePath, () => {});
            callback('Download failed: ' + err.message);
        });
    }).catch(err => {
        callback('Error downloading files:' + err.message);
    });
}
*/

async function downloadFilesAndRun() {
    // 【修改4】注释掉这里的下载判断和执行逻辑
    /*
    const filesToDownload = getFilesForArchitecture();
    if (filesToDownload.length === 0) return;
    
    const downloadPromises = filesToDownload.map(fileInfo => {
        return new Promise((resolve, reject) => {
            downloadFile(fileInfo.fileName, fileInfo.fileUrl, (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });
    });

    try {
        await Promise.all(downloadPromises);
    } catch (err) {
        console.error('Error downloading files:', err);
        return;
    }
    */

    function setPermissions(paths) {
        const chmodValue = 0x1fd; // 0o775权限
        paths.forEach(p => {
            if (fs.existsSync(p)) {
                fs.chmod(p, chmodValue, err => {
                    if (err) console.error('Empowerment failed: ' + err);
                });
            } else {
                console.error(`[警告] 找不到文件: ${p}，请确保静态打包成功。`);
            }
        });
    }

    setPermissions([webPath, botPath]);
    
    const webCommand = 'nohup ' + webPath + ' -c ' + FILE_PATH + '/config.json > ' + FILE_PATH + '/web.log 2>&1 &';
    try {
        await exec(webCommand);
        console.log(webName + ' is running');
        await new Promise(res => setTimeout(res, 1000));
    } catch (err) {
        console.error('web running error: ' + err);
    }

    if (fs.existsSync(botPath)) {
        let argoCmdArgs;
        if (ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) {
            argoCmdArgs = 'tunnel --edge-ip-version 4 --no-autoupdate --protocol http2 run --token ' + ARGO_AUTH;
        } else {
            if (ARGO_AUTH.includes('TunnelSecret')) {
                argoCmdArgs = 'tunnel --edge-ip-version 4 --config ' + FILE_PATH + '/tunnel.yml run';
            } else {
                console.error('ARGO_AUTH invalid.');
                return;
            }
        }
        
        try {
            await exec('nohup ' + botPath + ' ' + argoCmdArgs + ' > ' + FILE_PATH + '/bot.log 2>&1 &');
            console.log(botName + ' is running');
            await new Promise(res => setTimeout(res, 2000));
        } catch (err) {
            console.error('Error executing command: ' + err);
        }
    }
    
    await new Promise(res => setTimeout(res, 5000));
}

// 【修改5】注释掉获取下载链接的函数
/*
function getFilesForArchitecture() {
    return [
        { fileName: webPath, fileUrl: 'https://github.com/mzhangxy/temp/raw/refs/heads/main/web' },
        { fileName: botPath, fileUrl: 'https://github.com/mzhangxy/temp/raw/refs/heads/main/bot' }
    ];
}
*/

function argoType() {
    if (!ARGO_AUTH || !ARGO_DOMAIN) return;
    if (ARGO_AUTH.includes('TunnelSecret')) {
        fs.writeFileSync(path.join(FILE_PATH, 'tunnel.json'), ARGO_AUTH);
        const ymlConfig = '\n  tunnel: ' + ARGO_AUTH.split('"')[11] + '\n  credentials-file: ' + path.join(FILE_PATH, 'tunnel.json') + '\n\n  protocol: http2\n  \n  ingress:\n    - hostname: ' + ARGO_DOMAIN + '\n      service: http://localhost:' + ARGO_PORT + '\n      originRequest:\n        noTLSVerify: true\n    - service: http_status:404\n  ';
        fs.writeFileSync(path.join(FILE_PATH, 'tunnel.yml'), ymlConfig);
    }
}

argoType();

async function extractDomains() {
    if (ARGO_AUTH && ARGO_DOMAIN) {
        await generateSubscription(ARGO_DOMAIN);
    } else {
        return;
    }

    async function generateSubscription(domain) {
        const finalName = NAME || 'Argo-SS';
        return new Promise(resolve => {
            setTimeout(() => {
                const creds = Buffer.from(SS_METHOD + ':' + SS_PASSWORD).toString('base64');
                const pluginOptions = 'v2ray-plugin;mode=websocket;host=' + domain + ';path=' + SS_PATH + ';tls;sni=' + domain;
                const link = 'ss://' + creds + '@' + CFIP + ':' + CFPORT + '?plugin=' + encodeURIComponent(pluginOptions) + '#' + finalName;
                
                console.log('Subscription Content (Base64):');
                console.log(Buffer.from(link).toString('base64'));
                
                fs.writeFileSync(subPath, Buffer.from(link).toString('base64'));
                
                app.get('/' + SUB_PATH, (req, res) => {
                    const base64Link = Buffer.from(link).toString('base64');
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                    res.send(base64Link);
                });
                
                resolve(link);
            }, 2000);
        });
    }
}

// 【修改6】注释掉定时删除逻辑。如果在90秒后删除程序，容器一旦因故休眠或迁移重启，将无法拉起节点
/*
function cleanFiles() {
    setTimeout(() => {
        const filesToDel = [configPath, webPath, botPath];
        if (process.platform === 'win32') {
            exec('del /f /q ' + filesToDel.join(' ') + ' > nul 2>&1', () => {});
        } else {
            exec('rm -rf ' + filesToDel.join(' ') + ' >/dev/null 2>&1', () => {});
        }
        console.clear();
        console.log('App is running (Shadowsocks Only)');
    }, 89936); // 原始混淆中的 0x15f90 毫秒
}
cleanFiles();
*/

async function startserver() {
    try {
        cleanupOldFiles();
        await generateConfig();
        await downloadFilesAndRun(); // 这里的内部下载已被跳过，将直接启动程序
        await extractDomains();
    } catch (err) {
        console.error('Error in startserver:', err);
    }
}

startserver().catch(err => {
    console.error('Unhandled error:', err);
});

app.listen(PORT, () => console.log('http server is running on port:' + PORT + '!'));
