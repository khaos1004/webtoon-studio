import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Webtoon Layout Studio',
  description: '영역 선택형 효과와 SVG 말풍선을 갖춘 웹툰 레이아웃 편집기',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
