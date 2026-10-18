import { useT } from '../i18n';

/** AC-80: the Thesaurus mark and wordmark (web/public/brand/thesaurus-logo.svg). The tagline stays text, next to it. */
export default function Logo() {
  const { t } = useT();
  return <img className="logo vt-logo" src="/brand/thesaurus-logo.svg" alt={t('app.name')} width={160} height={32} />;
}
