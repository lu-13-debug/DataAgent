import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthRoot } from './AuthRoot';
import './styles.css';
import './readability.css';
import './accounts.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthRoot><App /></AuthRoot></React.StrictMode>);
