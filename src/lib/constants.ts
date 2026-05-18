import type { DraftEventStatus } from '../types/database';

export const GENRE_OPTIONS = [
  'Techno',
  'Tek',
  'Hard Techno',
  'House',
  'DnB',
  'Trance',
  'Hard Trance',
  'Psytrance',
  'Acid',
  'Breakbeat',
  'Electro',
  'Garage',
  'Dubstep',
  'Bounce',
  'Live',
  'Electronic',
] as const;

export const STATUS_TABS: { key: DraftEventStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'published', label: 'Published' },
];

export const COLORS = {
  bg: '#020707',
  card: 'rgba(3, 10, 10, 0.94)',
  accent: '#00F0D0',
  warning: '#FFD84D',
  text: '#ffffff',
  muted: '#8a9a9a',
  border: 'rgba(0, 240, 208, 0.15)',
  danger: '#ff6b6b',
} as const;
