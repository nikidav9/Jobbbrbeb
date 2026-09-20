import React, { useCallback, useEffect, useRef } from 'react';
import { View, type ViewProps } from 'react-native';
import {
  clearOnboardingTarget,
  registerOnboardingMeasurer,
  setOnboardingTarget,
} from '@/lib/onboardingTargets';

type Props = ViewProps & {
  targetKey: string;
};

export function OnboardingTarget({ targetKey, children, onLayout, ...props }: Props) {
  const ref = useRef<View>(null);

  const measure = useCallback(() => {
    ref.current?.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) setOnboardingTarget(targetKey, { x, y, w, h });
    });
  }, [targetKey]);

  useEffect(() => {
    const unregister = registerOnboardingMeasurer(targetKey, measure);
    const timer = setTimeout(measure, 60);
    return () => {
      clearTimeout(timer);
      unregister();
      clearOnboardingTarget(targetKey);
    };
  }, [measure, targetKey]);

  return (
    <View
      {...props}
      ref={ref}
      collapsable={false}
      onLayout={(event) => {
        onLayout?.(event);
        measure();
      }}
    >
      {children}
    </View>
  );
}

