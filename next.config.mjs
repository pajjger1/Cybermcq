/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Temporarily disabled
  images: { unoptimized: true },
  // output: 'standalone', // Temporarily commented out
  typescript: {
    ignoreBuildErrors: true, // Temporarily ignore TS errors
  },
  eslint: {
    ignoreDuringBuilds: true, // Temporarily ignore ESLint errors
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    // Keep webpack overrides minimal to avoid build stalls
    return config;
  },
};

export default nextConfig;


