/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('path');
const cp = require('child_process');
const autoWinSign = require('./auto_win_sign_wss');

const BINARY_DIST_ROOT = path.resolve(__dirname, '../bin');

const BINARY_NAME = 'fusion';

const macosBinaries = ['arm64', 'x64'].map((arch) => `${BINARY_NAME}-macos-${arch}`);

const windowsBinaries = `${BINARY_NAME}-win-x64.exe`;

const binaryWinPath = path.resolve(BINARY_DIST_ROOT, windowsBinaries);

// windows 证书签名
autoWinSign(binaryWinPath);

macosBinaries.forEach((binary) => {
  const binaryPath = path.resolve(BINARY_DIST_ROOT, binary);
  listIdentity();
  signWithIdentity(binaryPath);
});

function listIdentity() {
  const command = 'security';
  const args = ['find-identity', '-v', '-p', 'codesigning'];
  console.info('Execute command: %s', [command, ...args].join(' '));
  cp.spawnSync(command, args, { stdio: 'inherit' });
}

function signWithIdentity(path) {
  const identity = 'Developer ID Application: Tencent Technology (Shenzhen) Company Limited (88L2Q4487U)';
  const command = 'codesign';
  const args = ['--sign', identity, '--force', '--verbose', path];
  console.info('Execute command: %s', [command, ...args].join(' '));
  cp.spawnSync(command, args, { stdio: 'inherit' });
}
