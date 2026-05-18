import { useState, type KeyboardEvent } from 'react';
import { GENRE_OPTIONS } from '../../lib/constants';
import styles from './GenreMultiSelect.module.css';

interface GenreMultiSelectProps {
  value: string[];
  onChange: (genres: string[]) => void;
}

export function GenreMultiSelect({ value, onChange }: GenreMultiSelectProps) {
  const [customInput, setCustomInput] = useState('');

  const toggle = (genre: string) => {
    if (value.includes(genre)) {
      onChange(value.filter((g) => g !== genre));
    } else {
      onChange([...value, genre]);
    }
  };

  const addCustom = () => {
    const trimmed = customInput.trim();
    if (!trimmed || value.includes(trimmed)) {
      setCustomInput('');
      return;
    }
    onChange([...value, trimmed]);
    setCustomInput('');
  };

  const onCustomKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustom();
    }
  };

  const customGenres = value.filter(
    (g) => !GENRE_OPTIONS.includes(g as (typeof GENRE_OPTIONS)[number]),
  );

  return (
    <div className={styles.wrapper}>
      <div className={styles.chips}>
        {GENRE_OPTIONS.map((genre) => (
          <button
            key={genre}
            type="button"
            className={`${styles.chip} ${value.includes(genre) ? styles.active : ''}`}
            onClick={() => toggle(genre)}
          >
            {genre}
          </button>
        ))}
        {customGenres.map((genre) => (
          <button
            key={genre}
            type="button"
            className={`${styles.chip} ${styles.active} ${styles.custom}`}
            onClick={() => toggle(genre)}
          >
            {genre} ×
          </button>
        ))}
      </div>
      <div className={styles.customRow}>
        <input
          type="text"
          className={styles.input}
          placeholder="Add custom genre…"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={onCustomKeyDown}
        />
        <button type="button" className={styles.addBtn} onClick={addCustom}>
          Add
        </button>
      </div>
    </div>
  );
}
