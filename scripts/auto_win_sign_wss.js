/**
 nodejs Windows可执行程序签名脚本
 Author: alderzhang

 使用说明：
 本脚本用于配合electron-builder实现自定义的Windows环境下可执行程序签名，签名通过调用https://keystore.woa.com/服务来实现
 1. npm依赖包安装
 npm install jose@2 --save-dev
 npm install request --save-dev
 npm install extract-zip@2 --save-dev
 2. 修改package.json，在"build"-"win"内修改签名选项，并将自定义签名指向本脚本
 {
 ...
 "build": {
 ...
 "win": {
 ...
 "signingHashAlgorithms": [     // 只保留sha1签名算法，避免针对同一个可执行程序多次调用本脚本，因为本脚本一次执行会进行sha1、sha256两种签名
 "sha1"
 ],
 "sign": "./xxx/autoWinSignWss.js",   // 指定使用本脚本进行自定义签名，这里用本脚本实际路径代替
 "signAndEditExecutable": true, // 指定对可执行程序进行签名
 "signDlls": false              // 一般情况下，我们不需要对dll进行签名，因此这里设置为false
 }
 }
 ...
 }
 3. 从https://keystore.woa.com/获取签名密钥
 a. 打开https://keystore.woa.com/，注册一个新应用，应用平台选择"Windows"
 b. 进入"应用管理"-"授权管理"，选择"申请Auth ID密码"，填写Auth ID，调用IP可以填"*"，调用频率建议填150以上
 c. 等待接收邮件，拿到Auth Secret
 4. 将AuthId和AuthSecret填写到本脚本内的对应常量定义内，并按需修改SignType、Organization字段（一般不需要修改）
 5. 执行electron-builder时，将自动调用本脚本对可执行程序进行签名
 */

const jose = require('jose');
const request = require('request');
const fs = require('fs');
const path = require('path');
const extract = require('extract-zip');
const { KEY_STORE_AUTH_ID, KEY_STORE_AUTH_SECRET } = process.env;


const AuthId = KEY_STORE_AUTH_ID;
const AuthSecret = KEY_STORE_AUTH_SECRET;
/**
 * 签名文件类型
 * @type {string} 签名文件的类型:
 * Windows签名：EVMode
 *  微软EV驱动签名: microEVMode
 *  微软EV驱动签名（ARM）: microEVMode-ARM64
 *  纯微软驱动签名（不带tecent相关签名）: microMode
 */
const SignType = 'EVMode';
const Organization = 'Tencent Technology(Shenzhen) Company Limited';
/**
 * 签名结果检查间隔
 * @type {number} 检查间隔时间，单位毫秒，间隔时间过短可能导致接口调用超频，进而导致签名失败
 */
const QueryInterval = 5000;

const domain = 'https://proxy.keystore.woa.com'; // 要使用https域名
const UploadUrl = `${domain}/api/file/upload`;
const SignUrl = `${domain}/api/windows/signjob`;

function getToken() {
  return jose.JWT.sign(
    {
      authId: AuthId,
      timeMillis: Math.floor(Date.now() / 1000),
    },
    AuthSecret,
    {
      algorithm: 'HS256',
    },
  );
}

function uploadFile(filePath) {
  return new Promise((resolve, reject) => {
    request.post(
      {
        url: UploadUrl,
        headers: {
          Authorization: getToken(),
        },
        rejectUnauthorized: false,
        formData: {
          file: fs.createReadStream(filePath),
        },
        gzip: true,
      },
      (err, resp, body) => {
        if (!err && resp.statusCode === 200) {
          if (resp.headers['content-type'].includes('application/json;')) {
            const jsonBody = JSON.parse(body);
            if (jsonBody.code === 0) {
              resolve(jsonBody);
            } else {
              reject(jsonBody);
            }
          } else {
            reject(body);
          }
        } else if (err) {
          reject(err);
        } else {
          reject(body);
        }
      },
    );
  });
}

function applySign(fileId) {
  return new Promise((resolve, reject) => {
    request.post(
      {
        url: SignUrl,
        rejectUnauthorized: false,
        headers: {
          Authorization: getToken(),
        },
        json: true,
        body: {
          organization: Organization,
          signType: SignType,
          srcFileIds: [fileId],
        },
        gzip: true,
      },
      (err, resp, body) => {
        if (!err && resp.statusCode === 200) {
          // 因为请求里指定了json为true，所以会自动解析，不需要自行解析
          if (body.code === 0) {
            resolve(body);
          } else {
            reject(body);
          }
        } else if (err) {
          reject(err);
        } else {
          reject(body);
        }
      },
    );
  });
}

function querySign(applyId, filePath) {
  return new Promise((resolve, reject) => {
    request.get(
      {
        uri: SignUrl,
        qs: {
          id: applyId,
        },
        rejectUnauthorized: false,
        headers: {
          Authorization: getToken(),
        },
        gzip: true,
        encoding: null,
      },
      (err, resp, body) => {
        if (!err && resp.statusCode === 200) {
          if (resp.headers['content-type'].includes('application/json;')) {
            // 返回的是json内容，说明签名进行中，或者签名失败
            const jsonBody = JSON.parse(body);
            if (jsonBody.code === 0) {
              resolve(jsonBody); // 返回body
            } else {
              reject(jsonBody); // 报错
            }
          } else if (resp.headers['content-type'].includes('application/octet-stream')) {
            fs.writeFile(filePath, body, 'binary', (err) => {
              if (!err) {
                resolve(null); // 文件下载并写入成功，返回null
              } else {
                reject(err); // 文件写入失败，返回错误信息
              }
            });
          } else {
            reject(`unexpect response content type: ${resp.headers['content-type']}`);
          }
        } else if (err) {
          reject(err);
        } else {
          reject(body);
        }
      },
    );
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, milliseconds);
  });
}

async function autoWinSignWss(filePath) {
  try {
    console.log('autoWinSignWss upload', filePath);
    let ret = await uploadFile(filePath);
    console.log('autoWinSignWss apply', ret.data);
    ret = await applySign(ret.data);
    const applyId = ret.data;
    const zipFilePath = `${filePath}.zip`;
    console.log('autoWinSignWss wait', ret.data);
    while (ret !== null) {
      await sleep(QueryInterval); // 等待一段时间后再进行下一次检查
      ret = await querySign(applyId, zipFilePath);
    }
    console.log('autoWinSignWss unzip', zipFilePath);
    if (fs.existsSync(zipFilePath)) {
      await extract(zipFilePath, { dir: path.dirname(zipFilePath) });
      fs.unlinkSync(zipFilePath);
      console.log('autoWinSignWss end');
    }
  } catch (err) {
    throw new Error(`autoWinSignWss error: ${err}`);
  }
}

module.exports = async function (filePath) {
  console.log('autoWinSignWss start');
  await autoWinSignWss(filePath);
};
