#!/usr/bin/env node
/**
 * 附件下载器 - 将文件从指定URL下载到目标目录
 */
const fs = require('fs');
const path = require('path');
const request = require('request');
const url = require('url');

/**
 * 从URL下载文件到指定目录
 * @param {string} downloadUrl - 文件下载链接
 * @param {string} targetDir - 目标目录路径
 * @returns {Promise<string>} - 返回下载的文件路径
 */
function downloadFile(downloadUrl, targetDir) {
    return new Promise((resolve, reject) => {
        // 验证参数
        if (!downloadUrl) {
            return reject(new Error('下载链接不能为空'));
        }

        if (!targetDir) {
            return reject(new Error('目标目录不能为空'));
        }
        targetDir = path.resolve(__dirname, targetDir);
        try {
            if (fs.existsSync(targetDir)) {
                console.log('删除已有的下载目录:', targetDir);
                fs.rmdirSync(targetDir, { recursive: true });
            }
            console.log(`创建目录: ${targetDir}`);
            fs.mkdirSync(targetDir, { recursive: true });
        } catch (err) {
            return reject(new Error(`创建目录失败: ${err.message}`));
        }

        // 从URL中提取文件名
        const parsedUrl = url.parse(downloadUrl);
        let fileName = path.basename(parsedUrl.pathname);

        // 如果无法从URL中获取文件名，使用时间戳作为文件名
        if (!fileName || fileName === '') {
            fileName = `download_${Date.now()}`;

            // 尝试从Content-Disposition头获取文件名
            const req = request.get(downloadUrl);
            req.on('response', (response) => {
                const contentDisposition = response.headers['content-disposition'];
                if (contentDisposition) {
                    const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition);
                    if (matches && matches[1]) {
                        fileName = matches[1].replace(/['"]/g, '');
                    }
                }
            });
        }

        const filePath = path.join(targetDir, fileName);
        console.log('filepath', filePath);
        // 创建写入流
        const fileStream = fs.createWriteStream(filePath);

        console.log(`开始下载: ${downloadUrl}`);
        console.log(`保存到: ${filePath}`);

        // 下载文件
        request(downloadUrl)
            .on('error', (err) => {
                fs.unlink(filePath, () => { }); // 删除可能部分下载的文件
                reject(new Error(`下载失败: ${err.message}`));
            })
            .on('response', (response) => {
                if (response.statusCode !== 200) {
                    fs.unlink(filePath, () => { });
                    reject(new Error(`下载失败，HTTP状态码: ${response.statusCode}`));
                    return;
                }

                // 获取文件大小（如果服务器提供）
                const totalSize = parseInt(response.headers['content-length'], 10);
                let downloadedSize = 0;
                let lastLogTime = Date.now();

                response.on('data', (chunk) => {
                    downloadedSize += chunk.length;

                    // 每秒最多输出一次进度
                    const now = Date.now();
                    if (now - lastLogTime > 1000) {
                        if (totalSize) {
                            const percent = Math.round((downloadedSize / totalSize) * 100);
                            console.log(`下载进度: ${percent}% (${downloadedSize}/${totalSize} 字节)`);
                        } else {
                            console.log(`已下载: ${downloadedSize} 字节`);
                        }
                        lastLogTime = now;
                    }
                });
            })
            .pipe(fileStream);

        fileStream.on('finish', () => {
            console.log(`下载完成: ${filePath}`);
            resolve(filePath);
        });

        fileStream.on('error', (err) => {
            fs.unlink(filePath, () => { }); // 删除可能部分下载的文件
            reject(new Error(`文件写入失败: ${err.message}`));
        });
    });
}

function getDownloadUrl() {
    try {
        const vsixConfigPath = path.resolve(__dirname, '../vsix');
        console.log(vsixConfigPath);
        const data = fs.readFileSync(vsixConfigPath, { encoding: 'utf-8' })
        return data;
    } catch (err) {
        console.error(`读取下载链接失败: ${err.message}`);
        return '';
    }
}

/**
 * 命令行入口点
 */
if (require.main === module) {
    const minimist = require('minimist');

    // 解析命令行参数
    const args = minimist(process.argv.slice(2), {
        string: ['url', 'dir'],
    });
    const downloadUrl = args.url ?? getDownloadUrl();
    console.log(`下载链接: ${downloadUrl}`);

    if (!downloadUrl) {
        console.error('错误: 下载链接未提供。请通过 --url 参数指定下载链接或确保 vsix.json 文件包含有效的 url。');
        process.exit(1);
    }

    if (!args.dir) {
        console.error('用法: node vsixDownloader.js --url=<下载链接> --dir=<目标目录>');
        process.exit(1);
    }

    downloadFile(downloadUrl, args.dir)
        .then((filePath) => {
            console.log(`文件已成功下载到: ${filePath}`);
            process.exit(0);
        })
        .catch((error) => {
            console.error(`错误: ${error.message}`);
            process.exit(1);
        });
}

// 导出函数供其他模块使用
module.exports = {
    downloadFile,
};
