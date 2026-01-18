/**
 * Example 12: Authentication (Unstable API)
 *
 * Demonstrates how to use the unstable authentication API to:
 * 1. Check if already logged in (returns existing userinfo)
 * 2. Initiate an interactive login flow if not logged in
 * 3. Receive user information after successful login
 * 4. Use different authentication environments
 *
 * Supported environments:
 * - 'external': External environment (www.codebuddy.ai) - default
 * - 'internal': Tencent internal environment (copilot.tencent.com)
 * - 'ioa': iOA environment (tencent.sso.copilot.tencent.com)
 * - 'cloudhosted': Cloud-hosted environment (*.sso.copilot.tencent.com)
 * - Custom endpoint: Enterprise self-hosted environment
 *
 * Note: This API is marked as unstable and may change in future versions.
 *
 * Run: bun run examples/12-auth.ts
 */

import { unstable_v2_authenticate, type AuthEnvironment } from '../src';

// Helper to open URL in browser (cross-platform)
async function openUrl(url: string): Promise<void> {
    const { exec } = await import('child_process');
    const platform = process.platform;

    let command: string;
    if (platform === 'darwin') {
        command = `open "${url}"`;
    } else if (platform === 'win32') {
        command = `start "" "${url}"`;
    } else {
        command = `xdg-open "${url}"`;
    }

    return new Promise((resolve) => {
        exec(command, (error) => {
            if (error) {
                console.log(`Failed to open browser, please open manually: ${url}`);
            }
            resolve();
        });
    });
}

// Print user information after successful authentication
function printUserInfo(result: Awaited<ReturnType<typeof unstable_v2_authenticate>>) {
    console.log('=== Authentication Successful! ===\n');
    console.log('User Information:');
    console.log(`  User ID: ${result.userinfo.userId}`);
    console.log(`  Username: ${result.userinfo.userName}`);
    console.log(`  Nickname: ${result.userinfo.userNickname}`);
    if (result.userinfo.enterpriseId) {
        console.log(`  Enterprise ID: ${result.userinfo.enterpriseId}`);
    }
    if (result.userinfo.enterprise) {
        console.log(`  Enterprise: ${result.userinfo.enterprise}`);
    }
    console.log(`  Token: ${result.userinfo.token.substring(0, 20)}...`);
}

// Example 1: Default environment (external)
async function authenticateDefault() {
    console.log('=== Example 1: Default Environment (external) ===\n');
    console.log('Checking authentication status...\n');

    const result = await unstable_v2_authenticate({
        // environment defaults to 'external' if not specified
        onAuthUrl: async (authState) => {
            console.log('Not logged in. Please complete authentication in your browser.');
            console.log(`Login URL: ${authState.authUrl}\n`);
            console.log('Opening browser...');
            await openUrl(authState.authUrl);
            console.log('Waiting for authentication to complete...\n');
        },
        timeout: 300000, // 5 minutes
    });

    printUserInfo(result);
    return result;
}

// Example 2: Internal environment (Tencent internal)
async function authenticateInternal() {
    console.log('=== Example 2: Internal Environment ===\n');
    console.log('Authenticating with internal environment...\n');

    const result = await unstable_v2_authenticate({
        environment: 'internal',
        onAuthUrl: async (authState) => {
            console.log('Internal login URL:', authState.authUrl);
            console.log('Opening browser...');
            await openUrl(authState.authUrl);
            console.log('Waiting for authentication to complete...\n');
        },
        timeout: 300000,
    });

    printUserInfo(result);
    return result;
}

// Example 3: iOA environment
async function authenticateIOA() {
    console.log('=== Example 3: iOA Environment ===\n');
    console.log('Authenticating with iOA environment...\n');

    const result = await unstable_v2_authenticate({
        environment: 'ioa',
        onAuthUrl: async (authState) => {
            console.log('iOA login URL:', authState.authUrl);
            console.log('Opening browser...');
            await openUrl(authState.authUrl);
            console.log('Waiting for authentication to complete...\n');
        },
        timeout: 300000,
    });

    printUserInfo(result);
    return result;
}

// Example 4: Cloud-hosted environment
async function authenticateCloudhosted() {
    console.log('=== Example 4: Cloud-hosted Environment ===\n');
    console.log('Authenticating with cloud-hosted environment...\n');

    const result = await unstable_v2_authenticate({
        environment: 'cloudhosted',
        onAuthUrl: async (authState) => {
            console.log('Cloud-hosted login URL:', authState.authUrl);
            console.log('Opening browser...');
            await openUrl(authState.authUrl);
            console.log('Waiting for authentication to complete...\n');
        },
        timeout: 300000,
    });

    printUserInfo(result);
    return result;
}

// Example 5: Self-hosted environment (custom endpoint)
async function authenticateSelfhosted(endpoint: string) {
    console.log('=== Example 5: Self-hosted Environment ===\n');
    console.log(`Authenticating with self-hosted endpoint: ${endpoint}\n`);

    const result = await unstable_v2_authenticate({
        endpoint, // Use custom endpoint instead of environment
        onAuthUrl: async (authState) => {
            console.log('Self-hosted login URL:', authState.authUrl);
            console.log('Opening browser...');
            await openUrl(authState.authUrl);
            console.log('Waiting for authentication to complete...\n');
        },
        timeout: 300000,
    });

    printUserInfo(result);
    return result;
}

async function main() {
    console.log('=== Multi-Environment Authentication Example (Unstable API) ===\n');
    console.log('Available environments:');
    console.log('  - external: External environment (www.codebuddy.ai) [default]');
    console.log('  - internal: Tencent internal environment (copilot.tencent.com)');
    console.log('  - ioa: iOA environment (tencent.sso.copilot.tencent.com)');
    console.log('  - cloudhosted: Cloud-hosted environment (*.sso.copilot.tencent.com)');
    console.log('  - endpoint: Custom self-hosted endpoint\n');

    // Parse command line arguments
    const args = process.argv.slice(2);
    const envArg = args.find(arg => arg.startsWith('--env='));
    const endpointArg = args.find(arg => arg.startsWith('--endpoint='));

    try {
        if (endpointArg) {
            // Self-hosted with custom endpoint
            const endpoint = endpointArg.split('=')[1];
            await authenticateSelfhosted(endpoint);
        } else if (envArg) {
            // Predefined environment
            const environment = envArg.split('=')[1] as AuthEnvironment;
            switch (environment) {
                case 'internal':
                    await authenticateInternal();
                    break;
                case 'ioa':
                    await authenticateIOA();
                    break;
                case 'cloudhosted':
                    await authenticateCloudhosted();
                    break;
                case 'external':
                default:
                    await authenticateDefault();
                    break;
            }
        } else {
            // Default: external environment
            await authenticateDefault();
        }
    } catch (error) {
        if (error instanceof Error && error.name === 'AuthenticationError') {
            const authError = error as unknown as { type: string; message: string };
            console.error(`\nAuthentication failed: ${authError.type}`);
            console.error(`Message: ${authError.message}`);
        } else {
            console.error('\nUnexpected error:', error);
        }
    }

    console.log('\n=== Done ===');
    console.log('\nUsage examples:');
    console.log('  bun run examples/12-auth.ts                              # Default (external)');
    console.log('  bun run examples/12-auth.ts --env=internal               # Internal environment');
    console.log('  bun run examples/12-auth.ts --env=ioa                    # iOA environment');
    console.log('  bun run examples/12-auth.ts --env=cloudhosted            # Cloud-hosted environment');
    console.log('  bun run examples/12-auth.ts --endpoint=https://my.corp   # Self-hosted endpoint');
}

main().catch(console.error);