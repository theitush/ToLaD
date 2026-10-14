import { stamp } from './stamp';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { FanApp } from './fan/FanApp';
import './app.css';

// The fan (OneZoom-style) is the main view. ?river shows the time river,
// ?synthetic the spike's synthetic tree.
stamp('modules');
const q = new URLSearchParams(location.search);
const river = q.has('river') || q.has('synthetic');

createRoot(document.getElementById('root')!).render(<StrictMode>{river ? <App /> : <FanApp />}</StrictMode>);
