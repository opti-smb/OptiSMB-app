const path = require('path');

/**
 * Turbopack matches `@/*` → `./*` and treats `@/lib/utils` as `./lib/utils` (missing) before tsconfig
 * `@/lib/*` → `statement-js-lib`. Use explicit aliases. Relative values only: absolute `E:\...` breaks Turbopack on Windows.
 * Longer keys (`@/lib/server`, `@/lib/prisma.js`) must shadow `@/lib` for Prisma + auth.
 */
const libAliasesTurbopack = {
  '@/lib/prisma.js': './lib/prisma.js',
  '@/lib/server': './lib/server',
  '@/lib': './services/statement-js-lib/lib',
};

const libAliasesWebpack = {
  '@/lib/prisma.js': path.resolve(__dirname, 'lib/prisma.js'),
  '@/lib/server': path.resolve(__dirname, 'lib/server'),
  '@/lib': path.resolve(__dirname, 'services/statement-js-lib/lib'),
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['xlsx'],
  turbopack: {
    resolveAlias: libAliasesTurbopack,
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...libAliasesWebpack,
    };
    return config;
  },
};

module.exports = nextConfig;
