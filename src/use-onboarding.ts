import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import type { Bootstrap } from './types';
import { onboardingComplete, onboardingKey, progressFromData, readOnboarding, writeOnboarding } from './onboarding';
import type { OnboardingProgress } from './onboarding';

export function useOnboarding(data: Bootstrap | null) {
  const { runtime, user } = useAuth();
  const key = onboardingKey(runtime, user, window.location.origin);
  const [progress, setProgress] = useState<OnboardingProgress>(() => {
    try { return readOnboarding(window.localStorage, key); } catch { return { viewedSample: false, selectedData: false, generatedReport: false, dismissed: false }; }
  });
  const [reviewing, setReviewing] = useState(false);
  const update = useCallback((change: Partial<OnboardingProgress>) => setProgress(previous => ({ ...previous, ...change })), []);
  useEffect(() => {
    if (!data) return;
    setProgress(previous => {
      const next = progressFromData(previous, data.datasets, data.tasks);
      return next.selectedData === previous.selectedData && next.generatedReport === previous.generatedReport ? previous : next;
    });
  }, [data?.datasets, data?.tasks]);
  useEffect(() => { try { writeOnboarding(window.localStorage, key, progress); } catch { /* 浏览器禁用存储时保留内存进度。 */ } }, [key, progress]);
  return {
    progress, complete: onboardingComplete(progress), visible: reviewing || (!progress.dismissed && !onboardingComplete(progress)),
    mark: useCallback((step: 'viewedSample' | 'selectedData') => update({ [step]: true }), [update]),
    dismiss: useCallback(() => { setReviewing(false); update({ dismissed: true }); }, [update]),
    reopen: useCallback(() => { setReviewing(true); update({ dismissed: false }); }, [update]),
  };
}
