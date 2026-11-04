import { createRoot } from 'react-dom/client';
import Editor from '@/components/Editor';
(globalThis as any).__wtoonWorkerFactory = () => {
  (globalThis as any).__workerCreated = true;
  return new Worker('worker.js');
};
createRoot(document.getElementById('root')!).render(<Editor />);
