// The /demo hero embeds the official YouTube film; the hosted file is a link on the page, not a <video>.
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import HeroVideo from './components/HeroVideo';
import { renderAt } from './test/utils';

const frame = () => screen.getByTitle('Ver el recorrido en video');

test('a lazy 16:9 privacy-friendly YouTube embed, with the player permissions', () => {
  renderAt(<HeroVideo />);
  const v = frame();
  expect(v.tagName).toBe('IFRAME');
  expect(v.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/z8IdL3_Skvg');
  expect(v.getAttribute('allow')).toBe('accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
  expect(v.hasAttribute('allowfullscreen')).toBe(true);
  expect(v.getAttribute('loading')).toBe('lazy');
  expect(document.querySelector('[data-hero-video]')).toBeTruthy();
  expect(document.querySelector('video')).toBeNull();
});

test('in English the frame title follows the tab language', () => {
  sessionStorage.setItem('lang', 'en');
  renderAt(<HeroVideo />);
  expect(screen.getByTitle('Watch the walkthrough video').getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/z8IdL3_Skvg');
});
