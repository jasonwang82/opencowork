#!/bin/bash

# WorkBuddy 构建脚本
# 用于构建 macOS 应用程序包

set -e  # 遇到错误立即退出

echo "🚀 开始构建 WorkBuddy..."

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

# 5. 代码签名
echo ""
echo "🔐 开始代码签名..."

# 签名身份 - 使用不同证书签名不同类型的文件
# DevID_kjsh_app.p12 - 用于签名 .app 应用程序
APP_IDENTITY="Developer ID Application: Tencent Technology (Shanghai) Company Limited (FN2V63AD2J)"
# DevID_kjsh_installer.p12 - 用于签名 DMG 安装包
DMG_IDENTITY="Developer ID Installer: Tencent Technology (Shanghai) Co., Ltd (FN2V63AD2J)"

# 应用路径
APP_PATH="release/$VERSION/mac-arm64/WorkBuddy.app"
DMG_PATH="release/$VERSION/WorkBuddy-Mac-$VERSION-Installer.dmg"

# 检查 App 证书是否存在
echo "📋 检查 App 签名证书..."
if ! security find-identity -v -p codesigning | grep -q "$APP_IDENTITY"; then
    echo "⚠️  警告: 未找到 App 签名证书 '$APP_IDENTITY'"
    echo "   跳过代码签名步骤"
    echo ""
    echo "✅ 构建完成（未签名）！"
    echo ""
    echo "📁 构建产物位置:"
    echo "   - DMG 安装包: release/$VERSION/WorkBuddy-Mac-$VERSION-Installer.dmg"
    echo "   - 应用程序: release/$VERSION/mac-arm64/WorkBuddy.app"
    exit 0
fi
echo "✅ 找到 App 签名证书"

# 检查 Installer 证书是否存在
echo "📋 检查 Installer 签名证书..."
if ! security find-identity -v | grep -q "$DMG_IDENTITY"; then
    echo "⚠️  警告: 未找到 Installer 签名证书 '$DMG_IDENTITY'"
    echo "   将只签名 App，跳过 DMG 签名"
    DMG_SIGN_ENABLED=false
else
    echo "✅ 找到 Installer 签名证书"
    DMG_SIGN_ENABLED=true
fi

# 签名 .app 内部所有可执行文件和框架
echo "🔏 签名 WorkBuddy.app (使用 Developer ID Application)..."
echo "📝 执行命令: codesign --force --deep --verbose --sign \"$APP_IDENTITY\" \"$APP_PATH\""
codesign --force --deep --verbose --sign "$APP_IDENTITY" "$APP_PATH" 2>&1

if [ $? -eq 0 ]; then
    echo "✅ WorkBuddy.app 签名成功"
    APP_SIGNED=true
else
    echo "⚠️  WorkBuddy.app 签名失败"
    echo ""
    echo "📋 可能的解决方案:"
    echo "   1. 打开 '钥匙串访问' (Keychain Access)"
    echo "   2. 找到 'Developer ID Application: Tencent...' 证书"
    echo "   3. 展开它，双击下面的私钥"
    echo "   4. 点击 '访问控制' → '允许所有应用程序访问'"
    echo "   5. 保存更改 (需要 macOS 密码)"
    echo ""
    echo "⏭️  继续生成未签名版本..."
    APP_SIGNED=false
fi

# 签名 DMG (使用 Installer 证书)
DMG_SIGNED=false
if [ "$DMG_SIGN_ENABLED" = true ] && [ "$APP_SIGNED" = true ]; then
    echo "🔏 签名 DMG 安装包 (使用 Developer ID Installer)..."
    echo "📝 执行命令: codesign --force --verbose --sign \"$DMG_IDENTITY\" \"$DMG_PATH\""
    codesign --force --verbose --sign "$DMG_IDENTITY" "$DMG_PATH" 2>&1

    if [ $? -eq 0 ]; then
        echo "✅ DMG 签名成功"
        DMG_SIGNED=true
    else
        echo "⚠️  DMG 签名失败，继续..."
    fi
else
    echo "⚠️  跳过 DMG 签名"
fi

# 验证签名（仅当签名成功时）
if [ "$APP_SIGNED" = true ]; then
    echo ""
    echo "🔍 验证 App 签名..."
    codesign --verify --verbose "$APP_PATH" 2>&1
    
    if [ $? -eq 0 ]; then
        echo "✅ App 签名验证通过"
    else
        echo "⚠️  App 签名验证失败"
        APP_SIGNED=false
    fi
fi

if [ "$DMG_SIGNED" = true ]; then
    echo ""
    echo "🔍 验证 DMG 签名..."
    codesign --verify --verbose "$DMG_PATH" 2>&1
    
    if [ $? -eq 0 ]; then
        echo "✅ DMG 签名验证通过"
    else
        echo "⚠️  DMG 签名验证失败"
        DMG_SIGNED=false
    fi
fi

# 显示签名信息
if [ "$APP_SIGNED" = true ]; then
    echo ""
    echo "📜 App 签名详情:"
    codesign -dvvv "$APP_PATH" 2>&1 | grep -E "Authority|TeamIdentifier|Signature" | head -5
fi

if [ "$DMG_SIGNED" = true ]; then
    echo ""
    echo "📜 DMG 签名详情:"
    codesign -dvvv "$DMG_PATH" 2>&1 | grep -E "Authority|TeamIdentifier|Signature" | head -5
fi

# 构建完成
echo ""
echo "✅ 构建完成！"
echo ""
echo "📁 构建产物位置:"
if [ "$DMG_SIGNED" = true ]; then
    echo "   - DMG 安装包 (已签名): release/$VERSION/WorkBuddy-Mac-$VERSION-Installer.dmg"
else
    echo "   - DMG 安装包 (未签名): release/$VERSION/WorkBuddy-Mac-$VERSION-Installer.dmg"
fi
if [ "$APP_SIGNED" = true ]; then
    echo "   - 应用程序 (已签名): release/$VERSION/mac-arm64/WorkBuddy.app"
else
    echo "   - 应用程序 (未签名): release/$VERSION/mac-arm64/WorkBuddy.app"
fi

if [ "$APP_SIGNED" = false ]; then
    echo ""
    echo "⚠️  注意: 应用未签名，首次运行需要："
    echo "   1. 右键点击应用 → 选择'打开'"
    echo "   2. 或在系统设置 → 隐私与安全性 中允许"
fi

echo ""
echo "🔍 验证签名命令:"
echo "   codesign --verify --verbose /Applications/WorkBuddy.app"
echo "   codesign -dvvv /Applications/WorkBuddy.app"
echo ""
echo "🎉 可以分发 DMG 文件给用户安装使用！"
