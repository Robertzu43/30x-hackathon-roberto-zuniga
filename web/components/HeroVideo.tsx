// AC-114 (R-169): the product video in /demo's hero. A native <video> (D40 budget: no player library), no autoplay,
// preload="metadata"; poster, file and captions come from /demo/video.json, so Task 37 and Task 56 swap the video without web code.
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import './hero-video.css';

export type VideoManifest = { src: string; type: string; poster: string; tracks: Array<{ src: string; srclang: string; label: string }> };
const FALLBACK = '/demo/happy-path.webm';

/** `manifest`: undefined while it loads, null when it failed. */
export default function HeroVideo({ manifest }: { manifest: VideoManifest | null | undefined }) {
  const { t, lang } = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  // The recording is silent: the caption track in the tab's language shows, the others stay selectable (`default` only counts at load).
  useEffect(() => {
    for (const tt of Array.from(video.current?.textTracks ?? [])) tt.mode = tt.language === lang ? 'showing' : 'disabled';
  }, [lang, manifest]);
  const play = () => {
    setStarted(true);
    void video.current?.play().catch(() => {}); // a refused play leaves the native controls
  };
  return (
    <div className="hero-video" data-hero-video>
      {manifest === null || failed ? (
        <div className="hero-video-error">
          <p>{t('demo.video.error')}</p>
          <a href={manifest?.src ?? FALLBACK}>{t('demo.video')} →</a>
        </div>
      ) : manifest && (
        <>
          <video ref={video} src={manifest.src} poster={manifest.poster} controls playsInline preload="metadata"
            onPlay={() => setStarted(true)} onError={() => setFailed(true)}>
            {manifest.tracks.map((tr) => <track key={tr.src} kind="captions" src={tr.src} srcLang={tr.srclang} label={tr.label} default={tr.srclang === lang} />)}
          </video>
          {!started && (
            <button type="button" className="hero-play" aria-label={t('demo.video.play')} onClick={play}>
              <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M8 5v14l11-7z" fill="#ffffff" /></svg>
            </button>
          )}
        </>
      )}
    </div>
  );
}
