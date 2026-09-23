import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { track } from './lib/analytics';
if (!location.pathname.startsWith('/admin')) {
  const page=()=>track(location.hash.startsWith('#booking')?'booking_started':'landing');
  page(); window.addEventListener('hashchange',page);
}
import './theme.css';
import './styles.css';
import './booking-theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
