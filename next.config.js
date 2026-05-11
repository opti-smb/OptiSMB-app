/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /** Bundling `xlsx` in Server Components / Route Handlers needs Node externals (parse route). */
  serverExternalPackages: ['xlsx'],
};

module.exports = nextConfig;
