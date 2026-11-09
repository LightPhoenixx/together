import type { Metadata } from 'next';
import './styles.css';
export const metadata: Metadata = { title: 'Together — Shared expenses, made simple', description: 'Track shared expenses with friends, roommates and family.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
