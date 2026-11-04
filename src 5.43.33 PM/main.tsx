import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Failed to locate the #root mount node in index.html.');
}

createRoot(rootElement).render(<App />);
