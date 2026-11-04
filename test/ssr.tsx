import { renderToString } from 'react-dom/server';
import Editor from '@/components/Editor';
const html = renderToString(<Editor />);
console.log('SSR OK, bytes:', html.length, html.includes('Webtoon Layout Studio') ? 'title-present' : 'no-title');
