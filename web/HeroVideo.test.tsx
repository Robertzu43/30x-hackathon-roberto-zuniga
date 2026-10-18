// AC-114 (R-169): the /demo hero video, driven by /demo/video.json.
import { fireEvent, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import HeroVideo, { type VideoManifest } from './components/HeroVideo';
import { renderAt } from './test/utils';

const M: VideoManifest = {
  src: '/demo/happy-path.webm', type: 'video/webm', poster: '/demo/happy-path-poster.jpg',
  tracks: [{ src: '/demo/happy-path.es.vtt', srclang: 'es', label: 'Español' }, { src: '/demo/happy-path.en.vtt', srclang: 'en', label: 'English' }],
};
const video = () => document.querySelector('video')!;

test('a native video with controls, playsinline, preload metadata, the manifest poster, and no autoplay', () => {
  renderAt(<HeroVideo manifest={M} />);
  const v = video();
  expect(v.hasAttribute('controls')).toBe(true);
  expect(v.hasAttribute('playsinline')).toBe(true);
  expect(v.getAttribute('preload')).toBe('metadata');
  expect(v.hasAttribute('autoplay')).toBe(false);
  expect(v.getAttribute('poster')).toBe('/demo/happy-path-poster.jpg');
  expect(v.getAttribute('src')).toBe('/demo/happy-path.webm');
});

test('one captions track per manifest language; the tab language is the default', () => {
  renderAt(<HeroVideo manifest={M} />);
  const tracks = [...document.querySelectorAll('track')];
  expect(tracks.map((t) => [t.getAttribute('src'), t.getAttribute('srclang'), t.getAttribute('kind'), t.hasAttribute('default')])).toEqual([
    ['/demo/happy-path.es.vtt', 'es', 'captions', true],
    ['/demo/happy-path.en.vtt', 'en', 'captions', false],
  ]);
});

test('in English the English track is the default; with no track in the tab language none is (the film)', () => {
  sessionStorage.setItem('lang', 'en');
  const { unmount } = renderAt(<HeroVideo manifest={M} />);
  expect([...document.querySelectorAll('track[default]')].map((t) => t.getAttribute('srclang'))).toEqual(['en']);
  unmount();
  sessionStorage.setItem('lang', 'es');
  renderAt(<HeroVideo manifest={{ ...M, tracks: [M.tracks[1]!] }} />);
  expect(document.querySelectorAll('track[default]')).toHaveLength(0);
});

test('the play button is named «Reproducir el video», calls play() and goes away', () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  renderAt(<HeroVideo manifest={M} />);
  fireEvent.click(screen.getByRole('button', { name: 'Reproducir el video' }));
  expect(play).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Reproducir el video' })).toBeNull();
});

test('a failed manifest keeps the box and shows the designed message with the walkthrough link', () => {
  renderAt(<HeroVideo manifest={null} />);
  expect(document.querySelector('[data-hero-video]')).toBeTruthy();
  expect(screen.getByText('No pude cargar el video.')).toBeTruthy();
  expect(screen.getByRole('link', { name: /Ver el recorrido en video/ })).toBeTruthy();
  expect(video()).toBeNull();
});

test('a video that fails to load shows the same message', () => {
  renderAt(<HeroVideo manifest={M} />);
  fireEvent.error(video());
  expect(screen.getByText('No pude cargar el video.')).toBeTruthy();
});

test('while the manifest loads the 16:9 box is there, empty', () => {
  renderAt(<HeroVideo manifest={undefined} />);
  expect(document.querySelector('[data-hero-video]')).toBeTruthy();
  expect(video()).toBeNull();
});
