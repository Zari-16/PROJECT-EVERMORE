export type ThemeKey = 'lavender' | 'rose' | 'celestial' | 'blush-beige' | 'verdant';
export type Mode = 'light' | 'dark';

export const THEMES: Record<ThemeKey, { display: string; previewColor: string }> = {
  lavender: { display: 'Lavender Enchanted', previewColor: '#BFA9FF' },
  rose: { display: 'Roseblood Romance', previewColor: '#D46E7E' },
  celestial: { display: 'Celestial Blue', previewColor: '#7FB7FF' },
  'blush-beige': { display: 'Pink Pastel & Beige', previewColor: '#F5C6C6' },
  verdant: { display: 'Verdant Fairy Garden', previewColor: '#9FD7B7' },
};
