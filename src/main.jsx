import React from 'react';
import ReactDOM from 'react-dom/client';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { injectSpeedInsights } from '@vercel/speed-insights';
import App from './App';
import { TONCONNECT_MANIFEST_URL } from './config';
import './styles.css';

injectSpeedInsights();

const manifestUrl = new URL(TONCONNECT_MANIFEST_URL, window.location.origin).toString();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      <App />
    </TonConnectUIProvider>
  </React.StrictMode>
);
