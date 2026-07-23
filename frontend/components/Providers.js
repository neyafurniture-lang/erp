'use client';

import { AuthProvider } from '../lib/auth-context';
import MeetingSynthesisWindow from './MeetingSynthesisWindow';

export default function Providers({ children }) {
  return (
    <AuthProvider>
      {children}
      {/* Fenêtre hors AppShell : survit aux changements de page */}
      <MeetingSynthesisWindow />
    </AuthProvider>
  );
}
