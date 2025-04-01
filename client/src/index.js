import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css'; // Keep this even if empty, for potential future global styles
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);