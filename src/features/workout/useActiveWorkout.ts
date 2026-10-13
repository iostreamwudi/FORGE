import type { WorkoutSet } from '@/types/domain';
import { useForgeAppActions, useForgeAppState } from '@/state/ForgeAppContext';

export function useActiveWorkout() {
  const state = useForgeAppState();
  const actions = useForgeAppActions();
  return { ...state, ...actions };
}

export type SetEditorTarget = { set: WorkoutSet; field: 'kg' | 'reps' } | null;
