import { Metadata } from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = {
  title: 'Movement Guide | Rehably',
  description: 'AI-powered pose guidance for physiotherapy exercises',
};

// Dynamically import to avoid SSR issues with MediaPipe + camera APIs
const PoseDemoRunner = dynamic(
  () => import('./PoseDemoRunner'),
  {
    ssr: false,
    loading: () => (
      <div style={{
        minHeight: '100vh',
        background: '#080c14',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#64748b',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
      }}>
        Loading Rehably Movement Guide…
      </div>
    ),
  }
);

export default function PoseDemoPage() {
  return <PoseDemoRunner />;
}
