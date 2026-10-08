// Entry point of the popup. It does one job: put the <App /> component
// into the empty <div id="root"> in index.html. You rarely touch this file.
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './style.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
