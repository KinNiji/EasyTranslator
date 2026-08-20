'use client';

import type { UiLanguage } from '@/lib/i18n';

type Props = {
  language: UiLanguage;
  translate: (key: 'welcomeTitle' | 'welcomeText' | 'howToTitle' | 'howToText' | 'acknowledge' | 'close' | 'wait' | 'seconds') => string;
  secondsLeft: number;
  onAcknowledge: () => void;
  onClose: () => void;
  required: boolean;
};

export function OnboardingDialog({ language, translate: t, secondsLeft, onAcknowledge, onClose, required }: Props) {
  return (
    <div className="modal-backdrop onboarding-backdrop">
      <section className="settings-modal onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="welcome-title" lang={language}>
        <div className="modal-title">
          <h2 id="welcome-title">{t('welcomeTitle')}</h2>
          {!required && <button className="icon-button" aria-label={t('close')} onClick={onClose}>×</button>}
        </div>
        <p>{t('welcomeText')}</p>
        <h3>{t('howToTitle')}</h3>
        <p>{t('howToText')}</p>
        {required ? (
          <button className="primary-button onboarding-confirm" disabled={secondsLeft > 0} onClick={onAcknowledge}>
            {secondsLeft > 0 ? `${t('wait')} ${secondsLeft} ${t('seconds')}` : t('acknowledge')}
          </button>
        ) : <button className="secondary-button onboarding-confirm" onClick={onClose}>{t('close')}</button>}
      </section>
    </div>
  );
}
