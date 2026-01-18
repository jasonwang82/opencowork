const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 定义根目录（相对于脚本所在位置）
const ROOT_DIR = path.resolve(__dirname, '..');
const BIN_DIR = path.join(ROOT_DIR, 'bin');
const DEVTOOLS_DIR = path.join(ROOT_DIR, 'devtools');
// JB
const JETBRAINS_GEN_BIN_DIR = path.join(ROOT_DIR, '..', 'jetbrains', 'gen', 'bin');
const JETBRAINS_GEN_DEVTOOLS_DIR = path.join(ROOT_DIR, '..', 'jetbrains', 'gen', 'devtools');
const JETBRAINS_VSIX_SERVER_PATH = path.join(ROOT_DIR, '..', 'jetbrains', 'vsix', 'server.js');
const JETBRAINS_VSIX_SERVER_MAP_PATH = path.join(ROOT_DIR, '..', 'jetbrains', 'vsix', 'server.js.map');
// XCode
const XCode_GEN_BIN_DIR = path.join(ROOT_DIR, '..', 'xcode', 'resources', 'gen', 'bin');
const XCode_GEN_DEVTOOLS_DIR = path.join(ROOT_DIR, '..', 'xcode', 'resources', 'gen', 'devtools');
const XCode_VSIX_SERVER_PATH = path.join(ROOT_DIR, '..', 'xcode', 'resources', 'vsix', 'extension', 'server.js');
const XCode_VSIX_SERVER_MAP_PATH = path.join(ROOT_DIR, '..', 'xcode', 'resources', 'vsix', 'extension', 'server.js.map');
// VS
const VS_VSIX_SERVER_PATH = path.join(ROOT_DIR, '..', 'visualstudio', 'TencentCodebuddy', 'Resources', 'vsix', 'extension', 'server.js');
const VS_VSIX_SERVER_MAP_PATH = path.join(ROOT_DIR, '..', 'visualstudio', 'TencentCodebuddy', 'Resources', 'vsix', 'extension', 'server.js.map');

const SERVER_JS_PATH = path.join(ROOT_DIR, 'dist', 'server.js');
const SERVER_JS_MAP_PATH = path.join(ROOT_DIR, 'dist', 'server.js.map');

/**
 * 执行命令并打印输出
 */
function runCommand(command) {
  console.log(`\n> ${command}`);
  try {
    execSync(command, { stdio: 'inherit', cwd: ROOT_DIR });
  } catch (error) {
    console.error(`命令执行失败: ${command}`);
    process.exit(1);
  }
}

/**
 * 确保目录存在，如果不存在则创建
 */
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`创建目录: ${dirPath}`);
  }
}

/**
 * 复制文件或目录
 */
function copyPath(source, destination) {
  if (fs.existsSync(source)) {
    if (fs.lstatSync(source).isDirectory()) {
      // 如果目标存在，先删除
      if (fs.existsSync(destination)) {
        fs.rmSync(destination, { recursive: true, force: true });
      }

      // 复制整个目录
      fs.cpSync(source, destination, { recursive: true });
      console.log(`复制目录: ${source} -> ${destination}`);
    } else {
      // 确保目标目录存在
      ensureDirectoryExists(path.dirname(destination));

      // 复制单个文件
      fs.copyFileSync(source, destination);
      console.log(`复制文件: ${source} -> ${destination}`);
    }
  } else {
    console.error(`源路径不存在: ${source}`);
    process.exit(1);
  }
}

/**
 * 主构建流程
 */
async function build() {
  console.log('开始构建流程...');

  // 步骤1: TypeScript编译
  console.log('\n=== 步骤1: TypeScript编译 ===');
  runCommand('yarn compile');

  // 步骤2: Webpack构建
  console.log('\n=== 步骤2: Webpack构建 ===');
  runCommand('yarn bundle');

  // 步骤3: 为各平台构建二进制文件
  console.log('\n=== 步骤3: 构建平台二进制文件 ===');
  // runCommand('yarn build');
  console.log('skip -- ');

  // 步骤4: 复制文件到JetBrains插件目录
  console.log('\n=== 步骤4: 复制文件到JetBrains插件目录 ===');

  // 确保目标目录存在
  // ensureDirectoryExists(path.dirname(JETBRAINS_GEN_BIN_DIR));
  ensureDirectoryExists(path.dirname(JETBRAINS_VSIX_SERVER_PATH));

  // 复制bin目录
  // copyPath(BIN_DIR, JETBRAINS_GEN_BIN_DIR);

  // 复制devtools目录
  copyPath(DEVTOOLS_DIR, JETBRAINS_GEN_DEVTOOLS_DIR);

  // 复制server.js文件
  copyPath(SERVER_JS_PATH, JETBRAINS_VSIX_SERVER_PATH);

  // 复制server.js.map文件
  copyPath(SERVER_JS_MAP_PATH, JETBRAINS_VSIX_SERVER_MAP_PATH);

  // 步骤4: 复制文件到XCode插件目录
  console.log('\n=== 步骤4: 复制文件到XCode插件目录 ===');

  // 确保目标目录存在
  // ensureDirectoryExists(path.dirname(XCode_GEN_BIN_DIR));
  ensureDirectoryExists(path.dirname(XCode_VSIX_SERVER_PATH));

  // 复制bin目录
  // copyPath(BIN_DIR, XCode_GEN_BIN_DIR);

  // 复制devtools目录
  // copyPath(DEVTOOLS_DIR, XCode_GEN_DEVTOOLS_DIR);

  // 复制server.js文件
  copyPath(SERVER_JS_PATH, XCode_VSIX_SERVER_PATH);

  // 复制server.js.map文件
  copyPath(SERVER_JS_MAP_PATH, XCode_VSIX_SERVER_MAP_PATH);

  // 步骤5: 复制文件到Visual Studio插件目录
  console.log('\n=== 步骤5: 复制文件到Visual Studio插件目录 ===');

  // 确保目标目录存在
  ensureDirectoryExists(path.dirname(VS_VSIX_SERVER_PATH));

  // 复制server.js文件
  copyPath(SERVER_JS_PATH, VS_VSIX_SERVER_PATH);

  // 复制server.js.map文件
  copyPath(SERVER_JS_MAP_PATH, VS_VSIX_SERVER_MAP_PATH);

  console.log('\n构建完成! 🎉');
}

// 执行构建
build().catch(error => {
  console.error('构建过程中发生错误:', error);
  process.exit(1);
});
