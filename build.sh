#!/bin/bash

# CodeBuddy Work 构建脚本
# 用于构建 macOS 应用程序包

set -e  # 遇到错误立即退出

echo "🚀 开始构建 CodeBuddy Work..."

# 获取版本号
VERSION=$(node -p "require('./package.json').version")
echo "📦 版本: $VERSION"

# 检查 logo.png 是否存在
if [ ! -f "logo.png" ]; then
    echo "❌ 错误: logo.png 文件不存在"
    exit 1
fi

# 检查 logo.png 尺寸（macOS 需要至少 512x512）
LOGO_SIZE=$(sips -g pixelWidth -g pixelHeight logo.png 2>/dev/null | grep -E "pixelWidth|pixelHeight" | awk '{print $2}')
WIDTH=$(echo "$LOGO_SIZE" | head -n 1)
HEIGHT=$(echo "$LOGO_SIZE" | tail -n 1)

echo "🖼️  检查图标尺寸: ${WIDTH}x${HEIGHT}"

if [ "$WIDTH" -lt 512 ] || [ "$HEIGHT" -lt 512 ]; then
    echo "⚠️  图标尺寸不足 512x512，正在调整..."
    sips -z 512 512 logo.png --out logo-temp.png 2>/dev/null || true
    if [ -f "logo-temp.png" ]; then
        mv logo-temp.png logo.png
        echo "✅ 图标已调整为 512x512"
    else
        echo "❌ 无法调整图标尺寸，请手动调整 logo.png 到至少 512x512"
        exit 1
    fi
else
    echo "✅ 图标尺寸符合要求"
fi

# 清理之前的构建
echo "🧹 清理之前的构建文件..."
rm -rf dist dist-electron release

# 1. 编译 TypeScript
echo "📝 编译 TypeScript..."
npm run lint || echo "⚠️  Lint 警告，继续构建..."
npx tsc

# 2. 构建 Vite 项目
echo "⚡ 构建 Vite 项目..."
npm run build:vite || npx vite build

# 3. 构建 Electron 主进程
echo "🔧 构建 Electron 主进程..."
npx vite build --mode production --config vite.config.ts

# 4. 打包 macOS 应用
echo "🍎 打包 macOS 应用..."
npx electron-builder --mac

# 构建完成
echo ""
echo "✅ 构建完成！"
echo ""
echo "📁 构建产物位置:"
echo "   - DMG 安装包: release/$VERSION/CodeBuddy Work-Mac-$VERSION-Installer.dmg"
echo "   - 应用程序: release/$VERSION/mac-arm64/CodeBuddy Work.app"
echo ""
echo "🎉 可以分发 DMG 文件给用户安装使用！"

