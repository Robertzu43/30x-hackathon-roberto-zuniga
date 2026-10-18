// The /demo hero plays the official film. Privacy-friendly YouTube embed; the hosted mp4 is a link in the pitch, not a second player.
import { useT } from '../i18n';
import './hero-video.css';

const EMBED = 'https://www.youtube-nocookie.com/embed/z8IdL3_Skvg';

export default function HeroVideo() {
  const { t } = useT();
  return (
    <div className="hero-video" data-hero-video>
      <iframe
        src={EMBED}
        title={t('demo.video')}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        loading="lazy"
      />
    </div>
  );
}
