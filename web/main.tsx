/// <reference types="vite/client" />
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { reloadOnce } from './api';
import { AuthProvider } from './auth';
import { LangProvider, storedLang } from './i18n';
import './styles.css';

document.documentElement.lang = storedLang();
window.addEventListener('vite:preloadError', () => void reloadOnce()); // AC-99: a page chunk gone after a deploy

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </LangProvider>
  </StrictMode>,
);
