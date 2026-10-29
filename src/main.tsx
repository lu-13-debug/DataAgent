import React from 'react';
import ReactDOM from 'react-dom/client';
import { Entry } from './PublicShare';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './appearance.css';
import './styles.css';
import './readability.css';
import './accounts.css';
import './appearance-overrides.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AppErrorBoundary><Entry /></AppErrorBoundary></React.StrictMode>);
