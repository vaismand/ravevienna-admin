import type { DjFormData } from '../types/database';

export const EMPTY_DJ_FORM: DjFormData = {
  name: '',
  slug: '',
  bio: '',
  genres: [],
  instagram_url: '',
  soundcloud_url: '',
  spotify_url: '',
  website_url: '',
  image_url: '',
  city: 'Vienna',
  country: 'Austria',
  is_active: true,
};
