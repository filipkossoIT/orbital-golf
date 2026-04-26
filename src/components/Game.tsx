'use client';

import { useGameStore } from '@/store/game';
import StartScreen from './StartScreen';
import LobbyScreen from './LobbyScreen';
import GameScreen from './GameScreen';
import EndScreen from './EndScreen';
import Starfield from './Starfield';

export default function Game() {
  const screen = useGameStore((s) => s.screen);
  return (
    <>
      <Starfield />
      {screen === 'start' && <StartScreen />}
      {screen === 'lobby' && <LobbyScreen />}
      {screen === 'game' && <GameScreen />}
      {screen === 'end' && <EndScreen />}
    </>
  );
}
