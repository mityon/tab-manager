/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.TAB_MANAGER_EXPORT === '1'
    ? { output: 'export', distDir: 'extensions/dist' }
    : {}),
  reactStrictMode: true,
  images: {
    unoptimized: true, // Imageタグをexport可能にする
  },
  assetPrefix: './', // 画像、cssなどを反映させる
}

module.exports = nextConfig
