import React from 'react';
import { Composition } from 'remotion';
import { Hero, HERO_FRAMES, Promo, PROMO_FRAMES } from './Hero';
import { Tutorial, TUTORIAL_FRAMES } from './Tutorial';

export const Root: React.FC = () => (
  <>
    <Composition id="Hero" component={Hero} durationInFrames={HERO_FRAMES} fps={30} width={1920} height={1080} />
    <Composition id="Promo" component={Promo} durationInFrames={PROMO_FRAMES} fps={30} width={1920} height={1080} />
    <Composition id="Tutorial" component={Tutorial} durationInFrames={TUTORIAL_FRAMES} fps={30} width={1920} height={1080} />
  </>
);
