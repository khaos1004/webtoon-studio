import type { NextConfig } from 'next';

/**
 * ngrok 같은 터널 주소로 개발 서버(npm run dev)를 열면, Next 는 기본적으로 localhost 가 아닌 주소의
 * 개발용 자바스크립트를 막아 버려서 화면은 보이는데 버튼이 안 눌립니다. 아래 목록에 있는 주소만 허용해요.
 * 목록에 없는 주소(커스텀 도메인 등)는 실행할 때 DEV_ORIGINS 로 추가하세요:
 *   DEV_ORIGINS=my-name.ngrok.dev,other.example.com npm run dev
 */
const extra = (process.env.DEV_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['*.ngrok-free.app', '*.ngrok-free.dev', '*.ngrok.app', '*.ngrok.dev', '*.ngrok.io', ...extra],
};

export default nextConfig;
