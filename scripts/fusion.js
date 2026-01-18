#!/usr/bin/env node
const minimist = require('minimist');
const path = require('path');

// 解析命令行参数
const args = minimist(process.argv.slice(2), {
  string: ['file'],
});

// 验证必需的参数
if (!args.file) {
  console.error('Error: --file parameter is required');
  process.exit(1);
}

try {
  process.env.NODE_ENV = "production";
  // 解析文件路径为绝对路径
  const filePath = path.isAbsolute(args.file) ? args.file : path.join(process.cwd(), args.file);
  // 动态加载并执行指定文件
  require(filePath);
} catch (error) {
  console.error(`Error loading file ${args.file}:`, error.message);
  process.exit(1);
}