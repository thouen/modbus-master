import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // serialport/modbus-serial 是 Node.js 原生模块，仅在服务端运行
  serverExternalPackages: ['serialport', 'modbus-serial'],
  // outputFileTracingRoot: path.resolve(__dirname, '../../'),  // Uncomment and add 'import path from "path"' if needed
  /* config options here */
  allowedDevOrigins: ['*.dev.coze.site'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
