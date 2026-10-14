import { stamp } from './stamp';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FanApp } from './fan/FanApp';
import './app.css';

stamp('modules');

createRoot(document.getElementById('root')!).render(<StrictMode><FanApp /></StrictMode>);
